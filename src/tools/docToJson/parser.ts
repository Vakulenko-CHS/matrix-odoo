import {
  AttributeVal,
  BomEntry,
  ComponentEntry,
  OperationEntry,
} from "./types";
import { lineHtmlCommentFlags } from "../htmlComment";

const DEFAULT_ATTR_NAMES = ["Модель", "Тканина", "Наповнювач"];

// Maps bracket name (without emoji/brackets) to the attribute name(s) for that product
const BRACKET_ATTR_NAMES: Record<string, string[]> = {
  ДВП: ["ДВП"],
  ДСП: ["ДСП"],
  "Ламінат - лист": ["Ламінат Розмір"],
  Поролон: ["Поролон"],
  Войлок: ["Войлок"],
  Боннель: ["Боннель"],
  Петля: ["Петля"],
  Ніжка: ["Ніжка"],
  Синтепон: ["Синтепон"],
  Тканина: ["Тканина"],
  Флізелін: ["Флізелін"],
  Накладка: ["Колір Ламінату"],
};

// Maps the FIRST WORD of a plain (non-bracketed) product name to its attribute names
// e.g. 'Диван "Нео-3 Механізм"' → first word "Диван" → sofa attribute names
// NOTE: spellings must match Odoo exactly (e.g. "Пружинний" — one н)
const PLAIN_PRODUCT_ATTR_NAMES: Record<string, string[]> = {
  Диван: ["Тканина", "Диван Пружинний Блок", "Диван Наповнювач Подушек"],
};

