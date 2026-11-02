/**
 * Compact Studio Python (same behavior, fewer cloc lines).
 *
 *   npx ts-node --transpile-only src/commands/compressStudioLoc.ts
 *   npx ts-node --transpile-only src/commands/compressStudioLoc.ts --apply
 */
import { authenticate, executeKw, searchRead } from '../api/odoo';

const APPLY = process.argv.includes('--apply');

const SO_VOL = `for record in self:
    record['FIELD'] = sum(l.product_id.volume * l.product_uom_qty for l in record.order_line)`;

const SO_WT = `for record in self:
    record['FIELD'] = sum(l.product_id.weight * l.product_uom_qty for l in record.order_line)`;

function loadPct(usedField: string, capField: string, outField: string, asText: boolean): string {
  const out = asText
    ? `record['${outField}'] = f"{round(used / cap * 100, 2)}%" if cap else "0.0%"`
    : `record['${outField}'] = (used / cap * 100) if cap else 0.0`;
  return `for record in self:
    vehicle = record.x_studio_many2one_field_7jq_1jg4rtg1t
    used = record.sale_id.${usedField} or 0.0
    cap = vehicle.${capField} or 0.0
    if vehicle:
        domain = [('x_studio_many2one_field_7jq_1jg4rtg1t', '=', vehicle.id), ('state', 'not in', ['done', 'cancel'])]
        domain += [('id', '!=', record.id)] if record.id else []
        used += sum(self.env['stock.picking'].search(domain).mapped('sale_id.${usedField}'))
    ${out}`;
}

const PATCHES: { model: string; name: string; compute: string }[] = [
  { model: 'sale.order', name: 'x_studio_', compute: SO_VOL.replace('FIELD', 'x_studio_') },
  {
    model: 'sale.order',
    name: 'x_studio_float_field_7pn_1ji5bgkpg',
    compute: SO_WT.replace('FIELD', 'x_studio_float_field_7pn_1ji5bgkpg'),
  },
  {
    model: 'sale.order',
    name: 'x_studio_float_field_8h8_1ji5iec24',
    compute: SO_WT.replace('FIELD', 'x_studio_float_field_8h8_1ji5iec24'),
  },
  {
    model: 'sale.order',
    name: 'x_studio_float_field_9fs_1ji5ikn53',
    compute: SO_VOL.replace('FIELD', 'x_studio_float_field_9fs_1ji5ikn53'),
  },
  {
    model: 'stock.picking',
    name: 'x_studio_loading_volume',
    compute: loadPct('x_studio_float_field_9fs_1ji5ikn53', 'x_studio_body_volume_1', 'x_studio_loading_volume', true),
  },
  {
    model: 'stock.picking',
    name: 'x_studio_volume_progression',
    compute: loadPct('x_studio_float_field_9fs_1ji5ikn53', 'x_studio_body_volume_1', 'x_studio_volume_progression', false),
  },
  {
    model: 'stock.picking',
    name: 'x_studio_weight_load',
    compute: loadPct('x_studio_float_field_8h8_1ji5iec24', 'x_studio_float_field_kq_1jghnc7go', 'x_studio_weight_load', true),
  },
  {
    model: 'stock.picking',
    name: 'x_studio_weight_progression',
    compute: loadPct('x_studio_float_field_8h8_1ji5iec24', 'x_studio_float_field_kq_1jghnc7go', 'x_studio_weight_progression', false),
  },
  {
    model: 'stock.picking',
    name: 'x_studio_vehicle_conflict_note',
    compute: `for record in self:
    vehicle = record.x_studio_many2one_field_7jq_1jg4rtg1t
    record['x_studio_vehicle_conflict_note'] = False
    if not vehicle:
        continue
    domain = [('x_studio_many2one_field_7jq_1jg4rtg1t', '=', vehicle.id), ('state', 'not in', ['done', 'cancel'])]
    domain += [('id', '!=', record.id)] if record.id else []
    hits = self.env['stock.picking'].search(domain, order='scheduled_date asc, id asc', limit=3)
    extra = self.env['stock.picking'].search_count(domain) - len(hits)
    names = ', '.join(hits.mapped('name')) + (f' (+{extra})' if extra > 0 else '')
    record['x_studio_vehicle_conflict_note'] = f'Машина вже використовується в: {names}' if hits else False`,
  },
  {
    model: 'sale.order.line',
    name: 'x_studio_x_so_line_uid',
    compute: `for line in self:
    order = line.order_id
    line['x_studio_x_so_line_uid'] = False
    if not order:
        continue
    idx = 0
    for l in order.order_line:
        idx += 1
        if l.id == line.id:
            line['x_studio_x_so_line_uid'] = order.name + ' / № ' + str(idx).zfill(2)
            break`,
  },
];

const ACTION_CODE: Record<number, string> = {
  1143: `for record in records:
    lines = record.order_line.filtered(lambda l: not l.display_type)
    shown = lines[:5]
    extra = len(lines) > 5
    record['x_studio_lines_dashboard'] = len(lines)
    parts = [f"{line.x_studio_x_so_line_uid or ''}  {line.product_id.name}" for line in shown]
    attrs = [', '.join(f'{av.attribute_id.name}: {av.name}' for av in line.product_id.product_template_attribute_value_ids) or '—' for line in shown]
    record['x_studio_order_contents'] = '\\n'.join(parts + ([f'... +{len(lines) - 5} more'] if extra else [])) or False
    record['x_studio_order_attributes'] = '\\n'.join(attrs + (['...'] if extra else [])) or False`,
  831: `if not record.barcode:
    record.write({'barcode': env['ir.sequence'].next_by_code('product.barcode.auto')})`,
  833: `for record in records:
    if not record.barcode:
        record.write({'barcode': env['ir.sequence'].next_by_code('product.barcode.auto')})`,
};

