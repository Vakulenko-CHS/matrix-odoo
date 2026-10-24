/**
 * Створює специфікації для кожного активного варіанта 🧩[Ламінат - лист], у якого немає своєї BOM.
 * Без своєї BOM Odoo бере шаблонну (лише з рядком для 712x220) → MO без матеріалів → вічна «Чернетка».
 *
 * Значення: рядок із data/Ламінат_1.csv, якщо розмір там є; інакше за формулою, виведеною з тієї ж таблиці:
 *   ламінат м² = ширина × висота × 1.05; поклейка грн = кромка м × 5;
 *   кромка і порізка — з найближчого за розміром рядка таблиці. «БК» = без кромки (лише ламінат + порізка).
 * Нічого не видаляє і не архівує: лише додає відсутні BOM.
 *
 * Usage: ts-node src/tools/fill-laminate-boms.ts           (dry run)
 *        ts-node src/tools/fill-laminate-boms.ts --apply
 */
import * as fs from 'fs';
import * as path from 'path';
import { authenticate, executeKw, searchRead } from '../api/odoo';
import { withRetry } from './odooPaged';

const TEMPLATE = '🧩[Ламінат - лист]';
const LAMINATE = '[Ламінат] (Білий)';
const EDGE = '[Кромка] (Білий, 20мм)';
const WORKCENTER = 'Цех №3-0 ЛДСП (Нарізка Ламінату)';
const CSV = path.join(__dirname, '../../data/Ламінат_1.csv');
const WASTE = 1.05;
const GLUE_PER_M = 5;

interface Spec { lam: number; cut: number; edge: number; glue: number; bk: boolean; source: string; }
interface Row { key: string; size: string; w: number; h: number; bk: boolean; corners: boolean; lam: number; cut: number; edge: number; glue: number; }

// "768x220 БК" і "768x220БК", "с углами" і "з Углами" — один розмір
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, '').replace(/[сз]углами/, 'углами');
const parse = (s: string) => {
  const m = s.match(/^(\d+)x(\d+)/);
  return m ? { w: +m[1], h: +m[2], bk: /бк/i.test(s), corners: /углами/i.test(s) } : null;
};
const formulaLam = (w: number, h: number) => Math.round(w * h * WASTE / 1000) / 1000;

function loadCsv(): Row[] {
  return fs.readFileSync(CSV, 'utf8').split(/\r?\n/).map(r => r.split(';').map(s => s.trim()))
    .filter(c => parse(c[0]))
    .map(c => {
      const p = parse(c[0])!;
      return { key: norm(c[0]), size: c[0], ...p, lam: +c[1], cut: +c[2], glue: +c[3] || 0, edge: +c[4] || 0 };
    });
}

function nearest(rows: Row[], w: number, h: number): Row {
  const d = (r: Row) => Math.abs(r.w - w) * 10 + Math.abs(r.h - h);
  return rows.reduce((a, b) => (d(b) < d(a) ? b : a));
}

function specFor(size: string, rows: Row[]): Spec {
  const p = parse(size)!;
  const lam = formulaLam(p.w, p.h);
  const edged = rows.filter(r => !r.bk && r.edge > 0);
  const exact = rows.find(r => r.key === norm(size));
  if (exact) {
    // таблиця вписана вручну: явну помилку в м² не тягнемо в Odoo
    const okLam = Math.abs(exact.lam - lam) / lam < 0.1;
    return {
      lam: okLam ? exact.lam : lam, cut: exact.cut, bk: p.bk,
      edge: p.bk ? 0 : exact.edge, glue: p.bk ? 0 : exact.glue,
      source: `таблиця ${exact.size}${okLam ? '' : ` (м² ${exact.lam} → формула ${lam})`}`,
    };
  }
  const plain = rows.find(r => r.w === p.w && r.h === p.h && !r.corners && r.bk === p.bk)
    ?? rows.find(r => r.w === p.w && r.h === p.h && !r.corners);
  const cutRow = plain ?? nearest(rows, p.w, p.h);
  const edgeRow = plain && !plain.bk && plain.edge > 0 ? plain : nearest(edged, p.w, p.h);
  const edge = p.bk ? 0 : edgeRow.edge;
  // той самий розмір у таблиці (напр. «БК»-версія) — та сама площа ламінату
  const sameLam = plain && Math.abs(plain.lam - lam) / lam < 0.1 ? plain.lam : lam;
  return {
    lam: sameLam, cut: cutRow.cut, bk: p.bk, edge, glue: Math.round(edge * GLUE_PER_M * 10) / 10,
    source: `формула; порізка як ${cutRow.size}${p.bk ? '' : `, кромка як ${edgeRow.size}`}${p.corners ? ' (кути: як звичайний)' : ''}`,
  };
}

