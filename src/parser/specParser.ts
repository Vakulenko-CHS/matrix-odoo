import * as fs from "fs";
import * as path from "path";
import { BomDef, ComponentSpec, OperationSpec, UOM } from "../bom/types";
import { lineHtmlCommentFlags } from "../tools/htmlComment";
import { convertFilmQty } from "../validator/filmUom";

interface WorkshopHeader {
  number: string;
  fullName: string;
  code: string;
  operationName: string;
}

interface RawProduct {
  emoji: string;
  name: string;
  attributes: string[];
  qty?: number;
  uomStr?: string;
}

interface RawComponent {
  emoji: string;
  name: string;
  attributes: string[];
  qty: number;
  uomStr: string;
}

interface RawVariant {
  product: RawProduct;
  components: RawComponent[];
  price?: number;
}

function parseUom(uomStr: string): number {
  const s = uomStr.toLowerCase().replace(/\s+/g, "").replace(/\.$/, "");
  if (s === "шт" || s === "шт." || s === "од" || s === "штук" || s === "pcs")
    return UOM.UNITS;
  if (s.includes("m²") || s.includes("м²") || s === "m2" || s === " m²")
    return UOM.M2;
  if (s.includes("m³") || s.includes("м³") || s === "m3" || s === " m³")
    return UOM.M3;
  if (s === "кг" || s === "kg") return UOM.KG;
  if (s === "г" || s === "g") return UOM.G;
  if (s === "m" || s === "м" || s === "метр") return UOM.M;
  console.warn(`  [parse] невідома UOM: "${uomStr}", використовується Одиниці`);
  return UOM.UNITS;
}

function parseQty(qtyStr: string): number {
  return parseFloat(qtyStr.replace(",", ".")) || 0;
}

// Regex для рядка з emoji-продуктом або звичайним продуктом
// Відловлює: 🪤🧽[Назва] (Атр1, Атр2) - qty uom
const PRODUCT_RE =
  /^([\s\S]*?)(?:([\u{1F000}-\u{1FFFF}\u{2600}-\u{27FF}🪤🧩🪵🧽]+))?\[([^\]]+)\]\s*(?:\(([^)]+)\))?\s*(?:-\s*([\d,.]+)\s*(.+?))?\s*$/u;

// Рядок без дужок: "Диван (Атр1, Атр2)"
const PLAIN_PRODUCT_RE =
  /^[\s]*([A-Za-zА-ЯҐЄІЇа-яґєії0-9 -]+?)\s*\(([^)]+)\)\s*(?:-\s*([\d,.]+)\s*(.+?))?\s*$/;

// Компонент (відступ + назва - кількість UOM)
const COMPONENT_BRACKET_RE =
  /^(\s{2,})([\u{1F000}-\u{1FFFF}\u{2600}-\u{27FF}🪤🧩🪵🧽]*)\[([^\]]+)\]\s*(?:\(([^)]+)\))?\s*-\s*([\d,.]+)\s*(.+?)\s*$/u;
