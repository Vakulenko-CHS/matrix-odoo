/**
 * T-LAM-01: laminate + nakladka templates → Buy like [Боннель], drop ВНЗ.
 *
 *   npm run lam-buy              # dry-run
 *   npm run lam-buy -- --apply   # after «так» in chat
 */
import { authenticate, createMany, executeKw, searchRead, write } from "../api/odoo";
import { sleep, withRetry } from "../tools/odooPaged";

const APPLY = process.argv.includes("--apply");
const MTO_ROUTE = 1;
const BUY_ROUTE = 54;

/** Prefixes as in live Odoo (no space after emoji). */
const TMPL_PREFIXES = [
  "🧩[Ламінат - нарізані деталі]",
  "🧩[Ламінат кольоровий",
  "🧩[Ламінат - лист]",
  "🪤[Накладка]",
] as const;

const BONNELL_TMPL = 24;

async function resolveTargetTemplateIds(): Promise<number[]> {
  const ids = new Set<number>();
  for (const prefix of TMPL_PREFIXES) {
    const found = await executeKw<number[]>("product.template", "search", [
      [["name", "=like", `${prefix}%`], ["active", "=", true]],
    ]);
    for (const id of found) ids.add(id);
  }
  return [...ids].sort((a, b) => a - b);
}

async function loadTemplates(ids: number[]) {
  return executeKw<
    {
      id: number;
      name: string;
      purchase_ok: boolean;
      route_ids: number[];
      categ_id: [number, string];
      is_storable: boolean;
    }[]
  >("product.template", "search_read", [[["id", "in", ids]]], {
    fields: ["name", "purchase_ok", "route_ids", "categ_id", "is_storable"],
    context: { active_test: false },
  });
}

async function reportBonnell() {
  const [b] = await loadTemplates([BONNELL_TMPL]);
  if (!b) return;
  console.log(
    `\nЕталон [Боннель] id=${b.id}: purchase_ok=${b.purchase_ok}, routes=${b.route_ids}, categ=${b.categ_id[1]}`,
  );
  const opCount = await executeKw<number>("stock.warehouse.orderpoint", "search_count", [
    [["product_id.product_tmpl_id", "=", BONNELL_TMPL]],
  ]);
  console.log(`  orderpoints on variants: ${opCount}`);
}

async function ensureOrderpoints(tmplIds: number[]) {
  const [wh] = await searchRead<{ id: number; lot_stock_id: [number, string] }>(
    "stock.warehouse",
    [],
    ["id", "lot_stock_id"],
    1,
  );
  if (!wh) throw new Error("warehouse missing");
  const stockLocId = wh.lot_stock_id[0];

  const products = await executeKw<{ id: number }[]>(
    "product.product",
    "search_read",
    [[["product_tmpl_id", "in", tmplIds], ["is_storable", "=", true]]],
    { fields: ["id"], context: { active_test: false } },
  );
  const pids = products.map((p) => p.id);
  console.log(`  storable variants for orderpoints: ${pids.length}`);
  if (!pids.length) return { created: 0, patched: 0 };

  const ops = await executeKw<
    { id: number; product_id: [number, string]; route_id: false | [number, string] }[]
  >(
    "stock.warehouse.orderpoint",
    "search_read",
    [[["product_id", "in", pids], ["location_id", "=", stockLocId]]],
    { fields: ["product_id", "route_id"], context: { active_test: false } },
  );
  const have = new Set(ops.map((o) => o.product_id[0]));
  const missing = products.filter((p) => !have.has(p.id));
  const patchRoute = ops.filter((o) => !o.route_id || o.route_id[0] !== BUY_ROUTE);

  console.log(`  orderpoints missing: ${missing.length}, patch route: ${patchRoute.length}`);
  if (!APPLY) return { created: missing.length, patched: patchRoute.length };

  if (patchRoute.length) {
    await write(
      "stock.warehouse.orderpoint",
      patchRoute.map((o) => o.id),
      { route_id: BUY_ROUTE },
    );
  }

  let created = 0;
  for (let i = 0; i < missing.length; i += 80) {
    const batch = missing.slice(i, i + 80);
    const ids = await withRetry("orderpoint create", () =>
      createMany(
        "stock.warehouse.orderpoint",
        batch.map((p) => ({
          product_id: p.id,
          warehouse_id: wh.id,
          location_id: stockLocId,
          product_min_qty: 0,
          product_max_qty: 0,
          trigger: "auto",
          route_id: BUY_ROUTE,
        })),
      ),
    );
    created += Array.isArray(ids) ? ids.length : 1;
    await sleep(50);
  }
  return { created, patched: patchRoute.length };
}

async function main() {
  await authenticate();
  console.log(APPLY ? "MODE --apply" : "MODE dry-run");

  await reportBonnell();

  const ids = await resolveTargetTemplateIds();
  console.log(`\nЦільові шаблони (prefix match): ${ids.length}`);
  const rows = await loadTemplates(ids);

  let needBuy = 0;
  let needDropVnz = 0;
  let needStorable = 0;
  for (const t of rows) {
    if (!t.purchase_ok) needBuy++;
    if (t.route_ids.includes(MTO_ROUTE)) needDropVnz++;
    if (!t.is_storable) needStorable++;
  }
  console.log(`  purchase_ok=false: ${needBuy}`);
  console.log(`  мають ВНЗ (id ${MTO_ROUTE}): ${needDropVnz}`);
  console.log(`  is_storable=false: ${needStorable}`);

  for (const t of rows.slice(0, 8)) {
    console.log(`  · ${t.id} ${t.name.slice(0, 55)}…`);
  }
  if (rows.length > 8) console.log(`  … +${rows.length - 8}`);

  if (APPLY) {
    for (const t of rows) {
      const vals: Record<string, unknown> = {};
      if (!t.purchase_ok) vals.purchase_ok = true;
      if (t.route_ids.includes(MTO_ROUTE)) {
        await write("product.template", [t.id], { route_ids: [[3, MTO_ROUTE]] });
      }
      if (Object.keys(vals).length) await write("product.template", [t.id], vals);
      if (!t.is_storable) await write("product.template", [t.id], { is_storable: true });
    }
    console.log(`\n[+] purchase_ok / drop VNZ / storable on ${rows.length} templates`);
  }

  console.log("\nOrderpoints (маршрут Придбати id=54, min/max 0):");
  const op = await ensureOrderpoints(ids);
  console.log(op);

  console.log("\nDone.");
  if (!APPLY) console.log('Напиши «так, apply T-LAM-01» → npm run lam-buy -- --apply');
}

main().catch((e) => {
  console.error("[FATAL]", e instanceof Error ? e.message : e);
  process.exit(1);
});