async function idOf(model: string, name: string): Promise<number> {
  const [r] = await searchRead<{ id: number }>(model, [['name', '=', name]], ['id'], 1);
  if (!r) throw new Error(`${model} "${name}" не знайдено`);
  return r.id;
}

// "[Кромка] (Білий, 20мм)" → варіант шаблону "[Кромка]" зі значеннями Білий + 20мм
async function variantOf(fullName: string): Promise<{ id: number; uom_id: [number, string] }> {
  const m = fullName.match(/^(.*?)\s*\((.*)\)$/)!;
  const values = m[2].split(',').map(s => s.trim());
  const tmplId = await idOf('product.template', m[1]);
  const vars = await searchRead<{ id: number; uom_id: [number, string]; product_template_attribute_value_ids: number[] }>(
    'product.product', [['product_tmpl_id', '=', tmplId]], ['id', 'uom_id', 'product_template_attribute_value_ids']);
  const ptavs = await searchRead<{ id: number; name: string }>('product.template.attribute.value',
    [['id', 'in', vars.flatMap(v => v.product_template_attribute_value_ids)]], ['id', 'name']);
  const nameOf = new Map(ptavs.map(p => [p.id, p.name]));
  const hit = vars.filter(v => {
    const names = v.product_template_attribute_value_ids.map(i => nameOf.get(i));
    return names.length === values.length && values.every(x => names.includes(x));
  });
  if (hit.length !== 1) throw new Error(`"${fullName}": знайдено ${hit.length} варіантів`);
  return hit[0];
}

async function main() {
  const apply = process.argv.includes('--apply');
  await authenticate();
  const rows = loadCsv();

  const tmplId = await idOf('product.template', TEMPLATE);
  const lamId = await variantOf(LAMINATE);
  const edgeId = await variantOf(EDGE);
  console.log(`${LAMINATE} #${lamId.id} [${lamId.uom_id[1]}], ${EDGE} #${edgeId.id} [${edgeId.uom_id[1]}]`);
  const wcId = await idOf('mrp.workcenter', WORKCENTER);

  const variants = await searchRead<{ id: number; display_name: string }>('product.product', [['product_tmpl_id', '=', tmplId]], ['id', 'display_name']);
  const boms = await searchRead<{ product_id: [number, string] }>('mrp.bom', [['product_tmpl_id', '=', tmplId], ['product_id', '!=', false]], ['product_id']);
  const covered = new Set(boms.map(b => b.product_id[0]));
  const missing = variants
    .map(v => ({ id: v.id, size: v.display_name.replace(TEMPLATE, '').trim().replace(/^\(|\)$/g, '') }))
    .filter(v => !covered.has(v.id) && parse(v.size));

  console.log(`\n${apply ? 'APPLY' : 'DRY RUN'}: варіантів ${variants.length}, без своєї BOM ${missing.length}\n`);
  for (const v of missing) {
    const s = specFor(v.size, rows);
    console.log(`  ${v.size.padEnd(20)} лам ${s.lam} м² | порізка ${s.cut} | ${s.bk ? 'БК' : `кромка ${s.edge} м, поклейка ${s.glue}`} | ${s.source}`);
    if (!apply) continue;

    const opName = (kind: string) => `Операція (Цех №3-0) ${kind} - ${TEMPLATE} (${v.size})`;
    const op = (kind: string, seq: number, rate: number) =>
      [0, 0, { name: opName(kind), workcenter_id: wcId, sequence: seq, time_mode: 'manual', time_cycle_manual: 60, x_studio_piece_rate_2: rate }];
    const bomId = await withRetry(v.size, () => executeKw<number>('mrp.bom', 'create', [{
      product_tmpl_id: tmplId, product_id: v.id, product_qty: 1, code: v.size, type: 'normal', consumption: 'warning',
      operation_ids: s.bk ? [op('Порізка', 1, s.cut)] : [op('Порізка', 1, s.cut), op('Поклейка', 2, s.glue)],
    }]));
    const ops = await searchRead<{ id: number; name: string }>('mrp.routing.workcenter', [['bom_id', '=', bomId]], ['id', 'name']);
    const opId = (kind: string) => ops.find(o => o.name === opName(kind))?.id ?? false;
    const lines: any[] = [[0, 0, { product_id: lamId.id, product_qty: s.lam, product_uom_id: lamId.uom_id[0], sequence: 1, operation_id: opId('Порізка') }]];
    if (!s.bk) lines.push([0, 0, { product_id: edgeId.id, product_qty: s.edge, product_uom_id: edgeId.uom_id[0], sequence: 2, operation_id: opId('Поклейка') }]);
    await withRetry(v.size, () => executeKw('mrp.bom', 'write', [[bomId], { bom_line_ids: lines }]));
    console.log(`    → BOM ${bomId}`);
  }
  if (!apply && missing.length) console.log('\nЗапусти з --apply, щоб створити.');
}

main().catch(err => {
  console.error('[FATAL]', err.message);
  process.exit(1);
});
