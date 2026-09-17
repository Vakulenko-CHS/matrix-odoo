/** Collapse spaces; case-fold. For alias / canon lookup. */
export function normNameKey(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

/** Qty suffix on a component line. Allows glued dash: `(Накладная)-4 шт.` */
export const COMP_QTY_TAIL_RE = /\s*-\s*[\d.,]+\s*\S+\s*$/u;

export function componentHead(trimmed: string): string | null {
  const t = trimmed.trim();
  if (!COMP_QTY_TAIL_RE.test(t)) return null;
  return t.replace(COMP_QTY_TAIL_RE, "").trim() || null;
}
