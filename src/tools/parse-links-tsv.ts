/**
 * Parse temp/links-2.tsv (multiline cells) → JSON rows for import triage.
 *   npx ts-node --transpile-only src/tools/parse-links-tsv.ts [path]
 */
import * as fs from "fs";
import * as path from "path";

export interface Links2Row {
  name: string;
  url: string;
  ilyaUpdate: string;
  comment: string;
  newComponents: string;
}

export function parseLinks2Tsv(text: string): Links2Row[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const rows: Links2Row[] = [];
  let i = 0;
  if (lines[0]?.startsWith("Назва")) i = 1;

  function readField(): string {
    let buf = lines[i] ?? "";
    i++;
    while (i < lines.length) {
      const line = lines[i];
      if (!line) {
        i++;
        continue;
      }
      if (/^Диван\t/.test(line) || /^1\. Диван\t/.test(line)) break;
      buf += "\n" + line;
      i++;
    }
    return buf.trim();
  }

  while (i < lines.length) {
    const line = lines[i];
    if (!line?.trim()) {
      i++;
      continue;
    }
    if (!line.includes("https://hackmd.io/")) {
      i++;
      continue;
    }
    const parts = line.split("\t");
    const name = parts[0]?.trim() ?? "";
    const url = (parts[1] ?? "").trim();
    i++;
    const ilya = readField();
    const comment = readField();
    const newComponents = readField();
    if (name && url) {
      rows.push({
        name,
        url,
        ilyaUpdate: ilya,
        comment,
        newComponents,
      });
    }
  }
  return rows;
}

function main(): void {
  const p = path.resolve(process.argv[2] ?? "temp/links-2.tsv");
  const rows = parseLinks2Tsv(fs.readFileSync(p, "utf-8"));
  const out = path.resolve("temp/links-2-parsed.json");
  fs.writeFileSync(out, JSON.stringify(rows, null, 2), "utf-8");
  console.log(`Parsed ${rows.length} rows → ${out}`);
}

if (require.main === module) main();
