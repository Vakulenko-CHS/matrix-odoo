/**
 * Internal-transfer all WH/* on-hand qty into WH/Stock.
 * Leaves WH/Output and WH/Packing Zone untouched.
 *
 *   npx ts-node --transpile-only src/commands/moveShopStockToWhStock.ts
 *   npx ts-node --transpile-only src/commands/moveShopStockToWhStock.ts --apply
 */
import { authenticate, create, executeKw, searchRead } from '../api/odoo';

const APPLY = process.argv.includes('--apply');
const STOCK = 5;
const SKIP = new Set([5, 8, 9]); // Stock, Output, Packing Zone
const INTERNAL_PT = 7;

async function run() {
  await authenticate();
  console.log(APPLY ? 'MODE apply' : 'MODE dry-run');

  const locs = await searchRead<{ id: number; complete_name: string; active: boolean }>(
    'stock.location',
    [['complete_name', '=like', 'WH/%'], ['usage', '=', 'internal']],
    ['id', 'complete_name', 'active'],
  );
  const srcLocs = locs.filter(l => l.active && !SKIP.has(l.id));
  const srcIds = srcLocs.map(l => l.id);

  const quants = await searchRead<{
    id: number;
    product_id: [number, string];
    location_id: [number, string];
    quantity: number;
    reserved_quantity: number;
  }>('stock.quant', [['location_id', 'in', srcIds], ['quantity', '!=', 0]], [
    'id', 'product_id', 'location_id', 'quantity', 'reserved_quantity',
  ]);

  const byLoc = new Map<number, typeof quants>();
  for (const q of quants) {
    const locId = q.location_id[0];
    const list = byLoc.get(locId) ?? [];
    list.push(q);
    byLoc.set(locId, list);
  }

  console.log(`nonzero quants to move: ${quants.length} from ${byLoc.size} locations`);
  for (const loc of srcLocs) {
    const rows = byLoc.get(loc.id);
    if (!rows) continue;
    const sum = rows.reduce((s, r) => s + r.quantity, 0);
    console.log(`  ${loc.complete_name}: ${rows.length} rows, qty ${sum}`);
  }

  if (!APPLY) {
    console.log('pass --apply to create internal pickings WH/* → WH/Stock');
    return;
  }

  const productIds = [...new Set(quants.map(q => q.product_id[0]))];
  const products = await searchRead<{ id: number; uom_id: [number, string] }>(
    'product.product', [['id', 'in', productIds]], ['id', 'uom_id'],
  );
  const uomByProduct = new Map(products.map(p => [p.id, p.uom_id[0]]));

  for (const loc of srcLocs) {
    const rows = byLoc.get(loc.id);
    if (!rows?.length) continue;

    const pickingId = await create('stock.picking', {
      picking_type_id: INTERNAL_PT,
      location_id: loc.id,
      location_dest_id: STOCK,
      origin: `consolidate → WH/Stock from ${loc.complete_name}`,
      move_ids: rows.map(q => [0, 0, {
        product_id: q.product_id[0],
        product_uom_qty: q.quantity,
        product_uom: uomByProduct.get(q.product_id[0]),
        location_id: loc.id,
        location_dest_id: STOCK,
      }]),
    });
    await executeKw('stock.picking', 'action_confirm', [[pickingId]]);
    await executeKw('stock.picking', 'action_assign', [[pickingId]]);
    const [picking] = await searchRead<{ id: number; move_ids: number[]; state: string }>(
      'stock.picking', [['id', '=', pickingId]], ['id', 'move_ids', 'state'],
    );
    const moves = await searchRead<{ id: number; product_uom_qty: number }>(
      'stock.move', [['id', 'in', picking.move_ids]], ['id', 'product_uom_qty'],
    );
    for (const m of moves) {
      await executeKw('stock.move', 'write', [[m.id], { quantity: m.product_uom_qty, picked: true }]);
    }
    await executeKw('stock.picking', 'button_validate', [[pickingId]]);
    const [done] = await searchRead<{ state: string; name: string }>(
      'stock.picking', [['id', '=', pickingId]], ['state', 'name'],
    );
    console.log(`  [${done.state}] ${done.name} ${loc.complete_name} → WH/Stock (${rows.length})`);
  }

  const left = await searchRead<{ location_id: [number, string]; quantity: number }>(
    'stock.quant', [['location_id', 'in', srcIds], ['quantity', '!=', 0]], ['location_id', 'quantity'],
  );
  console.log(`leftover nonzero on shop locs: ${left.length}`);
}

run().catch(err => {
  console.error('[FATAL]', err instanceof Error ? err.message : err);
  process.exit(1);
});
