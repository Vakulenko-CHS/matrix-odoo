/**
 * T-FAB-01: 8 категорій уверх дропдауна «Тканина» (порядок value_ids на шаблоні).
 *
 *   npm run fab01-categories-top
 *   npm run fab01-categories-top -- --apply
 */
import { authenticate, searchRead, write } from "../api/odoo";
import { FAB01_CATEGORY_NAMES } from "./fab01Categories";

const FABRIC_ATTR_ID = 2;
/** Каталог після 8 категорій — без колізії sequence з «Рене 1…8». */
const CATALOG_SEQ_START = 100;
const APPLY = process.argv.includes("--apply");

const categoryIdSet = new Set<number>();

function reorderValueIds(valueIds: number[], categoryIds: number[]): number[] {
  const cat = categoryIds.filter((id) => valueIds.includes(id));
  const rest = valueIds.filter((id) => !categoryIdSet.has(id));
  return [...cat, ...rest];
}

async function loadCategoryValueIds(): Promise<number[]> {
  const vals = await searchRead<{ id: number; name: string }>(
    "product.attribute.value",
    [
      ["attribute_id", "=", FABRIC_ATTR_ID],
      ["name", "in", [...FAB01_CATEGORY_NAMES]],
    ],
    ["id", "name"]
  );
  if (vals.length !== FAB01_CATEGORY_NAMES.length) {
    const found = new Set(vals.map((v) => v.name));
    const missing = FAB01_CATEGORY_NAMES.filter((n) => !found.has(n));
    throw new Error(`Не всі категорії в Odoo. Відсутні: ${missing.join(", ")}`);
  }
  const byName = new Map(vals.map((v) => [v.name, v.id]));
  const ordered = FAB01_CATEGORY_NAMES.map((n) => byName.get(n)!);
  for (const id of ordered) categoryIdSet.add(id);
  return ordered;
}

async function main(): Promise<void> {
  await authenticate();
  const categoryIds = await loadCategoryValueIds();
  console.log(`Категорії (ids): ${categoryIds.join(", ")}`);
  console.log(APPLY ? "MODE: apply" : "MODE: dry-run (pass --apply)");

  if (APPLY) {
    for (let i = 0; i < categoryIds.length; i++) {
      await write("product.attribute.value", [categoryIds[i]], { sequence: i + 1 });
    }
    const allVals = await searchRead<{ id: number; sequence: number }>(
      "product.attribute.value",
      [["attribute_id", "=", FABRIC_ATTR_ID]],
      ["id", "sequence"],
      2000
    );
    const catalog = allVals
      .filter((v) => !categoryIdSet.has(v.id))
      .sort((a, b) => a.sequence - b.sequence || a.id - b.id);
    for (let i = 0; i < catalog.length; i++) {
      const seq = CATALOG_SEQ_START + i;
      if (catalog[i].sequence !== seq) {
        await write("product.attribute.value", [catalog[i].id], { sequence: seq });
      }
    }
    console.log(
      `[OK] sequence: категорії 1–8, каталог ${CATALOG_SEQ_START}+ (${catalog.length} значень)`
    );
  }

  const lines = await searchRead<{
    id: number;
    value_ids: number[];
    product_tmpl_id: [number, string];
  }>(
    "product.template.attribute.line",
    [["attribute_id", "=", FABRIC_ATTR_ID]],
    ["id", "value_ids", "product_tmpl_id"]
  );
  console.log(`\nШаблонів з «Тканина»: ${lines.length}`);

  let changed = 0;
  let unchanged = 0;

  for (const line of lines) {
    const next = reorderValueIds(line.value_ids, categoryIds);
    const same =
      next.length === line.value_ids.length &&
      next.every((id, i) => id === line.value_ids[i]);
    if (same) {
      unchanged++;
      continue;
    }
    changed++;
    const tmpl = line.product_tmpl_id[1];
    if (changed <= 3) {
      console.log(`  [~] "${tmpl}" — перенос ${categoryIds.length} категорій вгору`);
    }
    if (APPLY) {
      await write("product.template.attribute.line", [line.id], {
        value_ids: [[6, 0, next]],
      });
    }
  }

  console.log(
    `\n${APPLY ? "Оновлено" : "Потребує оновлення"}: ${changed}, без змін: ${unchanged}`
  );
  if (!APPLY && changed > 0) {
    console.log("dry-run — npm run fab01-categories-top -- --apply");
  }
}

main().catch((err) => {
  console.error("[FATAL]", err instanceof Error ? err.message : err);
  process.exit(1);
});
