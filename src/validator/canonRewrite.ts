import { displayName, normNameKey } from "./nameKey";

export interface CanonRewrite {
  from: string;
  to: string;
}

const COVER_TYPES = [
  "Чохол - напівфабрикат",
  "Чохол - нарізані матеріали",
];

function splitTopAttrs(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "(") depth += 1;
    else if (ch === ")") depth -= 1;
    if (ch === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function fixTokens(s: string): string {
  return s
    .replace(/компонети/g, "компоненти")
    .replace(/М Ч /g, "М.Ч.")
    .replace(/100ДСП/g, "100 ДСП")
    .replace(/(\d+)[хХ×](\d+)/g, "$1x$2");
}

function parseBracket(head: string): {
  emoji: string;
  inner: string;
  after: string;
} | null {
  const m = head.match(/^([🪵🧩🪤🧽]*)\[([^\]]+)\]\s*(.*)$/u);
  if (!m) return null;
  return { emoji: m[1], inner: m[2], after: m[3].trim() };
}

export function suffixesByInner(nameCanons: string[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const raw of nameCanons) {
    const p = parseBracket(raw);
    if (!p || !p.after) continue;
    const key = normNameKey(p.inner);
    let set = map.get(key);
    if (!set) {
      set = new Set();
      map.set(key, set);
    }
    set.add(normNameKey(p.after));
  }
  return map;
}

function splitCoverInner(inner: string): { type: string; model: string } | null {
  const fixed = fixTokens(inner);
  for (const type of COVER_TYPES) {
    if (fixed === type) return null;
    if (fixed.startsWith(`${type} `)) {
      return { type, model: fixed.slice(type.length).trim() };
    }
  }
  return null;
}

function laminateSized(head: string): string | null {
  const m = head.match(
    /^🧩\[Ламінат(?: кольоровий - лист| - кольоровий)\]\s*(\d+)\s*[xхXХ]\s*(\d+)\s*$/u,
  );
  if (!m) return null;
  return `🧩[Ламінат кольоровий - лист] (${m[1]}x${m[2]}, %Колір Ламінату%)`;
}

function bareLaminat(head: string): string | null {
  if (normNameKey(head) === "ламінат") return "[Ламінат] (Білий)";
  return null;
}

function serviceQc(head: string): string | null {
  if (normNameKey(head) === "перевірка якості") {
    return "(Послуга) Перевірка Якості";
  }
  return null;
}

/**
 * Map a spec product head to the target DB name. Exact aliases first.
 * Null = already canon or unknown.
 */
export function rewriteCanonHead(
  head: string,
  aliases: Map<string, string>,
  suffixIndex: Map<string, Set<string>>,
): string | null {
  const src = displayName(head);
  if (!src) return null;

  const lam = laminateSized(src) ?? bareLaminat(src);
  if (lam && displayName(lam) !== src) return lam;

  const qc = serviceQc(src);
  if (qc && qc !== src) return qc;

  const q = normNameKey(src);
  const fromAlias = aliases.get(q);
  if (fromAlias && displayName(fromAlias) !== src) return fromAlias;

  const p = parseBracket(src);
  if (!p) {
    const tokened = fixTokens(src);
    return tokened !== src ? tokened : null;
  }

  const cover = splitCoverInner(p.inner);
  if (cover) {
    const attrs = p.after.startsWith("(") ? ` ${p.after}` : p.after ? ` ${p.after}` : "";
    const next = `${p.emoji}[${cover.type}] ${cover.model}${attrs}`;
    return displayName(next) !== src ? next : null;
  }

  const inner = fixTokens(p.inner);
  let after = p.after;

  if (after.startsWith("(") && after.endsWith(")")) {
    const attrs = splitTopAttrs(after.slice(1, -1));
    const first = attrs[0] ? fixTokens(attrs[0]) : "";
    if (first && !first.startsWith("%")) {
      const allowed = suffixIndex.get(normNameKey(inner));
      if (allowed && allowed.has(normNameKey(first))) {
        const rest = attrs.slice(1);
        after = rest.length > 0 ? `${first} (${rest.join(", ")})` : first;
      } else {
        after = `(${[first, ...attrs.slice(1)].join(", ")})`;
      }
    }
  } else if (after) {
    after = fixTokens(after);
  }

  const next = after
    ? `${p.emoji}[${inner}] ${after}`
    : `${p.emoji}[${inner}]`;
  return displayName(next) !== src ? next : null;
}
