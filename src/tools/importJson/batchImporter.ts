import { searchRead, write, create, createMany, unlink, executeKw } from '../../api/odoo';
import { getOrCreateWorkcenter } from '../../bom/product';
import { ensureVariantFromAttrs, preSeedAttributeLines, clearVariantDisplayCache } from './resolver';
import { expandEntry } from './expander';
import { track, resetSession, saveSession } from '../../state/tracker';
import type { BomEntry } from '../docToJson/types';
import { convertFilmQty } from '../../validator/filmUom';

const UOM_MAP: Record<string, number> = {
  'шт': 1, 'шт.': 1, 'm': 8, 'm²': 10, 'г': 14, 'g': 14, 'кг': 15, 'm³': 30,
};

function uomStrToId(uom: string): number {
  const id = UOM_MAP[uom];
  if (id === undefined) {
    console.warn(`  [WARN] Невідома одиниця "${uom}", використовується шт`);
    return 1;
  }
  return id;
}

function sec(start: number): string {
  return `${((Date.now() - start) / 1000).toFixed(2)}s`;
}

async function ensureVariantLimit(minLimit = 10000): Promise<void> {
  const [existing] = await searchRead<{ id: number; value: string }>(
    'ir.config_parameter',
    [['key', '=', 'product.dynamic_variant_limit']],
    ['id', 'value'], 1
  );
  if (existing) {
    const current = parseInt(existing.value, 10);
    if (current < minLimit) {
      await write('ir.config_parameter', [existing.id], { value: String(minLimit) });
      console.log(`[config] product.dynamic_variant_limit: ${current} → ${minLimit}`);
    }
  } else {
    await create('ir.config_parameter', { key: 'product.dynamic_variant_limit', value: String(minLimit) });
    console.log(`[config] product.dynamic_variant_limit = ${minLimit}`);
  }
}

async function deleteWrongBoms(code: string): Promise<void> {
  const existing = await searchRead<{ id: number }>('mrp.bom', [['code', '=', code]], ['id']);
  if (existing.length) {
    await unlink('mrp.bom', existing.map(b => b.id));
    console.log(`  [DEL] Видалено ${existing.length} BOM з кодом "${code}"`);
  }
}

// ─── Types ───────────────────────────────────────────────────────────────────

type PreparedOp = {
  name: string;
  workcenterID: number;
  priceRate: number;
  sequence: number;
};

type PreparedComp = {
  variantId: number;
  qty: number;
  uomId: number;
  sequence: number;
  operationIndex: number;
};

type PreparedBom = {
  bomCode: string;
  variantId: number;
  templateId: number;
  qty: number;
  operations: PreparedOp[];
  components: PreparedComp[];
};

type BomLineGroup = {
  bomId: number;
  lines: object[];
};

// ─── Resolve one expanded entry (no Odoo writes) ──────────────────────────────

async function resolveEntry(entry: BomEntry): Promise<PreparedBom | null> {
  const resolved = await ensureVariantFromAttrs(entry.product.templateName, entry.product.attributes);
  if (!resolved) return null;

  const ops: PreparedOp[] = [];
  for (let i = 0; i < entry.operations.length; i++) {
    const op = entry.operations[i];
    const wcId = await getOrCreateWorkcenter(op.workcenterName);
    ops.push({ name: op.name, workcenterID: wcId, priceRate: op.priceRate, sequence: i + 1 });
  }

  const comps: PreparedComp[] = [];
  for (let i = 0; i < entry.components.length; i++) {
    const comp = entry.components[i];
    const compRes = await ensureVariantFromAttrs(comp.templateName, comp.attributes, comp.isService ?? false, true);
    if (!compRes) {
      console.warn(`    [SKIP comp] "${comp.templateName}"`);
      continue;
    }
    const film = convertFilmQty(comp.templateName, comp.qty, comp.uom);
    comps.push({
      variantId: compRes.variantId,
      qty: film.qty,
      uomId: uomStrToId(film.uom),
      sequence: i + 1,
      operationIndex: comp.operationIndex,
    });
  }

  return {
    bomCode: entry.product.variantDisplayName,
    variantId: resolved.variantId,
    templateId: resolved.templateId,
    qty: entry.product.qty,
    operations: ops,
    components: comps,
  };
}

// ─── Resilient batch line creation ───────────────────────────────────────────
// Tries mega-batch first; on failure falls back to per-BOM batches so one bad
// record doesn't kill everything.

