/**
 * Set inventoried on-hand qty to 10000 on WH/Stock for every Сировина variant.
 *
 *   npx ts-node --transpile-only src/commands/setRawInventory.ts --apply
 */
import { authenticate, executeKw, searchRead } from '../api/odoo';
import { sleep, withRetry } from '../tools/odooPaged';

const APPLY = process.argv.includes('--apply');
const RAW_CATEG = 5;
const STOCK_LOC = 5;
const QTY = 10000;
const BATCH = 80;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function run() {
  await authenticate();
  const products = await searchRead<{ id: number; display_name: string }>(
    'product.product',
    [['is_storable', '=', true], ['categ_id', 'child_of', RAW_CATEG]],
    ['id', 'display_name'],
  );
  const productIds = products.map(p => p.id);
  console.log(`Сировина variants: ${productIds.length}`);

  const quants = await searchRead<{ id: number; product_id: [number, string]; quantity: number; lot_id: false | [number, string] }>(
    'stock.quant',
    [['location_id', '=', STOCK_LOC], ['product_id', 'in', productIds]],
    ['id', 'product_id', 'quantity', 'lot_id'],
  );
  const byProduct = new Map<number, typeof quants>();
  for (const q of quants) {
    const pid = q.product_id[0];
    const list = byProduct.get(pid) ?? [];
    list.push(q);
    byProduct.set(pid, list);
  }

  const missing = productIds.filter(id => !byProduct.has(id));
  const applyIds: number[] = [];
  for (const p of products) {
    const rows = byProduct.get(p.id) ?? [];
    const noLot = rows.find(q => !q.lot_id);
    if (noLot) applyIds.push(noLot.id);
  }
  console.log(`WH/Stock quants to set ${QTY}: ${applyIds.length}`);
  console.log(`missing quants to create: ${missing.length}`);
  if (!APPLY) {
    console.log('DRY RUN — pass --apply');
    return;
  }

  const ctx = { context: { lang: 'uk_UA', inventory_mode: true } };
  if (missing.length) {
    let done = 0;
    for (const batch of chunk(missing, BATCH)) {
      const ids = await withRetry(`create ${done}`, () =>
        executeKw<number[]>('stock.quant', 'create', [
          batch.map(product_id => ({
            product_id,
            location_id: STOCK_LOC,
            inventory_quantity: QTY,
          })),
        ], ctx),
      );
      applyIds.push(...(Array.isArray(ids) ? ids : [ids]));
      done += batch.length;
      await sleep(40);
    }
    console.log(`created ${missing.length}`);
  }

  let done = 0;
  for (const batch of chunk(applyIds, BATCH)) {
    await withRetry(`inv ${done}`, () =>
      executeKw('stock.quant', 'write', [batch, { inventory_quantity: QTY }], ctx),
    );
    await withRetry(`apply ${done}`, () =>
      executeKw('stock.quant', 'action_apply_inventory', [batch], ctx),
    );
    done += batch.length;
    if (done % 80 === 0 || done === applyIds.length) console.log(`[+] ${done}/${applyIds.length}`);
    await sleep(40);
  }

  const sample = await searchRead<{ product_id: [number, string]; quantity: number }>(
    'stock.quant',
    [['id', 'in', applyIds.slice(0, 5)]],
    ['product_id', 'quantity'],
  );
  console.log('sample', sample);
}

run().catch(err => {
  console.error('[FATAL]', err instanceof Error ? err.message : err);
  process.exit(1);
});
