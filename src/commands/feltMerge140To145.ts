/**
 * T-FELT-01: merge [Войлок] (1.40) into (1.45) on BOM lines; drop 1.40 from catalog.
 *
 * Dry-run by default. npm run felt-merge -- --apply
 */
import {
  authenticate,
  executeKw,
  searchRead,
  unlink,
  write,
} from "../api/odoo";

const APPLY = process.argv.includes("--apply");

const FELT_TMPL = 20;
const PROD_140 = 43142;
const PROD_145 = 329;
const PAV_140 = 636;
const PTAV_140 = 5102;
const ATTR_LINE = 33;

const CTX = { context: { lang: "uk_UA", active_test: false } };

interface BomLine {
  id: number;
  bom_id: [number, string];
  product_id: [number, string];
  product_qty: number;
  operation_id: false | [number, string];
  bom_product_template_attribute_value_ids?: number[];
}

async function run() {
  await authenticate();

  const lines = await executeKw<BomLine[]>(
    "mrp.bom.line",
    "search_read",
    [[["product_id", "=", PROD_140]]],
    { fields: ["id", "bom_id", "product_id", "product_qty", "operation_id"], limit: 0, ...CTX },
  );

  console.log(`BOM lines on [Войлок] (1.40): ${lines.length}`);

  const bomIds = [...new Set(lines.map((l) => l.bom_id[0]))];
  const lines145Before = await executeKw<BomLine[]>(
    "mrp.bom.line",
    "search_read",
    [[["product_id", "=", PROD_145], ["bom_id", "in", bomIds]]],
    { fields: ["id", "bom_id", "operation_id", "product_qty"], limit: 0, ...CTX },
  );
  console.log(`Same BOMs already have 1.45 lines: ${lines145Before.length}`);

  if (!APPLY) {
    console.log("DRY RUN — no writes");
    console.log("npm run felt-merge -- --apply");
    return;
  }

  let remapped = 0;
  for (const line of lines) {
    await write("mrp.bom.line", [line.id], { product_id: PROD_145 });
    remapped++;
    if (remapped % 10 === 0) console.log(`[bom.line] ${remapped}/${lines.length}`);
  }
  console.log(`[+] remapped ${remapped} bom.line → product ${PROD_145}`);

  // Merge duplicate lines on same bom+operation+product (sum qty, unlink extras)
  const lines145After = await executeKw<BomLine[]>(
    "mrp.bom.line",
    "search_read",
    [[["product_id", "=", PROD_145], ["bom_id", "in", bomIds]]],
    { fields: ["id", "bom_id", "product_qty", "operation_id", "bom_product_template_attribute_value_ids"], limit: 0, ...CTX },
  );

  const groups = new Map<string, BomLine[]>();
  for (const l of lines145After) {
    const op = l.operation_id ? l.operation_id[0] : 0;
    const key = `${l.bom_id[0]}:${op}`;
    const arr = groups.get(key) ?? [];
    arr.push(l);
    groups.set(key, arr);
  }

  let merged = 0;
  for (const [, group] of groups) {
    if (group.length < 2) continue;
    const ptavKey = (l: BomLine) =>
      [...(l as BomLine & { bom_product_template_attribute_value_ids?: number[] }).bom_product_template_attribute_value_ids ?? []]
        .sort((a, b) => a - b)
        .join(",");
    const byPtav = new Map<string, BomLine[]>();
    for (const l of group) {
      const k = ptavKey(l as BomLine & { bom_product_template_attribute_value_ids?: number[] });
      const arr = byPtav.get(k) ?? [];
      arr.push(l);
      byPtav.set(k, arr);
    }
    for (const sub of byPtav.values()) {
      if (sub.length < 2) continue;
      sub.sort((a, b) => a.id - b.id);
      const keep = sub[0];
      const extraQty = sub.slice(1).reduce((s, x) => s + x.product_qty, 0);
      const newQty = keep.product_qty + extraQty;
      await write("mrp.bom.line", [keep.id], { product_qty: newQty });
      const drop = sub.slice(1).map((x) => x.id);
      await unlink("mrp.bom.line", drop);
      merged += drop.length;
      console.log(
        `[merge] bom ${keep.bom_id[0]} op ${keep.operation_id ? keep.operation_id[0] : 0}: ${sub.length}→1 qty ${newQty}`,
      );
    }
  }
  if (merged === 0) console.log("[merge] no duplicate 1.45 lines to collapse");

  const quants = await executeKw<{ id: number; quantity: number; location_id: [number, string] }[]>(
    "stock.quant",
    "search_read",
    [[["product_id", "=", PROD_140]]],
    { fields: ["id", "quantity", "location_id"], limit: 0, ...CTX },
  );
  if (quants.length) {
    console.log(
      `[quant] skip ${quants.length} rows on ${PROD_140} (no unlink ACL); archive variant anyway`,
    );
  }

  await executeKw(
    "product.template.attribute.line",
    "write",
    [[ATTR_LINE], { value_ids: [[3, PAV_140]] }],
    CTX,
  );
  console.log(`[+] removed pav ${PAV_140} from tmpl ${FELT_TMPL} attr line ${ATTR_LINE}`);

  const ptavLeft = await searchRead<{ id: number }>(
    "product.template.attribute.value",
    [["id", "=", PTAV_140]],
    ["id"],
    1,
  );
  if (ptavLeft.length) {
    await unlink("product.template.attribute.value", [PTAV_140]);
    console.log(`[+] unlinked ptav ${PTAV_140}`);
  }

  const prod140 = await executeKw<{ id: number; active: boolean }[]>(
    "product.product",
    "search_read",
    [[["id", "=", PROD_140]]],
    { fields: ["id", "active"], limit: 1, ...CTX },
  );
  if (prod140.length) {
    await write("product.product", [PROD_140], { active: false });
    console.log(`[+] archived product.product ${PROD_140}`);
  }

  const still140 = await executeKw<number[]>(
    "mrp.bom.line",
    "search",
    [[["product_id", "=", PROD_140]]],
    CTX,
  );
  if (still140.length) {
    throw new Error(`still ${still140.length} bom lines on 1.40 after apply`);
  }

  const variants = await searchRead<{ id: number; display_name: string }>(
    "product.product",
    [["product_tmpl_id", "=", FELT_TMPL]],
    ["id", "display_name"],
    0,
  );
  console.log("[verify] [Войлок] variants now:");
  for (const v of variants) console.log(`  ${v.id} ${v.display_name}`);

  console.log("done T-FELT-01");
}

run().catch((err) => {
  console.error("[FATAL]", err instanceof Error ? err.message : err);
  process.exit(1);
});
