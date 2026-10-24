/**
 * Create missing furniture product.template rows (canonical names from right_names_furniture).
 *
 *   npx ts-node --transpile-only src/tools/ensure-furniture-products.ts --check
 *   npx ts-node --transpile-only src/tools/ensure-furniture-products.ts --apply
 */
import { authenticate, create, searchRead } from "../api/odoo";
import { track, resetSession, saveSession } from "../state/tracker";

const FURNITURE_CATEGORY = "Сировина / Фурнітура";
const REFERENCE_PRODUCT = "Кріплення ламелі";

const CANON_NAMES = [
  "Куток великий чорний",
  "Ламель 585",
  "Ламель 735",
] as const;

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  await authenticate();

  const [ref] = await searchRead<{
    id: number;
    categ_id: [number, string];
    type: string;
    uom_id: [number, number];
    purchase_ok: boolean;
    sale_ok: boolean;
  }>(
    "product.template",
    [["name", "=", REFERENCE_PRODUCT]],
    ["id", "categ_id", "type", "uom_id", "purchase_ok", "sale_ok"],
    1,
  );
  if (!ref) {
    throw new Error(`Reference product not found: ${REFERENCE_PRODUCT}`);
  }

  const existing = await searchRead<{ id: number; name: string }>(
    "product.template",
    [["name", "in", [...CANON_NAMES]]],
    ["id", "name"],
  );
  const byName = new Map(existing.map((r) => [r.name, r.id]));

  if (apply) resetSession();

  for (const name of CANON_NAMES) {
    const id = byName.get(name);
    if (id) {
      console.log(`[OK] exists: «${name}» (tmpl ${id})`);
      continue;
    }
    if (!apply) {
      console.log(`[MISS] «${name}» — run with --apply to create`);
      continue;
    }
    const tmplId = await create("product.template", {
      name,
      type: ref.type,
      categ_id: ref.categ_id[0],
      uom_id: ref.uom_id[0],
      purchase_ok: ref.purchase_ok,
      sale_ok: ref.sale_ok,
    });
    track.template(tmplId);
    const [variant] = await searchRead<{ id: number }>(
      "product.product",
      [["product_tmpl_id", "=", tmplId]],
      ["id"],
      1,
    );
    console.log(`[+] created: «${name}» tmpl=${tmplId} variant=${variant?.id ?? "?"}`);
  }

  if (apply) saveSession("ensure-furniture-products");
}

main().catch((e: Error) => {
  console.error("[FATAL]", e.message);
  process.exit(1);
});
