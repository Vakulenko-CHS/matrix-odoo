/**
 * Dry-run estimate for template-level BOM import (no Odoo writes).
 *
 *   npm run estimate-import -- temp/links-3-docs
 *   npm run estimate-import -- exports/*.json
 *   npm run estimate-import -- temp/links-3-docs --odoo   # skip BOMs that already exist
 *
 * Timing: empirical ~1.0 s per new mrp.bom.line + overhead per new BOM/template.
 */
import * as fs from "fs";
import * as path from "path";
import { parseDocToJson } from "./docToJson";
import type { BomEntry, ComponentEntry } from "./docToJson/types";
import { applyModelTransform } from "./importJson/template-bom/importer";
import { authenticate, searchRead } from "../api/odoo";

const SEC_PER_LINE = Number(process.env.IMPORT_EST_SEC_PER_LINE ?? "1.0");
const SEC_PER_NEW_BOM = Number(process.env.IMPORT_EST_SEC_PER_BOM ?? "4");
const SEC_PER_NEW_TEMPLATE = Number(process.env.IMPORT_EST_SEC_PER_TEMPLATE ?? "2");

function cartesian(expand: Record<string, string[]>): Record<string, string>[] {
  const keys = Object.keys(expand);
  if (!keys.length) return [{}];
  let combos: Record<string, string>[] = [{}];
  for (const key of keys) {
    const next: Record<string, string>[] = [];
    for (const combo of combos) {
      for (const val of expand[key]) {
        next.push({ ...combo, [key]: val });
      }
    }
    combos = next;
  }
  return combos;
}

function countComponentLines(comp: ComponentEntry, expand: Record<string, string[]>): number {
  const placeholderAttrs = comp.attributes.filter((a) => a.value.includes("%"));
  if (!placeholderAttrs.length) return 1;

  const dims = placeholderAttrs
    .map((a) => ({
      key: a.attributeName,
      values: expand[a.attributeName] ?? [],
    }))
    .filter((d) => d.values.length > 0);

  if (!dims.length) return 0;
  const comboExpand = Object.fromEntries(dims.map((d) => [d.key, d.values]));
  return cartesian(comboExpand).length;
}

export function countPlannedBomLines(entries: BomEntry[]): number {
  let total = 0;
  for (const entry of entries) {
    const expand = entry.expand ?? {};
    for (const comp of entry.components) {
      total += countComponentLines(comp, expand);
    }
  }
  return total;
}

export interface FileEstimate {
  source: string;
  templateGroups: number;
  bomEntries: number;
  plannedLines: number;
  uniqueTemplates: string[];
  newBomsIfFresh: number;
  existingBoms?: number;
  newLinesIfFresh: number;
}

export interface ImportEstimate {
  files: FileEstimate[];
  totals: {
    files: number;
    templateGroups: number;
    plannedLines: number;
    newBoms: number;
    existingBoms: number;
    newLines: number;
    secMin: number;
    secMax: number;
    humanMin: string;
    humanMax: string;
  };
}

function listInputs(target: string): string[] {
  const abs = path.resolve(process.cwd(), target);
  if (!fs.statSync(abs).isDirectory()) return [abs];
  return fs
    .readdirSync(abs)
    .filter((f) => f.endsWith(".md") || f.endsWith(".json"))
    .filter((f) => !f.startsWith("_"))
    .sort((a, b) => a.localeCompare(b, "uk"))
    .map((f) => path.join(abs, f));
}

function loadBoms(filePath: string): { source: string; boms: BomEntry[] } {
  if (filePath.endsWith(".json")) {
    const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    return { source: data.sourceFile ?? path.basename(filePath), boms: data.boms };
  }
  const data = parseDocToJson(filePath);
  return { source: data.sourceFile, boms: data.boms };
}

function formatDuration(sec: number): string {
  if (sec < 90) return `${Math.round(sec)} с`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  if (m < 90) return `${m} хв ${s} с`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return `${h} год ${rm} хв`;
}

