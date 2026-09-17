import { create, searchRead, write } from "../../../api/odoo";
import { findTemplate, getOrCreateWorkcenter } from "../../../bom/product";
import { ensureVariantFromAttrs, preSeedAttributeLines } from "../resolver";
import { expandEntry } from "../expander";
import { preSeedPtavCache, getPtavId } from "./ptav";
import { track, resetSession, saveSession } from "../../../state/tracker";
import type {
  BomEntry,
  AttributeVal,
  ComponentEntry,
} from "../../docToJson/types";
import { convertFilmQty } from "../../../validator/filmUom";

const UOM_MAP: Record<string, number> = {
  шт: 1,
  "шт.": 1,
  m: 8,
  "m²": 10,
  г: 14,
  g: 14,
  кг: 15,
  "m³": 30,
};

function bomQty(comp: { templateName: string; qty: number; uom: string }): {
  qty: number;
  uomId: number;
  uom: string;
} {
  const film = convertFilmQty(comp.templateName, comp.qty, comp.uom);
  return { qty: film.qty, uomId: UOM_MAP[film.uom] ?? 1, uom: film.uom };
}

// ─── Route cache ─────────────────────────────────────────────────────────────

let _mfgRouteId: number | null = null;
let _mtoRouteId: number | null = null;

async function loadRoutes(): Promise<void> {
  if (_mfgRouteId !== null) return;
  const routes = await searchRead<{ id: number; name: string }>(
    "stock.route",
    [],
    ["id", "name"],
  );
  const find = (...kws: string[]) =>
    routes.find((r) =>
      kws.some((kw) => r.name.toLowerCase().includes(kw.toLowerCase())),
    );

  const mfg = find("manufactur", "виробн");
  const mto = find("внз", "make to order", "replenish on order", "поповнит");

  if (!mfg)
    throw new Error(
      "Маршрут Manufacture не знайдено. Перевір stock.route в Odoo.",
    );
  if (!mto)
    throw new Error("Маршрут MTO/ВНЗ не знайдено. Перевір stock.route в Odoo.");

  _mfgRouteId = mfg.id;
  _mtoRouteId = mto.id;
  console.log(
    `[routes] Manufacture: "${mfg.name}" (${mfg.id})  MTO: "${mto.name}" (${mto.id})`,
  );
}

/**
 * Set Manufacture + MTO routes on a product template.
 *
 * ALL manufactured templates (any template with a BOM) get BOTH routes so the
 * full Цех 1 → 9 chain fires automatically when the final sofa is ordered:
 *   - Manufacture: enables producing this via MO
 *   - MTO (Make to Order): triggers a sub-MO the moment a parent MO
 *     demands this product, cascading up to raw-cut operations
 */
async function applyRoutes(
  templateId: number,
  templateName: string,
): Promise<void> {
  await write("product.template", [templateId], {
    route_ids: [[6, 0, [_mfgRouteId!, _mtoRouteId!]]],
  });
  console.log(`  [route] Manufacture + MTO → ${templateName}`);
}

/**
 * Auto-configure sale_ok / purchase_ok on all templates based on their role
 * in the BOM tree:
 *   - Final products (manufactured, not used as component) → sale ✓  purchase ✗
 *   - Semi-finished (manufactured, used as component)      → sale ✗  purchase ✗
 *   - Raw materials (not manufactured, only components)    → sale ✗  purchase ✓
 *
 * A component that already has a BOM in Odoo (from a prior import) is treated
 * as semi-finished even if it isn't a product.templateName in the current JSON —
 * prevents "downgrade" to raw material on partial re-imports.
 * Services (comp.isService) are skipped — their commercial flags stay untouched.
 */
