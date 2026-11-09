/**
 * Assign serial lots to open sofa MOs (tracking=serial) from sale line uids + global sequence.
 *
 *   npm run assign-mo-serials -- --so S00265           # dry-run
 *   npm run assign-mo-serials -- --mo WH/MO/00699 --apply
 *   npm run assign-mo-serials -- --so S00265 --apply
 */
import { authenticate, create, executeKw, searchRead, write } from "../api/odoo";

const APPLY = process.argv.includes("--apply");
const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  if (i === -1 || i + 1 >= process.argv.length) return undefined;
  return process.argv[i + 1];
}

const SO_NAME = flag("--so");
const MO_NAME = flag("--mo");

type MoRow = {
  id: number;
  name: string;
  state: string;
  product_id: [number, string];
  product_qty: number;
  origin: string | false;
  sale_line_id: false | [number, string];
  lot_producing_ids: number[];
  serial_numbers_count: number;
};

let seqRow: { id: number; prefix: string | false; padding: number; number_next: number } | null =
  null;

async function peekSerialNames(count: number): Promise<string[]> {
  if (!seqRow) {
    const [row] = await searchRead<{
      id: number;
      prefix: string | false;
      padding: number;
      number_next: number;
    }>("ir.sequence", [["code", "=", "stock.lot.serial"]], ["prefix", "padding", "number_next"], 1);
    if (!row) throw new Error("Sequence stock.lot.serial missing");
    seqRow = row;
  }
  const prefix = seqRow.prefix || "";
  const pad = seqRow.padding || 0;
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const n = seqRow.number_next + i;
    out.push(pad ? `${prefix}${String(n).padStart(pad, "0")}` : `${prefix}${n}`);
  }
  return out;
}

async function consumeSerialNames(count: number): Promise<string[]> {
  const names: string[] = [];
  for (let i = 0; i < count; i++) {
    const name = await executeKw<string | false>("ir.sequence", "next_by_code", ["stock.lot.serial"]);
    if (!name) throw new Error("Sequence stock.lot.serial missing or empty");
    names.push(name);
  }
  return names;
}

async function saleLineUids(
  mo: MoRow,
): Promise<string[]> {
  const productId = mo.product_id[0];
  let orderId: number | null = null;

  if (mo.sale_line_id) {
    const [line] = await searchRead<{ id: number; order_id: [number, string]; x_studio_x_so_line_uid: string | false }>(
      "sale.order.line",
      [["id", "=", mo.sale_line_id[0]]],
      ["id", "order_id", "x_studio_x_so_line_uid"],
      1,
    );
    if (line) orderId = line.order_id[0];
  } else if (mo.origin && /^S\d+/.test(mo.origin)) {
    const [so] = await searchRead<{ id: number }>("sale.order", [["name", "=", mo.origin]], ["id"], 1);
    if (so) orderId = so.id;
  }

  if (!orderId) {
    return Array.from({ length: mo.product_qty }, (_, i) => `${mo.name} #${i + 1}`);
  }

  const lines = await searchRead<{
    id: number;
    product_id: [number, string];
    x_studio_x_so_line_uid: string | false;
    display_type: string | false;
  }>(
    "sale.order.line",
    [["order_id", "=", orderId], ["product_id", "=", productId]],
    ["id", "product_id", "x_studio_x_so_line_uid", "display_type"],
    0,
  );
  const productLines = lines.filter((l) => !l.display_type || l.display_type === "product");
  productLines.sort((a, b) => a.id - b.id);

  const uids = productLines
    .map((l) => l.x_studio_x_so_line_uid || `${mo.origin} / line ${l.id}`)
    .slice(0, mo.product_qty);

  while (uids.length < mo.product_qty) {
    uids.push(`${mo.origin || mo.name} / extra ${uids.length + 1}`);
  }
  return uids;
}

async function loadMos(): Promise<MoRow[]> {
  const domain: unknown[][] = [["state", "in", ["confirmed", "progress"]]];
  if (MO_NAME) domain.push(["name", "=", MO_NAME]);
  else if (SO_NAME) domain.push(["origin", "=", SO_NAME]);
  else {
    console.error("Usage: assign-mo-serials --so S00xxx | --mo WH/MO/00xxx [--apply]");
    process.exit(2);
  }

  const mos = await searchRead<MoRow>(
    "mrp.production",
    domain as never,
    [
      "id",
      "name",
      "state",
      "product_id",
      "product_qty",
      "origin",
      "sale_line_id",
      "lot_producing_ids",
      "serial_numbers_count",
    ],
    0,
  );

  const out: MoRow[] = [];
  for (const mo of mos) {
    const [prod] = await searchRead<{ tracking: string }>(
      "product.product",
      [["id", "=", mo.product_id[0]]],
      ["tracking"],
      1,
    );
    if (prod?.tracking !== "serial") continue;
    const name = mo.product_id[1];
    if (!name.startsWith("Диван ") && !name.startsWith("Ліжко ")) continue;
    out.push(mo);
  }
  return out;
}

async function main() {
  await authenticate();
  const mos = await loadMos();
  if (!mos.length) {
    console.log("No open finished-product MOs matched.");
    return;
  }

  console.log(APPLY ? "[APPLY]" : "[dry-run]", `MOs: ${mos.length}`);

  for (const mo of mos) {
    const need = Math.round(mo.product_qty);
    const have = mo.lot_producing_ids?.length ?? 0;
    if (have >= need && mo.serial_numbers_count >= need) {
      console.log(`  ${mo.name}: already has ${have} lot(s), skip`);
      continue;
    }

    const refs = await saleLineUids(mo);
    const lotIds: number[] = [...(mo.lot_producing_ids || [])];
    const toCreate = need - lotIds.length;
    const serialNames = APPLY
      ? await consumeSerialNames(toCreate)
      : await peekSerialNames(toCreate);

    for (let i = 0; i < toCreate; i++) {
      const sn = serialNames[i]!;
      const refIdx = lotIds.length + i;
      const vals = {
        name: sn,
        product_id: mo.product_id[0],
        ref: refs[refIdx] ?? refs[i] ?? false,
      };
      console.log(`  ${mo.name}: + lot ${sn} ref=${vals.ref}`);
      if (APPLY) {
        const id = await create("stock.lot", vals);
        lotIds.push(id);
      }
    }

    if (APPLY && lotIds.length) {
      await write("mrp.production", [mo.id], {
        lot_producing_ids: [[6, 0, lotIds]],
        serial_numbers_count: need,
      });
      const [after] = await searchRead<MoRow>(
        "mrp.production",
        [["id", "=", mo.id]],
        ["lot_producing_ids", "serial_numbers_count"],
        1,
      );
      console.log(`  ${mo.name}: wrote lots ${after.lot_producing_ids} count=${after.serial_numbers_count}`);
    }
  }
}

main().catch((err) => {
  console.error("[FATAL]", err.message || err);
  process.exit(1);
});
