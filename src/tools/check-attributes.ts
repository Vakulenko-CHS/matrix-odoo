import * as fs from "fs";
import * as path from "path";
import { SOFA_START_RE, stripSpecComment } from "./specLine";

interface Attribute {
  paramName: string; // e.g. "%Тканина%"
  order: number; // 1-based position in global list
  active: boolean;
  workshops: string[]; // e.g. ["7", "8", "9-1", "9"]
}

interface ParsedParams {
  productId: string; // first token before any comma or %
  attributes: string[]; // list of "%Attr%" tokens
}

// ─── Document section header ──────────────────────────────────────────────
const SECTION_HEADER_RE = /^#+\s*(Цех\s*№[\d\-]+)/u;
const ATTR_LIST_SECTION_RE =
  /# СПИСОК АТРИБУТІВ[^\n]*\n([\s\S]*?)(?=\n##|\n#[^#]|$)/;
/** "Name", ✅ | "Name" ❌ | "Name", | "Name"  — missing mark = ❌ */
const ATTR_LIST_ITEM_RE = /"([^"]+)",?\s*(✅|❌)?\uFE0F?/gu;
const ATTR_LIST_LINE_RE =
  /^(\s*"[^"]+")(,?)(\s*)((?:✅|❌)\uFE0F?)?(\s*)$/u;

/** Same «## Інструкції» block in every spec. Source of truth — do not parse from the file. */
export const ATTR_WORKSHOP_MAP: Record<string, readonly string[]> = {
  "%Тканина%": ["7", "8", "9-1", "9"],
  "%Диван Пружинний Блок%": ["5", "6", "9"],
  "%Диван Наповнювач Подушек%": ["9-1", "9"],
  "%Диван Розмір Бильця%": ["1", "2-1", "4-1", "5", "6", "7", "8", "9"],
  "%Колір Ламінату%": ["3-2", "4-2", "6", "9"],
  "%Дно Каркасу%": ["2-2", "4-2", "6", "9"],
};

function matchAttrListSection(content: string): RegExpMatchArray | null {
  return content.match(ATTR_LIST_SECTION_RE);
}

/**
 * Missing emoji in the list = ❌. Rewrite lines so every entry has ✅ or ❌.
 */
export function normalizeAttributeListEmojis(content: string): {
  content: string;
  fixes: string[];
} {
  const listMatch = matchAttrListSection(content);
  if (!listMatch || listMatch.index === undefined) {
    return { content, fixes: [] };
  }

  const block = listMatch[1];
  const fixes: string[] = [];
  const newBlock = block
    .split("\n")
    .map((line) => {
      const m = ATTR_LIST_LINE_RE.exec(line);
      if (!m) return line;
      if (m[4]) return line; // already ✅ or ❌
      // Quoted attr name present, mark missing → ❌
      const space = m[3].length > 0 ? m[3] : " ";
      const fixed = `${m[1]}${m[2]}${space}❌${m[5]}`;
      const name = /"([^"]+)"/.exec(m[1])?.[1] ?? m[1].trim();
      fixes.push(`[FIX] список атрибутів: "${name}" без позначки → ❌`);
      return fixed;
    })
    .join("\n");

  if (fixes.length === 0) return { content, fixes };

  const start = listMatch.index + listMatch[0].length - block.length;
  const next =
    content.slice(0, start) + newBlock + content.slice(start + block.length);
  return { content: next, fixes };
}

export function attributeListNeedsEmojiFix(content: string): boolean {
  const listMatch = matchAttrListSection(content);
  if (!listMatch) return false;
  return listMatch[1].split("\n").some((line) => {
    const m = ATTR_LIST_LINE_RE.exec(line);
    return Boolean(m && !m[4]);
  });
}

// ─── Step 1: Parse attribute rules from document ──────────────────────────

