import { extract, token_set_ratio, token_sort_ratio } from "fuzzball";
import { normNameKey } from "./nameKey";

export type FuzzyCanonHit = { canon: string; score: number };

const CUTOFF = 70;
const UNIQUE_GAP = 8;
const LIMIT = 8;
const HEAD_CUTOFF = 58;

/** Model tokens: h30, 80x190, 113.01, 312. */
export function extractCodes(s: string): string[] {
  const t = s
    .toLowerCase()
    .replace(/[×х]/gu, "x")
    .replace(/,/g, ".");
  const codes = new Set<string>();
  for (const m of t.matchAll(/[hн]\s*\d+/g)) {
    codes.add(`h${m[0].replace(/[hн\s]/g, "")}`);
  }
  for (const m of t.matchAll(/\d+x\d+/g)) codes.add(m[0]);
  for (const m of t.matchAll(/\d+\.\d+/g)) codes.add(m[0]);
  for (const m of t.matchAll(/\d{2,4}/g)) {
    const span = m[0];
    const i = m.index ?? 0;
    const around = t.slice(Math.max(0, i - 1), i + span.length + 1);
    if (around.includes("x") || around.includes(".")) continue;
    codes.add(span);
  }
  return [...codes];
}

function codesOverlap(queryCodes: string[], choiceCodes: string[]): boolean {
  if (queryCodes.length === 0) return true;
  return queryCodes.some((qc) =>
    choiceCodes.some(
      (cc) =>
        qc === cc ||
        (qc.length >= 3 && (cc.startsWith(qc) || qc.startsWith(cc))),
    ),
  );
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** First product word; skip qty-like tokens. */
export function firstSignificantWord(s: string): string {
  const t = normNameKey(s).replace(/[\[\]()]/g, " ");
  for (const w of t.split(/\s+/)) {
    if (w.length < 3) continue;
    if (/^\d/.test(w)) continue;
    if (/^[hн]\d/i.test(w)) continue;
    return w;
  }
  return "";
}

function orphanCodesOf(query: string, keys: string[]): string[] {
  return extractCodes(query).filter(
    (qc) => !keys.some((k) => codesOverlap([qc], extractCodes(k))),
  );
}

/** Drop leftover SKUs that exist in no catalog key (e.g. 03.07). */
export function stripOrphanCodes(query: string, keys: string[]): string {
  const orphan = orphanCodesOf(query, keys);
  let s = query;
  for (const c of orphan.sort((a, b) => b.length - a.length)) {
    s = s.replace(new RegExp(escapeRe(c), "gi"), " ");
  }
  return s.replace(/\s+/g, " ").trim();
}

function headBuckets(toCanon: Map<string, string>): Map<string, Set<string>> {
  const buckets = new Map<string, Set<string>>();
  for (const [key, canon] of toCanon) {
    const hw = firstSignificantWord(key);
    if (!hw) continue;
    let set = buckets.get(hw);
    if (!set) {
      set = new Set();
      buckets.set(hw, set);
    }
    set.add(canon);
  }
  return buckets;
}

/**
 * If the first word maps to exactly one furniture canon (incl. aliases),
 * return it. Optional fuzzball on unique heads for typos: зацеп ≈ зачіп.
 * Known multi-product families (каркас, ніжка, завіса) never fuzzy-match.
 */
export function uniqueHeadCanon(
  query: string,
  toCanon: Map<string, string>,
  fuzzy = true,
): string | null {
  const qw = firstSignificantWord(query);
  if (!qw) return null;
  const buckets = headBuckets(toCanon);
  const known = buckets.get(qw);
  if (known) return known.size === 1 ? [...known][0] : null;
  if (!fuzzy || qw.length < 4) return null;
  const uniqueHeads = [...buckets.entries()]
    .filter(([, set]) => set.size === 1)
    .map(([hw]) => hw);
  if (uniqueHeads.length === 0) return null;
  const raw = extract(qw, uniqueHeads, {
    scorer: token_sort_ratio,
    limit: 3,
    cutoff: HEAD_CUTOFF,
  }) as Array<[string, number, number]>;
  if (raw.length === 0) return null;
  if (raw.length >= 2 && raw[0][1] - raw[1][1] < UNIQUE_GAP) return null;
  const set = buckets.get(raw[0][0]);
  if (!set || set.size !== 1) return null;
  return [...set][0];
}

/**
 * Exact catalog hit: full alias, already-canon, or leftover SKU on a unique head
 * (`Зацеп 03.07` → `Зачіп Краб` via alias «Зацеп»).
 */
export function exactFurnitureCanon(
  query: string,
  aliases: Map<string, string>,
  toCanon: Map<string, string>,
): string | undefined {
  const q = normNameKey(query);
  if (!q) return undefined;
  const fromAlias = aliases.get(q);
  if (fromAlias) return fromAlias;
  const mapped = toCanon.get(q);
  if (mapped && normNameKey(mapped) === q) return mapped;

  const keys = [...toCanon.keys()];
  const stripped = stripOrphanCodes(query, keys);
  const sq = normNameKey(stripped);
  if (sq && sq !== q) {
    const viaStrip = aliases.get(sq) ?? toCanon.get(sq);
    if (viaStrip) return viaStrip;
    const word = firstSignificantWord(stripped);
    const viaWord = word ? aliases.get(word) : undefined;
    if (viaWord) return viaWord;
    const head = uniqueHeadCanon(stripped, toCanon, false);
    if (head) return head;
  }

  if (orphanCodesOf(query, keys).length > 0) {
    const word = firstSignificantWord(query);
    const viaWord = word ? aliases.get(word) : undefined;
    if (viaWord) return viaWord;
    const head = uniqueHeadCanon(query, toCanon, false);
    if (head) return head;
  }
  return undefined;
}

function mergeExtract(
  query: string,
  keys: string[],
  toCanon: Map<string, string>,
  scorer: (s1: string, s2: string) => number,
  cutoff: number,
  best: Map<string, number>,
): void {
  if (keys.length === 0 || query.length < 3) return;
  const raw = extract(query, keys, {
    scorer,
    limit: LIMIT,
    cutoff,
  }) as Array<[string, number, number]>;
  for (const [key, score] of raw) {
    const canon = toCanon.get(key);
    if (!canon) continue;
    if (normNameKey(canon) === query) continue;
    best.set(canon, Math.max(best.get(canon) ?? 0, score));
  }
}

export function furnitureSearchKeys(
  aliases: Map<string, string>,
  furnitureCanons: string[],
): Map<string, string> {
  const toCanon = new Map<string, string>();
  for (const c of furnitureCanons) {
    const k = normNameKey(c);
    if (k) toCanon.set(k, c);
  }
  for (const [alias, canon] of aliases) {
    if (alias) toCanon.set(alias, canon);
  }
  for (const canon of aliases.values()) {
    const k = normNameKey(canon);
    if (k) toCanon.set(k, canon);
  }
  return toCanon;
}

function rankedHits(best: Map<string, number>): FuzzyCanonHit[] {
  return [...best.entries()]
    .map(([canon, score]) => ({ canon, score }))
    .sort((a, b) => b.score - a.score || a.canon.localeCompare(b.canon, "uk"));
}

/**
 * Map a free-text product head to furniture canons via fuzzball.
 * Exact alias lookup should run first. Returns canons ranked, already unique.
 *
 * token_sort first (with model-code filter). If leftover SKUs kill the score,
 * strip orphan codes, then token_set, then unique first-word (Зацеп → Зачіп Краб).
 */
export function fuzzyFurnitureCanons(
  query: string,
  toCanon: Map<string, string>,
): FuzzyCanonHit[] {
  const q = normNameKey(query);
  if (q.length < 4 || toCanon.size === 0) return [];
  const self = toCanon.get(q);
  if (self && normNameKey(self) === q) return [];

  const allKeys = [...toCanon.keys()];
  let keys = allKeys;
  const qCodes = extractCodes(query);
  let usedCodeFilter = false;
  if (qCodes.length > 0) {
    const filtered = keys.filter((k) =>
      codesOverlap(qCodes, extractCodes(k)),
    );
    if (filtered.length > 0) {
      keys = filtered;
      usedCodeFilter = true;
    }
  }

  const best = new Map<string, number>();
  mergeExtract(
    q,
    keys,
    toCanon,
    token_sort_ratio,
    usedCodeFilter ? 60 : CUTOFF,
    best,
  );

  if (best.size === 0) {
    const stripped = stripOrphanCodes(query, allKeys);
    const q2 = normNameKey(stripped);
    if (q2 && q2 !== q) {
      mergeExtract(q2, allKeys, toCanon, token_sort_ratio, CUTOFF, best);
      mergeExtract(q2, allKeys, toCanon, token_set_ratio, CUTOFF, best);
    }
  }

  if (best.size === 0) {
    const qw = firstSignificantWord(query);
    if (qw) {
      const family = allKeys.filter((k) => firstSignificantWord(k) === qw);
      mergeExtract(q, family, toCanon, token_set_ratio, CUTOFF, best);
    }
  }

  if (best.size === 0) {
    const orphans = orphanCodesOf(query, allKeys);
    if (orphans.length > 0) {
      const stripped = stripOrphanCodes(query, allKeys);
      const head = uniqueHeadCanon(stripped || query, toCanon, true);
      if (head && normNameKey(head) !== q) best.set(head, 72);
    }
  }

  return rankedHits(best);
}

export function uniqueFuzzyCanon(
  hits: FuzzyCanonHit[],
): FuzzyCanonHit | null {
  if (hits.length === 0) return null;
  if (hits.length === 1) return hits[0];
  if (hits[0].score - hits[1].score >= UNIQUE_GAP) return hits[0];
  return null;
}

export function similarLabels(
  needle: string,
  labels: string[],
  limit = 3,
): string[] {
  const q = normNameKey(needle);
  if (q.length < 4 || labels.length === 0) return [];
  const raw = extract(q, labels, {
    scorer: token_sort_ratio,
    processor: (s: string) => normNameKey(String(s)),
    limit: limit + 3,
    cutoff: 78,
  }) as Array<[string, number, number]>;
  const out: string[] = [];
  for (const [label] of raw) {
    if (normNameKey(label) === q) continue;
    out.push(label);
    if (out.length >= limit) break;
  }
  return out;
}