async function createLinesBatch(groups: BomLineGroup[]): Promise<number[]> {
  if (groups.length === 0) return [];

  const allLines = groups.flatMap(g => g.lines);
  try {
    return await createMany('mrp.bom.line', allLines);
  } catch (err: any) {
    const msg = (err.message ?? '').slice(0, 120);
    console.warn(`\n[WARN] Mega-batch рядків не вдався (${msg})`);
    console.warn('[WARN] Перехід до per-BOM batch...\n');

    const allIds: number[] = [];
    for (const group of groups) {
      try {
        const ids = await createMany('mrp.bom.line', group.lines);
        allIds.push(...ids);
      } catch (e: any) {
        console.error(`  [ERROR] Рядки BOM ${group.bomId}: ${(e.message ?? '').slice(0, 120)}`);
      }
    }
    return allIds;
  }
}

// ─── Build per-BOM line group ─────────────────────────────────────────────────

function buildLineGroup(bomId: number, prep: PreparedBom, opIds: number[]): BomLineGroup {
  const lines: object[] = [];
  const opCount = prep.operations.length;
  for (const comp of prep.components) {
    const operationId = comp.operationIndex < opCount ? (opIds[comp.operationIndex] ?? false) : false;
    lines.push({
      bom_id: bomId,
      product_id: comp.variantId,
      product_qty: comp.qty,
      product_uom_id: comp.uomId,
      sequence: comp.sequence,
      operation_id: operationId,
    });
  }
  return { bomId, lines };
}

// ─── Repair: find existing BOMs without lines and fill them ──────────────────