async function applyProductTypes(boms: BomEntry[]): Promise<void> {
  const manufacturedNames = new Set(boms.map((e) => e.product.templateName));
  const componentNames = new Set<string>();
  for (const entry of boms) {
    for (const comp of entry.components) {
      if (comp.isService) continue;
      componentNames.add(comp.templateName);
    }
  }

  const allNames = [...new Set([...manufacturedNames, ...componentNames])];
  const templates = await searchRead<{ id: number; name: string }>(
    "product.template",
    [["name", "in", allNames]],
    ["id", "name"],
  );
  const nameToId = new Map(templates.map((t) => [t.name, t.id]));
  const idToName = new Map(templates.map((t) => [t.id, t.name]));

  // Templates that already have a BOM in Odoo are manufactured — even if this
  // JSON only lists them as components. Prevents "raw material" mis-classification.
  const existingBoms = await searchRead<{ product_tmpl_id: [number, string] }>(
    "mrp.bom",
    [["product_tmpl_id", "in", templates.map((t) => t.id)]],
    ["product_tmpl_id"],
  );
  for (const bom of existingBoms) {
    const name = idToName.get(bom.product_tmpl_id[0]);
    if (name) manufacturedNames.add(name);
  }

  const finalNames = [...manufacturedNames].filter(
    (n) => !componentNames.has(n),
  );
  const semiNames = [...manufacturedNames].filter((n) => componentNames.has(n));
  const rawNames = [...componentNames].filter((n) => !manufacturedNames.has(n));

  const resolve = (names: string[]) =>
    names
      .map((n) => nameToId.get(n))
      .filter((id): id is number => id !== undefined);
  const finalIds = resolve(finalNames);
  const semiIds = resolve(semiNames);
  const rawIds = resolve(rawNames);

  console.log(`\n${"=".repeat(60)}`);
  console.log("НАЛАШТУВАННЯ ТИПІВ ПРОДУКТІВ (sale_ok / purchase_ok)");
  console.log("=".repeat(60));

  if (finalIds.length > 0) {
    await write("product.template", finalIds, {
      sale_ok: true,
      purchase_ok: false,
    });
    console.log(`[type] ФІНАЛЬНІ (продаж ✓ / закупка ✗): ${finalIds.length}`);
    for (const n of finalNames) console.log(`  - ${n}`);
  }
  if (semiIds.length > 0) {
    await write("product.template", semiIds, {
      sale_ok: false,
      purchase_ok: false,
    });
    console.log(
      `\n[type] НАПІВФАБРИКАТИ (тільки виробництво): ${semiIds.length}`,
    );
    for (const n of semiNames) console.log(`  - ${n}`);
  }
  if (rawIds.length > 0) {
    await write("product.template", rawIds, {
      sale_ok: false,
      purchase_ok: true,
    });
    console.log(`\n[type] СИРОВИНА (закупка ✓ / продаж ✗): ${rawIds.length}`);
    for (const n of rawNames) console.log(`  - ${n}`);
  }

  const missing = allNames.filter((n) => !nameToId.has(n));
  if (missing.length > 0) {
    console.log(`\n[warn] Шаблони не знайдено в Odoo (${missing.length}):`);
    for (const n of missing) console.log(`  ? ${n}`);
  }
}

// ─── Category classification ─────────────────────────────────────────────────

/**
 * Substring → category name map for raw materials.
 * Order matters — specific keywords first. Match applies if templateName includes
 * the substring. Also acts as an override against parser artifacts (e.g. [Колесо]
 * / [Петля] mistakenly appearing as product.templateName).
 */
const RAW_MATERIAL_CATEGORY: Array<
  [keyword: string, categoryCompleteName: string]
> = [
  ["Скотч", "Упаковка"],
  ["Плівка", "Упаковка"],
  ["Картон", "Упаковка"],

  ["ДВП", "Сировина / Дерево"],
  ["ДСП", "Сировина / Дерево"],
  ["Ламінат", "Сировина / Дерево"],
  ["Фанера", "Сировина / Дерево"],
  ["Дерево", "Сировина / Дерево"],
  ["Кромка", "Сировина / Дерево"],

  ["Поролон", "Сировина / Наповнювачі"],
  ["Войлок", "Сировина / Наповнювачі"],
  ["Синтепон", "Сировина / Наповнювачі"],
  ["Флізелін", "Сировина / Наповнювачі"],
  ["Холлофайбер", "Сировина / Наповнювачі"],
  ["Крихта ППУ", "Сировина / Наповнювачі"],

  ["Тканина", "Сировина / Тканина"],
  ["Нитки", "Сировина / Тканина"],

  ["Соединитель", "Сировина / Фурнітура"],
  ["Колесо", "Сировина / Фурнітура"],
  ["Петля", "Сировина / Фурнітура"],
  ["Ніжка", "Сировина / Фурнітура"],
  ["Боннель", "Сировина / Фурнітура"],
  ["Стопор", "Сировина / Фурнітура"],
  ["Тік-так", "Сировина / Фурнітура"],
  ["Tік-так", "Сировина / Фурнітура"],
  ["Зацеп", "Сировина / Фурнітура"],
  ["Распорка", "Сировина / Фурнітура"],
  ["Алігатор", "Сировина / Фурнітура"],
];

