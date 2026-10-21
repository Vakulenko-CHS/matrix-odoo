/**
 * Pull HackMD → batch-format → ai-check summary → import estimate.
 *
 *   npm run sofa-batch-prep -- temp/batches/links-4/batch.tsv temp/batches/links-4/docs
 *
 * TSV/txt: рядки «Назва<TAB>https://hackmd.io/…» або лише URL.
 */
import * as fs from "fs";
import * as path from "path";
import { runPullHackmd } from "./pull-hackmd";
import { runBatchFormat } from "../commands/batchFormat";
import { diagnoseSpec } from "../validator/diagnose";
import { readKnownNamesMd } from "../validator/knownNames";
import { estimateImport } from "./template-bom-estimate";

interface TsvRow {
  name: string;
  url: string;
}

function parseTsvRows(text: string): TsvRow[] {
  const rows: TsvRow[] = [];
  for (const line of text.replace(/\r\n/g, "\n").split("\n")) {
    if (!line.includes("hackmd.io")) continue;
    const parts = line.split("\t");
    const name = parts[0]?.trim() ?? "";
    const url = (parts.find((p) => p.includes("hackmd.io")) ?? "").trim();
    if (name && url) rows.push({ name, url });
  }
  return rows;
}

function parseUrlsFromTsv(text: string): string[] {
  return parseTsvRows(text).map((r) => r.url);
}

