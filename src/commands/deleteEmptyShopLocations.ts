/**
 * Remove empty custom WH/С* and WH/П* locations after stock was moved to WH/Stock.
 * Keeps WH/Stock, Input, QC, Output, Packing.
 *
 *   npx ts-node --transpile-only src/commands/deleteEmptyShopLocations.ts --apply
 */
import { authenticate, executeKw, unlink } from '../api/odoo';

const APPLY = process.argv.includes('--apply');
const CTX = { context: { lang: 'uk_UA', active_test: false } };

/** Custom shop-floor locations under WH (not core warehouse structure). */
const SHOP_LOC_IDS = [
  283, 284, 287, 289, 290, 291, 292, 294, 295, 296, 297, 298, 299, 300,
];

async function sudoRun(code: string, label: string) {
  const [model] = await executeKw<{ id: number }[]>(
    'ir.model', 'search_read', [[['model', '=', 'stock.location']]], { fields: ['id'], limit: 1 },
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

async function run() {
  await authenticate();
  console.log(APPLY ? 'MODE apply' : 'MODE dry-run');

  const locs = await executeKw<{ id: number; complete_name: string; active: boolean }[]>(
    'stock.location', 'search_read', [[['id', 'in', SHOP_LOC_IDS]]],
    { fields: ['id', 'complete_name', 'active'], ...CTX },
  );
  for (const l of locs) console.log(`  ${l.id} ${l.complete_name} active=${l.active}`);
  if (!locs.length) {
    console.log('already gone');
    return;
  }
  if (!APPLY) {
    console.log('pass --apply to unlink (archive if history blocks)');
    return;
  }

  const ids = locs.map(l => l.id);
  await sudoRun(
    [
      'Quant = env["stock.quant"].sudo()',
      `recs = Quant.search([("location_id", "in", ${JSON.stringify(ids)})])`,
      'recs.unlink()',
    ].join('\n'),
    'unlink shop loc quants',
  );
  console.log('zero quants unlinked');

  for (const l of locs) {
    try {
      await unlink('stock.location', [l.id]);
      console.log(`  deleted ${l.complete_name}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`  unlink fail ${l.complete_name}: ${msg.slice(0, 160)}`);
      try {
        await executeKw('stock.location', 'write', [[l.id], { active: false }], CTX);
        console.log(`  archived ${l.complete_name}`);
      } catch (err2) {
        const m2 = err2 instanceof Error ? err2.message : String(err2);
        console.log(`  archive fail ${l.complete_name}: ${m2.slice(0, 160)}`);
      }
    }
  }
}

run().catch(err => {
  console.error('[FATAL]', err instanceof Error ? err.message : err);
  process.exit(1);
});