const FINAL_PRODUCT_CATEGORY = "Готова продукція / Дивани";

function extractCehToken(text: string): string | null {
  const m = text.match(/№\s*(\d+(?:-\d+)?)/);
  return m ? m[1] : null;
}

function classifyRawByKeyword(name: string): string | null {
  for (const [kw, catName] of RAW_MATERIAL_CATEGORY) {
    if (name.includes(kw)) return catName;
  }
  return null;
}

/**
 * Assign product.category to each template based on its role in the BOM tree
 * and (for raw materials) on keyword matching against known material types.
 *
 * Priority order per template:
 *   1. In manufactured set AND never a component → FINAL ("Готова продукція / Дивани")
 *   2. Matches a raw-material keyword           → RAW  ("Сировина / X" or "Упаковка")
 *      (this overrides JSON structure — defends against parser bugs where a raw
 *       item like [Колесо] wrongly appears as product.templateName)
 *   3. In manufactured set (semi-finished)      → SEMI (Цех category by first op)
 *   4. Neither manufactured nor keyword-matched → warning, category untouched
 */
async function applyProductCategories(boms: BomEntry[]): Promise<void> {
  const categories = await searchRead<{ id: number; complete_name: string }>(
    "product.category",
    [],
    ["id", "complete_name"],
  );
  const catIdByName = new Map(categories.map((c) => [c.complete_name, c.id]));

  // Build ceh number → categoryId map from "Цех / №N [...]" names
  const cehToCatId = new Map<string, number>();
  for (const c of categories) {
    if (!c.complete_name.startsWith("Цех")) continue;
    const token = extractCehToken(c.complete_name);
    if (token) cehToCatId.set(token, c.id);
  }

  const finalCatId = catIdByName.get(FINAL_PRODUCT_CATEGORY);
  if (!finalCatId) {
    throw new Error(
      `Категорію "${FINAL_PRODUCT_CATEGORY}" не знайдено в Odoo. Створіть її або оновіть FINAL_PRODUCT_CATEGORY.`,
    );
  }

  // Build manufactured / component sets from JSON (skip services)
  const manufacturedNames = new Set(boms.map((e) => e.product.templateName));
  const componentNames = new Set<string>();
  for (const entry of boms) {
    for (const comp of entry.components) {
      if (comp.isService) continue;
      componentNames.add(comp.templateName);
    }
  }

  // Build "first workcenter for this templateName" map — for semi-finished lookup
  const firstOpForName = new Map<string, string>();
  for (const entry of boms) {
    if (
      !firstOpForName.has(entry.product.templateName) &&
      entry.operations[0]
    ) {
      firstOpForName.set(
        entry.product.templateName,
        entry.operations[0].workcenterName,
      );
    }
  }

  // Decide desired category for every name we know about
  type Assignment = {
    name: string;
    catId: number;
    catName: string;
    source: "final" | "raw" | "semi";
  };
  const assignments: Assignment[] = [];
  const unclassified: string[] = [];
  const missingCategory: Array<{ name: string; catName: string }> = [];

  const allNames = new Set([...manufacturedNames, ...componentNames]);

  for (const name of allNames) {
    const isManufactured = manufacturedNames.has(name);
    const isComponent = componentNames.has(name);
    const isFinal = isManufactured && !isComponent;

    if (isFinal) {
      assignments.push({
        name,
        catId: finalCatId,
        catName: FINAL_PRODUCT_CATEGORY,
        source: "final",
      });
      continue;
    }

    // Raw-material keyword match only for pure components (never manufactured).
    // Manufactured templates (semi-finished) may contain raw-material words in their name
    // (e.g. "🪤🧽[Каркас + Поролон]") but must be classified by workcenter цех instead.
    if (!isManufactured) {
      const rawCatName = classifyRawByKeyword(name);
      if (rawCatName) {
        const catId = catIdByName.get(rawCatName);
        if (catId)
          assignments.push({ name, catId, catName: rawCatName, source: "raw" });
        else missingCategory.push({ name, catName: rawCatName });
        continue;
      }
    }

    if (isManufactured) {
      const wcName = firstOpForName.get(name);
      const token = wcName ? extractCehToken(wcName) : null;
      const catId = token ? cehToCatId.get(token) : undefined;
      if (catId) {
        const catName =
          categories.find((c) => c.id === catId)?.complete_name ?? `#${catId}`;
        assignments.push({ name, catId, catName, source: "semi" });
      } else {
        unclassified.push(name);
      }
      continue;
    }

    unclassified.push(name);
  }

  // Look up existing templates + their current categ_id (skip no-op writes)
  const templates = await searchRead<{
    id: number;
    name: string;
    categ_id: [number, string] | false;
  }>(
    "product.template",
    [["name", "in", [...allNames]]],
    ["id", "name", "categ_id"],
  );
  const tmplByName = new Map(templates.map((t) => [t.name, t]));

  const updatesByCat = new Map<number, number[]>();
  const alreadyOk: Assignment[] = [];
  const notInOdoo: string[] = [];

  for (const a of assignments) {
    const t = tmplByName.get(a.name);
    if (!t) {
      notInOdoo.push(a.name);
      continue;
    }
    const currentId = t.categ_id ? t.categ_id[0] : 0;
    if (currentId === a.catId) {
      alreadyOk.push(a);
      continue;
    }
    if (!updatesByCat.has(a.catId)) updatesByCat.set(a.catId, []);
    updatesByCat.get(a.catId)!.push(t.id);
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log("НАЛАШТУВАННЯ КАТЕГОРІЙ ТОВАРІВ");
  console.log("=".repeat(60));

  for (const [catId, ids] of updatesByCat) {
    await write("product.template", ids, { categ_id: catId });
    const catName =
      categories.find((c) => c.id === catId)?.complete_name ?? `#${catId}`;
    console.log(`[cat] ${catName}: +${ids.length} оновлено`);
    const idSet = new Set(ids);
    for (const a of assignments) {
      if (a.catId !== catId) continue;
      const t = tmplByName.get(a.name);
      if (t && idSet.has(t.id)) console.log(`  - ${a.name}`);
    }
  }

  if (alreadyOk.length > 0) {
    console.log(`\n[cat] Вже правильно: ${alreadyOk.length} шаблонів`);
  }

  if (unclassified.length > 0) {
    console.log(
      `\n[warn] Сировина без keyword у RAW_MATERIAL_CATEGORY (${unclassified.length}):`,
    );
    for (const n of unclassified) console.log(`  ? ${n}`);
  }

  if (missingCategory.length > 0) {
    console.log(
      `\n[warn] Категорія відсутня в Odoo (${missingCategory.length}):`,
    );
    for (const m of missingCategory)
      console.log(`  ? "${m.catName}" для ${m.name}`);
  }

  if (notInOdoo.length > 0) {
    console.log(`\n[warn] Шаблони не знайдено в Odoo (${notInOdoo.length}):`);
    for (const n of notInOdoo) console.log(`  ? ${n}`);
  }
}

/**
 * Compute the desired product.category ID for every manufactured template
 * (final products + semi-finished). Returns Map<templateName, categ_id>.
 * Raw material components (no BOM) are omitted — they're handled by applyProductCategories.
 */
function buildCategoryMap(
  boms: BomEntry[],
  catIdByName: Map<string, number>,
  cehToCatId: Map<string, number>,
  finalCatId: number,
): Map<string, number> {
  const manufacturedNames = new Set(boms.map((e) => e.product.templateName));
  const componentNames = new Set<string>();
  for (const entry of boms) {
    for (const comp of entry.components) {
      if (!comp.isService) componentNames.add(comp.templateName);
    }
  }

  const firstOpForName = new Map<string, string>();
  for (const entry of boms) {
    if (
      !firstOpForName.has(entry.product.templateName) &&
      entry.operations[0]
    ) {
      firstOpForName.set(
        entry.product.templateName,
        entry.operations[0].workcenterName,
      );
    }
  }

  const result = new Map<string, number>();
  for (const name of manufacturedNames) {
    if (!componentNames.has(name)) {
      result.set(name, finalCatId);
      continue;
    }
    // Semi-finished: always classify by workcenter цех, never by raw-material keyword.
    // Templates like "🪤🧽[Каркас + Поролон]" contain raw-material words but are manufactured.
    const wcName = firstOpForName.get(name);
    const token = wcName ? extractCehToken(wcName) : null;
    const catId = token ? cehToCatId.get(token) : undefined;
    if (catId) result.set(name, catId);
  }
  return result;
}

type Combo = Record<string, string>;

function cartesian(dims: Array<{ key: string; values: string[] }>): Combo[] {
  if (dims.length === 0) return [{}];
  let result: Combo[] = [{}];
  for (const { key, values } of dims) {
    result = result.flatMap((c) => values.map((v) => ({ ...c, [key]: v })));
  }
  return result;
}

// Strip "%placeholder%" markers and trailing variant list from operation names.
function cleanOpName(name: string): string {
  return name
    .replace(/ \([^)]*%[^)]*\)/g, "") // "(Угол Леон-Люкс 140 Механізм, %Тканина%, ...)"
    .replace(/%[^%]+%/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Transform entries that have a fixed "Модель" attribute:
 *   - Embed model value into template name: "Template" + Модель=X → "Template X"
 *   - Remove "Модель" and all "❌"-marked attributes from the product
 *   - Apply the same transformation to every component
 *   - Prune "Модель" and "❌" keys from expand maps
 *
 * After transformation every entry uses the uniform template-level BOM path —
 * each model-specific semi-finished product becomes its own unique template,
 * exactly like the чохол templates in цехи 7–8.
 */
function applyModelTransform(entries: BomEntry[]): BomEntry[] {
  const filterAttrs = (attrs: AttributeVal[]): AttributeVal[] =>
    attrs.filter(
      (a) => a.attributeName !== "Модель" && !a.attributeName.includes("❌"),
    );

  const filterExpand = (
    expand: Record<string, string[]>,
  ): Record<string, string[]> =>
    Object.fromEntries(
      Object.entries(expand).filter(
        ([key]) => key !== "Модель" && !key.includes("❌"),
      ),
    );

  // Only transform component name+attrs when the component itself has a fixed "Модель".
  // Components without "Модель" (e.g. чохол with ❌ attrs) are left unchanged.
  const transformComp = (comp: ComponentEntry): ComponentEntry => {
    const modelAttr = comp.attributes.find(
      (a) => a.attributeName === "Модель" && !a.value.includes("%"),
    );
    if (!modelAttr) return comp;
    return {
      ...comp,
      templateName: `${comp.templateName} ${modelAttr.value}`,
      attributes: filterAttrs(comp.attributes),
    };
  };

  return entries.map((entry) => {
    const modelAttr = entry.product.attributes.find(
      (a) => a.attributeName === "Модель" && !a.value.includes("%"),
    );

    // Always transform components — even if the product itself has no "Модель",
    // its components may reference model-specific templates (e.g. final sofa entry).
    const transformedComponents = entry.components.map(transformComp);

    if (!modelAttr) {
      const hasChanged = transformedComponents.some(
        (c, i) => c !== entry.components[i],
      );
      return hasChanged
        ? { ...entry, components: transformedComponents }
        : entry;
    }

    const modelValue = modelAttr.value;

    return {
      ...entry,
      product: {
        ...entry.product,
        templateName: `${entry.product.templateName} ${modelValue}`,
        attributes: filterAttrs(entry.product.attributes),
        ...(entry.product.ifAttr
          ? {
              ifAttr: Object.fromEntries(
                Object.entries(entry.product.ifAttr).filter(
                  ([k]) => !k.includes("❌"),
                ),
              ),
            }
          : {}),
      },
      components: transformedComponents,
      expand: entry.expand ? filterExpand(entry.expand) : undefined,
    };
  });
}

/** Resolve PTAV IDs for a list of fixed (non-placeholder) attribute values on a template */
async function resolvePtavIds(
  templateId: number,
  attrs: AttributeVal[],
): Promise<number[]> {
  const results = await Promise.all(
    attrs
      .filter((a) => !a.value.includes("%"))
      .map((a) => getPtavId(templateId, a.attributeName, a.value)),
  );
  return results.filter((id): id is number => id !== null);
}

/** Resolve PTAV IDs from an ifAttr condition map ({ attrName: value }) */
async function resolveIfAttrPtavIds(
  templateId: number,
  ifAttr?: Record<string, string>,
): Promise<number[]> {
  if (!ifAttr || Object.keys(ifAttr).length === 0) return [];
  return resolvePtavIds(
    templateId,
    Object.entries(ifAttr).map(([attributeName, value]) => ({
      attributeName,
      value,
    })),
  );
}

/**
 * Import all BomEntries that share the same product.templateName as a single
 * template-level BOM (product_id = false). Component lines use PTAV filters
 * to handle variant-specific components (fabric, size, pillow block, etc.).
 *
 * By the time this function is called, model-based entries have already been
 * transformed by applyModelTransform — the "Модель" value is embedded in the
 * template name and removed from attributes. So every group here follows the
 * same uniform path regardless of which цех produced it.
 */
export async function importTemplateBomGroup(
  templateName: string,
  entries: BomEntry[],
  categ_id?: number,
): Promise<"created" | "existed" | null> {
  if (entries.length === 0) return null;

  let tmplId: number;
  const found = await findTemplate(templateName);
  if (found) {
    tmplId = found.id;
  } else {
    // Template has no attributes after transform — preSeed skipped it; create it now
    const resolved = await ensureVariantFromAttrs(
      templateName,
      [],
      false,
      false,
    );
    if (!resolved) {
      console.warn(`  [SKIP] Не вдалося створити шаблон: "${templateName}"`);
      return null;
    }
    tmplId = resolved.templateId;
  }

  // Assign category immediately so the template is classified from the start
  if (categ_id) {
    await write("product.template", [tmplId], { categ_id });
  }

  const bomCode = `tmpl::${templateName}`;
  const [existingBom] = await searchRead<{ id: number }>(
    "mrp.bom",
    [
      ["product_tmpl_id", "=", tmplId],
      ["product_id", "=", false],
      ["code", "=", bomCode],
    ],
    ["id"],
    1,
  );
  if (existingBom) {
    console.log(
      `  [EXISTS] Template BOM (ID: ${existingBom.id}): ${templateName}`,
    );
    return "existed";
  }

  const bomId = await create("mrp.bom", {
    product_tmpl_id: tmplId,
    product_id: false,
    code: bomCode,
    product_qty: entries[0].product.qty,
    type: "normal",
  });
  track.bom(bomId);
  console.log(`  [+] Template BOM (ID: ${bomId}): ${templateName}`);

  const opIds: number[] = [];
  for (let i = 0; i < entries[0].operations.length; i++) {
    const op = entries[0].operations[i];
    const wcId = await getOrCreateWorkcenter(op.workcenterName);
    const opName = cleanOpName(op.name) || op.workcenterName;
    const opId = await create("mrp.routing.workcenter", {
      name: opName,
      bom_id: bomId,
      workcenter_id: wcId,
      sequence: i + 1,
      x_studio_piece_rate_2: op.priceRate,
    });
    track.operation(opId);
    opIds.push(opId);
    console.log(`    [op] "${op.workcenterName}" (${op.priceRate} грн)`);
  }

  await applyRoutes(tmplId, templateName);
  await preSeedPtavCache(tmplId);

  let lineSeq = 1;

  for (const entry of entries) {
    const expand = entry.expand ?? {};

    const fixedProductAttrs = entry.product.attributes.filter(
      (a) => !a.value.includes("%"),
    );
    const entryPtavIds = [
      ...(await resolvePtavIds(tmplId, fixedProductAttrs)),
      ...(await resolveIfAttrPtavIds(tmplId, entry.product.ifAttr)),
    ];

    for (const comp of entry.components) {
      const fixedAttrs = comp.attributes.filter((a) => !a.value.includes("%"));
      const placeholderAttrs = comp.attributes.filter((a) =>
        a.value.includes("%"),
      );

      if (placeholderAttrs.length === 0) {
        const compResolved = await ensureVariantFromAttrs(
          comp.templateName,
          fixedAttrs,
          comp.isService ?? false,
          true,
        );
        if (!compResolved) {
          console.warn(`    [SKIP] ${comp.templateName}`);
          continue;
        }

        const q1 = bomQty(comp);
        const lineId1 = await create("mrp.bom.line", {
          bom_id: bomId,
          product_id: compResolved.variantId,
          product_qty: q1.qty,
          product_uom_id: q1.uomId,
          sequence: lineSeq++,
          operation_id: opIds[comp.operationIndex] ?? false,
          ...(entryPtavIds.length > 0
            ? {
                bom_product_template_attribute_value_ids: [
                  [6, 0, entryPtavIds],
                ],
              }
            : {}),
        });
        track.bomLine(lineId1);

        const label = fixedAttrs.length
          ? `${comp.templateName} (${fixedAttrs.map((a) => a.value).join(", ")})`
          : comp.templateName;
        console.log(`    [+] ${label} × ${q1.qty} ${q1.uom}`);
        continue;
      }

      const dims = placeholderAttrs
        .map((a) => ({
          key: a.attributeName,
          values: expand[a.attributeName] ?? [],
        }))
        .filter((d) => d.values.length > 0);

      if (dims.length === 0) {
        console.warn(
          `    [WARN] Немає expand значень для: ${comp.templateName}`,
        );
        continue;
      }

      const combos = cartesian(dims);
      const total = combos.length;
      let created = 0;

      for (const combo of combos) {
        const resolvedAttrs: AttributeVal[] = [
          ...fixedAttrs,
          ...placeholderAttrs
            .map((a) => ({
              attributeName: a.attributeName,
              value: combo[a.attributeName] ?? a.value,
            }))
            .filter((a) => !a.value.includes("%")),
        ];

        const compResolved = await ensureVariantFromAttrs(
          comp.templateName,
          resolvedAttrs,
          comp.isService ?? false,
          true,
        );
        if (!compResolved) continue;

        const comboPtavIds = (
          await Promise.all(
            Object.entries(combo).map(([attrName, value]) =>
              getPtavId(tmplId, attrName, value),
            ),
          )
        ).filter((id): id is number => id !== null);

        const allPtavIds = [...entryPtavIds, ...comboPtavIds];

        const q2 = bomQty(comp);
        const lineId2 = await create("mrp.bom.line", {
          bom_id: bomId,
          product_id: compResolved.variantId,
          product_qty: q2.qty,
          product_uom_id: q2.uomId,
          sequence: lineSeq++,
          operation_id: opIds[comp.operationIndex] ?? false,
          ...(allPtavIds.length > 0
            ? { bom_product_template_attribute_value_ids: [[6, 0, allPtavIds]] }
            : {}),
        });
        track.bomLine(lineId2);
        created++;
      }

      console.log(
        `    [+] ${comp.templateName}: ${created}/${total} рядків (filter за ${placeholderAttrs.map((a) => a.attributeName).join(" × ")})`,
      );
    }
  }

  return "created";
}

/**
 * Import all BomEntries from a parsed JSON file as template-level BOMs.
 *
 * Steps:
 * 1. Transform model-based entries: embed "Модель" value into template name,
 *    strip "Модель" and "❌" attributes. This makes every semi-finished template
 *    unique per model (same as цехи 7–8 чохол templates).
 * 2. Pre-seed all product templates + attribute values (so Odoo generates variants).
 * 3. Group BomEntries by product.templateName.
 * 4. For each group → one template-level BOM with PTAV-filtered component lines.
 */
export async function importAllTemplateBoms(
  boms: BomEntry[],
  label?: string,
): Promise<void> {
  resetSession();
  const totalStart = Date.now();

  await loadRoutes();

  // Step 1: embed "Модель" in template name, strip ❌ attrs for all model-based entries
  const transformedBoms = applyModelTransform(boms);

  // Load categories early so we can assign them at template-creation time
  const categories = await searchRead<{ id: number; complete_name: string }>(
    "product.category",
    [],
    ["id", "complete_name"],
  );
  const catIdByName = new Map(categories.map((c) => [c.complete_name, c.id]));
  const cehToCatId = new Map<string, number>();
  for (const c of categories) {
    if (!c.complete_name.startsWith("Цех")) continue;
    const token = extractCehToken(c.complete_name);
    if (token) cehToCatId.set(token, c.id);
  }
  const finalCatId = catIdByName.get(FINAL_PRODUCT_CATEGORY);
  if (!finalCatId) {
    throw new Error(
      `Категорію "${FINAL_PRODUCT_CATEGORY}" не знайдено в Odoo. Створіть її або оновіть FINAL_PRODUCT_CATEGORY.`,
    );
  }
  const categoryMap = buildCategoryMap(
    transformedBoms,
    catIdByName,
    cehToCatId,
    finalCatId,
  );

  // Step 2: seed all templates + attribute values (so Odoo generates variants)
  const allExpanded = transformedBoms.flatMap((e) => expandEntry(e));
  await preSeedAttributeLines(allExpanded);

  // Assign categories to templates created/updated by preSeed (batch write, skip already-correct)
  const preSeedNames = [
    ...new Set(transformedBoms.map((e) => e.product.templateName)),
  ];
  const preSeedTemplates = await searchRead<{
    id: number;
    name: string;
    categ_id: [number, string] | false;
  }>(
    "product.template",
    [["name", "in", preSeedNames]],
    ["id", "name", "categ_id"],
  );
  const batchByCat = new Map<number, number[]>();
  for (const t of preSeedTemplates) {
    const catId = categoryMap.get(t.name);
    if (!catId) continue;
    if (t.categ_id && t.categ_id[0] === catId) continue;
    if (!batchByCat.has(catId)) batchByCat.set(catId, []);
    batchByCat.get(catId)!.push(t.id);
  }
  for (const [catId, ids] of batchByCat) {
    await write("product.template", ids, { categ_id: catId });
    const catName =
      categories.find((c) => c.id === catId)?.complete_name ?? `#${catId}`;
    console.log(`  [cat] ${catName}: +${ids.length} (pre-seed)`);
  }

  // Step 3: group by templateName
  const groups = new Map<string, BomEntry[]>();
  for (const entry of transformedBoms) {
    const key = entry.product.templateName;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(entry);
  }

  console.log(`\n[template-bom] Шаблонів до імпорту: ${groups.size}`);

  let created = 0,
    existed = 0,
    skipped = 0,
    errors = 0;

  // Step 4: one BOM per template group — categ_id passed so it's assigned immediately
  for (const [templateName, entries] of groups) {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`[template] ${templateName}  (${entries.length} записів)`);
    console.log("=".repeat(60));
    try {
      const result = await importTemplateBomGroup(
        templateName,
        entries,
        categoryMap.get(templateName),
      );
      if (result === "created") created++;
      else if (result === "existed") existed++;
      else skipped++;
    } catch (err: any) {
      console.error(`[ERROR] ${templateName}: ${err.message}`);
      errors++;
    }
  }

  // Classify templates by BOM-tree role and apply sale_ok / purchase_ok
  await applyProductTypes(transformedBoms);

  // Assign product.category for raw material components and any remaining templates
  await applyProductCategories(transformedBoms);

  saveSession(label);
  const totalSec = ((Date.now() - totalStart) / 1000).toFixed(2);
  console.log(`\n${"=".repeat(60)}`);
  console.log(
    `Підсумок: +${created} створено  =${existed} існує  ?${skipped} пропущено  !${errors} помилок`,
  );
  console.log(`Загальний час: ${totalSec}s`);
  console.log("=".repeat(60));
}
