/**
 * TEST / UNTESTED — first live import must verify this module.
 *
 * Hooks after JSON import:
 *   1. Облік запасів (`is_storable=true`) on goods templates.
 *   2. Сировина + purchase_ok → WH/Stock orderpoint, route Придбати, min=max=0.
 *
 * Not exercised on a sofa import yet. Check: new raw variants have orderpoints,
 * new goods have «Облік запасів», services stay non-storable, Тканина 50/50
 * orderpoints are not overwritten to 0/0.
 */
import { createMany, executeKw, searchRead, write } from "../../api/odoo";
import { sleep, withRetry } from "../odooPaged";
import type { BomEntry } from "../docToJson/types";

const MIN_QTY = 0;
const MAX_QTY = 0;
const BATCH = 80;
const CTX = { context: { lang: "uk_UA", active_test: false } };

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export function importTemplateNames(boms: BomEntry[]): string[] {
  const names = new Set<string>();
  for (const e of boms) {
    names.add(e.product.templateName);
    for (const c of e.components) {
      if (c.isService) continue;
      names.add(c.templateName);
    }
  }
  return [...names];
}

async function resolveIds() {
  const rawCats = await searchRead<{
    id: number;
    parent_id: false | [number, string];
  }>("product.category", [["name", "=", "Сировина"]], ["id", "parent_id"]);
  const raw =
    rawCats.find((c) => !c.parent_id) ?? rawCats[0];
  const routes = await searchRead<{ id: number; name: string }>(
    "stock.route",
    [],
    ["id", "name"],
  );
  const buy = routes.find((r) => r.name.toLowerCase().includes("придбати"));
  const [wh] = await searchRead<{ id: number; lot_stock_id: [number, string] }>(
    "stock.warehouse",
    [],
    ["id", "lot_stock_id"],
    1,
  );
  if (!raw) throw new Error('Категорію "Сировина" не знайдено');
  if (!buy) throw new Error('Маршрут "Придбати" не знайдено');
  if (!wh) throw new Error("Склад не знайдено");
  return {
    rawCategId: raw.id,
    buyRouteId: buy.id,
    warehouseId: wh.id,
    stockLocId: wh.lot_stock_id[0],
  };
}

/** Fields for new goods templates. Services must not pass is_storable. */
export function goodsCreateVals(): { is_storable: true } {
  // TEST / UNTESTED: Odoo 19 tracks stock via is_storable, type stays consu.
  return { is_storable: true };
}

export async function ensureImportedGoodsStorable(
  templateIds: number[],
): Promise<number> {
  if (!templateIds.length) return 0;
  const tmpls = await searchRead<{
    id: number;
    type: string;
    is_storable: boolean;
  }>("product.template", [["id", "in", templateIds]], [
    "id",
    "type",
    "is_storable",
  ]);
  const toFix = tmpls.filter((t) => t.type !== "service" && !t.is_storable);
  if (!toFix.length) return 0;
  for (const batch of chunk(toFix, BATCH)) {
    await write(
      "product.template",
      batch.map((t) => t.id),
      { is_storable: true },
    );
  }
  console.log(`[stock] Облік запасів: +${toFix.length} шаблонів`);
  return toFix.length;
}

