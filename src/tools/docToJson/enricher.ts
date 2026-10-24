import { BomEntry } from "./types";

interface SnapshotEntity {
  id: number;
  name: string;
}
interface SnapshotVariant {
  id: number;
  display_name: string;
  product_tmpl_id: [number, string];
}
interface SnapshotAttrValue {
  id: number;
  name: string;
  attribute_id: [number, string];
}

export interface SnapshotData {
  productTemplates: SnapshotEntity[];
  productVariants: SnapshotVariant[];
  productAttributeValues?: SnapshotAttrValue[];
  workcenters: (SnapshotEntity & { code?: string })[];
  uoms: SnapshotEntity[];
}

const UOM_ALIAS: Record<string, string> = {
  шт: "Одиниці",
};

// Workcenter names in the document that map to a different (existing) name in Odoo
const WORKCENTER_ALIAS: Record<string, string> = {
  "Цех №4-1 Сборка Бильце": "Цех №4-1 Збірка Бильце",
  "Цех №4-2 Сборка Каркаc": "Цех №4-2 Збірка Каркас",
  "Цех №4-3 Сборка Планка": "Цех №4-3 Збірка Планка",
  ВТК: "Цех Відділ Технічного котнтролю",
};

function wcKey(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLocaleLowerCase("uk");
}

function buildDisplayName(
  templateName: string,
  attrValues: { value: string }[],
): string {
  if (!attrValues.length) return templateName;
  return `${templateName} (${attrValues.map((a) => a.value).join(", ")})`;
}

export function enrichBoms(boms: BomEntry[], snapshot: SnapshotData): void {
  const templateByName = new Map<string, number>();
  snapshot.productTemplates.forEach((t) => templateByName.set(t.name, t.id));

  const variantByDisplayName = new Map<string, number>();
  snapshot.productVariants.forEach((v) =>
    variantByDisplayName.set(v.display_name, v.id),
  );

  const workcenterByKey = new Map<string, number>();
  snapshot.workcenters.forEach((w) => {
    const key = wcKey(w.name);
    if (workcenterByKey.has(key) && !w.code) return;
    workcenterByKey.set(key, w.id);
  });

  const uomByName = new Map<string, number>();
  snapshot.uoms.forEach((u) => uomByName.set(u.name, u.id));

  function resolveUomId(uom: string): number | undefined {
    return uomByName.get(UOM_ALIAS[uom] ?? uom);
  }

  // Normalize attribute names for case/space-insensitive lookup
  const normalizeAttr = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

  // Build attribute-value lookup: normalized(attrName) → ordered list of values
  const attrValuesByName = new Map<string, string[]>();
  if (snapshot.productAttributeValues) {
    for (const av of snapshot.productAttributeValues) {
      if (!av.attribute_id) continue;
      const key = normalizeAttr(av.attribute_id[1]);
      if (!attrValuesByName.has(key)) attrValuesByName.set(key, []);
      attrValuesByName.get(key)!.push(av.name);
    }
  }

  for (const bom of boms) {
    const tmplId = templateByName.get(bom.product.templateName);
    const varId = variantByDisplayName.get(bom.product.variantDisplayName);
    if (tmplId !== undefined) bom.product.odooTemplateId = tmplId;
    if (varId !== undefined) bom.product.odooVariantId = varId;

    for (const op of bom.operations) {
      const resolvedName =
        WORKCENTER_ALIAS[op.workcenterName] ?? op.workcenterName;
      const wcId = workcenterByKey.get(wcKey(resolvedName));
      if (wcId !== undefined) op.odooWorkcenterId = wcId;
    }

    for (const comp of bom.components) {
      const displayName = buildDisplayName(comp.templateName, comp.attributes);

      let compTmplName = comp.templateName;
      let compDisplayName = displayName;

      // (Послуга) components are stored in Odoo with that prefix
      if (comp.isService) {
        compTmplName = `(Послуга) ${comp.templateName}`;
        compDisplayName = buildDisplayName(compTmplName, comp.attributes);
      }

      const compTmplId = templateByName.get(compTmplName);
      const compVarId = variantByDisplayName.get(compDisplayName);
      if (compTmplId !== undefined) comp.odooTemplateId = compTmplId;
      if (compVarId !== undefined) comp.odooVariantId = compVarId;

      const uomId = resolveUomId(comp.uom);
      if (uomId !== undefined) comp.odooUomId = uomId;
    }

    // Build expand config: collect all %AttrName% placeholders used in this BOM
    const placeholders = new Set<string>();

    function scanForPlaceholders(str: string) {
      for (const m of str.matchAll(/%([^%]+)%/g)) placeholders.add(m[1]);
    }

    for (const attr of bom.product.attributes) {
      scanForPlaceholders(attr.value);
      scanForPlaceholders(attr.attributeName);
    }
    scanForPlaceholders(bom.product.variantDisplayName);

    for (const comp of bom.components) {
      for (const attr of comp.attributes) scanForPlaceholders(attr.value);
      if (comp.ifAttr) {
        for (const val of Object.values(comp.ifAttr)) scanForPlaceholders(val);
      }
    }

    if (placeholders.size > 0) {
      const expand: Record<string, string[]> = {};
      for (const attrName of placeholders) {
        // %Name❌% → inactive attr, always expands to a single ["❌"] value
        if (attrName.endsWith('❌')) {
          expand[attrName] = ['❌'];
          continue;
        }
        const values = (attrValuesByName.get(normalizeAttr(attrName)) ?? [])
          .filter(v => v !== '❌' && !v.startsWith('%'));
        if (values.length > 0) {
          expand[attrName] = values;
        } else {
          // Fallback: collect unique values from ifAttr tags in this BOM
          const seen = new Set<string>();
          for (const comp of bom.components) {
            if (comp.ifAttr && comp.ifAttr[attrName])
              seen.add(comp.ifAttr[attrName]);
          }
          if (seen.size > 0) expand[attrName] = [...seen];
        }
      }
      if (Object.keys(expand).length > 0) bom.expand = expand;
    }
  }
}
