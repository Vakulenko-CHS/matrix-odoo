import { searchRead, create, write, executeKw } from '../api/odoo';
import { track } from '../state/tracker';
import type { ResolvedProduct } from './types';
import {
  canonWorkcenterName,
  extractWorkshopNum,
  findCanonWorkcenter,
} from '../workcenters/canon';

export { canonWorkcenterName };

const normalizeStr = (s: string): string =>
  s.trim().replace(/[Xx]/g, 'х').replace(/\s+/g, ' ').toLowerCase();

const _templateCache = new Map<string, { id: number } | null>();
const _attrCache = new Map<string, number>();
const _attrValueCache = new Map<string, number>();
const _workcenterCache = new Map<string, number>();
let _workcenterRows: Array<{ id: number; name: string; code?: string | false; active?: boolean }> | null = null;

function wcKey(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLocaleLowerCase('uk');
}


async function loadWorkcenters() {
  if (_workcenterRows) return _workcenterRows;
  _workcenterRows = await searchRead<{ id: number; name: string; code?: string | false; active?: boolean }>(
    'mrp.workcenter',
    [],
    ['id', 'name', 'code', 'active'],
  );
  return _workcenterRows;
}

function pickWorkcenter(
  rows: Array<{ id: number; name: string; code?: string | false; active?: boolean }>,
  preferredCode?: string,
) {
  const live = rows.filter((r) => r.active !== false);
  const pool = live.length ? live : rows;
  if (preferredCode) {
    const coded = pool.find((r) => r.code && String(r.code) === preferredCode);
    if (coded) return coded;
  }
  return (
    pool.find((r) => r.code) ??
    pool.find((r) => r.name.includes('Збірка')) ??
    pool[0]
  );
}

// templateId → [{id, displayName, norms}] — завантажується одним батч-запитом
const _templateVariantCache = new Map<number, Array<{
  id: number;
  displayName: string;
  norms: string[];
}>>();

/** Інвалідувати кеш варіантів шаблону (при додаванні нових значень атрибутів) */
export function invalidateTemplateVariantCache(templateId: number): void {
  _templateVariantCache.delete(templateId);
}

/** Знайти шаблон товару за точною назвою */
export async function findTemplate(name: string): Promise<{ id: number } | null> {
  if (_templateCache.has(name)) return _templateCache.get(name)!;
  const [rec] = await searchRead<{ id: number }>(
    'product.template', [['name', '=', name]], ['id'], 1
  );
  const result = rec ?? null;
  _templateCache.set(name, result);
  return result;
}

/** Записати шаблон у кеш після ручного створення */
export function cacheTemplate(name: string, id: number): void {
  _templateCache.set(name, { id });
}

/**
 * Знайти варіант товару за назвою шаблону та значеннями атрибутів.
 *
 * Якщо attrValues не задано або порожньо — повертає перший (єдиний) варіант.
 * Якщо задано — шукає варіант, де ВСІ вказані значення збігаються
 * (з нормалізацією: x/X → х, lower, trim).
 */
export async function resolveProduct(
  productName: string,
  attrValues?: string[]
): Promise<ResolvedProduct | null> {
  const tmpl = await findTemplate(productName);
  if (!tmpl) {
    console.warn(`  [WARN] Шаблон не знайдено: "${productName}"`);
    return null;
  }

  if (!attrValues || attrValues.length === 0) {
    const [v] = await searchRead<{ id: number; display_name: string }>(
      'product.product',
      [['product_tmpl_id', '=', tmpl.id]],
      ['id', 'display_name'], 1
    );
    if (!v) return null;
    return { variantId: v.id, templateId: tmpl.id, displayName: v.display_name };
  }

  // Побудувати кеш варіантів шаблону якщо ще не завантажено.
  // Один searchRead + ОДИН батч executeKw для всіх PTAV → O(2) запити замість O(N).
  if (!_templateVariantCache.has(tmpl.id)) {
    const variants = await searchRead<{
      id: number;
      display_name: string;
      product_template_attribute_value_ids: number[];
    }>(
      'product.product',
      [['product_tmpl_id', '=', tmpl.id]],
      ['id', 'display_name', 'product_template_attribute_value_ids']
    );

    const allPtavIds = [...new Set(variants.flatMap(v => v.product_template_attribute_value_ids))];
    const ptavNameById = new Map<number, string>();
    if (allPtavIds.length > 0) {
      const ptavs = await executeKw<{ id: number; name: string }[]>(
        'product.template.attribute.value', 'read',
        [allPtavIds],
        { fields: ['id', 'name'] }
      );
      ptavs.forEach(p => ptavNameById.set(p.id, p.name));
    }

    _templateVariantCache.set(tmpl.id, variants.map(v => ({
      id: v.id,
      displayName: v.display_name,
      norms: v.product_template_attribute_value_ids.map(id => normalizeStr(ptavNameById.get(id) ?? '')),
    })));
  }

  const requiredNorm = attrValues.map(normalizeStr);
  for (const v of _templateVariantCache.get(tmpl.id)!) {
    if (requiredNorm.every(req => v.norms.includes(req))) {
      return { variantId: v.id, templateId: tmpl.id, displayName: v.displayName };
    }
  }

  console.warn(`  [WARN] Варіант не знайдено: "${productName}" [${attrValues.join(', ')}]`);
  return null;
}