function parseAttributeRules(content: string): Attribute[] {
  const attrs: Attribute[] = [];

  // 1a. Parse СПИСОК АТРИБУТІВ section for order and active status
  const listMatch = matchAttrListSection(content);
  if (!listMatch) throw new Error('Не знайдено "# СПИСОК АТРИБУТІВ" у файлі');

  const listBlock = listMatch[1];
  const itemRe = new RegExp(ATTR_LIST_ITEM_RE.source, "gu");
  let m: RegExpExecArray | null;
  let order = 0;
  while ((m = itemRe.exec(listBlock)) !== null) {
    order++;
    const paramName = `%${m[1]}%`;
    attrs.push({
      paramName,
      order,
      // Missing mark = inactive (❌)
      active: m[2] === "✅",
      workshops: [...(ATTR_WORKSHOP_MAP[paramName] ?? [])],
    });
  }

  // Extra attrs (not in the hardcoded map): fill workshops from «Інструкції» if present.
  const instrMatch = content.match(
    /## Інструкції[^\n]*\n([\s\S]*?)(?=\n# |\n## |$)/,
  );
  if (!instrMatch) return attrs;

  const instrBlock = instrMatch[1];
  const workshopRe = /Впливає на цехи:\s*\(([^)]+)\)/u;
  const entries = instrBlock.split(/(?=^\d+\.\s+%)/mu).filter((e) => e.trim());
  for (const entry of entries) {
    const nameMatch = /^\d+\.\s+%([^%]+)%/u.exec(entry);
    if (!nameMatch) continue;
    const paramName = `%${nameMatch[1]}%`;
    const attr = attrs.find((a) => a.paramName === paramName);
    if (!attr || attr.workshops.length > 0) continue;
    const wMatch = workshopRe.exec(entry);
    attr.workshops = wMatch ? wMatch[1].split(",").map((w) => w.trim()) : [];
  }

  return attrs;
}

// ─── Step 2: Parse product line params ────────────────────────────────────

