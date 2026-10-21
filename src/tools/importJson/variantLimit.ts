import { create, searchRead, write } from '../../api/odoo';

/** Raise Odoo product.dynamic_variant_limit if below minLimit (default 10000). */
export async function ensureVariantLimit(minLimit = 10000): Promise<void> {
  const [existing] = await searchRead<{ id: number; value: string }>(
    'ir.config_parameter',
    [['key', '=', 'product.dynamic_variant_limit']],
    ['id', 'value'],
    1,
  );
  if (existing) {
    const current = parseInt(existing.value, 10);
    if (current < minLimit) {
      await write('ir.config_parameter', [existing.id], { value: String(minLimit) });
      console.log(`[config] product.dynamic_variant_limit: ${current} → ${minLimit}`);
    }
  } else {
    await create('ir.config_parameter', {
      key: 'product.dynamic_variant_limit',
      value: String(minLimit),
    });
    console.log(`[config] product.dynamic_variant_limit = ${minLimit}`);
  }
}
