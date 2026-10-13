/**
 * One-shot: add Ламель 735 / 585 to Диван Лілі Механізм template BOM (Цех №9 op).
 *   npx ts-node --transpile-only src/tools/add-lili-lamel-bom-lines.ts --apply
 */
import { authenticate, create, searchRead } from "../api/odoo";
import { findTemplate } from "../bom/product";
import { track, resetSession, saveSession } from "../state/tracker";

const SOFA = "Диван Лілі Механізм";
const LAMELS: { name: string; qty: number }[] = [
  { name: "Ламель 735", qty: 8 },
  { name: "Ламель 585", qty: 8 },
];

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  await authenticate();

  const tmpl = await findTemplate(SOFA);
  if (!tmpl) throw new Error(`Template not found: ${SOFA}`);

  const bomCode = `tmpl::${SOFA}`;
  const [bom] = await searchRead<{ id: number }>(
    "mrp.bom",
    [
      ["product_tmpl_id", "=", tmpl.id],
      ["product_id", "=", false],
      ["code", "=", bomCode],
    ],
    ["id"],
    1,
  );
  if (!bom) throw new Error(`BOM not found: ${bomCode}`);

  const ops = await searchRead<{ id: number; name: string; sequence: number }>(
    "mrp.routing.workcenter",
    [["bom_id", "=", bom.id]],
    ["id", "name", "sequence"],
  );
  ops.sort((a, b) => a.sequence - b.sequence);
  const op9 = ops.find((o) => o.name.includes("Цех №9")) ?? ops[0];
  if (!op9) throw new Error("No operations on sofa BOM");

  const lines = await searchRead<{ product_id: [number, string] }>(
    "mrp.bom.line",
    [["bom_id", "=", bom.id]],
    ["product_id"],
  );
  const have = new Set(lines.map((l) => l.product_id[0]));

  for (const { name, qty } of LAMELS) {
    const [p] = await searchRead<{ id: number }>(
      "product.product",
      [["product_tmpl_id.name", "=", name]],
      ["id"],
      1,
    );
    if (!p) throw new Error(`Variant missing for ${name}`);
    if (have.has(p.id)) {
      console.log(`[OK] already on BOM: ${name}`);
      continue;
    }
    if (!apply) {
      console.log(`[MISS] ${name} × ${qty} шт → op ${op9.name}`);
      continue;
    }
    resetSession();
    const lineId = await create("mrp.bom.line", {
      bom_id: bom.id,
      product_id: p.id,
      product_qty: qty,
      product_uom_id: 1,
      operation_id: op9.id,
    });
    track.bomLine(lineId);
    console.log(`[+] ${name} × ${qty} (line ${lineId})`);
  }

  if (apply) saveSession("add-lili-lamel-bom-lines");
}

main().catch((e: Error) => {
  console.error("[FATAL]", e.message);
  process.exit(1);
});
