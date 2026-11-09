/**
 * T-SER-01: archive test junk (reversible where Odoo allows active=false).
 *
 *   npm run ser-junk              # dry-run
 *   npm run ser-junk -- --apply
 *
 * A: lot 0000001 — inventory to 0 (MO 00545–548 stay done; history)
 * B: fabric pav validate, validate-all, Синтетика — remove from templates, archive pav
 * C: TEСТ products — zero/remove stray quants; archive legacy location «Тестовый склад»
 */
import {
  authenticate,
  executeKw,
  searchRead,
  unlink,
  write,
} from "../api/odoo";
import { sleep, withRetry } from "../tools/odooPaged";

const APPLY = process.argv.includes("--apply");
const FABRIC_ATTR = 2;
const PAV_JUNK = [
  { id: 714, name: "validate" },
  { id: 713, name: "validate-all" },
  { id: 718, name: "Синтетика" },
] as const;
const LOT_TEST = 1; // 0000001
const TEST_PRODUCT_IDS = [64, 68, 78, 177, 178];
const MO_TEST_NAMES = ["WH/MO/00545", "WH/MO/00546", "WH/MO/00547", "WH/MO/00548"];

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

async function removePavFromFabricLines(pavId: number, label: string) {
  const lines = await searchRead<{ id: number; product_tmpl_id: [number, string] }>(
    "product.template.attribute.line",
    [
      ["attribute_id", "=", FABRIC_ATTR],
      ["value_ids", "in", [pavId]],
    ],
    ["id", "product_tmpl_id"],
    0,
  );
  console.log(`  ${label}: attr-lines with pav ${pavId}: ${lines.length}`);
  if (!APPLY || !lines.length) return;
  for (const batch of chunk(lines, 40)) {
    for (const line of batch) {
      await write("product.template.attribute.line", [line.id], {
        value_ids: [[3, pavId]],
      });
    }
    await sleep(120);
  }
}

async function unlinkPtavsForPav(pavId: number, label: string) {
  let offset = 0;
  let total = 0;
  for (;;) {
    const ptavs = await executeKw<number[]>(
      "product.template.attribute.value",
      "search",
      [[["product_attribute_value_id", "=", pavId]]],
      { limit: 200, offset },
    );
    if (!ptavs.length) break;
    total += ptavs.length;
    if (APPLY) {
      try {
        await withRetry("unlink ptav", () =>
          unlink("product.template.attribute.value", ptavs),
        );
      } catch (e) {
        console.log(`    WARN unlink batch: ${e instanceof Error ? e.message : e}`);
        break;
      }
    }
    if (ptavs.length < 200) break;
    offset += 200;
    await sleep(80);
  }
  console.log(`  ${label}: ptav rows left to unlink: ${total}`);
}

async function archivePav(pavId: number, name: string) {
  const [pav] = await searchRead<{ id: number; active: boolean }>(
    "product.attribute.value",
    [["id", "=", pavId]],
    ["active"],
    1,
  );
  if (!pav) {
    console.log(`  skip pav ${name} — not found`);
    return;
  }
  console.log(`  pav ${name} (${pavId}) active=${pav.active}`);
  if (APPLY && pav.active) {
    await write("product.attribute.value", [pavId], { active: false });
  }
}

async function phaseFabric() {
  console.log("\n=== B: fabric junk (archive pav, restore = active true + re-import) ===");
  for (const { id, name } of PAV_JUNK) {
    console.log(`\n--- ${name} (${id}) ---`);
    await removePavFromFabricLines(id, name);
    await unlinkPtavsForPav(id, name);
    await archivePav(id, name);
  }
}