const EMOJI_RE = /^[🪵🧩🪤🧽]+/u;
const BRACKET_PREFIX_RE = /^\[.+\](\s*\(|\s+[^(%])/u;
const SOFA_PREFIX_RE = SOFA_START_RE;

function isProductLine(line: string): boolean {
  const t = line.trim();
  return (
    (EMOJI_RE.test(t) && t.includes("[")) ||
    BRACKET_PREFIX_RE.test(t) ||
    SOFA_PREFIX_RE.test(t)
  );
}

function stripLineComment(line: string): string {
  return stripSpecComment(line);
}

/**
 * Find the first `(` after the `]`, then find its matching `)`.
 * Returns [start, end] indices of the paren content (exclusive).
 */
function findParamBounds(line: string): { open: number; close: number } | null {
  const nameEnd = line.lastIndexOf("]");
  if (nameEnd < 0) {
    // Sofa final product: "Диван Угол Леон-Люкс 200 Колеса (%Тканина%, ...)"
    const open = line.indexOf("(");
    if (open < 0) return null;
    let depth = 1;
    let i = open + 1;
    while (i < line.length && depth > 0) {
      if (line[i] === "(") depth++;
      if (line[i] === ")") depth--;
      i++;
    }
    return { open, close: i - 1 };
  }
  const open = line.indexOf("(", nameEnd);
  if (open < 0) return null;
  let depth = 1;
  let i = open + 1;
  while (i < line.length && depth > 0) {
    if (line[i] === "(") depth++;
    if (line[i] === ")") depth--;
    i++;
  }
  return { open, close: i - 1 };
}

function parseParams(line: string): ParsedParams | null {
  const clean = stripLineComment(line);
  const bounds = findParamBounds(clean);
  if (!bounds) return null;

  const inner = clean.slice(bounds.open + 1, bounds.close);
  const tokens = inner.split(",").map((t) => t.trim());

  // If first token is already an %attr%, there's no plain productId
  const firstIsAttr = (tokens[0] ?? "").startsWith("%");
  const productId = firstIsAttr ? "" : (tokens[0] ?? "");
  const attrStart = firstIsAttr ? 0 : 1;
  const attributes = tokens.slice(attrStart).filter((t) => t.startsWith("%"));

  return { productId, attributes };
}

const HAS_QTY_RE =
  /[-]\s*[\d.,]*\s*(?:шт|кг|m|m²|m³)|[-]\s*[\d.,]+\s*$/u;
const QTY_TAIL_RE = /(\s+-\s*[\d.,]+\s*\S+)\s*$/u;

function splitComment(line: string): { head: string; comment: string } {
  const commentIdx = line.indexOf("//");
  if (commentIdx < 0) return { head: line.trim(), comment: "" };
  return {
    head: line.slice(0, commentIdx).trim(),
    comment: " " + line.slice(commentIdx).trim(),
  };
}

/** Insert or replace `(…)` params. Works when the line has no parens yet. */
export function replaceParamsInner(
  originalLine: string,
  newParamsContent: string,
): string {
  const { head, comment } = splitComment(originalLine);
  const bounds = findParamBounds(head);
  if (bounds) {
    return (
      head.slice(0, bounds.open + 1) +
      newParamsContent +
      head.slice(bounds.close) +
      comment
    );
  }
  const qty = head.match(QTY_TAIL_RE);
  if (qty && qty.index != null) {
    return `${head.slice(0, qty.index)} (${newParamsContent})${qty[1]}${comment}`;
  }
  return `${head} (${newParamsContent})${comment}`;
}

function rebuildLine(originalLine: string, newParamsContent: string): string {
  return replaceParamsInner(originalLine, newParamsContent);
}

function productType(line: string): string {
  const s = stripLineComment(line.trim());
  const bracketEnd = s.indexOf("]");
  if (bracketEnd < 0) return "";
  return s.slice(0, bracketEnd + 1).trim();
}

/** Model / product id. Pattern A `(Model, %Attr%)` or Pattern B `] Model (%Attr%)`. */
function productId(line: string): string {
  const noQty = stripLineComment(line.trim()).replace(
    /\s*-\s*[\d.,]+\s*\S+\s*$/u,
    "",
  ).trim();
  const after = noQty.match(/\]\s+(.+)$/);
  if (after) {
    const rest = after[1].trim();
    if (rest.startsWith("(")) {
      const inner = rest.slice(1);
      const sepIdx = inner.search(/[,%]/);
      const content =
        sepIdx >= 0
          ? inner.slice(0, sepIdx).trim()
          : inner.replace(/\).*/, "").trim();
      if (content.startsWith("%")) return "";
      return content;
    }
    const paren = rest.indexOf("(");
    const model = (paren < 0 ? rest : rest.slice(0, paren)).trim();
    if (model && !model.startsWith("%")) return model;
  }
  const parenOpen = noQty.indexOf("(");
  if (parenOpen < 0) return "";
  const inner = noQty.slice(parenOpen + 1);
  const sepIdx = inner.search(/[,%]/);
  const content =
    sepIdx >= 0
      ? inner.slice(0, sepIdx).trim()
      : inner.replace(/\).*/, "").trim();
  if (content.startsWith("%")) return "";
  return content;
}

function productKey(line: string): string | null {
  const t = productType(line);
  const id = productId(line);
  if (!t || !id) return null;
  return `${t}::${id}`;
}

function paramsInner(line: string): string {
  const clean = stripLineComment(line.trim());
  const bounds = findParamBounds(clean);
  if (!bounds) return "";
  return clean.slice(bounds.open + 1, bounds.close).replace(/\s+/g, " ").trim();
}

function attrTokens(inner: string): string[] {
  if (!inner) return [];
  return inner
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.startsWith("%"));
}

/** Copy `%Attr%` tokens onto a consumer line, keep Pattern A model in parens. */
export function applyAttrsToLine(line: string, attrs: string[]): string {
  const inner = paramsInner(line);
  const tokens = inner
    ? inner.split(",").map((t) => t.trim()).filter(Boolean)
    : [];
  const modelInParens =
    tokens[0] && !tokens[0].startsWith("%") ? tokens[0] : "";
  const newInner = modelInParens
    ? [modelInParens, ...attrs].join(", ")
    : attrs.join(", ");
  return replaceParamsInner(line, newInner);
}