export async function estimateImport(
  targets: string[],
  opts: { odoo: boolean },
): Promise<ImportEstimate> {
  const paths = targets.flatMap((t) => listInputs(t));
  const existingBomCodes = new Set<string>();

  if (opts.odoo) {
    await authenticate();
    const boms = await searchRead<{ code: string }>(
      "mrp.bom",
      [["code", "=like", "tmpl::%"]],
      ["code"],
    );
    for (const b of boms) {
      if (b.code) existingBomCodes.add(b.code);
    }
  }

  const files: FileEstimate[] = [];
  let totalGroups = 0;
  let totalLines = 0;
  let totalNewBoms = 0;
  let totalExistingBoms = 0;
  let totalNewLines = 0;

  for (const filePath of paths) {
    const { source, boms } = loadBoms(filePath);
    const transformed = applyModelTransform(boms);
    const groups = new Map<string, BomEntry[]>();
    for (const e of transformed) {
      const k = e.product.templateName;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(e);
    }

    let plannedLines = 0;
    let newBoms = 0;
    let existingBoms = 0;
    let newLines = 0;

    for (const [templateName, entries] of groups) {
      const lines = countPlannedBomLines(entries);
      plannedLines += lines;
      const code = `tmpl::${templateName}`;
      if (opts.odoo && existingBomCodes.has(code)) {
        existingBoms++;
      } else {
        newBoms++;
        newLines += lines;
      }
    }

    const fe: FileEstimate = {
      source,
      templateGroups: groups.size,
      bomEntries: transformed.length,
      plannedLines,
      uniqueTemplates: [...groups.keys()],
      newBomsIfFresh: groups.size,
      newLinesIfFresh: plannedLines,
    };
    if (opts.odoo) {
      fe.existingBoms = existingBoms;
      fe.newBomsIfFresh = newBoms;
      fe.newLinesIfFresh = newLines;
    }

    files.push(fe);
    totalGroups += groups.size;
    totalLines += plannedLines;
    totalNewBoms += fe.newBomsIfFresh;
    totalExistingBoms += fe.existingBoms ?? 0;
    totalNewLines += fe.newLinesIfFresh;
  }

  const baseOverhead =
    totalNewBoms * SEC_PER_NEW_BOM + totalNewTemplatesEstimate(files) * SEC_PER_NEW_TEMPLATE;
  const secLine = totalNewLines * SEC_PER_LINE;
  const secMin = secLine * 0.85 + baseOverhead * 0.9;
  const secMax = secLine * 1.15 + baseOverhead * 1.2;

  return {
    files,
    totals: {
      files: files.length,
      templateGroups: totalGroups,
      plannedLines: totalLines,
      newBoms: totalNewBoms,
      existingBoms: totalExistingBoms,
      newLines: totalNewLines,
      secMin,
      secMax,
      humanMin: formatDuration(secMin),
      humanMax: formatDuration(secMax),
    },
  };
}

function totalNewTemplatesEstimate(files: FileEstimate[]): number {
  const all = new Set<string>();
  for (const f of files) {
    for (const t of f.uniqueTemplates) all.add(t);
  }
  return all.size;
}

export async function runEstimateImport(argv: string[]): Promise<void> {
  const odoo = argv.includes("--odoo");
  const paths = argv.filter((a) => !a.startsWith("--"));
  if (!paths.length) {
    console.error(
      "Використання: npm run estimate-import -- <папка|.md|.json> [--odoo]\n" +
        "  --odoo  врахувати існуючі tmpl:: BOM у Odoo (потрібен ODOO_API_KEY)",
    );
    process.exit(2);
  }

  const est = await estimateImport(paths, { odoo });
  console.log("\n=== estimate-import (dry-run, без запису) ===\n");
  for (const f of est.files) {
    const ex =
      f.existingBoms != null
        ? `  існує BOM: ${f.existingBoms}  нових BOM: ${f.newBomsIfFresh}  нових lines: ${f.newLinesIfFresh}`
        : `  (усі BOM нові) lines: ${f.plannedLines}`;
    console.log(`${f.source}`);
    console.log(`  шаблонів (груп): ${f.templateGroups}  BOM-записів: ${f.bomEntries}${ex}`);
  }
  console.log("\n--- підсумок ---");
  console.log(`Файлів: ${est.totals.files}`);
  console.log(`Груп шаблонів (BOM): ${est.totals.templateGroups}`);
  console.log(`Рядків компонентів (усього в плані): ${est.totals.plannedLines}`);
  if (odoo) {
    console.log(`Вже є в Odoo (BOM): ${est.totals.existingBoms}`);
    console.log(`До створення: BOM ${est.totals.newBoms}, lines ~${est.totals.newLines}`);
  }
  console.log(
    `Оцінка часу import-template-bom: ${est.totals.humanMin} – ${est.totals.humanMax}` +
      `  (${SEC_PER_LINE}s/line, ${SEC_PER_NEW_BOM}s/BOM)`,
  );
  console.log("(sync-bom-missing-lines та інші кроки — окремо, не в оцінці)\n");

  const out = path.resolve("temp", "import-estimate.json");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(est, null, 2) + "\n", "utf-8");
  console.log(`JSON: ${path.relative(process.cwd(), out)}`);
}

if (require.main === module) {
  runEstimateImport(process.argv.slice(2)).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
