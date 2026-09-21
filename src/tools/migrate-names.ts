/**
 * Name-canon migration vs live Odoo.
 * Write path is not implemented. Only --dry-run (search_read).
 *
 *   npm run migrate-names -- --dry-run
 */
import * as fs from "fs";
import * as path from "path";
import { authenticate, executeKw } from "../api/odoo";
import { loadCanonSpecs } from "./migrateNames/parseSpec";
import {
  LiveCategory,
  LiveTemplate,
  buildMigratePlan,
  renderPlanMarkdown,
} from "./migrateNames/plan";

const PAGE = 500;
const PAUSE_MS = 250;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function isRetryable(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /429|Too many|rate limit|ECONNRESET|ETIMEDOUT/i.test(msg);
}

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let last: unknown;
  for (let i = 0; i < 6; i++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      if (!isRetryable(err) || i === 5) throw err;
      const wait = 1000 * 2 ** i;
      process.stderr.write(`[migrate-names] retry ${i + 1} in ${wait}ms\n`);
      await sleep(wait);
    }
  }
  throw last;
}

async function searchReadPaged<T>(
  model: string,
  fields: string[],
  domain: unknown[] = [],
  activeTest = true,
): Promise<T[]> {
  const out: T[] = [];
  let offset = 0;
  for (;;) {
    const batch = await withRetry(() =>
      executeKw<T[]>(model, "search_read", [domain], {
        fields,
        limit: PAGE,
        offset,
        context: { lang: "uk_UA", active_test: activeTest },
      }),
    );
    out.push(...batch);
    process.stderr.write(
      `[migrate-names] ${model} +${batch.length} (total ${out.length})\n`,
    );
    if (batch.length < PAGE) break;
    offset += PAGE;
    await sleep(PAUSE_MS);
  }
  return out;
}

interface TmplRow {
  id: number;
  name: string;
  type: string;
  active: boolean;
  categ_id: [number, string] | false;
  uom_id: [number, string] | false;
  attribute_line_ids: number[];
  product_variant_count?: number;
}

interface CatRow {
  id: number;
  complete_name: string;
}

interface AttrLineRow {
  id: number;
  product_tmpl_id: [number, string];
  attribute_id: [number, string];
}

interface BomRow {
  id: number;
  product_tmpl_id: [number, string] | false;
}

interface AttrRow {
  id: number;
  name: string;
}

function usage(): never {
  console.error(`Використання:
  npm run migrate-names -- --dry-run

Лише читання. Запис у Odoo ще не зроблено.`);
  process.exit(2);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--apply") || args.includes("--write")) {
    console.error("Запис у Odoo вимкнено. Є тільки --dry-run.");
    process.exit(2);
  }
  if (!args.includes("--dry-run")) usage();

  console.log("[migrate-names] dry-run. Odoo write/create/unlink не викликаємо.");
  const { canons, archive } = loadCanonSpecs();
  console.log(
    `[migrate-names] канон ${canons.length} · архів-спека ${archive.length}`,
  );

  await authenticate();
  await sleep(PAUSE_MS);

  const categories = await searchReadPaged<CatRow>("product.category", [
    "id",
    "complete_name",
  ]);
  await sleep(PAUSE_MS);

  const templates = (
    await searchReadPaged<TmplRow>("product.template", [
      "id",
      "name",
      "type",
      "active",
      "categ_id",
      "uom_id",
      "attribute_line_ids",
      "product_variant_count",
    ])
  ).filter((t) => t.active);
  await sleep(PAUSE_MS);

  const attrLines = await searchReadPaged<AttrLineRow>(
    "product.template.attribute.line",
    ["id", "product_tmpl_id", "attribute_id"],
  );
  await sleep(PAUSE_MS);

  const boms = await searchReadPaged<BomRow>("mrp.bom", [
    "id",
    "product_tmpl_id",
  ]);
  await sleep(PAUSE_MS);

  const colorAttrs = await searchReadPaged<AttrRow>(
    "product.attribute",
    ["id", "name"],
    [["name", "=", "Колір Ламінату"]],
  );

  const catById = new Map(categories.map((c) => [c.id, c.complete_name]));
  const attrsByTmpl = new Map<number, string[]>();
  for (const line of attrLines) {
    const tid = line.product_tmpl_id[0];
    const list = attrsByTmpl.get(tid) ?? [];
    list.push(line.attribute_id[1]);
    attrsByTmpl.set(tid, list);
  }
  const bomByTmpl = new Map<number, number>();
  for (const bom of boms) {
    if (!bom.product_tmpl_id) continue;
    const tid = bom.product_tmpl_id[0];
    bomByTmpl.set(tid, (bomByTmpl.get(tid) ?? 0) + 1);
  }

  const live: LiveTemplate[] = templates.map((t) => ({
    id: t.id,
    name: t.name,
    type: t.type,
    category: t.categ_id
      ? (catById.get(t.categ_id[0]) ?? t.categ_id[1])
      : "Без категорії",
    categoryId: t.categ_id ? t.categ_id[0] : null,
    uom: t.uom_id ? t.uom_id[1] : "",
    attrNames: attrsByTmpl.get(t.id) ?? [],
    variants: t.product_variant_count ?? 0,
    bomCount: bomByTmpl.get(t.id) ?? 0,
  }));

  const liveCats: LiveCategory[] = categories.map((c) => ({
    id: c.id,
    completeName: c.complete_name,
  }));

  const poslugyExists = categories.some(
    (c) => c.complete_name === "Послуги" || c.complete_name.endsWith(" / Послуги"),
  );

  const plan = buildMigratePlan(canons, archive, live, liveCats, {
    laminateColorExists: colorAttrs.length > 0,
    poslugyExists,
  });

  const when = new Date().toISOString().slice(0, 19).replace("T", " ");
  const dir = path.resolve("temp");
  fs.mkdirSync(dir, { recursive: true });
  const mdPath = path.join(dir, "migrate-names-dry-run.md");
  const jsonPath = path.join(dir, "migrate-names-plan.json");
  fs.writeFileSync(mdPath, renderPlanMarkdown(plan, when), "utf-8");
  fs.writeFileSync(
    jsonPath,
    `${JSON.stringify({ when, counts: plan.counts, issues: plan.issues, ops: plan.ops }, null, 2)}\n`,
    "utf-8",
  );

  const blockers = plan.issues.filter((i) => i.level === "blocker");
  const warnings = plan.issues.filter((i) => i.level === "warning");
  console.log("");
  console.log("dry-run OK — Odoo не змінювали");
  console.log(
    `keep ${plan.counts.keep}  rename ${plan.counts.rename}  update ${plan.counts.update}  merge ${plan.counts["merge-archive"]}  archive ${plan.counts.archive}  create ${plan.counts.create}  orphan ${plan.counts.orphan}  cat ${plan.counts["cat-rename"]}`,
  );
  console.log(`blockers ${blockers.length}  warnings ${warnings.length}`);
  for (const i of blockers) console.log(`  ! ${i.message}`);
  for (const i of warnings.slice(0, 20)) console.log(`  ? ${i.message}`);
  if (warnings.length > 20) {
    console.log(`  ? … ще ${warnings.length - 20} warning у файлі`);
  }
  console.log(`[migrate-names] ${mdPath}`);
  console.log(`[migrate-names] ${jsonPath}`);
}

main().catch((err) => {
  console.error("[migrate-names]", err instanceof Error ? err.message : err);
  process.exit(1);
});