export async function ensureRawBuyOrderpoints(opts?: {
  templateIds?: number[];
  forcePurchaseOk?: boolean;
  dropMto?: boolean;
}): Promise<{ created: number; patched: number }> {
  const { rawCategId, buyRouteId, warehouseId, stockLocId } = await resolveIds();
  const domain: unknown[] = [["categ_id", "child_of", rawCategId]];
  if (opts?.templateIds?.length) {
    domain.push(["id", "in", opts.templateIds]);
  }

  const tmpls = await executeKw<
    {
      id: number;
      name: string;
      active: boolean;
      purchase_ok: boolean;
      route_ids: number[];
    }[]
  >("product.template", "search_read", [domain], {
    fields: ["id", "name", "active", "purchase_ok", "route_ids"],
    ...CTX,
  });

  const live = tmpls.filter((t) => t.active);
  if (opts?.forcePurchaseOk) {
    const need = live.filter((t) => !t.purchase_ok);
    if (need.length) {
      await write(
        "product.template",
        need.map((t) => t.id),
        { purchase_ok: true },
      );
      console.log(`[stock] purchase_ok ${need.length}`);
    }
  }

  if (opts?.dropMto) {
    const mto = (
      await searchRead<{ id: number; name: string }>(
        "stock.route",
        [],
        ["id", "name"],
      )
    ).find((r) => /внз|make to order|поповнит/i.test(r.name));
    if (mto) {
      const withMto = live.filter((t) => t.route_ids.includes(mto.id));
      for (const t of withMto) {
        await write("product.template", [t.id], { route_ids: [[3, mto.id]] });
      }
      if (withMto.length) console.log(`[stock] drop MTO ${withMto.length}`);
    }
  }

  const purchased = (
    await searchRead<{ id: number; purchase_ok: boolean }>(
      "product.template",
      [["id", "in", live.map((t) => t.id)]],
      ["id", "purchase_ok"],
    )
  ).filter((t) => t.purchase_ok);
  const tmplIds = purchased.map((t) => t.id);
  if (!tmplIds.length) return { created: 0, patched: 0 };

  const products = await executeKw<{ id: number }[]>(
    "product.product",
    "search_read",
    [[["product_tmpl_id", "in", tmplIds], ["is_storable", "=", true]]],
    { fields: ["id"], ...CTX },
  );
  const pids = products.map((p) => p.id);
  if (!pids.length) return { created: 0, patched: 0 };

  const ops = await executeKw<
    {
      id: number;
      product_id: [number, string];
      route_id: false | [number, string];
    }[]
  >(
    "stock.warehouse.orderpoint",
    "search_read",
    [[["product_id", "in", pids], ["location_id", "=", stockLocId]]],
    { fields: ["id", "product_id", "route_id"], ...CTX },
  );
  const have = new Set(ops.map((o) => o.product_id[0]));
  const missing = products.filter((p) => !have.has(p.id));
  const patchRoute = ops.filter(
    (o) => !o.route_id || o.route_id[0] !== buyRouteId,
  );

  if (patchRoute.length) {
    await write(
      "stock.warehouse.orderpoint",
      patchRoute.map((o) => o.id),
      { route_id: buyRouteId },
    );
    console.log(`[stock] orderpoint → Придбати ${patchRoute.length}`);
  }

  let created = 0;
  for (const batch of chunk(missing, BATCH)) {
    const ids = await withRetry(`op ${created}`, () =>
      createMany(
        "stock.warehouse.orderpoint",
        batch.map((p) => ({
          product_id: p.id,
          warehouse_id: warehouseId,
          location_id: stockLocId,
          product_min_qty: MIN_QTY,
          product_max_qty: MAX_QTY,
          trigger: "auto",
          route_id: buyRouteId,
        })),
      ),
    );
    created += Array.isArray(ids) ? ids.length : 1;
    await sleep(40);
  }
  if (created) {
    console.log(
      `[stock] Buy orderpoints +${created} (min/max ${MIN_QTY}/${MAX_QTY} WH/Stock)`,
    );
  }
  return { created, patched: patchRoute.length };
}

/**
 * TEST / UNTESTED — run after types + categories on the imported BOM set.
 */
export async function afterImportStockAndBuy(boms: BomEntry[]): Promise<void> {
  const names = importTemplateNames(boms);
  if (!names.length) return;
  const tmpls = await searchRead<{ id: number }>(
    "product.template",
    [["name", "in", names]],
    ["id"],
  );
  const ids = tmpls.map((t) => t.id);
  console.log(`\n${"=".repeat(60)}`);
  console.log(
    "TEST/UNTESTED: Облік запасів + Buy orderpoints (Сировина, купівля)",
  );
  console.log("=".repeat(60));
  await ensureImportedGoodsStorable(ids);
  await ensureRawBuyOrderpoints({ templateIds: ids });
}
