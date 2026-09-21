import * as fs from "fs";
import { normNameKey } from "../../validator/nameKey";

export type CanonSource = "target" | "furniture";

export interface CanonItem {
  source: CanonSource;
  category: string;
  name: string;
  uom: string;
  aliases: string[];
  note?: string;
  /** null = do not check attrs. [] = none. */
  expectedAttrNames: string[] | null;
  expectedType?: string;
}

export interface ArchiveItem {
  id: number;
  name: string;
  reason: string;
}

export const CAT_FIX: Array<[RegExp, string]> = [
  [/Деровини/g, "Деревини"],
  [/Карказ/g, "Каркас"],
  [/напівфабрікат/g, "напівфабрикат"],
  [/сборка/g, "збірка"],
];

export function fixCat(s: string): string {
  let o = s;
  for (const [re, to] of CAT_FIX) o = o.replace(re, to);
  return o;
}

const SKIP_HEADERS = new Set([
  "правила",
  "категорії (папки odoo)",
  "архів / злити (не канон)",
]);

function parseQuotedList(s: string): string[] {
  return [...s.matchAll(/"([^"]+)"/g)].map((m) => m[1].trim()).filter(Boolean);
}

function expectedAttrsFromNote(
  source: CanonSource,
  note: string | undefined,
): string[] | null {
  if (source === "furniture") return [];
  if (!note) return null;
  const only = note.match(/атрибут лише %([^%]+)%/u);
  if (only) return [only[1]];
  return null;
}

function expectedTypeFromNote(note: string | undefined): string | undefined {
  const m = note?.match(/\btype=(\w+)/u);
  return m?.[1];
}

function categoryFromNote(header: string, note: string | undefined): string {
  if (note && /категорія Послуги/u.test(note)) return "Послуги";
  return header;
}

export function parseCanonMarkdown(
  md: string,
  source: CanonSource,
): CanonItem[] {
  const items: CanonItem[] = [];
  let category = "";
  let current: CanonItem | null = null;

  const flush = (): void => {
    if (current) items.push(current);
    current = null;
  };

  for (const raw of md.split(/\n/)) {
    const t = raw.trim();
    if (t.startsWith("## ")) {
      flush();
      const title = t.slice(3).trim();
      if (SKIP_HEADERS.has(title.toLowerCase())) {
        category = "";
        continue;
      }
      category = title;
      continue;
    }
    if (t.startsWith("# ") && /архів/i.test(t)) {
      flush();
      category = "";
      continue;
    }
    if (t.startsWith("Товар:")) {
      flush();
      if (!category) continue;
      const name = t.slice("Товар:".length).trim().replace(/^"|"$/g, "");
      current = {
        source,
        category,
        name,
        uom: "Одиниці",
        aliases: [],
        expectedAttrNames: source === "furniture" ? [] : null,
      };
      continue;
    }
    if (!current) continue;
    if (t.startsWith("uoms:")) {
      const q = t.match(/"([^"]+)"/);
      if (q) current.uom = q[1];
      continue;
    }
    if (t.startsWith("Аліаси:")) {
      current.aliases.push(...parseQuotedList(t.slice("Аліаси:".length)));
      continue;
    }
    if (t.startsWith("//")) {
      current.note = t.slice(2).trim();
      current.category = categoryFromNote(current.category, current.note);
      current.expectedAttrNames = expectedAttrsFromNote(source, current.note);
      current.expectedType = expectedTypeFromNote(current.note);
    }
  }
  flush();
  return items;
}

export function parseArchive(md: string): ArchiveItem[] {
  const start = md.search(/^## Архів \/ злити/mu);
  if (start < 0) return [];
  const block = md.slice(start);
  const out: ArchiveItem[] = [];
  for (const raw of block.split(/\n/)) {
    const m = raw.match(/^- `(\d+)` (.+?) — (.+)$/u);
    if (!m) continue;
    out.push({ id: Number(m[1]), name: m[2].trim(), reason: m[3].trim() });
  }
  return out;
}

export function loadCanonSpecs(cwd = process.cwd()): {
  canons: CanonItem[];
  archive: ArchiveItem[];
} {
  const target = fs.readFileSync(`${cwd}/right_names.md`, "utf-8");
  const furniture = fs.readFileSync(
    `${cwd}/right_names_furniture.md`,
    "utf-8",
  );
  const byKey = new Map<string, CanonItem>();
  for (const item of [
    ...parseCanonMarkdown(furniture, "furniture"),
    ...parseCanonMarkdown(target, "target"),
  ]) {
    const k = normNameKey(item.name);
    const prev = byKey.get(k);
    if (prev) {
      prev.aliases = [...new Set([...prev.aliases, ...item.aliases])];
      if (!prev.note && item.note) prev.note = item.note;
      if (prev.expectedAttrNames == null) {
        prev.expectedAttrNames = item.expectedAttrNames;
      }
      if (!prev.expectedType && item.expectedType) {
        prev.expectedType = item.expectedType;
      }
      continue;
    }
    byKey.set(k, { ...item, aliases: [...item.aliases] });
  }
  return { canons: [...byKey.values()], archive: parseArchive(target) };
}
