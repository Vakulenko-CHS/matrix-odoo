import { matchUnbraced, unwrapNameBraces } from "../parser/nameBrace";

/** Collapse spaces; case-fold. For alias / canon lookup. */
export function normNameKey(s: string): string {
  return unwrapNameBraces(s).replace(/\s+/g, " ").trim().toLowerCase();
}

/** Collapse spaces; keep case. Spec line must match canon spelling. */
export function displayName(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** Qty suffix on a component line. Allows glued dash: `(Накладная)-4 шт.` */
export const COMP_QTY_TAIL_RE = /\s*-\s*[\d.,]+\s*\S+\s*$/u;

export function stripQtyTail(s: string): string {
  const m = matchUnbraced(s, COMP_QTY_TAIL_RE);
  if (!m || m.index === undefined) return s;
  return s.slice(0, m.index).trimEnd();
}

export function componentHead(trimmed: string): string | null {
  const t = trimmed.trim();
  const m = matchUnbraced(t, COMP_QTY_TAIL_RE);
  if (!m || m.index === undefined) return null;
  return t.slice(0, m.index).trim() || null;
}
