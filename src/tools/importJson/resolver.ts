import { searchRead, create, write, unlink, fieldsGet } from '../../api/odoo';
import { findTemplate, cacheTemplate, getOrCreateAttribute, getOrCreateAttributeValue, resolveProduct, invalidateTemplateVariantCache } from '../../bom/product';
import { track } from '../../state/tracker';
import type { AttributeVal, BomEntry } from '../docToJson/types';
import type { ResolvedProduct } from '../../bom/types';

let _storableType: string | null = null;
const _resolvedCache = new Map<string, ResolvedProduct | null>();
const _variantByDisplayName = new Map<string, ResolvedProduct>();

/**
 * Odoo інколи має кілька product.template.attribute.line на один attribute_id
 * (гонка паралельних імпортів) → комбінаторний вибух варіантів (89×89).
 * Зливаємо value_ids в один рядок, зайві рядки видаляємо.
 */
async function getOrMergeAttrLine(
  templateId: number,
  attrId: number,
): Promise<{ id: number; value_ids: number[] } | null> {
  const lines = await searchRead<{ id: number; value_ids: number[] }>(
    'product.template.attribute.line',
    [['product_tmpl_id', '=', templateId], ['attribute_id', '=', attrId]],
    ['id', 'value_ids'],
  );
  if (lines.length === 0) return null;
  if (lines.length === 1) return lines[0];

  const keep = lines.reduce((a, b) =>
    a.value_ids.length >= b.value_ids.length ? a : b,
  );
  const merged = [...new Set(lines.flatMap((l) => l.value_ids))].sort((a, b) => a - b);
  const same =
    keep.value_ids.length === merged.length &&
    keep.value_ids.every((id, i) => id === merged[i]);
  if (!same) {
    await write('product.template.attribute.line', [keep.id], {
      value_ids: [[6, 0, merged]],
    });
  }
  const extraIds = lines.filter((l) => l.id !== keep.id).map((l) => l.id);
  if (extraIds.length > 0) {
    await unlink('product.template.attribute.line', extraIds);
    invalidateTemplateVariantCache(templateId);
    console.warn(
      `  [!] Видалено ${extraIds.length} дублікат(ів) PTAL (шаблон ${templateId}, attr ${attrId})`,
    );
  }
  return { id: keep.id, value_ids: merged };
}

/**
 * Pass 1: Для всіх вже-розгорнутих BomEntry зібрати потрібні атрибути по шаблонах
 * та записати їх батчем (один write на рядок атрибута замість N write по одному).
 * Odoo генерує всі варіанти ОДИН РАЗ після запису, а не N разів.
 */
export async function preSeedAttributeLines(entries: BomEntry[]): Promise<void> {
  type TemplateInfo = { attrMap: Map<string, Set<string>>; isService: boolean; isComponent: boolean };
  const needed = new Map<string, TemplateInfo>();

  const collect = (templateName: string, attrs: AttributeVal[], isService = false, isComponent = false) => {
    if (attrs.length === 0) return;
    if (!needed.has(templateName)) needed.set(templateName, { attrMap: new Map(), isService, isComponent });
    const { attrMap } = needed.get(templateName)!;
    for (const attr of attrs) {
      if (attr.value.includes('%')) continue;
      const cleanName = attr.attributeName.replace(/❌$/, '');
      if (!attrMap.has(cleanName)) attrMap.set(cleanName, new Set());
      attrMap.get(cleanName)!.add(attr.value);
    }
  };

  for (const entry of entries) {
    collect(entry.product.templateName, entry.product.attributes, false, false);
    for (const comp of entry.components) {
      collect(comp.templateName, comp.attributes, comp.isService ?? false, true);
    }
  }

  const sec = (t: number) => `${((Date.now() - t) / 1000).toFixed(2)}s`;

  console.log(`\n[pre-seed] Шаблонів з атрибутами: ${needed.size}`);

  for (const [templateName, { attrMap, isService, isComponent }] of needed) {
    let templateId: number;
    const existing = await findTemplate(templateName);
    if (existing) {
      templateId = existing.id;
    } else {
      const t = Date.now();
      templateId = await create('product.template', {
        name: templateName,
        type: isService ? 'service' : await getStorableType(),
        // TEST / UNTESTED: Odoo 19 «Облік запасів» = is_storable, not type=product.
        ...(isService ? {} : { is_storable: true }),
        uom_id: 1,
        ...(isComponent ? { sale_ok: false } : {}),
      });
      track.template(templateId);
      cacheTemplate(templateName, templateId);
      console.log(`  [+] Шаблон: "${templateName}" (ID: ${templateId}) (${sec(t)})`);
    }

    for (const [attrName, valuesSet] of attrMap) {
      const attrId = await getOrCreateAttribute(attrName);
      const valueIds: number[] = [];
      for (const v of valuesSet) {
        valueIds.push(await getOrCreateAttributeValue(attrId, v));
      }

      const existingLine = await getOrMergeAttrLine(templateId, attrId);

      if (existingLine) {
        const missing = valueIds.filter(id => !existingLine.value_ids.includes(id));
        if (missing.length > 0) {
          const t = Date.now();
          // [4, id] = "link one" — додає без видалення існуючих значень
          await write('product.template.attribute.line', [existingLine.id], {
            value_ids: missing.map(id => [4, id]),
          });
          invalidateTemplateVariantCache(templateId);
          console.log(`  [~] "${templateName}" / "${attrName}": +${missing.length} значень (${sec(t)})`);
        }
      } else {
        const t = Date.now();
        await create('product.template.attribute.line', {
          product_tmpl_id: templateId,
          attribute_id: attrId,
          value_ids: valueIds.map(id => [4, id]),
        });
        console.log(`  [+] "${templateName}" / "${attrName}": ${valueIds.length} значень (${sec(t)})`);
      }
    }
  }

  console.log(`[pre-seed] Готово — варіанти сгенеровані Odoo\n`);
}

