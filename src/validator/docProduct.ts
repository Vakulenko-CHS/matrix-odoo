import { token_set_ratio } from "fuzzball";
import { normNameKey } from "./nameKey";

const PRODUCT_KIND = /^(диван|ліжко)\s+/iu;
const SKIP_LINE =
  /^(#|\/\/|<!--|<<|\[|цехи\s*:|синтаксис|атрибут|список атрибут)/iu;

/** Furniture title at file start (attrs stripped) + short model id. */
export type DocProductNames = {
  /** e.g. "Диван Угол Елегант БН" */
  full: string;
  /** e.g. "Угол Елегант БН" (без Диван/Ліжко) */
  short: string;
  /** full + short, unique */
  variants: string[];
};

/** First real product line → name without `(…%…%)`. */
export function extractDocProductNames(
  content: string,
): DocProductNames | null {
  for (const raw of content.split("\n")) {
    const t = raw.trim();
    if (!t || SKIP_LINE.test(t)) continue;
    if (t.startsWith('"') && /✅|❌/.test(t)) continue;

    const parenIdx = t.indexOf("(");
    const namePart = (parenIdx >= 0 ? t.slice(0, parenIdx) : t).trim();
    if (namePart.length < 2) continue;

    const full = namePart.replace(/\s+/g, " ").trim();
    const short = full.replace(PRODUCT_KIND, "").trim() || full;
    const variants = [...new Set([full, short].filter(Boolean))];
    return { full, short, variants };
  }
  return null;
}

export function isExactDocProductId(
  id: string,
  doc: DocProductNames,
): boolean {
  const k = normNameKey(id);
  if (!k) return false;
  return doc.variants.some((v) => normNameKey(v) === k);
}

/** Exact hit, or fuzzball against doc title variants (typos / short forms). */
export function isDocProductId(
  id: string,
  doc: DocProductNames,
  fuzzyCutoff = 82,
): boolean {
  if (isExactDocProductId(id, doc)) return true;
  const q = normNameKey(id);
  if (q.length < 4) return false;
  for (const v of doc.variants) {
    if (token_set_ratio(q, normNameKey(v)) >= fuzzyCutoff) return true;
  }
  return false;
}

/** True if replace-all(find→replacement) would rewrite the file title / model id. */
export function renameCorruptsDocProduct(
  find: string,
  replacement: string,
  doc: DocProductNames,
): boolean {
  if (!find || find === replacement) return false;
  if (!isExactDocProductId(find, doc)) return false;
  return !isExactDocProductId(replacement, doc);
}

/** Inject file-title product into known-name set/labels for catalog + fuzzy. */
export function injectDocProductNames<
  T extends { set: Set<string>; labels: string[] },
>(catalog: T, content: string): T {
  const doc = extractDocProductNames(content);
  if (!doc) return catalog;
  const set = new Set(catalog.set);
  const labels = [...catalog.labels];
  for (const v of doc.variants) {
    const key = v.toLowerCase();
    if (set.has(key)) continue;
    set.add(key);
    labels.push(v);
  }
  return { ...catalog, set, labels };
}

const FINISHED_GOOD_RE = /^(диван|ліжко)\s+/iu;

/** Name part of a finished-good line (attrs stripped). */
export function finishedGoodName(line: string): string | null {
  const t = line.trim();
  if (!FINISHED_GOOD_RE.test(t)) return null;
  const parenIdx = t.indexOf("(");
  return (parenIdx >= 0 ? t.slice(0, parenIdx) : t).trim() || null;
}

/**
 * Does this line refer to chain subject `id` (optional bracket type)?
 * Sofa/bed title only matches when id === full title — not short model id inside it.
 */
export function lineMentionsChainSubject(
  line: string,
  id: string,
  bracketType?: string | null,
): boolean {
  const t = line.trim();
  if (!id || !t.includes(id)) return false;

  if (FINISHED_GOOD_RE.test(t)) {
    const name = finishedGoodName(t);
    return Boolean(name && name === id);
  }

  if (bracketType) {
    const bare = bracketType.replace(/^[🪵🧩🪤🧽\s]+/u, "").trim();
    if (bare && !t.includes(bare) && !t.includes(bracketType)) return false;
  }
  return true;
}

/** Bracket type from CHAIN message: `([Подушка])` / `(🧩[…])`. */
export function chainBracketFromMessage(message: string): string | null {
  return (
    message.match(/\(([🪵🧩🪤🧽]*\[[^\]]+\])\)/u)?.[1] ??
    message.match(/\((\[[^\]]+\])\)/u)?.[1] ??
    null
  );
}
