/**
 * Prep + batch-format all furniture/beds/<slug>/fixed.md from original or existing fixed.
 *
 *   npm run bed-batch-format
 *   npm run bed-batch-format -- terry-80x190 sky-90x200
 */
import * as fs from "fs";
import * as path from "path";
import { formatOne } from "./batchFormat";
import { readKnownNamesMd } from "../validator/knownNames";
import { applyBedSpecPrep, applyBedPostFormatFixes } from "../tools/bedSpecPrep";

const ROOT = path.resolve(__dirname, "../..");
const BEDS = path.join(ROOT, "furniture/beds");
const INVENTORY = path.join(ROOT, "furniture/inventory.json");

type InvRow = { slug: string; name: string; status: string };

function loadInventory(): InvRow[] {
  return JSON.parse(fs.readFileSync(INVENTORY, "utf-8")) as InvRow[];
}

function writeDiff(slug: string, status: string, applied: number, errors: number): void {
  const p = path.join(BEDS, slug, "DIFF.md");
  const body = `# DIFF — ${slug}

Дата: 2026-11-09

Джерело: \`original.md\` → \`npm run bed-batch-format\` (KNOWLEDGE + validator).

- Атрибути / інструкції за профілем ліжка (еталон Террі-газ / ізголов'я на всіх з чохлом).
- Ізголов'я: inline → окремий НФ + рядок у цеху 9 (де було в original).
- Автофікси batch-format (коди цехів, prep).

**ai-check:** ${status} · applied=${applied} · errors=${errors} (перевір \`npm run ai-check -- --as-is …/fixed.md\`).
`;
  fs.writeFileSync(p, `${body}\n`, "utf-8");
}

export async function runBedBatchFormat(argv: string[]): Promise<void> {
  const known = readKnownNamesMd();
  const all = loadInventory();
  const filter = new Set(argv.filter((a) => !a.startsWith("-")));
  const rows = filter.size ? all.filter((r) => filter.has(r.slug)) : all;

  const summary: string[] = [];
  console.log(`bed-batch-format: ${rows.length} моделей\n`);

  for (const row of rows) {
    const dir = path.join(BEDS, row.slug);
    const origPath = path.join(dir, "original.md");
    const fixPath = path.join(dir, "fixed.md");
    if (!fs.existsSync(origPath)) {
      console.log(`SKIP ${row.slug}: no original.md`);
      continue;
    }

    const isEtalon = row.slug === "terry-90x200-gas";
    let raw: string;
    if (fs.existsSync(fixPath) && /^terry-.+-gas$/.test(row.slug)) {
      raw = fs.readFileSync(fixPath, "utf-8");
    } else {
      raw = fs.readFileSync(origPath, "utf-8");
    }

    if (!isEtalon) {
      raw = applyBedSpecPrep(raw, row.slug, row.name);
    }

    const done = formatOne(raw, "fixed.md", known);
    const body = applyBedPostFormatFixes(done.content, row.slug);
    const text = body.endsWith("\n") ? body : `${body}\n`;
    fs.writeFileSync(fixPath, text, "utf-8");
    writeDiff(row.slug, done.last.status, done.applied.length, done.last.counts.errors);

    row.status =
      row.slug === "terry-90x200-gas" ? "etalon" : "draft-fixed";
    const tag = `${done.last.status} e=${done.last.counts.errors} w=${done.last.counts.warnings} a=${done.applied.length}`;
    console.log(`${row.slug}: ${tag}`);
    summary.push(`| ${row.slug} | ${tag} |`);
  }

  fs.writeFileSync(INVENTORY, JSON.stringify(all, null, 2) + "\n", "utf-8");

  const summaryPath = path.join(BEDS, "_batch-summary.md");
  fs.writeFileSync(
    summaryPath,
    `# bed-batch-format 2026-11-09\n\n| slug | ai-check |\n|---|---|\n${summary.join("\n")}\n`,
    "utf-8",
  );
  console.log(`\n→ ${path.relative(ROOT, summaryPath)}`);
  console.log("inventory.json statuses оновлено");
}
