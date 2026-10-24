/**
 * Hard-delete archived warehouses from the user list.
 *
 *   npx ts-node --transpile-only src/commands/deleteArchivedWarehouses.ts
 *   npx ts-node --transpile-only src/commands/deleteArchivedWarehouses.ts --apply
 */
import { authenticate, executeKw, unlink } from '../api/odoo';

const APPLY = process.argv.includes('--apply');
const CTX = { context: { lang: 'uk_UA', active_test: false } };
const MATRIX_WH = 1;
const MATRIX_MFG_PT = 11;
const MATRIX_IN_PT = 1;
const WH_IDS = [6, 19, 9, 20, 16, 21, 7, 14, 12, 32];

async function searchIds(model: string, domain: unknown[]): Promise<number[]> {
  return executeKw<number[]>(model, 'search', [domain], CTX);
}

async function sudoRun(code: string, label: string) {
  const [model] = await executeKw<{ id: number }[]>(
    'ir.model', 'search_read', [[['model', '=', 'stock.warehouse']]], { fields: ['id'], limit: 1 },
  );
  const actionId = await executeKw<number>('ir.actions.server', 'create', [{
    name: `tmp ${label}`,
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

async function tryUnlink(model: string, ids: number[], label: string) {
  if (ids.length === 0) return;
  console.log(`  unlink ${model} ${ids.length} (${label})`);
  if (!APPLY) return;
  try {
    await unlink(model, ids);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`  skip ${model}: ${msg.slice(0, 180)}`);
  }
}

async function reassignBlockers(whId: number, ptIds: number[]) {
  if (ptIds.length === 0) return;

  const moIds = await searchIds('mrp.production', [['picking_type_id', 'in', ptIds]]);
  if (moIds.length) {
    console.log(`  reassign ${moIds.length} MO -> MATRIX mfg`);
    if (APPLY) await executeKw('mrp.production', 'write', [moIds, { picking_type_id: MATRIX_MFG_PT }]);
  }

  const schedIds = await searchIds('mrp.production.schedule', [['warehouse_id', '=', whId]]);
  if (schedIds.length) {
    console.log(`  reassign ${schedIds.length} MPS -> MATRIX WH`);
    if (APPLY) await executeKw('mrp.production.schedule', 'write', [schedIds, { warehouse_id: MATRIX_WH }]);
  }

  const poIds = await searchIds('purchase.order', [['picking_type_id', 'in', ptIds]]);
  if (poIds.length) {
    console.log(`  reassign ${poIds.length} PO -> MATRIX incoming`);
    if (APPLY) await executeKw('purchase.order', 'write', [poIds, { picking_type_id: MATRIX_IN_PT }]);
  }

  const pickIds = await searchIds('stock.picking', [['picking_type_id', 'in', ptIds]]);
  if (pickIds.length) {
    console.log(`  sudo reassign ${pickIds.length} picking -> MATRIX incoming`);
    if (APPLY) {
      await sudoRun(
        [
          'recs = env["stock.picking"].sudo().with_context(active_test=False).browse(' + JSON.stringify(pickIds) + ')',
          'if recs.exists():',
          `    recs.write({"picking_type_id": ${MATRIX_IN_PT}})`,
        ].join('\n'),
        `reassign pickings wh ${whId}`,
      );
    }
  }

  const routeIds = await searchIds('stock.route', [
    '|', ['supplied_wh_id', '=', whId], ['supplier_wh_id', '=', whId],
  ]);
  const ruleIds = [
    ...await searchIds('stock.rule', [['picking_type_id', 'in', ptIds]]),
    ...(routeIds.length ? await searchIds('stock.rule', [['route_id', 'in', routeIds]]) : []),
    ...await searchIds('stock.rule', [['warehouse_id', '=', whId]]),
  ];
  const uniqueRules = [...new Set(ruleIds)];
  if (uniqueRules.length) {
    const moveIds = await searchIds('stock.move', [['rule_id', 'in', uniqueRules]]);
    if (moveIds.length) {
      console.log(`  clear rule_id on ${moveIds.length} moves`);
      if (APPLY) {
        try {
          await executeKw('stock.move', 'write', [moveIds, { rule_id: false }]);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.log(`  move.rule_id write skip: ${msg.slice(0, 180)}`);
          if (APPLY) {
            await sudoRun(
              [
                'recs = env["stock.move"].sudo().browse(' + JSON.stringify(moveIds) + ')',
                'recs.write({"rule_id": False})',
              ].join('\n'),
              `clear move rules wh ${whId}`,
            );
          }
        }
      }
    }
    await tryUnlink('stock.rule', uniqueRules, 'rules');
  }
  await tryUnlink('stock.route', routeIds, 'routes');
}

async function deleteWarehouse(whId: number, name: string) {
  console.log(`\n[${whId}] ${name}`);
  const ptIds = await searchIds('stock.picking.type', [['warehouse_id', '=', whId]]);
  await reassignBlockers(whId, ptIds);
  console.log('  unlink stock.warehouse');
  if (!APPLY) return;
  await unlink('stock.warehouse', [whId]);
  console.log('  ok');
}

async function run() {
  await authenticate();
  console.log(APPLY ? 'MODE apply' : 'MODE dry-run (pass --apply to delete)');

  const whs = await executeKw<{ id: number; name: string; code: string }[]>(
    'stock.warehouse', 'search_read', [[['id', 'in', WH_IDS]]],
    { fields: ['id', 'name', 'code'], ...CTX },
  );
  const byId = new Map(whs.map(w => [w.id, w]));
  for (const id of WH_IDS) {
    const w = byId.get(id);
    if (!w) {
      console.log(`[${id}] already gone`);
      continue;
    }
    try {
      await deleteWarehouse(id, `${w.code} ${w.name}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`  FAIL ${msg.slice(0, 400)}`);
    }
  }
}

run().catch(err => {
  console.error('[FATAL]', err instanceof Error ? err.message : err);
  process.exit(1);
});