/** Отримати або створити атрибут товару */
export async function getOrCreateAttribute(name: string): Promise<number> {
  if (_attrCache.has(name)) return _attrCache.get(name)!;
  const [existing] = await searchRead<{ id: number }>(
    'product.attribute', [['name', '=', name]], ['id'], 1
  );
  if (existing) { _attrCache.set(name, existing.id); return existing.id; }

  const id = await create('product.attribute', { name, create_variant: 'always' });
  track.attribute(id);
  console.log(`  [+] Атрибут створено: "${name}" (ID: ${id})`);
  _attrCache.set(name, id);
  return id;
}

/** Отримати або створити значення атрибуту */
export async function getOrCreateAttributeValue(attrId: number, valueName: string): Promise<number> {
  const key = `${attrId}::${valueName}`;
  if (_attrValueCache.has(key)) return _attrValueCache.get(key)!;
  const [existing] = await searchRead<{ id: number }>(
    'product.attribute.value',
    [['attribute_id', '=', attrId], ['name', '=', valueName]],
    ['id'], 1
  );
  if (existing) { _attrValueCache.set(key, existing.id); return existing.id; }

  const id = await create('product.attribute.value', { attribute_id: attrId, name: valueName });
  track.attributeValue(id);
  console.log(`    [+] Значення атрибуту створено: "${valueName}" (ID: ${id})`);
  _attrValueCache.set(key, id);
  return id;
}

function workcenterHits(
  rows: Array<{ id: number; name: string; code?: string | false; active?: boolean }>,
  name: string,
  canon: string,
) {
  const known = findCanonWorkcenter(name) ?? findCanonWorkcenter(canon);
  const keys = new Set([wcKey(name), wcKey(canon), ...(known ? [wcKey(known.name)] : [])]);
  const num = known?.num ?? extractWorkshopNum(canon) ?? extractWorkshopNum(name);
  return rows.filter((r) => {
    if (keys.has(wcKey(r.name))) return true;
    if (known?.code && r.code && String(r.code) === known.code) return true;
    return num != null && extractWorkshopNum(r.name) === num;
  });
}

/** Отримати або створити робочий центр. Known № reuses Odoo row; never duplicate Збірка/збірка. */
export async function getOrCreateWorkcenter(name: string): Promise<number> {
  const canon = canonWorkcenterName(name);
  const known = findCanonWorkcenter(name) ?? findCanonWorkcenter(canon);
  for (const key of [name, canon, known?.name].filter(Boolean) as string[]) {
    if (_workcenterCache.has(key)) return _workcenterCache.get(key)!;
  }
  const rows = await loadWorkcenters();
  const hits = workcenterHits(rows, name, canon);
  if (hits.length) {
    const existing = pickWorkcenter(hits, known?.code);
    for (const key of [name, canon, existing.name, known?.name].filter(Boolean) as string[]) {
      _workcenterCache.set(key, existing.id);
    }
    if (existing.name !== name) {
      console.log(`  [wc] reuse "${existing.name}" (ID: ${existing.id}) for "${name}"`);
    }
    return existing.id;
  }

  const payload: { name: string; time_efficiency: number; code?: string } = {
    name: canon,
    time_efficiency: 100,
  };
  if (known?.code) payload.code = known.code;
  const id = await create('mrp.workcenter', payload);
  track.workcenter(id);
  console.log(`  [+] Робочий центр створено: "${canon}" (ID: ${id})`);
  _workcenterRows = null;
  for (const key of [name, canon]) _workcenterCache.set(key, id);
  return id;
}

/**
 * Забезпечити існування варіанту.
 * Якщо значення атрибуту ще немає — створює його і додає до рядку атрибуту шаблону.
 * Odoo автоматично генерує новий варіант після цього.
 *
 * attrLineValues: [{attrLineId, attrId, valueName}] — один запис на кожен атрибут
 */
export async function ensureVariant(
  templateId: number,
  attrLineValues: Array<{ attrLineId: number; attrId: number; valueName: string }>
): Promise<number | null> {
  const requiredNorm: string[] = [];

  for (const { attrLineId, attrId, valueName } of attrLineValues) {
    const valueId = await getOrCreateAttributeValue(attrId, valueName);
    await write('product.template.attribute.line', [attrLineId], {
      value_ids: [[4, valueId]],
    });
    requiredNorm.push(normalizeStr(valueName));
    console.log(`    [~] Значення "${valueName}" додано до рядку атрибуту ${attrLineId}`);
  }

  const variants = await searchRead<{
    id: number;
    product_template_attribute_value_ids: number[];
  }>(
    'product.product',
    [['product_tmpl_id', '=', templateId]],
    ['id', 'product_template_attribute_value_ids']
  );

  for (const v of variants) {
    if (!v.product_template_attribute_value_ids.length) continue;

    const ptavs = await executeKw<{ name: string }[]>(
      'product.template.attribute.value', 'read',
      [v.product_template_attribute_value_ids],
      { fields: ['name'] }
    );

    const norms = ptavs.map(p => normalizeStr(p.name));
    if (requiredNorm.every(r => norms.includes(r))) return v.id;
  }

  return null;
}

/**
 * Отримати рядки атрибутів шаблону.
 * Корисно для передачі в ensureVariant.
 */
export async function getTemplateAttrLines(templateId: number): Promise<Array<{
  id: number;
  attribute_id: [number, string];
  value_ids: number[];
}>> {
  return searchRead(
    'product.template.attribute.line',
    [['product_tmpl_id', '=', templateId]],
    ['id', 'attribute_id', 'value_ids']
  );
}