/** HackMD title часто зламаний — перейменувати .md за назвою з TSV. */
function renameDocsFromTsv(outDir: string, rows: TsvRow[]): void {
  const manifestPath = path.join(outDir, "_manifest.json");
  if (!fs.existsSync(manifestPath)) return;
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as {
    url: string;
    fileName: string;
  }[];
  const byUrl = new Map(rows.map((r) => [r.url.replace(/\/+$/, ""), r.name]));
  const claimed = new Set<string>();

  for (const entry of manifest) {
    const name = byUrl.get(entry.url.replace(/\/+$/, ""));
    if (!name) continue;
    const safe = name.replace(/[\\/:*?"<>|]/g, "").trim() + ".md";
    let target = safe;
    let i = 2;
    while (claimed.has(target.toLowerCase())) {
      target = `${name.replace(/[\\/:*?"<>|]/g, "").trim()} (${i}).md`;
      i++;
    }
    claimed.add(target.toLowerCase());
    const from = path.join(outDir, entry.fileName);
    const to = path.join(outDir, target);
    if (fs.existsSync(from) && from !== to) {
      fs.renameSync(from, to);
      entry.fileName = target;
    }
  }
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf-8");
}

function writeUrlsFile(urls: string[], outPath: string): void {
  fs.writeFileSync(outPath, urls.join("\n") + "\n", "utf-8");
}

function lintNewFurniture(content: string, fileName: string): string[] {
  const known = readKnownNamesMd();
  const r = diagnoseSpec(content, fileName, known, "validate");
  const found: string[] = [];
  for (const issue of r.issues) {
    if (issue.source !== "lint") continue;
    const m = issue.message.match(/Нова фурнітура: «([^»]+)»/);
    if (m && !found.includes(m[1])) found.push(m[1]);
  }
  return found;
}

export async function runSofaBatchPrep(argv: string[]): Promise<void> {
  const tsvPath = argv[0];
  if (!tsvPath) {
    console.error("Використання: npm run sofa-batch-prep -- <links.tsv> [outDir]");
    process.exit(2);
  }
  const absTsv = path.resolve(process.cwd(), tsvPath);
  const outDir = path.resolve(process.cwd(), argv[1] ?? "temp/links-3-docs");
  const tsvText = fs.readFileSync(absTsv, "utf-8");
  const rows = parseTsvRows(tsvText);
  const urls = rows.map((r) => r.url);
  if (!urls.length) {
    console.error("URL не знайдено у файлі.");
    process.exit(2);
  }

  const urlsFile = path.join(path.dirname(absTsv), "links-3-urls.txt");
  writeUrlsFile(urls, urlsFile);
  console.log(`\n[1/5] pull-hackmd ${urls.length} URL → ${path.relative(process.cwd(), outDir)}`);
  await runPullHackmd([urlsFile, outDir]);
  console.log("[1b/5] rename за назвами з TSV");
  renameDocsFromTsv(outDir, rows);

  console.log("\n[2/5] batch-format");
  await runBatchFormat([outDir]);

  console.log("\n[3/5] ai-check summary");
  const known = readKnownNamesMd();
  const checkRows: object[] = [];
  const allFurn = new Map<string, { files: string[]; line?: number }>();

  const mdFiles = fs
    .readdirSync(outDir)
    .filter((f) => f.endsWith(".md") && !f.startsWith("_"))
    .sort();

  for (const f of mdFiles) {
    const abs = path.join(outDir, f);
    const raw = fs.readFileSync(abs, "utf-8");
    const r = diagnoseSpec(raw, f, known, "validate");
    const furn = lintNewFurniture(raw, f);
    for (const name of furn) {
      const hit = r.issues.find((i) => i.message.includes(`«${name}»`));
      const cur = allFurn.get(name) ?? { files: [] };
      if (!cur.files.includes(f)) cur.files.push(f);
      if (hit?.line) cur.line = hit.line;
      allFurn.set(name, cur);
    }
    checkRows.push({
      name: f.replace(/\.md$/, ""),
      status: r.status,
      counts: r.counts,
      chain: r.issues.filter((i) => i.source === "chain").map((i) => `L${i.line} ${i.message}`),
      new_furniture: furn,
      blocking: r.issues.filter((i) => i.kind === "blocking"),
    });
  }

  const checkJson = path.join(path.dirname(outDir), "links-3-ai-check.json");
  fs.writeFileSync(checkJson, JSON.stringify(checkRows, null, 2) + "\n", "utf-8");
  console.log(`  → ${path.relative(process.cwd(), checkJson)}`);

  console.log("\n[4/5] estimate-import (dry-run)");
  let est;
  try {
    est = await estimateImport([outDir], { odoo: true });
    console.log(
      `  (Odoo) нових BOM ~${est.totals.newBoms}, lines ~${est.totals.newLines}`,
    );
  } catch {
    console.warn("  Odoo недоступний — оцінка як для чистого імпорту (усі BOM нові).");
    est = await estimateImport([outDir], { odoo: false });
  }
  const estPath = path.join(path.dirname(outDir), "links-3-import-estimate.json");
  fs.writeFileSync(estPath, JSON.stringify(est, null, 2) + "\n", "utf-8");
  console.log(
    `  час import-template-bom: ${est.totals.humanMin}–${est.totals.humanMax} (~${est.totals.plannedLines} lines)`,
  );
  console.log(`  → ${path.relative(process.cwd(), estPath)}`);

  const furnOut = path.join(path.dirname(outDir), "links-3-new-furniture.md");
  const lines = [
    "# Нова фурнітура (links-3, lint)",
    "",
    "| Як у специ | Де | Пропозиція канону |",
    "|---|---|---|",
  ];
  for (const [raw, meta] of [...allFurn.entries()].sort((a, b) => a[0].localeCompare(b[0], "uk"))) {
    const canon = proposeFurnitureCanon(raw);
    lines.push(`| \`${raw}\` | ${meta.files.slice(0, 3).join(", ")}${meta.files.length > 3 ? "…" : ""} | **${canon.name}** |`);
    if (canon.aliases.length) {
      lines.push(`| | | аліаси: ${canon.aliases.map((a) => `\`${a}\``).join(", ")} |`);
    }
    if (canon.note) lines.push(`| | | ${canon.note} |`);
  }
  fs.writeFileSync(furnOut, lines.join("\n") + "\n", "utf-8");
  console.log(`\nФурнітура: ${path.relative(process.cwd(), furnOut)}`);
}

function proposeFurnitureCanon(raw: string): {
  name: string;
  aliases: string[];
  note?: string;
} {
  const t = raw.trim();
  const lower = t.toLowerCase().replace(/\s+/g, " ");

  if (lower.includes("сабля") || lower.includes("балюта")) {
    return {
      name: "Механізм Сабля (Балюта)",
      aliases: [t, "мех.Сабля(Балюта)", "Мех. Сабля Балюта"],
      note: "Уточнити у складу: чи це окремий SKU від «Механізм 312 СМ».",
    };
  }
  if (lower.includes("мдф") && lower.includes("венге")) {
    const m = t.match(/(\d+)\s*[xх×]\s*(\d+)/i);
    if (m) {
      const w = m[1];
      const h = m[2];
      return {
        name: `МДФ Венге ${w}×${h}`,
        aliases: [t, `мдф венге ${w}x${h}`, `мдф венге (${w}x${h})`, `мдф венге ${w}х${h}`],
        note: "Од. виміру: шт (лист).",
      };
    }
    return { name: "МДФ Венге", aliases: [t] };
  }

  return {
    name: t.replace(/^\[|\]$/g, "").replace(/\s+/g, " ").trim(),
    aliases: [t],
    note: "Перевірити в Odoo — можливо вже є під іншою назвою.",
  };
}

if (require.main === module) {
  runSofaBatchPrep(process.argv.slice(2)).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