// ─── Step 3: Workshop number extraction ───────────────────────────────────

function extractWorkshopNum(header: string): string | null {
  const m = /Цех\s*№([\d\-]+)/u.exec(header);
  return m ? m[1] : null;
}

// ─── Step 4: Compute required attributes for a product output ─────────────

function requiredAttrsFor(
  workshopNum: string,
  outputLine: string,
  allAttrs: Attribute[],
): Attribute[] {
  const required: Attribute[] = [];

  for (const attr of allAttrs) {
    if (attr.workshops.includes(workshopNum)) {
      required.push(attr);
    }
  }

  // Special: Ламінат in Цех №3-1 always has %Колір Ламінату% regardless of global active status
  if (workshopNum === "3-1" && outputLine.includes("[Ламінат")) {
    const nakl = allAttrs.find((a) => a.paramName === "%Колір Ламінату%");
    if (nakl && !required.some((r) => r.paramName === "%Колір Ламінату%")) {
      required.push(nakl);
    }
  }

  // Raw frame wood (нарізана деревина) doesn't vary by armrest size
  if (outputLine.includes("[Каркас - нарізана деревина]")) {
    const idx = required.findIndex(
      (a) => a.paramName === "%Диван Розмір Бильця%",
    );
    if (idx >= 0) required.splice(idx, 1);
  }

  // Sort by global order
  required.sort((a, b) => a.order - b.order);
  return required;
}

function tokenKey(token: string): string {
  return token.replace(/❌%$/, "%");
}

function requiredTokensFor(
  workshopNum: string,
  outputLine: string,
  allAttrs: Attribute[],
): string[] {
  const required = requiredAttrsFor(workshopNum, outputLine, allAttrs);
  const isWorkshop9 = workshopNum === "9";
  return isWorkshop9
    ? required.filter((a) => a.active).map((a) => a.paramName)
    : required.map((a) =>
        a.active ? a.paramName : a.paramName.replace(/%$/, "❌%"),
      );
}

// ─── Step 5: Main verification and fix ────────────────────────────────────

interface LineChange {
  lineIdx: number;
  oldLine: string;
  newLine: string;
}

interface ProductRename {
  // Used for cascading input updates
  baseKey: string; // e.g. "🪤[Каркас - напівфабрикат] (Д.Леон-Люкс Колеса"
  oldParams: string; // e.g. "Д.Леон-Люкс Колеса, %Дно Каркасу%, %Колір Ламінату%"
  newParams: string; // e.g. "Д.Леон-Люкс Колеса, %Колір Ламінату%, %Дно Каркасу%"
}

function buildBaseKey(line: string): string {
  const clean = stripLineComment(line.trim());
  const bounds = findParamBounds(clean);
  if (!bounds) return clean;
  const inner = clean.slice(bounds.open + 1, bounds.close);
  // Base key = everything up to first ',' or '%' in the inner params
  const firstSep = inner.search(/[,%]/);
  const productId =
    firstSep >= 0 ? inner.slice(0, firstSep).trim() : inner.trim();
  // prefix = everything before the opening '('
  const prefix = clean.slice(0, bounds.open);
  return `${prefix}(${productId}`;
}

