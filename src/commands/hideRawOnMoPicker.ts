/**
 * Hide Сировина (categ 5 + children) from the MO "product to build" picker.
 * Component lines stay unfiltered.
 *
 *   npx ts-node --transpile-only src/commands/hideRawOnMoPicker.ts --apply
 */
import { authenticate, executeKw, searchRead } from '../api/odoo';

const APPLY = process.argv.includes('--apply');
const RAW_CATEG = 5;
const PARENT_VIEW = 1029;
const VIEW_NAME = 'matrix: hide Сировина on MO product_id';
const DOMAIN = `[('type', '=', 'consu'), '!', ('categ_id', 'child_of', ${RAW_CATEG})]`;
const ARCH = `<data>
  <xpath expr="//field[@name='product_id'][@default_focus='1']" position="attributes">
    <attribute name="domain">${DOMAIN}</attribute>
  </xpath>
</data>`;

async function run() {
  await authenticate();
  const existing = await searchRead<{ id: number }>(
    'ir.ui.view', [['name', '=', VIEW_NAME], ['model', '=', 'mrp.production']], ['id'],
  );
  console.log(`domain: ${DOMAIN}`);
  console.log(existing.length ? `existing view ${existing[0].id}` : 'no view yet');
  if (!APPLY) {
    console.log('DRY RUN — pass --apply to write ir.ui.view inherit');
    return;
  }

  if (existing.length) {
    await executeKw('ir.ui.view', 'write', [existing.map(v => v.id), { arch_db: ARCH, inherit_id: PARENT_VIEW }]);
    console.log(`updated view ${existing[0].id}`);
  } else {
    const id = await executeKw<number>('ir.ui.view', 'create', [{
      name: VIEW_NAME,
      type: 'form',
      model: 'mrp.production',
      inherit_id: PARENT_VIEW,
      mode: 'extension',
      arch_db: ARCH,
    }]);
    console.log(`created view ${id}`);
  }

  const fv = await executeKw<any>('mrp.production', 'get_view', [], {
    context: { lang: 'en_US' },
    view_type: 'form',
  });
  const arch = String(fv.arch ?? fv);
  const i = arch.indexOf('default_focus="1"');
  console.log('combined field:', arch.slice(Math.max(0, i - 80), i + 220));
}

run().catch(err => {
  console.error('[FATAL]', err instanceof Error ? err.message : err);
  process.exit(1);
});
