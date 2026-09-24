/** Optional `{literal suffix}` after `]` — `-` inside is a name, not UOM. */

const BRACE_CHUNK = /\{[^{}]*\}/g;

export function maskNameBraces(s: string): string {
  return s.replace(BRACE_CHUNK, (m) => "\u0001".repeat(m.length));
}

/** `{Б-4}` → `Б-4`. Spec syntax only — drop before Odoo / productId. */
export function unwrapNameBraces(s: string): string {
  return s.replace(/\{([^{}]*)\}/g, "$1");
}

export function matchUnbraced(s: string, re: RegExp): RegExpExecArray | null {
  const r = new RegExp(re.source, re.flags);
  return r.exec(maskNameBraces(s));
}

export function testUnbraced(s: string, re: RegExp): boolean {
  const r = new RegExp(re.source, re.flags);
  return r.test(maskNameBraces(s));
}

/** Qty tail on masked line; slice original. Canon: ` - qty uom`. */
const SPLIT_QTY_RE = /\s+-\s+([\d.,]+)\s+(\S+)\s*$/u;

export function splitQtyTail(line: string): {
  body: string;
  qtyStr: string | null;
  uom: string;
  tail: string;
} {
  const m = matchUnbraced(line, SPLIT_QTY_RE);
  if (!m || m.index === undefined) {
    return { body: line, qtyStr: null, uom: "", tail: "" };
  }
  return {
    body: line.slice(0, m.index),
    qtyStr: m[1],
    uom: (m[2] ?? "").replace(/\.$/, ""),
    tail: line.slice(m.index),
  };
}

/** Suffix after `]` that looks like `…-4` and is not a real qty tail. */
export function hyphenNameSuffix(trimmed: string): string | null {
  const t = trimmed.trim();
  if (testUnbraced(t, SPLIT_QTY_RE)) return null;
  const m = t.match(/\]\s+(\{)?(?![(%])/);
  if (!m || m.index === undefined) return null;
  if (m[1] === "{") return null;
  const rest = t.slice(m.index + m[0].length);
  const cut = rest.search(/\s*\(/);
  const suffix = (cut < 0 ? rest : rest.slice(0, cut)).trim();
  if (!suffix || !/-\d/.test(suffix)) return null;
  if (cut >= 0) return null;
  return suffix;
}
