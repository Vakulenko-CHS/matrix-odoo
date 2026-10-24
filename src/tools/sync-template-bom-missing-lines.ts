/**
 * Add missing component lines to existing template-level BOMs (product_id = false).
 * Does not remove or change existing lines.
 *
 *   npx ts-node --transpile-only src/tools/sync-template-bom-missing-lines.ts --check exports/foo.json
 *   npx ts-node --transpile-only src/tools/sync-template-bom-missing-lines.ts --apply exports/foo.json
 */
import * as fs from "fs";
import * as path from "path";
import { authenticate, create, searchRead } from "../api/odoo";
import { findTemplate } from "../bom/product";
import { ensureVariantFromAttrs } from "./importJson/resolver";
import type { BomEntry, OdooImportJson } from "./docToJson/types";
import { convertFilmQty } from "../validator/filmUom";
import { track, resetSession, saveSession } from "../state/tracker";

const UOM_MAP: Record<string, number> = {
  шт: 1,
  "шт.": 1,
  m: 8,
  "m²": 10,
  г: 14,
  g: 14,
  кг: 15,
  "m³": 30,
};

function uomId(uom: string): number {
  return UOM_MAP[uom] ?? 1;
}

function componentKey(templateName: string, attrs: { attributeName: string; value: string }[]): string {
  if (!attrs.length) return templateName;
  const tail = attrs.map((a) => `${a.attributeName}=${a.value}`).join("|");
  return `${templateName}::${tail}`;
}

async function syncEntry(entry: BomEntry, apply: boolean): Promise<number> {
  const templateName = entry.product.templateName;
  const found = await findTemplate(templateName);
  if (!found) {
    console.warn(`  [SKIP] no template: ${templateName}`);
    return 0;
  }

  const bomCode = `tmpl::${templateName}`;
  const [bom] = await searchRead<{ id: number }>(
    "mrp.bom",
    [
      ["product_tmpl_id", "=", found.id],
      ["product_id", "=", false],
      ["code", "=", bomCode],
    ],
    ["id"],
    1,
  );
  if (!bom) {
    console.warn(`  [SKIP] no template BOM: ${bomCode}`);
    return 0;
  }

  const ops = await searchRead<{ id: number; sequence: number }>(
    "mrp.routing.workcenter",
    [["bom_id", "=", bom.id]],
    ["id", "sequence"],
  );
  ops.sort((a, b) => a.sequence - b.sequence);
  const opIds = ops.map((o) => o.id);

  const lines = await searchRead<{ id: number; product_id: [number, string]; operation_id: false | [number, string] }>(
    "mrp.bom.line",
    [["bom_id", "=", bom.id]],
    ["id", "product_id", "operation_id"],
  );
  const existingKeys = new Set(
    lines.map((l) => {
      const op = l.operation_id ? l.operation_id[0] : 0;
      return `${l.product_id[0]}@${op}`;
    }),
  );

  let added = 0;
  for (const comp of entry.components) {
    if (comp.attributes.some((a) => a.value.includes("%"))) continue;

    const resolved = await ensureVariantFromAttrs(
      comp.templateName,
      comp.attributes,
      comp.isService ?? false,
      true,
    );
    if (!resolved) {
      console.warn(`  [SKIP] component unresolved: ${componentKey(comp.templateName, comp.attributes)}`);
      continue;
    }

    const opId = opIds[comp.operationIndex] ?? false;
    const key = `${resolved.variantId}@${opId || 0}`;
    if (existingKeys.has(key)) continue;

    const film = convertFilmQty(comp.templateName, comp.qty, comp.uom);
    const label = componentKey(comp.templateName, comp.attributes);
    if (!apply) {
      console.log(`  [MISS] ${label} × ${film.qty} ${film.uom} (op ${comp.operationIndex})`);
      added++;
      continue;
    }

    const lineId = await create("mrp.bom.line", {
      bom_id: bom.id,
      product_id: resolved.variantId,
      product_qty: film.qty,
      product_uom_id: uomId(film.uom),
      sequence: lines.length + added + 1,
      operation_id: opId || false,
    });
    track.bomLine(lineId);
    existingKeys.add(key);
    console.log(`  [+] ${label} × ${film.qty} ${film.uom}`);
    added++;
  }
  return added;
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const finalOnly = process.argv.includes("--final-only");
  const jsonPath = process.argv.find((a) => a.endsWith(".json"));
  if (!jsonPath) {
    console.error("Usage: … --check|--apply <exports/*.json>");
    process.exit(2);
  }
  const abs = path.resolve(jsonPath);
  const data: OdooImportJson = JSON.parse(fs.readFileSync(abs, "utf-8"));

  await authenticate();
  if (apply) resetSession();

  let total = 0;
  const entries = finalOnly
    ? data.boms.filter((e) => e.product.templateName.startsWith("Диван "))
    : data.boms;
  console.log(
    `\n[sync-bom-lines] ${path.basename(abs)} (${entries.length}/${data.boms.length} BOM entries${finalOnly ? ", final sofas only" : ""})`,
  );
  for (const entry of entries) {
    const n = await syncEntry(entry, apply);
    total += n;
  }

  console.log(`\nПідсумок: ${total} ${apply ? "додано" : "відсутніх"} рядків`);
  if (apply && total > 0) saveSession(`sync-bom-lines:${path.basename(abs)}`);
}

main().catch((e: Error) => {
  console.error("[FATAL]", e.message);
  process.exit(1);
});
