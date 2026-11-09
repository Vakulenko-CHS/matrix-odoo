/**
 * Read-only scan for test/junk records (T-SER-01 report).
 * Usage: ts-node --transpile-only src/commands/auditOdooJunk.ts
 */
import { authenticate, searchRead } from "../api/odoo";
import { searchReadPaged } from "../tools/odooPaged";

type MoRow = {
  id: number;
  name: string;
  state: string;
  product_id: [number, string];
  origin: string | false;
  lot_producing_ids: number[];
  create_date: string;
};

type LotRow = {
  id: number;
  name: string;
  product_id: [number, string];
  product_qty: number;
};

type PavRow = {
  id: number;
  name: string;
  attribute_id: [number, string];
  is_used_on_products: boolean;
};

type PtavRow = {
  id: number;
  name: string;
  price_extra: number;
  product_attribute_value_id: [number, string];
  attribute_id: [number, string];
};

function section(title: string) {
  console.log(`\n## ${title}\n`);
}

function bullets(lines: string[]) {
  for (const l of lines) console.log(l ? `- ${l}` : "- (немає)");
}

async function main() {
  await authenticate();

  section("1. Відомий тест-MO (T-SER-01 / NOTES)");
  const mo545 = await searchRead<MoRow>(
    "mrp.production",
    [["name", "=", "WH/MO/00545"]],
    [
      "name",
      "state",
      "product_id",
      "origin",
      "lot_producing_ids",
      "create_date",
    ],
    5,
  );
  if (mo545.length === 0) {
    bullets(["WH/MO/00545 не знайдено (можливо вже скасовано/видалено)"]);
  } else {
    for (const mo of mo545) {
      const lotNames =
        mo.lot_producing_ids?.length
          ? (
              await searchRead<{ name: string }>(
                "stock.lot",
                [["id", "in", mo.lot_producing_ids]],
                ["name"],
                10,
              )
            )
              .map((l) => l.name)
              .join(", ")
          : "—";
      bullets([
        `**${mo.name}** id=${mo.id} state=${mo.state} product=${mo.product_id[1]}`,
        `lots=${lotNames} origin=${mo.origin || "—"} created=${mo.create_date}`,
      ]);
      const children = await searchRead<MoRow>(
        "mrp.production",
        [["origin", "ilike", mo.name]],
        ["name", "state", "product_id", "origin"],
        50,
      );
      if (children.length) {
        console.log("\n  Дочірні MO (origin містить 00545):");
        for (const c of children) {
          console.log(`  - ${c.name} [${c.state}] ${c.product_id[1]}`);
        }
      }
    }
  }

  section("2. Серійні номери (stock.lot) — Джаз і «000000*»");
  const jazzLots = await searchRead<LotRow>(
    "stock.lot",
    [
      "|",
      ["product_id.name", "ilike", "Диван Джаз"],
      ["name", "ilike", "000000"],
    ],
    ["name", "product_id", "product_qty"],
    200,
  );
  jazzLots.sort((a, b) => a.name.localeCompare(b.name));
  if (jazzLots.length === 0) bullets(["немає"]);
  else {
    for (const lot of jazzLots) {
      console.log(
        `- lot **${lot.name}** id=${lot.id} qty=${lot.product_qty} → ${lot.product_id[1]}`,
      );
    }
  }

  section("3. Значення атрибута «Тканина» — тестові назви");
  const junkFabricNames = ["validate", "validate-all", "Синтетика"];
  for (const n of junkFabricNames) {
    const pavs = await searchRead<PavRow>(
      "product.attribute.value",
      [["name", "=", n]],
      ["name", "attribute_id", "is_used_on_products"],
      20,
    );
    if (pavs.length === 0) {
      console.log(`- «${n}»: product.attribute.value — **немає**`);
      continue;
    }
    for (const p of pavs) {
      console.log(
        `- pav id=${p.id} **${p.name}** attr=${p.attribute_id[1]} used_on_products=${p.is_used_on_products}`,
      );
      const ptavs = await searchRead<
        PtavRow & { product_tmpl_id: [number, string] }
      >(
        "product.template.attribute.value",
        [["product_attribute_value_id", "=", p.id]],
        [
          "name",
          "price_extra",
          "product_attribute_value_id",
          "attribute_id",
          "product_tmpl_id",
        ],
        200,
      );
      for (const t of ptavs) {
        console.log(
          `    ptav id=${t.id} price_extra=${t.price_extra} tmpl=${t.product_tmpl_id[1]}`,
        );
      }
    }
  }

  section("4. PTAV з price_extra = 100 (тестова доплата за тканину)");
  const extra100 = await searchReadPaged<PtavRow>(
    "product.template.attribute.value",
    ["id", "name", "price_extra", "attribute_id", "product_tmpl_id"],
    { domain: [["price_extra", "=", 100]], label: "ptav+100" },
  );
  const fabricExtra = extra100.filter((r) =>
    String((r as PtavRow & { attribute_id: [number, string] }).attribute_id[1]).includes("Ткан"),
  );
  console.log(`- Усього ptav з price_extra=100: **${extra100.length}**`);
  console.log(`- З них attr «Тканина*»: **${fabricExtra.length}**`);
  for (const t of fabricExtra.slice(0, 15)) {
    const row = t as PtavRow & { product_tmpl_id: [number, string] };
    console.log(
      `  - ptav ${t.id} «${t.name}» tmpl=${row.product_tmpl_id?.[1] ?? "?"}`,
    );
  }
  if (fabricExtra.length > 15)
    console.log(`  … ще ${fabricExtra.length - 15}`);

  section("5. MO на готовий «Диван Джаз» (усі стани)");
  const jazzMo = await searchRead<MoRow>(
    "mrp.production",
    [["product_id.name", "ilike", "Диван Джаз"]],
    ["name", "state", "lot_producing_ids", "create_date"],
    30,
  );
  jazzMo.sort((a, b) => a.name.localeCompare(b.name));
  for (const mo of jazzMo) {
    const lots =
      mo.lot_producing_ids?.length > 0
        ? String(mo.lot_producing_ids.length) + " id(s)"
        : "—";
    console.log(
      `- ${mo.name} [${mo.state}] lots=${lots} ${mo.create_date}`,
    );
  }

  section("6. Чернетки sale.order (draft) — можливі тести");
  const draftSo = await searchRead<{
    id: number;
    name: string;
    state: string;
    partner_id: [number, string];
    create_date: string;
  }>(
    "sale.order",
    [["state", "=", "draft"]],
    ["name", "state", "partner_id", "create_date"],
    25,
  );
  draftSo.sort((a, b) => b.create_date.localeCompare(a.create_date));
  for (const so of draftSo.slice(0, 15)) {
    console.log(
      `- ${so.name} partner=${so.partner_id[1]} created=${so.create_date}`,
    );
  }
  if (draftSo.length > 15)
    console.log(`- … усього draft SO: ${draftSo.length}`);

  section("7. Продукти / шаблони — ім’я схоже на test|validate|demo");
  const nameJunk = await searchRead<{ id: number; name: string; active: boolean }>(
    "product.template",
    [
      "|",
      "|",
      ["name", "ilike", "validate"],
      ["name", "ilike", "test"],
      ["name", "ilike", "demo"],
    ],
    ["name", "active"],
    40,
  );
  for (const t of nameJunk) {
    console.log(`- tmpl ${t.id} active=${t.active} **${t.name}**`);
  }
  if (nameJunk.length === 0) bullets(["немає збігів"]);

  section("8. Архівні варіанти з ненульовим stock.quant (лише qty≠0)");
  const hotQuants = await searchRead<{
    id: number;
    product_id: [number, string];
    quantity: number;
    location_id: [number, string];
  }>(
    "stock.quant",
    [["quantity", "!=", 0]],
    ["product_id", "quantity", "location_id"],
    500,
  );
  const archivedProducts = await searchReadPaged<{
    id: number;
    display_name: string;
    active: boolean;
  }>("product.product", ["id", "display_name", "active"], {
    domain: [["active", "=", false]],
    label: "archived-variants",
  });
  const archSet = new Set(archivedProducts.map((p) => p.id));
  const archQuants = hotQuants.filter((q) => archSet.has(q.product_id[0]));
  console.log(`- Quants qty≠0 на **архівних** variant: **${archQuants.length}**`);
  for (const q of archQuants.slice(0, 20)) {
    console.log(
      `  - quant ${q.id} qty=${q.quantity} ${q.product_id[1]} @ ${q.location_id[1]}`,
    );
  }
  if (archQuants.length > 20)
    console.log(`  … ще ${archQuants.length - 20}`);

  section("9. MO скасовані / чернетка (останні 20)");
  const deadMo = await searchRead<MoRow>(
    "mrp.production",
    [["state", "in", ["draft", "cancel"]]],
    ["name", "state", "product_id", "create_date"],
    20,
  );
  deadMo.sort((a, b) => b.create_date.localeCompare(a.create_date));
  for (const mo of deadMo) {
    console.log(
      `- ${mo.name} [${mo.state}] ${mo.product_id[1]} ${mo.create_date}`,
    );
  }

  section("10. Підсумок list_price=1 на шаблонах диванів (не сміття — T-COST-01)");
  const sofaOne = await searchRead<{ id: number; name: string }>(
    "product.template",
    [
      ["categ_id.complete_name", "ilike", "Дивани"],
      ["list_price", "=", 1],
    ],
    ["name"],
    0,
  );
  console.log(
    `- Шаблонів у категорії Дивани з list_price=1 ₴: **${sofaOne.length}** (ціна — окрема задача, не архівувати)`,
  );

  console.log("\n---\nSTATUS: read-only audit complete\n");
}

main().catch((err) => {
  console.error("[FATAL]", err instanceof Error ? err.message : err);
  process.exit(1);
});