const SO_FIELDS = [
  'name',
  'x_studio_',
  'x_studio_float_field_7pn_1ji5bgkpg',
  'x_studio_float_field_8h8_1ji5iec24',
  'x_studio_float_field_9fs_1ji5ikn53',
  'x_studio_order_contents',
  'x_studio_order_attributes',
  'x_studio_lines_dashboard',
];
const PICK_FIELDS = [
  'name',
  'state',
  'x_studio_many2one_field_7jq_1jg4rtg1t',
  'x_studio_loading_volume',
  'x_studio_volume_progression',
  'x_studio_weight_load',
  'x_studio_weight_progression',
  'x_studio_vehicle_conflict_note',
];

function loc(code: string): number {
  return code.split('\n').filter((l) => {
    const t = l.trim();
    return t.length > 0 && !t.startsWith('#');
  }).length;
}

async function snapshot() {
  const so = await searchRead('sale.order', [], SO_FIELDS, 5);
  const lines = await searchRead(
    'sale.order.line',
    [['order_id', '!=', false]],
    ['id', 'order_id', 'product_id', 'x_studio_x_so_line_uid', 'display_type'],
    20,
  );
  const picks = await searchRead(
    'stock.picking',
    [['x_studio_many2one_field_7jq_1jg4rtg1t', '!=', false]],
    PICK_FIELDS,
    20,
  );
  return { so, lines, picks };
}

async function sudoRun(code: string) {
  const [model] = await searchRead<{ id: number }>('ir.model', [['model', '=', 'ir.actions.server']], ['id'], 1);
  const actionId = await executeKw<number>('ir.actions.server', 'create', [{
    name: 'tmp compressStudioLoc recompute',
    model_id: model.id,
    state: 'code',
    type: 'ir.actions.server',
    usage: 'ir_actions_server',
    binding_type: 'action',
    code,
  }]);
  try {
    await executeKw('ir.actions.server', 'run', [[actionId]]);
  } finally {
    await executeKw('ir.actions.server', 'unlink', [[actionId]]);
  }
}

async function run() {
  await authenticate();
  const before = await snapshot();
  console.log('BEFORE SO', JSON.stringify(before.so, null, 2));
  console.log('BEFORE lines', JSON.stringify(before.lines, null, 2));
  console.log('BEFORE picks', JSON.stringify(before.picks, null, 2));

  let total = 0;
  for (const p of PATCHES) total += loc(p.compute);
  for (const c of Object.values(ACTION_CODE)) total += loc(c);
  console.log(`physical non-empty lines ~${total}`);

  if (!APPLY) {
    console.log('DRY RUN — pass --apply to write compute/code on live');
    return;
  }

  for (const p of PATCHES) {
    const [field] = await searchRead<{ id: number }>(
      'ir.model.fields',
      [['model', '=', p.model], ['name', '=', p.name]],
      ['id'],
      1,
    );
    if (!field) throw new Error(`missing ${p.model}.${p.name}`);
    await executeKw('ir.model.fields', 'write', [[field.id], { compute: p.compute }]);
    console.log(`wrote field ${p.model}.${p.name} id=${field.id}`);
  }
  for (const [id, code] of Object.entries(ACTION_CODE)) {
    await executeKw('ir.actions.server', 'write', [[Number(id)], { code }]);
    console.log(`wrote action ${id}`);
  }

  await sudoRun(`
so = env['sale.order'].search([])
if so:
    so.order_line.invalidate_recordset(['x_studio_x_so_line_uid'])
    so.invalidate_recordset([
        'x_studio_', 'x_studio_float_field_7pn_1ji5bgkpg',
        'x_studio_float_field_8h8_1ji5iec24', 'x_studio_float_field_9fs_1ji5ikn53',
    ])
    so.order_line.mapped('x_studio_x_so_line_uid')
    so.mapped('x_studio_')
    so.mapped('x_studio_float_field_8h8_1ji5iec24')
    so.mapped('x_studio_float_field_9fs_1ji5ikn53')
    env['ir.actions.server'].browse(1143).with_context(
        active_model='sale.order', active_ids=so.ids, active_id=so[0].id,
    ).run()
picks = env['stock.picking'].search([('x_studio_many2one_field_7jq_1jg4rtg1t', '!=', False)])
if picks:
    flds = [
        'x_studio_loading_volume', 'x_studio_volume_progression',
        'x_studio_weight_load', 'x_studio_weight_progression',
        'x_studio_vehicle_conflict_note',
    ]
    picks.invalidate_recordset(flds)
    for f in flds:
        picks.mapped(f)
`);

  const after = await snapshot();
  console.log('AFTER SO', JSON.stringify(after.so, null, 2));
  console.log('AFTER lines', JSON.stringify(after.lines, null, 2));
  console.log('AFTER picks', JSON.stringify(after.picks, null, 2));

  const fields = await executeKw<{ compute: string }[]>(
    'ir.model.fields',
    'search_read',
    [[['state', '=', 'manual'], ['compute', '!=', false]]],
    { fields: ['compute'] },
  );
  let n = 0;
  for (const f of fields) n += loc(f.compute);
  for (const id of [1143, 831, 833]) {
    const [a] = await executeKw<{ code: string }[]>(
      'ir.actions.server',
      'search_read',
      [[['id', '=', id]]],
      { fields: ['code'] },
    );
    n += loc(a.code);
  }
  console.log(`live physical lines after write ~${n}`);
}

run().catch((err) => {
  console.error('[FATAL]', err instanceof Error ? err.message : err);
  process.exit(1);
});
