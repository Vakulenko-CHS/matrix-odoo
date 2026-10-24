/**
 * Sync 🧩[Ламінат - лист] BOMs from temp/Ламінат.tsv:
 * - laminate (Білий) qty = col B
 * - кромка (Білий) qty = col E (skip if БК)
 * - ops: Порізка (C) + Поклейка (D) on workcenter Цех №3-0
 * - bom.line.operation_id = Спожитий в операції
 *
 *   npx ts-node --transpile-only src/tools/sync-laminate-sheet-boms.ts --check
 *   npx ts-node --transpile-only src/tools/sync-laminate-sheet-boms.ts --apply
 */
import * as fs from "fs";
import * as path from "path";
import {
  authenticate,
  create,
  searchRead,
  write,
  unlink,
} from "../api/odoo";
import { sleep } from "./odooPaged";

const TMPL_NAME = "🧩[Ламінат - лист]";
const WC_NAME = "Цех №3-0 ЛДСП (Нарізка Ламінату)";
const LAM_WHITE = "[Ламінат] (Білий)";
const KROM_WHITE = "[Кромка] (Білий)";

type Row = {
  size: string;
  isBk: boolean;
  lamQty: number;
  cutPrice: number;
  gluePrice: number | null;
  kromQty: number | null;
};

function parseTsv(file: string): Row[] {
  const lines = fs.readFileSync(file, "utf-8").split(/\r?\n/);
  const bySize = new Map<string, Row>();
  for (const line of lines.slice(7)) {
    if (!line.trim()) continue;
    const cols = line.split("\t");
    const raw = (cols[0] || "").trim();
    if (!raw || !/\d/.test(raw)) continue;
    const size = raw.replace(/\s+/g, "");
    const isBk = /БК$/i.test(size);
    const lamQty = parseFloat((cols[1] || "").replace(",", "."));
    const cutPrice = parseFloat((cols[2] || "").replace(",", "."));
    const glueRaw = (cols[3] || "").trim();
    const kromRaw = (cols[4] || "").trim();
    const gluePrice =
      glueRaw === "" || glueRaw.toLowerCase() === "null"
        ? null
        : parseFloat(glueRaw.replace(",", "."));
    const kromQty =
      kromRaw === "" || kromRaw.toLowerCase() === "null"
        ? null
        : parseFloat(kromRaw.replace(",", "."));
    if (Number.isNaN(lamQty) || Number.isNaN(cutPrice)) {
      console.warn(`skip bad row ${raw}`);
      continue;
    }
    bySize.set(size, {
      size,
      isBk: isBk || kromQty == null,
      lamQty,
      cutPrice,
      gluePrice: isBk || kromQty == null ? null : gluePrice,
      kromQty: isBk || kromQty == null ? null : kromQty,
    });
  }
  return [...bySize.values()];
}