function verify(
  fileLines: string[],
  allAttrs: Attribute[],
): { outputChanges: LineChange[]; renames: ProductRename[]; issues: string[] } {
  const outputChanges: LineChange[] = [];
  const renames: ProductRename[] = [];
  const issues: string[] = [];

  let currentWorkshop: string | null = null;
  let bomStarted = false; // true once we've seen an output line in current section

  for (let i = 0; i < fileLines.length; i++) {
    const raw = fileLines[i];
    const trimmed = raw.trim();

    // New section?
    const hMatch = SECTION_HEADER_RE.exec(trimmed);
    if (hMatch) {
      currentWorkshop = extractWorkshopNum(hMatch[1]);
      bomStarted = false;
      continue;
    }

    if (!currentWorkshop) continue;
    if (!isProductLine(trimmed)) continue;

    const cleanLine = stripLineComment(trimmed);

    // Check for unknown %...% attribute references on ALL product lines (outputs and inputs)
    const paramCheck = parseParams(cleanLine);
    if (paramCheck) {
      for (const attr of paramCheck.attributes) {
        const normalized = attr.replace(/❌%$/, "%");
        if (!allAttrs.some((a) => a.paramName === normalized)) {
          const msg = `[UNKNOWN-ATTR] рядок ${i + 1}: невідомий атрибут ${attr} — "${trimmed.slice(0, 80)}"`;
          console.log(`  ${msg}`);
          issues.push(msg);
        }
      }
    }

    // Is it an input line (has "- N шт." or "- шт." or "- N кг" etc.)?
    const hasQty = HAS_QTY_RE.test(cleanLine);
    if (hasQty) continue; // skip inputs — handled via cascading

    // It's an output line
    bomStarted = true;

    const reqTokens = requiredTokensFor(currentWorkshop, cleanLine, allAttrs);
    const parsed = parseParams(cleanLine);

    if (!parsed) {
      if (reqTokens.length === 0) continue;
      const newParamsContent = reqTokens.join(", ");
      const newLine = rebuildLine(raw, newParamsContent);
      if (newLine === raw) continue;
      outputChanges.push({ lineIdx: i, oldLine: raw, newLine });
      const msg =
        `[FIX] рядок ${i + 1}: Цех №${currentWorkshop}: немає атрибутів ` +
        `→ "${newParamsContent}"`;
      console.log(`  ${msg}`);
      issues.push(msg);
      renames.push({
        baseKey: buildBaseKey(cleanLine),
        oldParams: "",
        newParams: newParamsContent,
      });
      continue;
    }

    const newParamsContent = parsed.productId
      ? [parsed.productId, ...reqTokens].join(", ")
      : reqTokens.join(", ");

    const bounds = findParamBounds(cleanLine);
    if (!bounds) continue;
    const oldParamsContent = cleanLine.slice(bounds.open + 1, bounds.close);
    const oldNorm = oldParamsContent.replace(/\s+/g, " ").trim();
    const newNorm = newParamsContent.replace(/\s+/g, " ").trim();
    if (oldNorm === newNorm) continue;

    const have = new Set(parsed.attributes.map(tokenKey));
    const missing = reqTokens.filter((t) => !have.has(tokenKey(t)));
    const msg = missing.length
      ? `[FIX] рядок ${i + 1}: Цех №${currentWorkshop}: немає ${missing.join(", ")} → "${newParamsContent}"`
      : `[FIX] рядок ${i + 1}: Цех №${currentWorkshop}: "${oldParamsContent}" → "${newParamsContent}"`;

    const newLine = rebuildLine(raw, newParamsContent);
    outputChanges.push({ lineIdx: i, oldLine: raw, newLine });
    console.log(`  ${msg}`);
    issues.push(msg);

    renames.push({
      baseKey: buildBaseKey(cleanLine),
      oldParams: oldParamsContent,
      newParams: newParamsContent,
    });
  }

  return { outputChanges, renames, issues };
}

// ─── Step 6: Cascade input updates ────────────────────────────────────────

