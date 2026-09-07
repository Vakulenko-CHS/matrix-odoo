export interface QuickFix {
  id: string;
  label: string;
  action: "delete-line" | "replace-line" | "merge-next" | "replace-all" | "insert-after";
  line: number;
  extraLines?: number;
  replacement?: string;
  find?: string;
}

const SKIP_NAME =
  /^(дерево|дсп|двп|фанера|тканина|синтепон|флізелін|поролон|войлок|скотч|плівка|картон|кромка|бонняль|Холлофайбер|крихта|крошка)$/i;

const TYPOS: Array<{ re: RegExp; correct: string }> = [
  { re: /Цшна/gi, correct: "Ціна" },
  { re: /Цсна/gi, correct: "Ціна" },
  { re: /деровина/gi, correct: "деревина" },
  { re: /карказ/gi, correct: "Каркас" },
  { re: /компонети/gi, correct: "компоненти" },
  { re: /атримбут/gi, correct: "атрибут" },
  { re: /обємі/gi, correct: "об'ємі" },
  { re: /труегольн/gi, correct: "трикутн" },
  { re: /накладная/gi, correct: "Накладна" },
  { re: /холофайдер/gi, correct: "Холлофайбер" },
  { re: /крошка ппу/gi, correct: "Крихта ППУ" },
  { re: /cинтепон/gi, correct: "Синтепон" },
];

const QTY_ONLY_RE = /^-\s*([\d.,]*)\s*(шт\.?|кг|m³|m²|m|г)?\s*$/iu;

const ZERO_QTY_RE = /-\s*0(?:[.,]0+)?\s*(шт\.?|кг|m³|m²|m|г)?\s*$/u;

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const row = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    let prev = i - 1;
    row[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = row[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + cost);
      prev = tmp;
    }
  }
  return row[n];
}

function similar(a: string, b: string): boolean {
  if (a === b) return false;
  if (Math.abs(a.length - b.length) > 2) return false;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen < 5) return false;
  const d = levenshtein(a, b);
  return d >= 1 && d <= 2;
}

function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[🪵🧩🪤🧽]/gu, "")
    .replace(/\s+/g, " ")
    .replace(/\s*-\s*/g, "-")
    .trim();
}

function extractNames(line: string): string[] {
  if (/^\s*<!--/.test(line)) return [];
  const names: string[] = [];
  const re = /\[([^\]]+)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    const inner = m[1].trim();
    if (inner && !SKIP_NAME.test(inner.split(/\s|-/)[0] ?? "")) {
      names.push(inner);
    }
  }
  return names;
}

export interface LintHit {
  kind: "blocking" | "error" | "warning";
  source: "lint";
  line: number;
  message: string;
  original: string;
  fixes: QuickFix[];
}

