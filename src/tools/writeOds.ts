import { crc32 } from "zlib";
import * as fs from "fs";
import * as path from "path";

export interface OdsSheet {
  name: string;
  rows: string[];
}

function u16(n: number): Buffer {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n);
  return b;
}

function u32(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
}

function dosTime(d = new Date()): { time: number; date: number } {
  return {
    time:
      ((d.getHours() & 0x1f) << 11) |
      ((d.getMinutes() & 0x3f) << 5) |
      (Math.floor(d.getSeconds() / 2) & 0x1f),
    date:
      (((d.getFullYear() - 1980) & 0x7f) << 9) |
      (((d.getMonth() + 1) & 0xf) << 5) |
      (d.getDate() & 0x1f),
  };
}

function zipStore(entries: Array<{ name: string; data: Buffer }>): Buffer {
  const { time, date } = dosTime();
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf-8");
    const crc = crc32(entry.data) >>> 0;
    const local = Buffer.concat([
      Buffer.from("PK\x03\x04"),
      u16(20),
      u16(0),
      u16(0),
      u16(time),
      u16(date),
      u32(crc),
      u32(entry.data.length),
      u32(entry.data.length),
      u16(name.length),
      u16(0),
      name,
      entry.data,
    ]);
    const central = Buffer.concat([
      Buffer.from("PK\x01\x02"),
      u16(20),
      u16(20),
      u16(0),
      u16(0),
      u16(time),
      u16(date),
      u32(crc),
      u32(entry.data.length),
      u32(entry.data.length),
      u16(name.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      name,
    ]);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }
  const centralDir = Buffer.concat(centrals);
  const eocd = Buffer.concat([
    Buffer.from("PK\x05\x06"),
    u16(0),
    u16(0),
    u16(entries.length),
    u16(entries.length),
    u32(centralDir.length),
    u32(offset),
    u16(0),
  ]);
  return Buffer.concat([...locals, centralDir, eocd]);
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function sheetName(raw: string, used: Set<string>): string {
  let base = raw.replace(/[\\/?*\[\]:]/g, " ").replace(/\s+/g, " ").trim();
  if (!base) base = "Sheet";
  if (base.length > 31) base = base.slice(0, 31).trim();
  let name = base;
  let i = 2;
  while (used.has(name.toLowerCase())) {
    const suffix = ` ${i}`;
    name = `${base.slice(0, Math.max(1, 31 - suffix.length))}${suffix}`;
    i++;
  }
  used.add(name.toLowerCase());
  return name;
}

function cellXml(text: string): string {
  const parts = text.split(/\r?\n/);
  const body = parts
    .map((p) => `<text:p>${xmlEscape(p)}</text:p>`)
    .join("");
  return (
    `<table:table-row table:style-name="ro">` +
    `<table:table-cell table:style-name="ce" office:value-type="string">${body}</table:table-cell>` +
    `</table:table-row>`
  );
}

function contentXml(sheets: OdsSheet[]): string {
  const used = new Set<string>();
  const tables = sheets
    .map((sheet) => {
      const name = xmlEscape(sheetName(sheet.name, used));
      const rows = sheet.rows.map((row) => cellXml(row)).join("");
      return (
        `<table:table table:name="${name}">` +
        `<table:table-column table:style-name="co"/>` +
        `${rows}</table:table>`
      );
    })
    .join("");
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<office:document-content` +
    ` xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"` +
    ` xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"` +
    ` xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"` +
    ` xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"` +
    ` xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"` +
    ` office:version="1.3">` +
    `<office:automatic-styles>` +
    `<style:style style:name="ro" style:family="table-row">` +
    `<style:table-row-properties style:row-height="24pt" style:use-optimal-row-height="true"/>` +
    `</style:style>` +
    `<style:style style:name="ce" style:family="table-cell">` +
    `<style:table-cell-properties fo:wrap-option="wrap" style:vertical-align="top"/>` +
    `</style:style>` +
    `<style:style style:name="co" style:family="table-column">` +
    `<style:table-column-properties style:column-width="22cm"/>` +
    `</style:style>` +
    `</office:automatic-styles>` +
    `<office:body><office:spreadsheet>${tables}</office:spreadsheet></office:body>` +
    `</office:document-content>`
  );
}

const STYLES_XML =
  `<?xml version="1.0" encoding="UTF-8"?>` +
  `<office:document-styles xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" office:version="1.3">` +
  `<office:styles/>` +
  `</office:document-styles>`;

const MANIFEST_XML =
  `<?xml version="1.0" encoding="UTF-8"?>` +
  `<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3">` +
  `<manifest:file-entry manifest:full-path="/" manifest:version="1.3" manifest:media-type="application/vnd.oasis.opendocument.spreadsheet"/>` +
  `<manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>` +
  `<manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/>` +
  `</manifest:manifest>`;

export function writeOds(filePath: string, sheets: OdsSheet[]): void {
  const abs = path.resolve(filePath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const zip = zipStore([
    {
      name: "mimetype",
      data: Buffer.from("application/vnd.oasis.opendocument.spreadsheet", "utf-8"),
    },
    { name: "content.xml", data: Buffer.from(contentXml(sheets), "utf-8") },
    { name: "styles.xml", data: Buffer.from(STYLES_XML, "utf-8") },
    {
      name: "META-INF/manifest.xml",
      data: Buffer.from(MANIFEST_XML, "utf-8"),
    },
  ]);
  fs.writeFileSync(abs, zip);
}