async function repairIncompleteBoms(
  existingByCode: Map<string, number>,
  allExpanded: BomEntry[]
): Promise<number> {
  const existingBomIds = [...existingByCode.values()];
  if (existingBomIds.length === 0) return 0;

  // BOMs that already have at least one line
  const bomsWithLines = await executeKw<number[]>(
    'mrp.bom', 'search',
    [[['bom_line_ids', '!=', false], ['id', 'in', existingBomIds]]],
    {}
  );
  const withLinesSet = new Set(bomsWithLines);

  const incompleteBomIds = existingBomIds.filter(id => !withLinesSet.has(id));
  if (incompleteBomIds.length === 0) return 0;

  const incompleteBomIdSet = new Set(incompleteBomIds);
  console.log(`\n[repair] ${incompleteBomIds.length} існуючих BOM без рядків — відновлення...`);

  // Load existing operations for incomplete BOMs (sequence → id mapping per bom)
  const existingOps = await searchRead<{ id: number; bom_id: any; sequence: number }>(
    'mrp.routing.workcenter',
    [['bom_id', 'in', incompleteBomIds]],
    ['id', 'bom_id', 'sequence']
  );

  // bomId → array of opIds sorted by sequence (0-indexed = operationIndex)
  const opsByBom = new Map<number, number[]>();
  for (const op of existingOps) {
    const bomId: number = Array.isArray(op.bom_id) ? op.bom_id[0] : op.bom_id;
    if (!opsByBom.has(bomId)) opsByBom.set(bomId, []);
    opsByBom.get(bomId)!.push({ seq: op.sequence, id: op.id } as any);
  }
  for (const [bomId, ops] of opsByBom) {
    const sorted = (ops as any[]).sort((a, b) => a.seq - b.seq).map((o: any) => o.id);
    opsByBom.set(bomId, sorted);
  }

  // Resolve entries and build line groups
  const lineGroups: BomLineGroup[] = [];
  for (const entry of allExpanded) {
    const bomId = existingByCode.get(entry.product.variantDisplayName);
    if (!bomId || !incompleteBomIdSet.has(bomId)) continue;

    const prep = await resolveEntry(entry);
    if (!prep) continue;

    const opIds = opsByBom.get(bomId) ?? [];
    const group = buildLineGroup(bomId, prep, opIds);
    if (group.lines.length > 0) lineGroups.push(group);
  }

  const repairedIds = await createLinesBatch(lineGroups);
  track.bomLines(repairedIds);
  console.log(`[repair] Відновлено ${repairedIds.length} рядків для ${lineGroups.length} BOM`);
  return repairedIds.length;
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function batchImportAllBoms(boms: BomEntry[], label?: string): Promise<void> {
  resetSession();
  const totalStart = Date.now();
  const LINE = '='.repeat(60);
  const phases: Array<{ label: string; elapsed: number }> = [];

  const phase = (label: string, start: number) => {
    const elapsed = Date.now() - start;
    phases.push({ label, elapsed });
    console.log(`[batch] ${label}: ${(elapsed / 1000).toFixed(2)}s`);
  };

  await ensureVariantLimit(10000);

  // ── Phase 1: expand + pre-seed attributes ─────────────────────────────────
  const allExpanded = boms.flatMap(entry => expandEntry(entry));
  console.log(`\n[batch] Розгорнуто ${allExpanded.length} варіантів`);

  let t = Date.now();
  await preSeedAttributeLines(allExpanded);
  phase('Pre-seed атрибутів', t);

  // Clear snapshot variant cache — preSeedAttributeLines may have triggered
  // Odoo to regenerate variants with new IDs, making snapshot IDs stale.
  clearVariantDisplayCache();
  console.log('[batch] Snapshot variant cache очищено (свіжа резолюція)');

  // ── Phase 2: load existing BOMs ───────────────────────────────────────────
  t = Date.now();
  const existingBoms = await searchRead<{ id: number; code: string }>('mrp.bom', [], ['id', 'code']);
  const existingByCode = new Map(existingBoms.filter(b => b.code).map(b => [b.code, b.id]));
  phase(`Завантаження ${existingByCode.size} існуючих BOM`, t);

  // ── Repair: fill incomplete BOMs from a previous failed run ──────────────
  t = Date.now();
  const repaired = await repairIncompleteBoms(existingByCode, allExpanded);
  if (repaired > 0) phase(`Відновлення рядків (${repaired})`, t);

  // ── Phase 3: delete placeholder BOMs for expanded entries ─────────────────
  for (const entry of boms) {
    if (entry.expand) {
      try { await deleteWrongBoms(entry.product.variantDisplayName); }
      catch (err: any) { console.warn(`  [WARN] Не вдалося видалити: ${err.message}`); }
    }
  }

  // ── Phase 4: resolve all new entries ──────────────────────────────────────
  t = Date.now();
  console.log(`\n[batch] Резолюція варіантів і компонентів...`);

  const toCreate: PreparedBom[] = [];
  let existedCount = 0;
  let skippedCount = 0;

  for (const entry of allExpanded) {
    if (existingByCode.has(entry.product.variantDisplayName)) {
      existedCount++;
      continue;
    }
    const prep = await resolveEntry(entry);
    if (prep) toCreate.push(prep);
    else skippedCount++;
  }

  phase(`Резолюція (${toCreate.length} нових | ${existedCount} існує | ${skippedCount} пропущено)`, t);

  if (toCreate.length === 0) {
    console.log(`\n[batch] Нічого нового для створення.`);
    printSummary(phases, 0, existedCount, skippedCount, totalStart);
    return;
  }

  // ── Phase 5A: batch create BOMs ───────────────────────────────────────────
  t = Date.now();
  const bomIds = await createMany('mrp.bom', toCreate.map(p => ({
    product_id: p.variantId,
    product_tmpl_id: p.templateId,
    code: p.bomCode,
    product_qty: p.qty,
    type: 'normal',
  })));
  track.boms(bomIds);
  phase(`Створення ${bomIds.length} BOM`, t);

  // ── Phase 5B: batch create operations ─────────────────────────────────────
  t = Date.now();
  const opRows: object[] = [];
  const opStartIdx: number[] = [];

  for (let i = 0; i < toCreate.length; i++) {
    opStartIdx.push(opRows.length);
    for (const op of toCreate[i].operations) {
      opRows.push({
        name: op.name,
        bom_id: bomIds[i],
        workcenter_id: op.workcenterID,
        sequence: op.sequence,
        x_studio_piece_rate_2: op.priceRate,
      });
    }
  }

  let allOpIds: number[] = [];
  if (opRows.length > 0) {
    allOpIds = await createMany('mrp.routing.workcenter', opRows);
    track.operations(allOpIds);
    phase(`Створення ${allOpIds.length} операцій`, t);
  }

  // ── Phase 5C: batch create BOM lines (resilient) ──────────────────────────
  t = Date.now();
  const lineGroups: BomLineGroup[] = [];

  for (let i = 0; i < toCreate.length; i++) {
    const opBase = opStartIdx[i];
    const opSlice = allOpIds.slice(opBase, opBase + toCreate[i].operations.length);
    const group = buildLineGroup(bomIds[i], toCreate[i], opSlice);
    if (group.lines.length > 0) lineGroups.push(group);
  }

  const createdLineIds = await createLinesBatch(lineGroups);
  track.bomLines(createdLineIds);
  phase(`Створення ${createdLineIds.length} рядків BOM`, t);

  // ── Summary ───────────────────────────────────────────────────────────────
  saveSession(label);
  printSummary(phases, toCreate.length, existedCount, skippedCount, totalStart);
}

function printSummary(
  phases: Array<{ label: string; elapsed: number }>,
  created: number,
  existed: number,
  skipped: number,
  totalStart: number
): void {
  const LINE = '='.repeat(60);
  console.log(`\n${LINE}`);
  console.log('ФАЗИ:');
  for (const p of phases) {
    console.log(`  ${(p.elapsed / 1000).toFixed(2)}s`.padEnd(10) + p.label);
  }
  console.log(LINE);
  console.log(`Підсумок: +${created} створено  =${existed} існувало  ?${skipped} пропущено`);
  console.log(`Загальний час: ${sec(totalStart)}`);
  console.log(LINE);
}
