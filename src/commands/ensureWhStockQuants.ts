/**
 * Ensure storable product.product rows have a stock.quant on WH/Stock.
 * Skips category «Готова продукція / Дивани» (too many variants).
 * Existing WH/Stock rows (any qty) are left alone. Missing ones get qty 0.
 *
 *   npm run ensure-wh-stock              # dry-run
 *   npm run ensure-wh-stock -- --apply
 *   npm run ensure-wh-stock -- --purge-sofas --apply
 *   npm run ensure-wh-stock -- --purge-archived --apply
 */
import { authenticate, executeKw, searchRead } from '../api/odoo';
import { sleep, withRetry } from '../tools/odooPaged';

const APPLY = process.argv.includes('--apply');
const PURGE_SOFAS = process.argv.includes('--purge-sofas');
const PURGE_ARCHIVED = process.argv.includes('--purge-archived');
const STOCK_LOC = 5; // WH/Stock
const SOFA_CATEG = 1; // Готова продукція / Дивани
const ID_PAGE = 2000;
const BATCH = 80;
/** Observed create rate on abort: ~255 rows/s (68800 in ~270s). */
const ROWS_PER_SEC = 255;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function eta(n: number): string {
  const s = Math.max(1, Math.round(n / ROWS_PER_SEC));
  if (s < 60) return `~${s}s`;
  const m = Math.round(s / 60);
  return `~${m} min`;
}

async function searchAllIds(model: string, domain: unknown[]): Promise<number[]> {
  const ids: number[] = [];
  let offset = 0;
  for (;;) {
    const page = await withRetry(`${model} search ${offset}`, () =>
      executeKw<number[]>(model, 'search', [domain], { limit: ID_PAGE, offset }),
    );
    ids.push(...page);
    process.stderr.write(`[${model}] ids +${page.length} (total ${ids.length})\n`);
    if (page.length < ID_PAGE) break;
    offset += ID_PAGE;
    await sleep(80);
  }
  return ids;
}

/** stock.quant.unlink is superuser-only; run via a throwaway server action. */
async function sudoUnlinkQuants(pyDomain: string, countDomain: unknown[], label: string) {
  const n = await executeKw<number>('stock.quant', 'search_count', [countDomain], {
    context: { lang: 'uk_UA', active_test: false },
  });
  console.log(`${label}: ${n}  eta ${eta(n)}`);
  if (n === 0) return;
  if (!APPLY) {
    console.log('DRY RUN — no unlinks');
    return;
  }

  const [model] = await searchRead<{ id: number }>('ir.model', [['model', '=', 'stock.quant']], ['id'], 1);
  if (!model) throw new Error('ir.model stock.quant missing');

  const code = [
    'Quant = env["stock.quant"].sudo()',
    `domain = ${pyDomain}`,
    'while True:',
    '    recs = Quant.search(domain, limit=200)',
    '    if not recs:',
    '        break',
    '    recs.unlink()',
  ].join('\n');

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

  const left = await executeKw<number>('stock.quant', 'search_count', [countDomain], {
    context: { lang: 'uk_UA', active_test: false },
  });
  console.log(`purge done, leftover: ${left}`);
}

async function purgeSofaZeros() {
  await sudoUnlinkQuants(
    `[("location_id", "=", ${STOCK_LOC}), ("product_id.categ_id", "child_of", ${SOFA_CATEG}), ("quantity", "=", 0)]`,
    [
      ['location_id', '=', STOCK_LOC],
      ['product_id.categ_id', 'child_of', SOFA_CATEG],
      ['quantity', '=', 0],
    ],
    'sofa WH/Stock qty=0',
  );
}

async function purgeArchivedLocQuants() {
  await sudoUnlinkQuants(
    '[("location_id.active", "=", False)]',
    [['location_id.active', '=', false]],
    'quants on archived locations',
  );
}

async function ensureNonSofa() {
  const stockQuants = await searchRead<{ product_id: [number, string] }>(
    'stock.quant',
    [['location_id', '=', STOCK_LOC]],
    ['product_id'],
  );
  const have = new Set(stockQuants.map(q => q.product_id[0]));

  const productIds = await searchAllIds('product.product', [
    ['is_storable', '=', true],
    '!',
    ['categ_id', 'child_of', SOFA_CATEG],
  ]);
  const missing = productIds.filter(id => !have.has(id));

  console.log(`non-sofa storable variants: ${productIds.length}`);
  console.log(`already WH/Stock (any product): ${have.size}`);
  console.log(`to create qty=0: ${missing.length}  eta ${eta(missing.length)}`);

  if (missing.length === 0) {
    console.log('all non-sofa variants already have WH/Stock');
    return;
  }

  if (!APPLY) {
    console.log('DRY RUN — no writes');
    console.log('npm run ensure-wh-stock -- --apply');
    return;
  }

  let done = 0;
  for (const batch of chunk(missing, BATCH)) {
    await withRetry(`create ${done}`, () =>
      executeKw('stock.quant', 'create', [
        batch.map(product_id => ({ product_id, location_id: STOCK_LOC })),
      ], { context: { lang: 'uk_UA', inventory_mode: true } }),
    );
    done += batch.length;
    if (done % 800 === 0 || done === missing.length) {
      console.log(`[+] ${done}/${missing.length}`);
    }
    await sleep(50);
  }
  console.log('done');
}

async function run() {
  await authenticate();
  if (PURGE_SOFAS) await purgeSofaZeros();
  else if (PURGE_ARCHIVED) await purgeArchivedLocQuants();
  else await ensureNonSofa();
}

run().catch(err => {
  console.error('[FATAL]', err instanceof Error ? err.message : err);
  process.exit(1);
});