const COMPONENT_PLAIN_RE =
  /^(\s{2,})([^[\n#\/\-].+?)\s*-\s*([\d,.]+)\s*(.+?)\s*$/;

function parseWorkshopHeader(line: string): WorkshopHeader | null {
  const m = line.match(
    /^#+\s*Цех\s+№([\w-]+)\s+(.+?)\s+-\s+(\S+)\s+[""](.+?)[""]\s*$/,
  );
  if (!m) return null;
  return {
    number: m[1].trim(),
    fullName: `Цех №${m[1].trim()} ${m[2].trim()}`,
    code: m[3].trim(),
    operationName: m[4].trim(),
  };
}

function tryParseProduct(line: string): RawProduct | null {
  const trimmed = line.trim();
  if (
    !trimmed ||
    trimmed.startsWith("//") ||
    trimmed.startsWith("Ціна") ||
    trimmed === "або" ||
    trimmed === "---"
  )
    return null;

  // Спробуємо з дужками []
  const m = trimmed.match(PRODUCT_RE);
  if (m && m[3]) {
    return {
      emoji: (m[2] || "").trim(),
      name: m[3].trim(),
      attributes: m[4]
        ? m[4]
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : [],
      qty: m[5] ? parseQty(m[5]) : undefined,
      uomStr: m[6]?.trim(),
    };
  }

  // Без дужок: "Диван (Атр1, Атр2)"
  const pm = trimmed.match(PLAIN_PRODUCT_RE);
  if (pm) {
    return {
      emoji: "",
      name: pm[1].trim(),
      attributes: pm[2]
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      qty: pm[3] ? parseQty(pm[3]) : undefined,
      uomStr: pm[4]?.trim(),
    };
  }

  return null;
}

function tryParseComponent(line: string): RawComponent | null {
  // З дужками: "    🧩[Каркас] (100ДСП) - 1 шт."
  const bm = line.match(COMPONENT_BRACKET_RE);
  if (bm && bm[3]) {
    const qty = parseQty(bm[5]);
    if (qty <= 0) return null;
    return {
      emoji: (bm[2] || "").trim(),
      name: bm[3].trim(),
      attributes: bm[4]
        ? bm[4]
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : [],
      qty,
      uomStr: bm[6].trim(),
    };
  }

  // Без дужок: "    Дерево - 0.024 m³"
  const pm = line.match(COMPONENT_PLAIN_RE);
  if (pm) {
    const name = pm[2].trim();
    if (
      !name ||
      name.startsWith("Ціна") ||
      name.startsWith("або") ||
      name === "---"
    )
      return null;
    const qty = parseQty(pm[3]);
    if (qty <= 0) return null;
    return {
      emoji: "",
      name,
      attributes: [],
      qty,
      uomStr: pm[4].trim(),
    };
  }

  return null;
}

function rawProductToBomDef(
  product: RawProduct,
  components: RawComponent[],
  workshop: WorkshopHeader,
  price?: number,
): BomDef {
  const operation: OperationSpec = {
    name: workshop.operationName,
    workcenter: workshop.fullName,
    priceRate: price,
  };

  const bomComponents: ComponentSpec[] = components.map((c) => {
    const film = convertFilmQty(c.name, c.qty, c.uomStr);
    return {
      product: c.name,
      variants: c.attributes.length > 0 ? c.attributes : undefined,
      qty: film.qty,
      uomId: parseUom(film.uom),
      operationIndex: 0,
    };
  });

  return {
    product: product.name,
    variants: product.attributes.length > 0 ? product.attributes : undefined,
    qty: product.qty ?? 1,
    operations: [operation],
    components: bomComponents,
  };
}

function parsePrice(line: string): number | undefined {
  const m = line.match(/Ціна\s+([\d,.]+)/);
  return m ? parseFloat(m[1].replace(",", ".")) : undefined;
}

export function parseSpecFile(filePath: string): BomDef[] {
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n");
  const commented = lineHtmlCommentFlags(content);
  const boms: BomDef[] = [];

  let currentWorkshop: WorkshopHeader | null = null;
  let currentProduct: RawProduct | null = null;
  let currentComponents: RawComponent[] = [];
  let currentPrice: number | undefined;
  let inHeader = true; // skip preamble before first workshop

  function flushVariant() {
    if (!currentWorkshop || !currentProduct) return;
    // Skip if product has qty=0 (empty placeholder)
    if (
      currentProduct.qty !== undefined &&
      currentProduct.qty <= 0 &&
      currentComponents.length === 0
    )
      return;
    boms.push(
      rawProductToBomDef(
        currentProduct,
        currentComponents,
        currentWorkshop,
        currentPrice,
      ),
    );
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (commented[i]) continue;

    // Workshop header: "# Цех №N ..."
    if (trimmed.startsWith("#") && trimmed.includes("Цех")) {
      const wh = parseWorkshopHeader(trimmed);
      if (wh) {
        flushVariant();
        currentWorkshop = wh;
        currentProduct = null;
        currentComponents = [];
        currentPrice = undefined;
        inHeader = false;
        continue;
      }
    }

    if (inHeader) continue;
    if (!currentWorkshop) continue;

    // Skip comments and empty lines (but don't break state)
    if (
      !trimmed ||
      trimmed.startsWith("//") ||
      trimmed.startsWith("<<") ||
      trimmed.startsWith(">>")
    )
      continue;

    // Price line
    if (trimmed.startsWith("Ціна")) {
      currentPrice = parsePrice(trimmed);
      continue;
    }

    // "або" separator — flush current variant, start new one within same workshop
    if (trimmed === "або" || trimmed === "Або") {
      flushVariant();
      currentProduct = null;
      currentComponents = [];
      continue;
    }

    // Section separator "---" — flush current variant
    if (trimmed === "---") {
      flushVariant();
      currentProduct = null;
      currentComponents = [];
      currentPrice = undefined;
      continue;
    }

    // Try to parse as component (must be indented, has "- qty uom")
    if (line.match(/^\s{3,}/) && currentProduct !== null) {
      const comp = tryParseComponent(line);
      if (comp) {
        currentComponents.push(comp);
        continue;
      }
    }

    // Try to parse as a product line (output of this workshop)
    const prod = tryParseProduct(line);
    if (prod) {
      if (currentProduct !== null) {
        // New product in same workshop (after ---)
        flushVariant();
        currentComponents = [];
        currentPrice = undefined;
      }
      currentProduct = prod;
      continue;
    }

    // Try as component even without deep indent (2+ spaces)
    if (currentProduct !== null && line.match(/^\s{2,}/)) {
      const comp = tryParseComponent(line);
      if (comp) {
        currentComponents.push(comp);
      }
    }
  }

  // Flush last variant
  flushVariant();

  return boms;
}