export function preSeedVariants(variants: Array<{ id: number; display_name: string; product_tmpl_id: [number, string] }>) {
  for (const v of variants) {
    _variantByDisplayName.set(v.display_name, {
      variantId: v.id,
      templateId: v.product_tmpl_id[0],
      displayName: v.display_name,
    });
  }
}

/** Очистити snapshot-кеш варіантів (викликати після preSeedAttributeLines щоб уникнути stale ID) */
export function clearVariantDisplayCache(): void {
  _variantByDisplayName.clear();
}

async function getStorableType(): Promise<string> {
  if (_storableType) return _storableType;
  const fields = await fieldsGet('product.template', ['selection']);
  const selection: [string, string][] = fields.type?.selection ?? [];
  for (const key of ['consu', 'storable', 'product']) {
    if (selection.some(([k]: [string, string]) => k === key)) {
      _storableType = key;
      return key;
    }
  }
  _storableType = 'consu';
  return _storableType;
}

/**
 * Знайти або створити шаблон товару та його варіант за набором атрибутів.
 *
 * - Якщо шаблон не існує — створюється автоматично (storable або service).
 * - Для кожного атрибуту: знаходить/створює рядок атрибуту шаблону і додає значення.
 * - Odoo автоматично генерує варіант після додавання значень атрибутів.
 * - Якщо attributes порожній — повертає єдиний (базовий) варіант шаблону.
 */
export async function ensureVariantFromAttrs(
  templateName: string,
  attributes: AttributeVal[],
  isService = false,
  isComponent = false
): Promise<ResolvedProduct | null> {
  // Skip attributes that still contain %placeholder% — they weren't fully resolved
  // Strip ❌ suffix from attributeName (inactive attrs keep their clean Odoo name)
  const resolvedAttrs = attributes
    .filter(a => !a.value.includes('%'))
    .map(a => ({ ...a, attributeName: a.attributeName.replace(/❌$/, '') }));

  const cacheKey = `${templateName}::${resolvedAttrs.map(a => `${a.attributeName}=${a.value}`).join(',')}`;
  if (_resolvedCache.has(cacheKey)) return _resolvedCache.get(cacheKey)!;

  // Check snapshot pre-seed by expected display_name (avoids all Odoo calls for known variants)
  const expectedDisplayName = resolvedAttrs.length === 0
    ? templateName
    : `${templateName} (${resolvedAttrs.map(a => a.value).join(', ')})`;
  const fromSnapshot = _variantByDisplayName.get(expectedDisplayName);
  if (fromSnapshot) {
    _resolvedCache.set(cacheKey, fromSnapshot);
    return fromSnapshot;
  }

  let templateId: number;
  const existing = await findTemplate(templateName);

  if (existing) {
    templateId = existing.id;
  } else {
    templateId = await create('product.template', {
      name: templateName,
      type: isService ? 'service' : await getStorableType(),
      // TEST / UNTESTED: Odoo 19 «Облік запасів» = is_storable, not type=product.
      ...(isService ? {} : { is_storable: true }),
      uom_id: 1,
      ...(isComponent ? { sale_ok: false } : {}),
    });
    track.template(templateId);
    console.log(`  [+] Шаблон створено: "${templateName}" (ID: ${templateId})`);
  }

  if (resolvedAttrs.length === 0) {
    const [v] = await searchRead<{ id: number }>(
      'product.product',
      [['product_tmpl_id', '=', templateId]],
      ['id'], 1
    );
    const result = v ? { variantId: v.id, templateId, displayName: templateName } : null;
    _resolvedCache.set(cacheKey, result);
    return result;
  }

  for (const attr of resolvedAttrs) {
    const attrId = await getOrCreateAttribute(attr.attributeName);
    const valueId = await getOrCreateAttributeValue(attrId, attr.value);

    const existingLine = await getOrMergeAttrLine(templateId, attrId);

    if (existingLine) {
      if (!existingLine.value_ids.includes(valueId)) {
        await write('product.template.attribute.line', [existingLine.id], {
          value_ids: [[4, valueId]],
        });
        invalidateTemplateVariantCache(templateId);
        console.log(`    [~] "${attr.value}" → рядок атрибуту "${attr.attributeName}"`);
      }
    } else {
      await create('product.template.attribute.line', {
        product_tmpl_id: templateId,
        attribute_id: attrId,
        value_ids: [[4, valueId]],
      });
      invalidateTemplateVariantCache(templateId);
      console.log(`    [+] Рядок "${attr.attributeName}" → "${attr.value}" на шаблоні "${templateName}"`);
    }
  }

  const result = await resolveProduct(templateName, resolvedAttrs.map(a => a.value));
  _resolvedCache.set(cacheKey, result);
  return result;
}