export function lintSpec(content: string): LintHit[] {
  const lines = content.split("\n");
  const hits: LintHit[] = [];
  let seq = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const t = line.trim();
    const n = i + 1;

    if (t.startsWith("<!--")) {
      if (/<!--\s*TODO/i.test(t)) {
        hits.push({
          kind: "blocking",
          source: "lint",
          line: n,
          message: `TODO: рядок позначено як незавершений — потрібно виправити перед збереженням`,
          original: t,
          fixes: [
            {
              id: `todo-del-${seq++}`,
              label: "Видалити рядок TODO",
              action: "delete-line",
              line: n,
            },
          ],
        });
      }
      continue;
    }

    for (const typo of TYPOS) {
      typo.re.lastIndex = 0;
      if (!typo.re.test(line)) continue;
      typo.re.lastIndex = 0;
      hits.push({
        kind: "error",
        source: "lint",
        line: n,
        message: `Орфографія: має бути «${typo.correct}»`,
        original: t,
        fixes: [
          {
            id: `spell-${seq++}`,
            label: `Замінити на «${typo.correct}»`,
            action: "replace-line",
            line: n,
            replacement: line.replace(typo.re, typo.correct),
          },
        ],
      });
    }

    if (ZERO_QTY_RE.test(t) || /-\s*0\s*шт/i.test(t)) {
      hits.push({
        kind: "blocking",
        source: "lint",
        line: n,
        message: "Нульова кількість. Ймовірно рядок зайвий.",
        original: t,
        fixes: [
          {
            id: `zero-${seq++}`,
            label: "Видалити рядок",
            action: "delete-line",
            line: n,
          },
        ],
      });
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t.includes("[") || /-\s*[\d.,]+\s*\S+\s*$/.test(t)) continue;
    let j = i + 1;
    while (j < lines.length && !lines[j].trim()) j++;
    const qty = j < lines.length ? QTY_ONLY_RE.exec(lines[j].trim()) : null;
    if (!qty) continue;
    const qtyStr = qty[1] || "0";
    let unit = qty[2] ?? "шт.";
    if (/^шт/i.test(unit)) unit = "шт.";
    const extra = j - i;
    hits.push({
      kind: "error",
      source: "lint",
      line: i + 1,
      message: `Кількість стоїть окремим рядком («- ${qtyStr} ${unit}»). Має бути в одному рядку з назвою.`,
      original: t,
      fixes: [
        {
          id: `merge-${seq++}`,
          label: `Поєднати в «${t} - ${qtyStr} ${unit}»`,
          action: "merge-next",
          line: i + 1,
          extraLines: extra,
          replacement: `${lines[i].trimEnd()} - ${qtyStr} ${unit}`,
        },
      ],
    });
  }

  const counts = new Map<string, { raw: string; lines: number[] }>();
  lines.forEach((line, i) => {
    for (const name of extractNames(line)) {
      const key = normalizeName(name);
      if (!key || SKIP_NAME.test(key)) continue;
      const cur = counts.get(key) ?? { raw: name, lines: [] };
      cur.lines.push(i + 1);
      counts.set(key, cur);
    }
  });

  const allKeys = [...counts.keys()];
  for (const [key, info] of counts) {
    if (info.lines.length !== 1) continue;
    if (!/напівфабрикат|нарізан|каркас|бильц|планка|чохол|накладк/i.test(key)) {
      continue;
    }
    const near = allKeys
      .filter((other) => similar(key, other))
      .slice(0, 4)
      .map((other) => counts.get(other)!.raw);
    if (near.length === 0) continue;
    const line = info.lines[0];
    const original = lines[line - 1] ?? "";
    hits.push({
      kind: "warning",
      source: "lint",
      line,
      message: `«${info.raw}» зустрічається один раз. Схожі назви: ${near.map((n) => `«${n}»`).join(", ")}. Можливо орфографія.`,
      original: original.trim(),
      fixes: near.map((n) => ({
        id: `fuzzy-${seq++}`,
        label: `Замінити на «${n}»`,
        action: "replace-all",
        line,
        find: info.raw,
        replacement: n,
      })),
    });
  }

  // ── Empty-BOM detection ─────────────────────────────────────────────────────
  // Output line (emoji+bracket, no qty suffix) inside a workshop that has zero
  // component lines before the next output / price / separator.
  // If the raw line already carries <!-- Купляється --> the block is intentional.
  const WORKSHOP_HDR = /^#[^#].*№/;
  const OUTPUT_RE = /^[🪵🧩🪤🧽]+\[/u;
  const COMP_QTY_RE = /-\s*[\d,.][\d,.]*\s*\S+\s*$/;
  const PRICE_HDR = /^Ціна\s+[\d.]+\s*грн/i;
  const KUPLUETSYA = /<!--\s*Купляється\s*-->/i;
  const SEPARATOR = /^(або|Або|і|---|\s*)$/;

  let inWs = false;
  let outLine = -1;
  let outText = "";
  let outRaw = "";
  let hasComp = false;

  function flushBom(): void {
    if (outLine < 0) return;
    if (!hasComp && !KUPLUETSYA.test(outRaw)) {
      hits.push({
        kind: "warning",
        source: "lint",
        line: outLine,
        message: `Порожня специфікація — немає компонентів. Якщо товар купляється, додай «<!-- Купляється -->» до цього рядка.`,
        original: outText,
        fixes: [
          {
            id: `buy-${seq++}`,
            label: "Позначити «Купляється»",
            action: "replace-line",
            line: outLine,
            replacement: `${outRaw.trimEnd()} <!-- Купляється -->`,
          },
        ],
      });
    }
    outLine = -1;
    hasComp = false;
  }

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const t = raw.trim();

    if (WORKSHOP_HDR.test(t)) { flushBom(); inWs = true; continue; }
    if (!inWs) continue;
    if (!t || t.startsWith("//")) continue;

    if (SEPARATOR.test(t)) { flushBom(); continue; }
    if (PRICE_HDR.test(t)) { flushBom(); continue; }

    // Output line: starts with emoji+bracket, no qty at end
    if (OUTPUT_RE.test(t) && !COMP_QTY_RE.test(t)) {
      flushBom();
      outLine = i + 1;
      outText = t.replace(/<!--.*?-->/g, "").trim();
      outRaw = raw;
      hasComp = false;
      continue;
    }

    // Component line with qty
    if (COMP_QTY_RE.test(t) && outLine >= 0) hasComp = true;
  }
  flushBom();
  // ────────────────────────────────────────────────────────────────────────────

  return hits;
}

export function applyFix(content: string, fix: QuickFix): string {
  const lines = content.split("\n");
  const idx = fix.line - 1;
  if (idx < 0 || idx >= lines.length) return content;

  if (fix.action === "delete-line") {
    const drop = idx + 1 < lines.length && !lines[idx + 1].trim() ? 2 : 1;
    lines.splice(idx, drop);
    return lines.join("\n");
  }
  if (fix.action === "replace-line" && fix.replacement !== undefined) {
    lines[idx] = fix.replacement;
    return lines.join("\n");
  }
  if (fix.action === "merge-next" && fix.replacement !== undefined) {
    const drop = fix.extraLines ?? 1;
    lines.splice(idx, drop + 1, fix.replacement);
    return lines.join("\n");
  }
  if (fix.action === "replace-all" && fix.find && fix.replacement) {
    return content.split(fix.find).join(fix.replacement);
  }
  if (fix.action === "insert-after" && fix.replacement !== undefined) {
    lines.splice(idx + 1, 0, ...fix.replacement.split("\n"));
    return lines.join("\n");
  }
  return content;
}