function getAttrNames(bracketName?: string, plainPrefix?: string): string[] {
  if (bracketName && BRACKET_ATTR_NAMES[bracketName])
    return BRACKET_ATTR_NAMES[bracketName];
  if (plainPrefix) {
    const firstWord = plainPrefix.split(/[\s"«»]/)[0].trim();
    if (PLAIN_PRODUCT_ATTR_NAMES[firstWord])
      return PLAIN_PRODUCT_ATTR_NAMES[firstWord];
  }
  return DEFAULT_ATTR_NAMES;
}

interface WorkshopInfo {
  fullName: string; // "Цех №1 Дерева (нарізка)"
  operationPrefix: string; // "Операція (Цех №1)"
}

interface ParsedProduct {
  templateName: string; // "🪵[Каркас - нарізана деревина]" or "Диван"
  isBracketed: boolean;
  attributes: AttributeVal[];
  variantDisplayName: string;
  qty: number;
  ifAttr?: Record<string, string>;
}

interface ParsedComponent {
  templateName: string;
  attributes: AttributeVal[];
  qty: number;
  uom: string;
  isService: boolean;
  ifAttr?: Record<string, string>;
}

// Strips a trailing "// @Attr=Value" tag from a line, returns { clean, ifAttr }
function stripIfAttrTag(line: string): {
  clean: string;
  ifAttr?: Record<string, string>;
} {
  const tagMatch = line.match(/^(.*?)\s*\/\/\s*@([^=]+?)=(.+?)\s*$/);
  if (!tagMatch) return { clean: line };
  return {
    clean: tagMatch[1].trimEnd(),
    ifAttr: { [tagMatch[2].trim()]: tagMatch[3].trim() },
  };
}

// Splits a string by top-level commas (ignores commas inside nested parentheses)
function splitTopLevel(s: string): string[] {
  let depth = 0;
  let current = "";
  const parts: string[] = [];
  for (const ch of s) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      if (current.trim()) parts.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

// Extracts attribute values from a "(val1, val2)" string with possible nested parens
function parseAttrString(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("(") || !trimmed.endsWith(")")) return [];
  const inner = trimmed.slice(1, -1);
  return splitTopLevel(inner);
}

function valuesToAttributes(
  values: string[],
  bracketName?: string,
  plainPrefix?: string,
): AttributeVal[] {
  const names = getAttrNames(bracketName, plainPrefix);
  return values.map((value, i) => {
    // If the value itself is a %Placeholder%, use its name as the attribute name.
    // This eliminates all position-based guessing for plain sofa products.
    const placeholder = value.match(/^%([^%]+)%$/);
    const attributeName = placeholder
      ? placeholder[1]
      : (names[i] ?? `Атрибут${i + 1}`);
    return { attributeName, value };
  });
}

// Finds the FIRST complete outer parenthesized group in s (respects nested parens)
function extractFirstOuterParen(s: string): string {
  const start = s.indexOf("(");
  if (start === -1) return "";
  let depth = 0;
  for (let i = start; i < s.length; i++) {
    if (s[i] === "(") depth++;
    else if (s[i] === ")") {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return "";
}

/**
 * Поролон attr з брудного remainder після `]`.
 * Канон attrStr для parseAttrString: "(ST-2233 (2000x1600x10))"
 * → JSON value: "ST-2233 (2000x1600x10)"
 */
function rebuildPorolonAttrStr(remainder: string): string {
  const code = remainder.match(/\b(ST-\d+)\b/i)?.[1];
  const dimsRaw = remainder.match(/(\d+(?:[xхX×]\d+){2,})/)?.[1];
  if (!code || !dimsRaw) return "";
  const dims = dimsRaw.replace(/[хX×]/g, "x");
  return `(${code.replace(/^st-/i, "ST-")} (${dims}))`;
}

// Splits a full product line into: emoji+template, attrString, qty, uom
// Correctly handles nested parens: "[Поролон] (ST-2535 (2000x1600x20)) - 2.4 кг"
//   → prefix="[Поролон]", attrStr="(ST-2535 (2000x1600x20))", qty=2.4, uom="кг"
function splitLineParts(
  line: string,
): { prefix: string; attrStr: string; qty: number | null; uom: string } | null {
  // Strip qty+uom from the end: " - qty uom"
  const qtyMatch = line.match(/\s+-\s+([\d,.]+)\s+([\S]+)\s*$/);
  let qty: number | null = null;
  let uom = "";
  let body = line;

  if (qtyMatch) {
    qty = parseFloat(qtyMatch[1].replace(",", "."));
    uom = qtyMatch[2].trim().replace(/\.$/, "");
    body = line.slice(0, line.length - qtyMatch[0].length);
  }

  // body is now: "emoji[Name] (attrs)", "emoji[Name]", or "Name (attrs)"
  const bracketOpen = body.indexOf("[");
  const bracketClose = body.lastIndexOf("]");

  if (bracketOpen !== -1 && bracketClose !== -1) {
    // Has brackets — prefix is everything through ']' (includes emoji)
    const prefixBare = body.slice(0, bracketClose + 1).trim();
    const remainder = body.slice(bracketClose + 1).trim();
    const bracketName = prefixBare.match(/\[([^\]]+)\]/)?.[1]?.trim() ?? "";
    // Поролон: збираємо ST + dims з remainder (ігноруємо криві дужки)
    if (bracketName === "Поролон") {
      const rebuilt = rebuildPorolonAttrStr(remainder);
      if (rebuilt) return { prefix: prefixBare, attrStr: rebuilt, qty, uom };
    }
    const attrStr = extractFirstOuterParen(remainder);
    const beforeParen = remainder.replace(/\(.*$/s, "").trim();
    const prefix =
      beforeParen && !beforeParen.startsWith("-")
        ? `${prefixBare} ${beforeParen}`
        : prefixBare;
    return { prefix, attrStr, qty, uom };
  } else {
    // No brackets — split at first '('
    const parenIdx = body.indexOf("(");
    if (parenIdx !== -1) {
      const prefix = body.slice(0, parenIdx).trim();
      // Bare "Поролон ST-… (dims)" / "Поролон (ST) (dims)"
      // \b ненадійний з кирилицею — лише ^Поролон + пробіл/(
      if (/^Поролон$/i.test(prefix) || /^Поролон[\s(]/u.test(body)) {
        const rebuilt = rebuildPorolonAttrStr(body.replace(/^Поролон\s*/i, ""));
        if (rebuilt) {
          // Канон templateName з дужками — як після formatter
          return { prefix: "[Поролон]", attrStr: rebuilt, qty, uom };
        }
      }
      const attrStr = extractFirstOuterParen(body.slice(parenIdx));
      return { prefix, attrStr, qty, uom };
    }
    // No parens either — just a plain name with optional qty
    return { prefix: body.trim(), attrStr: "", qty, uom };
  }
}

// Returns the full template name including emoji and brackets
function parseEmojiBracketPrefix(prefix: string): {
  emoji: string;
  bracketName: string;
  suffix: string;
} | null {
  const m = prefix.match(
    /^([\p{Emoji}\u{1F000}-\u{1FFFF}\u{2600}-\u{27FF}🪤🧩🪵🧽]*)\[([^\]]+)\](?:\s+(.+))?$/u,
  );
  if (!m) return null;
  return {
    emoji: m[1].trim(),
    bracketName: m[2].trim(),
    suffix: (m[3] ?? "").trim(),
  };
}

function buildTemplateName(
  emoji: string,
  bracketName: string,
  isBracketed: boolean,
  suffix = "",
): string {
  const base = isBracketed ? `${emoji}[${bracketName}]` : bracketName;
  return suffix ? `${base} ${suffix}` : base;
}

// Only these two templates embed the model identifier into the bracket name to avoid
// variant explosion (Тканина × model × size = thousands of variants in one template).
const EMBED_MODEL_TEMPLATES = new Set([
  'Чохол - нарізані матеріали',
  'Чохол - напівфабрикат',
  'Накладка',
]);

function embedLiteralFirstAttr(
  bracketName: string,
  attrValues: string[],
): { effectiveName: string; effectiveValues: string[] } {
  if (
    EMBED_MODEL_TEMPLATES.has(bracketName) &&
    attrValues.length > 0 &&
    !attrValues[0].includes('%')
  ) {
    return {
      effectiveName: `${bracketName} ${attrValues[0]}`,
      effectiveValues: attrValues.slice(1),
    };
  }
  return { effectiveName: bracketName, effectiveValues: attrValues };
}

function buildVariantDisplayName(
  templateName: string,
  attrValues: string[],
): string {
  if (attrValues.length === 0) return templateName;
  return `${templateName} (${attrValues.join(", ")})`;
}

// Try to parse a line as a product (main BOM output)
// Returns null if the line doesn't look like a product at all
function tryParseProduct(
  line: string,
  isFirstInSection: boolean,
): ParsedProduct | null {
  const { clean: trimmed, ifAttr } = stripIfAttrTag(line.trim());
  if (!trimmed || isSkipLine(trimmed)) return null;

  const parts = splitLineParts(trimmed);
  if (!parts) return null;

  const { prefix, attrStr, qty, uom } = parts;

  // Check for (Послуга) prefix — service, treat as component not product
  if (trimmed.startsWith("(Послуга)")) return null;

  // Bracketed product: emoji[Name] suffix?
  const bracketMatch = parseEmojiBracketPrefix(prefix);
  if (bracketMatch) {
    const { emoji, bracketName, suffix } = bracketMatch;
    const attrValues = attrStr ? parseAttrString(attrStr) : [];
    const { effectiveName, effectiveValues } = suffix
      ? { effectiveName: bracketName, effectiveValues: attrValues }
      : embedLiteralFirstAttr(bracketName, attrValues);
    const templateName = buildTemplateName(emoji, effectiveName, true, suffix);
    const attributes = valuesToAttributes(effectiveValues, bracketName);
    const variantDisplayName = buildVariantDisplayName(templateName, effectiveValues);

    // If it has qty but we already have a product, treat as component (caller checks)
    if (qty !== null && !isFirstInSection) return null;

    return {
      templateName,
      isBracketed: true,
      attributes,
      variantDisplayName,
      qty: qty ?? 1,
      ifAttr,
    };
  }

  // Plain product: Name (attrs) — no qty OR qty only if first in section
  if (attrStr && prefix && (qty === null || isFirstInSection)) {
    // Make sure prefix doesn't look like a component — allows quotes for names like Диван "Нео-3 Механізм"
    if (/^[А-ЯҐЄІЇA-Zа-яґєіїa-z0-9\s\-"«»]+$/u.test(prefix)) {
      const attrValues = parseAttrString(attrStr);
      const attributes = valuesToAttributes(attrValues, undefined, prefix);
      const variantDisplayName = buildVariantDisplayName(prefix, attrValues);
      return {
        templateName: prefix,
        isBracketed: false,
        attributes,
        variantDisplayName,
        qty: qty ?? 1,
        ifAttr,
      };
    }
  }

  return null;
}

// Try to parse a line as a component
function tryParseComponent(line: string): ParsedComponent | null {
  const trimmed = line.trim();
  if (!trimmed || isSkipLine(trimmed)) return null;

  const { clean, ifAttr } = stripIfAttrTag(trimmed);

  // (Послуга) Name - qty uom
  const serviceMatch = clean.match(
    /^\(Послуга\)\s+(.+?)\s+-\s+([\d,.]+)\s+([\S]+)\s*$/,
  );
  if (serviceMatch) {
    return {
      templateName: serviceMatch[1].trim(),
      attributes: [],
      qty: parseFloat(serviceMatch[2].replace(",", ".")),
      uom: serviceMatch[3].trim().replace(/\.$/, ""),
      isService: true,
      ifAttr,
    };
  }

  const parts = splitLineParts(clean);
  if (!parts || parts.qty === null) return null;

  const { prefix, attrStr, qty, uom } = parts;
  if (qty <= 0) return null;

  // Bracketed component: emoji[Name] suffix? (attrs) - qty uom
  const bracketMatch = parseEmojiBracketPrefix(prefix);
  if (bracketMatch) {
    const { emoji, bracketName, suffix } = bracketMatch;
    const attrValues = attrStr ? parseAttrString(attrStr) : [];
    const { effectiveName, effectiveValues } = suffix
      ? { effectiveName: bracketName, effectiveValues: attrValues }
      : embedLiteralFirstAttr(bracketName, attrValues);
    const templateName = buildTemplateName(emoji, effectiveName, true, suffix);
    return {
      templateName,
      attributes: valuesToAttributes(effectiveValues, bracketName),
      qty,
      uom,
      isService: false,
      ifAttr,
    };
  }

  // Plain component: Name - qty uom (no parens in prefix)
  if (prefix && !attrStr) {
    if (prefix.length > 1) {
      return {
        templateName: prefix,
        attributes: [],
        qty,
        uom,
        isService: false,
        ifAttr,
      };
    }
  }

  // Plain component with attributes: Name (attrs) - qty uom
  if (attrStr && prefix) {
    const attrValues = parseAttrString(attrStr);
    return {
      templateName: prefix,
      attributes: valuesToAttributes(attrValues, undefined, prefix),
      qty,
      uom,
      isService: false,
      ifAttr,
    };
  }

  return null;
}

// Lines that should always be skipped
function isSkipLine(line: string): boolean {
  const t = line.trim();
  return (
    !t ||
    t.startsWith("//") ||
    t.startsWith("<<") ||
    t.startsWith(">>") ||
    t === "або" ||
    t === "Або" ||
    t === "---" ||
    t.startsWith("Ціна") ||
    t.startsWith("#") ||
    (t.startsWith("[") && !t.includes("]")) // malformed bracket
  );
}

function parsePrice(line: string): number {
  const m = line.match(/Ціна\s+([\d,.]+)/);
  return m ? parseFloat(m[1].replace(",", ".")) : 0;
}

function parseWorkshopHeader(line: string): WorkshopInfo | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("#")) return null;

  // Standard: # Цех №1 Name - Code “OperationPrefix”
  // Two-step: first extract workshop number/name/code, then pull operation from last quoted group
  const baseMatch = trimmed.match(/^#+\s*Цех\s+№([\w-]+)\s+(.+?)\s+-\s+(\S+)/);
  if (baseMatch) {
    const number = baseMatch[1].trim();
    const name = baseMatch[2].trim();
    // Remainder after “- CODE”: find the quoted operation name
    // Quotes may be ASCII “ (U+0022), U+201C, or U+201D
    const remainder = trimmed.slice(baseMatch[0].length).trim();
    // Quotes: ASCII “ (U+0022), LEFT “ (U+201C), RIGHT “ (U+201D)
    // Use new RegExp to guarantee correct Unicode escapes regardless of source file encoding
    const Q = "[\\u201C\\u201D\\u0022]";
    const opMatch = remainder.match(new RegExp(`^${Q}(.+?)${Q}\\s*$`));
    if (opMatch) {
      return {
        fullName: `Цех №${number} ${name}`,
        operationPrefix: opMatch[1].trim(),
      };
    }
    // Fallback: operation prefix not found — use code
    return {
      fullName: `Цех №${number} ${name}`,
      operationPrefix: baseMatch[3].trim(),
    };
  }

  // Special: # ВТК (no code/operation format)
  const vtk = trimmed.match(/^#+\s*(ВТК)\s*$/);
  if (vtk) {
    return {
      fullName: "ВТК",
      operationPrefix: "ВТК",
    };
  }

  return null;
}

// Main parsing function — returns array of BomEntry
export function parseDoc(content: string): BomEntry[] {
  const lines = content.split("\n");
  const commented = lineHtmlCommentFlags(content);
  const boms: BomEntry[] = [];

  let currentWorkshop: WorkshopInfo | null = null;
  let currentProduct: ParsedProduct | null = null;
  let currentComponents: ParsedComponent[] = [];
  let currentOpIndex = 0; // which operation index we're currently filling
  let inHeader = true; // skip preamble before first workshop
  let isFirstInSection = true; // true after header/або/---
  let isNewWorkshop = false; // true when a new # Цех header was just seen

  // Built-up operations for the CURRENT bom (may span multiple workshops)
  let currentOperations: OperationEntry[] = [];

  // Start index in boms[] for BOMs in the current workshop price group.
  // Resets on the FIRST product of each new workshop (not on "або" variants).
  let workshopBomStart = 0;

  function flushBom() {
    if (!currentProduct || !currentWorkshop) return;
    if (currentOperations.length === 0) return;

    if (currentProduct.qty === 0) {
      currentProduct = null;
      currentComponents = [];
      currentOperations = [];
      currentOpIndex = 0;
      isFirstInSection = true;
      return;
    }

    const components: ComponentEntry[] = currentComponents.map((c) => ({
      templateName: c.templateName,
      attributes: c.attributes,
      qty: c.qty,
      uom: c.uom,
      operationIndex: (c as any)._opIndex ?? 0,
      isService: c.isService || undefined,
      ifAttr: c.ifAttr,
    }));

    boms.push({
      product: {
        templateName: currentProduct.templateName,
        attributes: currentProduct.attributes,
        variantDisplayName: currentProduct.variantDisplayName,
        qty: currentProduct.qty,
        ifAttr: currentProduct.ifAttr,
      },
      operations: [...currentOperations],
      components,
    });

    currentProduct = null;
    currentComponents = [];
    currentOperations = [];
    currentOpIndex = 0;
    isFirstInSection = true;
  }

  function flushVariant() {
    flushBom();
  }

  for (let i = 0; i < lines.length; i++) {
    if (commented[i]) continue;
    const line = lines[i];
    const trimmed = line.trim();

    // Workshop header
    if (trimmed.startsWith("#")) {
      const wh = parseWorkshopHeader(trimmed);
      if (wh) {
        // New workshop — if we transition to a new BOM workshop (not just extending),
        // mark the start of this workshop's BOMs for price back-propagation.
        // Defer flush: wait to see if first content is a product (new BOM) or
        // a component (extends current BOM, e.g. Цех №10, ВТК).
        currentWorkshop = wh;
        isFirstInSection = true;
        isNewWorkshop = true;
        inHeader = false;
        continue;
      }
      // Non-workshop # heading (e.g. "# АТРИБУТИ") — skip
      continue;
    }

    if (inHeader) continue;
    if (!currentWorkshop) continue;

    // Skip comments and empty lines
    if (
      !trimmed ||
      trimmed.startsWith("//") ||
      trimmed.startsWith("<<") ||
      trimmed.startsWith(">>")
    )
      continue;

    // Price line — apply to last operation of current BOM AND all previously
    // flushed BOMs in this workshop section (для "або" variants sharing one price)
    if (trimmed.startsWith("Ціна")) {
      const price = parsePrice(trimmed);
      if (currentOperations.length > 0) {
        currentOperations[currentOperations.length - 1].priceRate = price;
      }
      for (let bi = workshopBomStart; bi < boms.length; bi++) {
        const ops = boms[bi].operations;
        if (ops.length > 0) ops[ops.length - 1].priceRate = price;
      }
      continue;
    }

    // "або" separator — flush current BOM, start new variant in same workshop
    if (trimmed === "або" || trimmed === "Або") {
      flushVariant();
      isFirstInSection = true;
      continue;
    }

    // "---" separator — flush, new section in same workshop
    if (trimmed === "---") {
      flushVariant();
      isFirstInSection = true;
      continue;
    }

    // If isFirstInSection, try to decide: is this line a main product or a component?
    // NOTE: (Послуга) lines are NOT handled early — they fall through to isFirstInSection
    // so that ВТК-style workshops get their own operation added first.
    if (isFirstInSection) {
      const asProd = tryParseProduct(trimmed, true);
      if (asProd) {
        // This starts a new BOM: flush any accumulated state
        flushBom();
        if (isNewWorkshop) {
          workshopBomStart = boms.length; // new workshop → reset price group window
          isNewWorkshop = false;
        }
        currentProduct = asProd;
        currentOpIndex = 0;
        // Add the first operation for this workshop
        currentOperations.push({
          name: `${currentWorkshop.operationPrefix} ${asProd.variantDisplayName}`,
          workcenterName: currentWorkshop.fullName,
          priceRate: 0,
        });
        isFirstInSection = false;
        continue;
      }

      // Not a product → this workshop EXTENDS the previous BOM (e.g. Цех №10, ВТК)
      if (currentProduct !== null) {
        // Add a new operation for this workshop
        currentOpIndex = currentOperations.length;
        currentOperations.push({
          name: `${currentWorkshop.operationPrefix} ${currentProduct.variantDisplayName}`,
          workcenterName: currentWorkshop.fullName,
          priceRate: 0,
        });
        isFirstInSection = false;
        // Fall through to component parsing below
      }
    }

    // Try as component
    const comp = tryParseComponent(trimmed);
    if (comp) {
      (comp as any)._opIndex = currentOpIndex;
      currentComponents.push(comp);
      continue;
    }

    // A second (or later) bracketed product within the same цех section with no qty
    // and no explicit separator (або/---). Flush the current BOM and start a new one
    // under the same workshop. workshopBomStart is NOT reset so Ціна applies to all.
    if (currentProduct !== null && currentWorkshop !== null) {
      const asProd = tryParseProduct(trimmed, false);
      if (asProd && asProd.isBracketed) {
        flushBom();
        currentProduct = asProd;
        currentOpIndex = 0;
        isFirstInSection = false;
        currentOperations.push({
          name: `${currentWorkshop.operationPrefix} ${asProd.variantDisplayName}`,
          workcenterName: currentWorkshop.fullName,
          priceRate: 0,
        });
        continue;
      }
    }
  }

  // Flush last accumulated BOM
  if (currentProduct && currentProduct.qty !== 0) {
    const components: ComponentEntry[] = currentComponents.map((c) => ({
      templateName: c.templateName,
      attributes: c.attributes,
      qty: c.qty,
      uom: c.uom,
      operationIndex: (c as any)._opIndex ?? 0,
      isService: c.isService || undefined,
      ifAttr: c.ifAttr,
    }));
    boms.push({
      product: {
        templateName: currentProduct.templateName,
        attributes: currentProduct.attributes,
        variantDisplayName: currentProduct.variantDisplayName,
        qty: currentProduct.qty,
        ifAttr: currentProduct.ifAttr,
      },
      operations: currentOperations,
      components,
    });
  }

  return boms;
}
