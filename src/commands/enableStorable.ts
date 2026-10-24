/**
 * Enable inventory tracking (is_storable / «Облік запасів») on every goods
 * product.template. Services stay consumable/non-storable.
 *
 * Dry-run by default; add --apply to write.
 */
import { authenticate, searchRead, write } from '../api/odoo';

const APPLY = process.argv.includes('--apply');
const BATCH = 80;

interface Template {
  id: number;
  name: string;
  type: string;
  is_storable: boolean;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function run() {
  await authenticate();

  const templates = await searchRead<Template>(
    'product.template',
    [],
    ['id', 'name', 'type', 'is_storable'],
  );

  const goods = templates.filter(t => t.type === 'consu');
  const services = templates.filter(t => t.type !== 'consu');
  const already = goods.filter(t => t.is_storable);
  const toFix = goods.filter(t => !t.is_storable);

  console.log(`templates: ${templates.length}`);
  console.log(`goods (consu): ${goods.length}  already on: ${already.length}  off: ${toFix.length}`);
  console.log(`skip non-goods: ${services.length}`);
  for (const t of services) {
    console.log(`  skip ${t.type} ${t.id} ${t.name}`);
  }

  if (toFix.length === 0) {
    console.log('all goods already have Облік запасів on');
    return;
  }

  console.log(`will set is_storable=true on ${toFix.length} templates`);
  for (const t of toFix.slice(0, 40)) {
    console.log(`  ${t.id} ${t.name}`);
  }
  if (toFix.length > 40) console.log(`  … +${toFix.length - 40} more`);

  if (!APPLY) {
    console.log('DRY RUN — no writes');
    console.log('npm run enable-storable -- --apply');
    return;
  }

  let done = 0;
  for (const batch of chunk(toFix, BATCH)) {
    await write('product.template', batch.map(t => t.id), { is_storable: true });
    done += batch.length;
    console.log(`[+] ${done}/${toFix.length}`);
  }
  console.log('done');
}

run().catch(err => {
  console.error('[FATAL]', err instanceof Error ? err.message : err);
  process.exit(1);
});