function nearly(a: number, b: number, eps = 1e-6): boolean {
  return Math.abs(a - b) <= eps;
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const check = process.argv.includes("--check") || !apply;
  await authenticate();

  const rows = parseTsv(path.resolve("temp/Ламінат.tsv"));
  console.log(`[laminate-bom] rows=${rows.length} mode=${apply ? "APPLY" : "CHECK"}`);

  const tmpls = await searchRead<{ id: number }>(
    "product.template",
    [["name", "=", TMPL_NAME]],
    ["id"],
    1,
  );
  if (!tmpls.length) throw new Error(`tmpl not found ${TMPL_NAME}`);
  const tmplId = tmpls[0].id;

  const wcs = await searchRead<{ id: number; name: string }>(
    "mrp.workcenter",
    [["name", "=", WC_NAME]],
    ["id", "name"],
    1,
  );
  if (!wcs.length) throw new Error(`workcenter not found ${WC_NAME}`);
  const wcId = wcs[0].id;

  const lamPs = await searchRead<{ id: number; display_name: string }>(
    "product.product",
    [["product_tmpl_id.name", "=", "[Ламінат]"]],
    ["id", "display_name"],
  );
  const kromPsAll = await searchRead<{ id: number; display_name: string }>(
    "product.product",
    [["product_tmpl_id.name", "=", "[Кромка]"]],
    ["id", "display_name"],
  );
  const lamPsHit = lamPs.filter((p) => p.display_name === LAM_WHITE);
  const kromPs = kromPsAll.filter((p) => p.display_name === KROM_WHITE);
  if (!lamPsHit.length) throw new Error(`product not found ${LAM_WHITE}`);
  if (!kromPs.length) throw new Error(`product not found ${KROM_WHITE}`);
  const lamId = lamPsHit[0].id;
  const kromId = kromPs[0].id;

  const boms = await searchRead<{
    id: number;
    code: string | false;
    product_id: [number, string] | false;
  }>("mrp.bom", [["product_tmpl_id", "=", tmplId]], [
    "id",
    "code",
    "product_id",
  ]);
  /** Prefer exact code match; then variant size in display name. */
  const bomBySize = new Map<string, (typeof boms)[0]>();
  for (const b of boms) {
    if (!b.code) continue;
    const c = String(b.code).replace(/\s+/g, "");
    if (c.includes("[")) continue;
    // last write wins only if empty — keep first exact code
    if (!bomBySize.has(c)) bomBySize.set(c, b);
  }
  for (const b of boms) {
    const pname = b.product_id ? b.product_id[1] : "";
    const m = pname.match(/\(([^)]+)\)\s*$/);
    const fromName = m?.[1]?.replace(/\s+/g, "");
    if (fromName && !bomBySize.has(fromName)) bomBySize.set(fromName, b);
  }

  let issues = 0;
  let fixed = 0;
  const missingBom: string[] = [];

  for (const row of rows) {
    const bom = bomBySize.get(row.size);
    if (!bom) {
      missingBom.push(row.size);
      issues++;
      console.log(`MISS bom ${row.size}`);
      continue;
    }
    const productName = bom.product_id
      ? bom.product_id[1]
      : `${TMPL_NAME} (${row.size})`;
    const cutName = `Операція (Цех №3-0) Порізка - ${productName}`;
    const glueName = `Операція (Цех №3-0) Поклейка - ${productName}`;

    const lines = await searchRead<{
      id: number;
      product_id: [number, string];
      product_qty: number;
      operation_id: [number, string] | false;
    }>("mrp.bom.line", [["bom_id", "=", bom.id]], [
      "id",
      "product_id",
      "product_qty",
      "operation_id",
    ]);
    const lamLine = lines.find((l) => l.product_id[0] === lamId);
    const kromLine = lines.find((l) => l.product_id[0] === kromId);
    const extra = lines.filter(
      (l) => l.product_id[0] !== lamId && l.product_id[0] !== kromId,
    );

    const ops = await searchRead<{
      id: number;
      name: string;
      workcenter_id: [number, string];
      sequence: number;
      x_studio_piece_rate_2: number;
    }>("mrp.routing.workcenter", [["bom_id", "=", bom.id]], [
      "id",
      "name",
      "workcenter_id",
      "sequence",
      "x_studio_piece_rate_2",
    ]);
    let cutOp = ops.find((o) => /Порізка/i.test(o.name));
    let glueOp = ops.find((o) => /Поклейка/i.test(o.name));

    const problems: string[] = [];

    if (!lamLine) problems.push("no laminate line");
    else if (!nearly(lamLine.product_qty, row.lamQty)) {
      problems.push(`lam qty ${lamLine.product_qty}≠${row.lamQty}`);
    }

    if (row.isBk) {
      if (kromLine) problems.push(`BK but has kromka qty=${kromLine.product_qty}`);
      if (glueOp) problems.push("BK but has glue op");
    } else {
      if (!kromLine) problems.push("no kromka line");
      else if (row.kromQty != null && !nearly(kromLine.product_qty, row.kromQty)) {
        problems.push(`krom qty ${kromLine.product_qty}≠${row.kromQty}`);
      }
      if (row.gluePrice == null) problems.push("missing glue price in TSV");
    }

    if (!cutOp) problems.push("no cut op");
    else {
      if (cutOp.workcenter_id[0] !== wcId) problems.push("cut wrong WC");
      if (!nearly(cutOp.x_studio_piece_rate_2 ?? 0, row.cutPrice)) {
        problems.push(
          `cut price ${cutOp.x_studio_piece_rate_2}≠${row.cutPrice}`,
        );
      }
      if (cutOp.name !== cutName) problems.push(`cut name «${cutOp.name}»`);
    }

    if (!row.isBk) {
      if (!glueOp) problems.push("no glue op");
      else {
        if (glueOp.workcenter_id[0] !== wcId) problems.push("glue wrong WC");
        if (
          row.gluePrice != null &&
          !nearly(glueOp.x_studio_piece_rate_2 ?? 0, row.gluePrice)
        ) {
          problems.push(
            `glue price ${glueOp.x_studio_piece_rate_2}≠${row.gluePrice}`,
          );
        }
        if (glueOp.name !== glueName) problems.push(`glue name «${glueOp.name}»`);
      }
    }

    if (lamLine && cutOp && lamLine.operation_id?.[0] !== cutOp.id) {
      problems.push("lam not consumed in cut");
    }
    if (!row.isBk && kromLine && glueOp && kromLine.operation_id?.[0] !== glueOp.id) {
      problems.push("krom not consumed in glue");
    }
    if (extra.length) {
      problems.push(`extra lines=${extra.length}`);
    }

    if (problems.length) {
      issues++;
      console.log(`BAD ${row.size}: ${problems.join("; ")}`);
    } else if (check && !apply) {
      // quiet ok
    }

    if (!apply) continue;

    // ── apply ────────────────────────────────────────────────────
    // ops first (need ids for lines)
    if (!cutOp) {
      const id = await create("mrp.routing.workcenter", {
        name: cutName,
        bom_id: bom.id,
        workcenter_id: wcId,
        sequence: 1,
        x_studio_piece_rate_2: row.cutPrice,
      });
      cutOp = {
        id,
        name: cutName,
        workcenter_id: [wcId, WC_NAME],
        sequence: 1,
        x_studio_piece_rate_2: row.cutPrice,
      };
    } else {
      const vals: Record<string, unknown> = {};
      if (cutOp.name !== cutName) vals.name = cutName;
      if (cutOp.workcenter_id[0] !== wcId) vals.workcenter_id = wcId;
      if (!nearly(cutOp.x_studio_piece_rate_2 ?? 0, row.cutPrice)) {
        vals.x_studio_piece_rate_2 = row.cutPrice;
      }
      if (cutOp.sequence !== 1) vals.sequence = 1;
      if (Object.keys(vals).length) await write("mrp.routing.workcenter", [cutOp.id], vals);
    }

    if (row.isBk) {
      if (glueOp) {
        await unlink("mrp.routing.workcenter", [glueOp.id]);
        glueOp = undefined;
      }
    } else {
      const gluePrice = row.gluePrice ?? 0;
      if (!glueOp) {
        const id = await create("mrp.routing.workcenter", {
          name: glueName,
          bom_id: bom.id,
          workcenter_id: wcId,
          sequence: 2,
          x_studio_piece_rate_2: gluePrice,
        });
        glueOp = {
          id,
          name: glueName,
          workcenter_id: [wcId, WC_NAME],
          sequence: 2,
          x_studio_piece_rate_2: gluePrice,
        };
      } else {
        const vals: Record<string, unknown> = {};
        if (glueOp.name !== glueName) vals.name = glueName;
        if (glueOp.workcenter_id[0] !== wcId) vals.workcenter_id = wcId;
        if (!nearly(glueOp.x_studio_piece_rate_2 ?? 0, gluePrice)) {
          vals.x_studio_piece_rate_2 = gluePrice;
        }
        if (glueOp.sequence !== 2) vals.sequence = 2;
        if (Object.keys(vals).length) {
          await write("mrp.routing.workcenter", [glueOp.id], vals);
        }
      }
    }

    // lines
    if (!lamLine) {
      await create("mrp.bom.line", {
        bom_id: bom.id,
        product_id: lamId,
        product_qty: row.lamQty,
        operation_id: cutOp!.id,
      });
    } else {
      const vals: Record<string, unknown> = {};
      if (!nearly(lamLine.product_qty, row.lamQty)) vals.product_qty = row.lamQty;
      if (lamLine.operation_id?.[0] !== cutOp!.id) vals.operation_id = cutOp!.id;
      if (Object.keys(vals).length) await write("mrp.bom.line", [lamLine.id], vals);
    }

    if (row.isBk) {
      if (kromLine) await unlink("mrp.bom.line", [kromLine.id]);
    } else if (row.kromQty != null && glueOp) {
      if (!kromLine) {
        await create("mrp.bom.line", {
          bom_id: bom.id,
          product_id: kromId,
          product_qty: row.kromQty,
          operation_id: glueOp.id,
        });
      } else {
        const vals: Record<string, unknown> = {};
        if (!nearly(kromLine.product_qty, row.kromQty)) {
          vals.product_qty = row.kromQty;
        }
        if (kromLine.operation_id?.[0] !== glueOp.id) {
          vals.operation_id = glueOp.id;
        }
        if (Object.keys(vals).length) await write("mrp.bom.line", [kromLine.id], vals);
      }
    }

    fixed++;
    await sleep(30);
  }

  console.log("");
  console.log(`[laminate-bom] issues=${issues} fixed=${fixed} missingBom=${missingBom.length}`);
  if (missingBom.length) console.log(`missing: ${missingBom.join(", ")}`);
  if (check && !apply && issues > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error("[laminate-bom]", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