function cascadeInputUpdates(
  fileLines: string[],
  renames: ProductRename[],
  alreadyChanged: Set<number>,
): { changes: LineChange[]; issues: string[] } {
  const inputChanges: LineChange[] = [];
  const issues: string[] = [];

  for (let i = 0; i < fileLines.length; i++) {
    if (alreadyChanged.has(i)) continue;

    const raw = fileLines[i];
    const trimmed = raw.trim();
    if (!isProductLine(trimmed)) continue;
    if (!trimmed.includes("%")) {
      // Could be a zero-attribute input that needs updating after output rename
      // Check if any rename baseKey matches this line
    }

    const cleanLine = stripLineComment(trimmed);
    const hasQty = HAS_QTY_RE.test(cleanLine);
    if (!hasQty) continue; // only inputs

    for (const rename of renames) {
      // Check if this input line's base matches the renamed product
      if (!cleanLine.startsWith(rename.baseKey)) continue;

      // Verify old params match
      const bounds = findParamBounds(cleanLine);
      if (!bounds) {
        if (rename.oldParams.replace(/\s+/g, " ").trim() !== "") continue;
        const newLine = rebuildLine(raw, rename.newParams);
        if (newLine === raw) continue;
        console.log(
          `  [CASCADE] рядок ${i + 1}: немає атрибутів → "${rename.newParams}"`,
        );
        issues.push(
          `[CASCADE] рядок ${i + 1}: немає атрибутів → "${rename.newParams}"`,
        );
        inputChanges.push({ lineIdx: i, oldLine: raw, newLine });
        break;
      }
      const currentParams = cleanLine.slice(bounds.open + 1, bounds.close);
      const currentNorm = currentParams.replace(/\s+/g, " ").trim();
      const oldNorm = rename.oldParams.replace(/\s+/g, " ").trim();

      if (currentNorm !== oldNorm) continue;

      const newLine = rebuildLine(raw, rename.newParams);
      if (newLine === raw) continue;

      console.log(
        `  [CASCADE] рядок ${i + 1}: "${currentParams}" → "${rename.newParams}"`,
      );
      issues.push(
        `[CASCADE] рядок ${i + 1}: "${currentParams}" → "${rename.newParams}"`,
      );
      inputChanges.push({ lineIdx: i, oldLine: raw, newLine });
      break;
    }
  }

  return { changes: inputChanges, issues };
}

type Produced = { lineIdx: number; attrs: string[] };

/** Copy attrs from nearest producer above onto consumers of the same type+id. */
function syncConsumerAttrs(
  fileLines: string[],
  skip: Set<number>,
): { changes: LineChange[]; issues: string[] } {
  const produced: Produced[] = [];
  const producedKeys: string[] = [];
  const changes: LineChange[] = [];
  const issues: string[] = [];

  for (let i = 0; i < fileLines.length; i++) {
    const raw = fileLines[i];
    const trimmed = raw.trim();
    if (!isProductLine(trimmed)) continue;
    const clean = stripLineComment(trimmed);
    const key = productKey(clean);
    if (!key) continue;
    if (!HAS_QTY_RE.test(clean)) {
      produced.push({ lineIdx: i, attrs: attrTokens(paramsInner(clean)) });
      producedKeys.push(key);
    }
  }

  for (let i = 0; i < fileLines.length; i++) {
    if (skip.has(i)) continue;
    const raw = fileLines[i];
    const trimmed = raw.trim();
    if (!isProductLine(trimmed)) continue;
    const clean = stripLineComment(trimmed);
    if (!HAS_QTY_RE.test(clean)) continue;
    const key = productKey(clean);
    if (!key) continue;

    let src: Produced | null = null;
    for (let p = 0; p < produced.length; p++) {
      if (producedKeys[p] !== key) continue;
      if (produced[p].lineIdx >= i) continue;
      if (!src || produced[p].lineIdx > src.lineIdx) src = produced[p];
    }
    if (!src || src.attrs.length === 0) continue;

    const have = attrTokens(paramsInner(clean));
    if (have.length > 0) continue;
    if (src.attrs.length === 0) continue;

    const newLine = applyAttrsToLine(raw, src.attrs);
    if (newLine === raw) continue;

    const msg =
      `[ATTR-CHAIN] рядок ${i + 1}: немає атрибутів, у виробництві ` +
      `ряд. ${src.lineIdx + 1}: ${src.attrs.join(", ")}`;
    console.log(`  ${msg}`);
    issues.push(msg);
    changes.push({ lineIdx: i, oldLine: raw, newLine });
  }

  return { changes, issues };
}

// ─── Apply all changes ────────────────────────────────────────────────────

