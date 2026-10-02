/**
 * Name-canon migration vs live Odoo.
 * Write path is not implemented. Only --dry-run (search_read).
 *
 *   npm run migrate-names -- --dry-run
 */
import * as fs from "fs";
import * as path from "path";
import { loadCanonSpecs } from "./migrateNames/parseSpec";
import {
  LiveCategory,
  LiveTemplate,
  buildMigratePlan,
  renderPlanMarkdown,
} from "./migrateNames/plan";
import {
  buildDetailedMigratePlan,
  renderDetailedPlanMarkdown,
} from "./migrateNames/detailedPlan";
import { buildJournalFromDetailed, orderHealthCheck } from "./migrateNames/buildJournal";
import { saveJournal } from "./migrateNames/journal";
import { searchReadPaged, sleep } from "./odooPaged";

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

interface BomLineRow {
  id: number;
  product_id: [number, string] | false;
}

interface VariantRow {
  id: number;
  product_tmpl_id: [number, string];
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

  await sleep(250);

  const categories = await searchReadPaged<CatRow>("product.category", [
    "id",
    "complete_name",
  ], { label: "migrate-names" });
  await sleep(250);

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
    ], { label: "migrate-names" })
  ).filter((t) => t.active);
  await sleep(250);

  const attrLines = await searchReadPaged<AttrLineRow>(
    "product.template.attribute.line",
    ["id", "product_tmpl_id", "attribute_id"],
    { label: "migrate-names" },
  );
  await sleep(250);

  const boms = await searchReadPaged<BomRow>("mrp.bom", [
    "id",
    "product_tmpl_id",
  ], { label: "migrate-names" });
  await sleep(250);

  const bomLines = await searchReadPaged<BomLineRow>("mrp.bom.line", [
    "id",
    "product_id",
  ], { label: "migrate-names" });
  await sleep(250);

  const variants = await searchReadPaged<VariantRow>("product.product", [
    "id",
    "product_tmpl_id",
  ], { label: "migrate-names" });
  await sleep(250);

  const colorAttrs = await searchReadPaged<AttrRow>(
    "product.attribute",
    ["id", "name"],
    { domain: [["name", "=", "Колір Ламінату"]], label: "migrate-names" },
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

  const variantToTmpl = new Map<number, number>();
  for (const v of variants) {
    variantToTmpl.set(v.id, v.product_tmpl_id[0]);
  }
  const componentUse = new Map<number, number>();
  for (const line of bomLines) {
    if (!line.product_id) continue;
    const tid = variantToTmpl.get(line.product_id[0]);
    if (tid == null) continue;
    componentUse.set(tid, (componentUse.get(tid) ?? 0) + 1);
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
    componentUse: componentUse.get(t.id) ?? 0,
  }));

  const liveCats: LiveCategory[] = categories.map((c) => ({
    id: c.id,
    completeName: c.complete_name,
  }));

  const poslugyExists = categories.some(
    (c) => c.complete_name === "Послуги" || c.complete_name.endsWith(" / Послуги"),
  );

  const extra = {
    laminateColorExists: colorAttrs.length > 0,
    poslugyExists,
  };
  const plan = buildMigratePlan(canons, archive, live, liveCats, extra);
  const when = new Date().toISOString().slice(0, 19).replace("T", " ");
  const detailed = buildDetailedMigratePlan(
    canons,
    archive,
    live,
    liveCats,
    extra,
    when,
  );

  const dir = path.resolve("temp");
  fs.mkdirSync(dir, { recursive: true });
  const mdPath = path.join(dir, "migrate-names-dry-run.md");
  const jsonPath = path.join(dir, "migrate-names-plan.json");
  const detailedJson = path.join(dir, "migrate-detailed-plan.json");
  const detailedMd = path.join(dir, "migrate-detailed-plan.md");

  fs.writeFileSync(mdPath, renderPlanMarkdown(plan, when), "utf-8");
  fs.writeFileSync(
    jsonPath,
    `${JSON.stringify({ when, counts: plan.counts, issues: plan.issues, ops: plan.ops }, null, 2)}\n`,
    "utf-8",
  );
  fs.writeFileSync(
    detailedJson,
    `${JSON.stringify(detailed, null, 2)}\n`,
    "utf-8",
  );
  fs.writeFileSync(detailedMd, renderDetailedPlanMarkdown(detailed), "utf-8");

  const journal = buildJournalFromDetailed(detailed);
  const health = orderHealthCheck(detailed);
  const journalPaths = saveJournal(journal);
  const healthPath = path.join(dir, "migrate-order-health.md");
  fs.writeFileSync(
    healthPath,
    [
      "# Order / feasibility check",
      "",
      `When: ${when}`,
      "",
      "## Bottom→top",
      "",
      ...health.map((h) => `- ${h}`),
      "",
      "## Docs cross-check (Odoo 19)",
      "",
      "- Archive `product.template` → archives variants; MRP also archives linked BOMs on active write.",
      "- If product still on **active BOM line as component**, Odoo warns but allows archive — hanging refs. We remap first.",
      "- Prefer archive over unlink (stock/MO history).",
      "- UOM change blocked if other UOMs already used on BOM — we do not change UOM in this plan.",
      "",
      "## Live dump gates",
      "",
      "- See dump-full + warnings above for open MO / BOM counts.",
      "- This dry-run does **not** execute writes; staging apply is the real proof.",
      "",
    ].join("\n"),
    "utf-8",
  );

  const blockers = plan.issues.filter((i) => i.level === "blocker");
  const warnings = plan.issues.filter((i) => i.level === "warning");
  console.log("");
  console.log("dry-run OK — Odoo не змінювали");
  console.log(
    `keep ${plan.counts.keep}  rename ${plan.counts.rename}  update ${plan.counts.update}  merge ${plan.counts["merge-archive"]}  archive ${plan.counts.archive}  create ${plan.counts.create}  orphan ${plan.counts.orphan}  cat ${plan.counts["cat-rename"]}`,
  );
  console.log(
    `detailed: mergeGroups ${detailed.summary.mergeGroups}  patternB ${detailed.summary.patternBSplits}  creates ${detailed.summary.creates}`,
  );
  console.log(`blockers ${blockers.length}  warnings ${warnings.length}`);
  for (const i of blockers) console.log(`  ! ${i.message}`);
  for (const i of warnings.slice(0, 12)) console.log(`  ? ${i.message}`);
  if (warnings.length > 12) {
    console.log(`  ? … ще ${warnings.length - 12} warning у файлі`);
  }
  console.log(`[migrate-names] ${mdPath}`);
  console.log(`[migrate-names] ${jsonPath}`);
  console.log(`[migrate-names] ${detailedMd}`);
  console.log(`[migrate-names] ${detailedJson}`);
  console.log(`[migrate-names] journal ${journalPaths.mdPath}`);
  console.log(`[migrate-names] ${healthPath}`);
  for (const h of health.slice(0, 6)) console.log(`  · ${h}`);
}

main().catch((err) => {
  console.error("[migrate-names]", err instanceof Error ? err.message : err);
  process.exit(1);
});