async function phaseLot0000001() {
  console.log("\n=== A: lot 0000001 (not 0000002/3) ===");
  const [lot] = await searchRead<{ id: number; name: string }>(
    "stock.lot",
    [["id", "=", LOT_TEST]],
    ["name"],
    1,
  );
  if (!lot) {
    console.log("  lot id=1 missing");
    return;
  }
  console.log(`  lot ${lot.name} id=${lot.id}`);

  const mos = await searchRead<{ name: string; state: string }>(
    "mrp.production",
    [["name", "in", MO_TEST_NAMES]],
    ["name", "state"],
    10,
  );
  for (const mo of mos) console.log(`  MO ${mo.name} [${mo.state}] — лишається в історії (нема active)`);

  const quants = await searchRead<{
    id: number;
    quantity: number;
    location_id: [number, string];
  }>(
    "stock.quant",
    [["lot_id", "=", LOT_TEST], ["quantity", "!=", 0]],
    ["quantity", "location_id"],
    20,
  );
  console.log(`  quants qty≠0: ${quants.length}`);
  for (const q of quants) {
    console.log(`    quant ${q.id} qty=${q.quantity} @ ${q.location_id[1]}`);
    if (!APPLY) continue;
    try {
      await executeKw("stock.quant", "write", [[q.id], { inventory_quantity: 0 }]);
      await executeKw("stock.quant", "action_apply_inventory", [[q.id]]);
      console.log(`    applied inventory 0 on quant ${q.id}`);
    } catch (e) {
      console.log(`    WARN quant ${q.id}: ${e instanceof Error ? e.message : e}`);
    }
  }
}

async function sudoUnlinkQuants(domain: unknown[][], label: string) {
  const n = await executeKw<number>("stock.quant", "search_count", [domain], {
    context: { active_test: false },
  });
  console.log(`  ${label}: ${n} quants`);
  if (!APPLY || n === 0) return;

  const [model] = await searchRead<{ id: number }>(
    "ir.model",
    [["model", "=", "stock.quant"]],
    ["id"],
    1,
  );
  if (!model) throw new Error("ir.model stock.quant missing");

  const pyDomain = JSON.stringify(domain)
    .replace(/\[/g, "(")
    .replace(/\]/g, ")")
    .replace(/"/g, "'");

  const code = [
    "Quant = env['stock.quant'].sudo()",
    `domain = ${JSON.stringify(domain)}`,
    "while True:",
    "    recs = Quant.search(domain, limit=100)",
    "    if not recs:",
    "        break",
    "    recs.unlink()",
  ].join("\n");

  const actionId = await executeKw<number>("ir.actions.server", "create", [
    {
      name: `tmp ser-junk ${label}`,
      model_id: model.id,
      state: "code",
      type: "ir.actions.server",
      usage: "ir_actions_server",
      binding_type: "action",
      code,
    },
  ]);
  try {
    await executeKw("ir.actions.server", "run", [[actionId]]);
  } finally {
    await executeKw("ir.actions.server", "unlink", [[actionId]]);
  }
}

async function phaseTestProducts() {
  console.log("\n=== C: TEСТ products + location ===");
  const prods = await executeKw<
    { id: number; display_name: string; active: boolean }[]
  >(
    "product.product",
    "read",
    [TEST_PRODUCT_IDS],
    { fields: ["display_name", "active"], context: { active_test: false } },
  );
  for (const p of prods) {
    console.log(`  product ${p.id} active=${p.active} ${p.display_name}`);
  }

  await sudoUnlinkQuants(
    [["product_id", "in", TEST_PRODUCT_IDS]],
    "all quants on TEСТ products",
  );

  const locs = await searchRead<{ id: number; complete_name: string; active: boolean }>(
    "stock.location",
    [["complete_name", "ilike", "Тестовый склад"]],
    ["complete_name", "active"],
    5,
  );
  for (const loc of locs) {
    console.log(`  location ${loc.complete_name} active=${loc.active}`);
    if (APPLY && loc.active) {
      await write("stock.location", [loc.id], { active: false });
      console.log(`  archived location ${loc.id}`);
    }
  }
}

async function main() {
  await authenticate();
  console.log(APPLY ? "MODE: --apply" : "MODE: dry-run (add --apply)");
  await phaseLot0000001();
  await phaseFabric();
  await phaseTestProducts();
  console.log("\nDone.");
  if (!APPLY) console.log("Re-run with --apply to write.");
}

main().catch((err) => {
  console.error("[FATAL]", err instanceof Error ? err.message : err);
  process.exit(1);
});