function applyChanges(fileLines: string[], changes: LineChange[]): string[] {
  const result = [...fileLines];
  for (const c of changes) {
    result[c.lineIdx] = c.newLine;
  }
  return result;
}

// ─── Library export ───────────────────────────────────────────────────────

/**
 * Fingerprint of ✅/❌ flags in «# СПИСОК АТРИБУТІВ».
 * Missing mark counts as ❌ (same as inactive).
 */
export function attributeFlagsSignature(content: string): string | null {
  const listMatch = matchAttrListSection(content);
  if (!listMatch) return null;
  const itemRe = new RegExp(ATTR_LIST_ITEM_RE.source, "gu");
  const parts: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(listMatch[1])) !== null) {
    parts.push(`${m[1]}=${m[2] === "✅" ? "✅" : "❌"}`);
  }
  return parts.length > 0 ? parts.join("|") : null;
}

/**
 * Run attribute checks on in-memory content.
 * Returns the fixed content and list of issues found.
 */
export function runAttributeCheck(
  content: string,
  fileName: string,
): { content: string; issues: string[] } {
  console.log(`\nАтрибути: ${fileName}`);

  const listNorm = normalizeAttributeListEmojis(content);
  for (const fix of listNorm.fixes) {
    console.log(`  ${fix}`);
  }

  const fileLines = listNorm.content.split("\n");
  const allAttrs = parseAttributeRules(listNorm.content);
  for (const a of allAttrs) {
    console.log(
      `  ${a.order}. ${a.paramName} [${a.active ? "✅" : "❌"}] → цехи: ${a.workshops.join(", ") || "—"}`,
    );
  }

  const {
    outputChanges,
    renames,
    issues: attrIssues,
  } = verify(fileLines, allAttrs);
  const changedOutputIdxs = new Set(outputChanges.map((c) => c.lineIdx));
  let workingLines = applyChanges(fileLines, outputChanges);
  const { changes: inputChanges, issues: cascadeIssues } = cascadeInputUpdates(
    workingLines,
    renames,
    changedOutputIdxs,
  );
  workingLines = applyChanges(workingLines, inputChanges);
  const skipped = new Set([
    ...changedOutputIdxs,
    ...inputChanges.map((c) => c.lineIdx),
  ]);
  const { changes: chainChanges, issues: chainIssues } = syncConsumerAttrs(
    workingLines,
    skipped,
  );
  workingLines = applyChanges(workingLines, chainChanges);

  const totalChanges =
    listNorm.fixes.length +
    outputChanges.length +
    inputChanges.length +
    chainChanges.length;
  if (totalChanges === 0) {
    console.log("  ✅ Атрибути в порядку, змін немає.");
  } else {
    console.log(
      `  Змін список: ${listNorm.fixes.length}, output: ${outputChanges.length}, input (каскад): ${inputChanges.length}, ланцюг: ${chainChanges.length}`,
    );
  }

  return {
    content: workingLines.join("\n"),
    issues: [...listNorm.fixes, ...attrIssues, ...cascadeIssues, ...chainIssues],
  };
}

// ─── Entry point ──────────────────────────────────────────────────────────

function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error("Usage: ts-node check-attributes.ts <path-to-md-file>");
    process.exit(1);
  }

  const absPath = path.resolve(filePath);
  if (!fs.existsSync(absPath)) {
    console.error(`Файл не знайдено: ${absPath}`);
    process.exit(1);
  }

  const original = fs.readFileSync(absPath, "utf-8");
  const fileName = path.basename(absPath);
  const { content: fixed } = runAttributeCheck(original, fileName);

  if (fixed === original) return;

  const bakPath = absPath + ".bak";
  if (!fs.existsSync(bakPath)) {
    fs.writeFileSync(bakPath, original, "utf-8");
    console.log(`Оригінал збережено: ${path.basename(bakPath)}`);
  }
  fs.writeFileSync(absPath, fixed, "utf-8");
  console.log(`✅ Файл оновлено.`);
}

if (typeof require !== "undefined" && require.main === module) {
  main();
}
