/**
 * Сировина: purchase_ok, drop MTO, WH/Stock Buy orderpoints (min=max=0).
 *
 * Dummy on-hand is 10000. min/max 0/0: no RFQ while forecast ≥ 0.
 *
 *   npx ts-node --transpile-only src/commands/ensureRawBuyOrderpoints.ts
 *   npx ts-node --transpile-only src/commands/ensureRawBuyOrderpoints.ts --apply
 */
import { authenticate } from '../api/odoo';
import { ensureRawBuyOrderpoints } from '../tools/importJson/stockAndBuy';

const APPLY = process.argv.includes('--apply');

async function run() {
  await authenticate();
  if (!APPLY) {
    console.log('DRY RUN — pass --apply (writes purchase_ok, drops MTO, creates orderpoints)');
    console.log('Live import path: afterImportStockAndBuy (TEST/UNTESTED)');
    return;
  }
  const r = await ensureRawBuyOrderpoints({ forcePurchaseOk: true, dropMto: true });
  console.log(r);
}

run().catch((err) => {
  console.error('[FATAL]', err instanceof Error ? err.message : err);
  process.exit(1);
});
