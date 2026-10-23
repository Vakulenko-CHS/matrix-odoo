/**
 * Merge size-in-name 🧩[Ламінат кольоровий - лист] … templates into tmpl 214
 * variants (size × color). Remap BOM lines / moves / orderpoints. Archive splits.
 *
 *   npx ts-node --transpile-only src/commands/mergeColoredSheetSplits.ts --apply
 */
import {
  authenticate,
  create,
  executeKw,
  searchRead,
  unlink,
  write,
} from "../api/odoo";

const APPLY = process.argv.includes("--apply");
const CANON = 214;
const CANON_NAME = "🧩[Ламінат кольоровий - лист]";
const COLORS = ["Венге", "Трифе", "Дуб крарт", "Білий"] as const;
const CTX = { context: { lang: "uk_UA", active_test: false } };

function parseSize(tmplName: string): string {
  const rest = tmplName.replace(/^🧩\[Ламінат кольоровий - лист\]\s*/, "");
  const m = rest.match(/(\d+)\s*[xхXХ]\s*(\d+)/);
  if (!m) throw new Error(`no size in ${tmplName}`);
  const size = `${m[1]}x${m[2]}`;
  if (size === "303x100") return "100x303";
  return size;
}

function parseColor(display: string): string | null {
  for (const c of COLORS) {
    if (display.includes(`(${c})`) || display.endsWith(`(${c})`)) return c;
  }
  return null;
}

async function remapProduct(fromId: number, toId: number): Promise<number> {
  if (fromId === toId) return 0;
  let n = 0;
  const models: Array<[string, string]> = [
    ["mrp.bom.line", "product_id"],
    ["stock.move", "product_id"],
    ["stock.move.line", "product_id"],
    ["stock.warehouse.orderpoint", "product_id"],
  ];
  for (const [model, field] of models) {
    const ids = await executeKw<number[]>(
      model,
      "search",
      [[[field, "=", fromId]]],
      CTX,
    );
    if (!ids.length) continue;
    try {
      await write(model, ids, { [field]: toId });
      n += ids.length;
    } catch (e: any) {
      console.log(`  write fail ${model} ${e.message?.slice(0, 180)}`);
    }
  }
  return n;
}

async function colorPtavs(tmplId: number): Promise<Map<string, number>> {
  const rows = await searchRead<{
    id: number;
    name: string;
    attribute_id: [number, string];
  }>("product.template.attribute.value", [["product_tmpl_id", "=", tmplId]], [
    "id",
    "name",
    "attribute_id",
  ]);
  const map = new Map<string, number>();
  for (const r of rows) {
    if (r.attribute_id[1]?.includes("Колір") || COLORS.includes(r.name as any)) {
      map.set(r.name, r.id);
    }
  }
  return map;
}

async function run() {
  await authenticate();
  const canonVars = await executeKw<{ id: number; display_name: string }[]>(
    "product.product",
    "search_read",
    [[["product_tmpl_id", "=", CANON]]],
    { fields: ["id", "display_name"], ...CTX },
  );
  const byName = new Map(canonVars.map((v) => [v.display_name, v.id]));
  const target = (size: string, color: string) => {
    const name = `${CANON_NAME} (${size}, ${color})`;
    const id = byName.get(name);
    if (!id) throw new Error(`missing canon ${name}`);
    return id;
  };

  const splits = await executeKw<{ id: number; name: string; active: boolean }[]>(
    "product.template",
    "search_read",
    [[["name", "ilike", CANON_NAME]]],
    { fields: ["id", "name", "active"], ...CTX },
  );
  const extra = splits.filter((t) => t.id !== CANON);
  console.log(`split templates ${extra.length}`);

  for (const t of extra) {
    const size = parseSize(t.name);
    const vars = await executeKw<{ id: number; display_name: string }[]>(
      "product.product",
      "search_read",
      [[["product_tmpl_id", "=", t.id]]],
      { fields: ["id", "display_name"], ...CTX },
    );
    console.log(`\n${t.id} ${t.name} → size ${size} vars ${vars.length}`);

    for (const v of vars) {
      const color = parseColor(v.display_name);
      const lines = await executeKw<
        {
          id: number;
          bom_id: [number, string];
          product_qty: number;
          bom_product_template_attribute_value_ids: number[];
        }[]
      >(
        "mrp.bom.line",
        "search_read",
        [[["product_id", "=", v.id]]],
        {
          fields: [
            "id",
            "bom_id",
            "product_qty",
            "bom_product_template_attribute_value_ids",
          ],
          ...CTX,
        },
      );

      if (color) {
        const toId = target(size, color);
        console.log(`  ${v.display_name} → ${size},${color} #${toId} lines=${lines.length}`);
        if (APPLY) {
          const n = await remapProduct(v.id, toId);
          console.log(`    remapped ${n}`);
        }
        continue;
      }

      // colorless: per BOM, match overlay color or explode tmpl BOM
      for (const line of lines) {
        const [bom] = await executeKw<
          { id: number; product_id: false | [number, string]; product_tmpl_id: [number, string] }[]
        >("mrp.bom", "read", [[line.bom_id[0]], ["product_id", "product_tmpl_id"]]);
        const bomColor = bom.product_id
          ? parseColor(bom.product_id[1])
          : null;
        if (bomColor) {
          const toId = target(size, bomColor);
          console.log(`  line ${line.id} colorless → ${bomColor} #${toId}`);
          if (APPLY) await write("mrp.bom.line", [line.id], { product_id: toId });
          continue;
        }
        const ptavs = await colorPtavs(bom.product_tmpl_id[0]);
        if (ptavs.size >= 2) {
          console.log(
            `  line ${line.id} explode tmpl BOM ${bom.product_tmpl_id[1]} colors=${ptavs.size}`,
          );
          if (APPLY) {
            for (const c of COLORS) {
              const ptav = ptavs.get(c);
              if (!ptav) continue;
              await create("mrp.bom.line", {
                bom_id: bom.id,
                product_id: target(size, c),
                product_qty: line.product_qty,
                bom_product_template_attribute_value_ids: [[6, 0, [ptav]]],
              });
            }
            await unlink("mrp.bom.line", [line.id]);
          }
        } else {
          const toId = target(size, "Венге");
          console.log(`  line ${line.id} fallback Венге #${toId}`);
          if (APPLY) await write("mrp.bom.line", [line.id], { product_id: toId });
        }
      }
      const leftover = await executeKw<number>(
        "mrp.bom.line",
        "search_count",
        [[["product_id", "=", v.id]]],
        CTX,
      );
      if (leftover && APPLY) {
        const n = await remapProduct(v.id, target(size, "Венге"));
        console.log(`  leftover remap ${n}`);
      }
    }

    if (APPLY) {
      const still = await executeKw<number>(
        "mrp.bom.line",
        "search_count",
        [[["product_id", "in", vars.map((v) => v.id)]]],
        CTX,
      );
      if (still) {
        console.log(`  SKIP archive ${t.id} still ${still} lines`);
        continue;
      }
      await write("product.template", [t.id], {
        active: false,
        purchase_ok: false,
        sale_ok: false,
      });
      console.log(`  archived ${t.id}`);
    }
  }

  if (APPLY) {
    await write("product.template", [CANON], {
      purchase_ok: false,
      sale_ok: false,
    });
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
