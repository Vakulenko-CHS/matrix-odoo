import { lineHtmlCommentFlags } from "../tools/htmlComment";
import {
  COMP_QTY_TAIL_RE,
  componentHead,
  displayName,
  normNameKey,
} from "./nameKey";
import {
  exactFurnitureCanon,
  furnitureSearchKeys,
  fuzzyFurnitureCanons,
  uniqueFuzzyCanon,
} from "./fuzzyNames";
import { rewriteCanonHead, suffixesByInner, patternBModelSuffix } from "./canonRewrite";

export interface QuickFix {
  id: string;
  label: string;
  action:
    | "delete-line"
    | "replace-line"
    | "merge-next"
    | "replace-all"
    | "insert-after"
    | "goto-line"
    | "copy";
  line: number;
  extraLines?: number;
  replacement?: string;
  find?: string;
  /** 1-indexed line to focus after apply. Defaults to `line`. */
  focusLine?: number;
  /** Select first occurrence of this text on the focus line. */
  selectText?: string;
}

const SKIP_NAME =
  /^(дерево|дсп|двп|фанера|тканина|синтепон|флізелін|поролон|войлок|скотч|плівка|картон|кромка|бонняль|Холлофайбер|крихта|крошка)$/i;

const SKIP_FURN_LINE =
  /^(дерево|дсп|двп|фанера|тканина|синтепон|флізелін|поролон|войлок|скотч|плівка|картон|кромка|бонняль|холлофайбер|крихта|крошка|ціна|або|і)\b/i;

const SHOP9_HDR = /^#\s*Цех\s*№\s*9(?![\d-])/u;
const WORKSHOP_HDR = /^#[^#].*№/;

function skipFurnitureName(head: string): boolean {
  const first =
    head.replace(/[\[\]()]/g, " ").trim().split(/\s+/)[0] ?? "";
  return SKIP_NAME.test(first);
}

/** Sofa outputs / cut parts — not shop-9 hardware. */
function isProducedPart(head: string): boolean {
  if (/%[А-Яа-яҐЄІЇA-Za-z]/.test(head)) return true;
  const inner = (head.match(/\[([^\]]+)\]/)?.[1] ?? head).trim();
  return (
    /напівфабрикат|нарізан|наволочк/i.test(inner) ||
    /^(подушка|чохол|накладка)\b/i.test(inner) ||
    /^(диван|ліжко|угол)\b/i.test(inner)
  );
}

function lineCanonHead(trimmed: string): string | null {
  const t = trimmed
    .replace(/<!--.*?-->/g, "")
    .replace(/\s*\/\/.*$/, "")
    .trim();
  if (!t || t.startsWith("#") || t.startsWith("<<") || t.startsWith("//")) {
    return null;
  }
  if (/^Ціна\s+/i.test(t)) return null;
  if (/^(або|Або|і|---)$/.test(t)) return null;
  const qtyHead = componentHead(t);
  if (qtyHead) return qtyHead;
  if (/^[🪵🧩🪤🧽]/.test(t) && t.includes("[")) return t;
  if (/^\[[^\]]+\]/.test(t)) return t;
  if (/^\(Послуга\)/.test(t)) return t.replace(COMP_QTY_TAIL_RE, "").trim() || t;
  if (/^(Ламінат|Перевірка Якості)\b/i.test(t)) {
    return t.replace(COMP_QTY_TAIL_RE, "").trim() || t;
  }
  return null;
}

/** Keep `- N uom`, `// @Attr=…`, and `<!-- -->` after a head rewrite. */
function lineFixTail(trimmed: string): { qty: string; trail: string } {
  let body = trimmed;
  let trail = "";
  const html = body.match(/(\s*<!--[\s\S]*-->)\s*$/);
  if (html) {
    trail = html[1];
    body = body.slice(0, -html[0].length).trimEnd();
  }
  const slash = body.match(/(\s*\/\/.*)$/);
  if (slash) {
    trail = `${slash[1]}${trail}`;
    body = body.slice(0, -slash[0].length).trimEnd();
  }
  const qty = body.match(COMP_QTY_TAIL_RE)?.[0] ?? "";
  return { qty, trail };
}

function rebuiltFixLine(indent: string, head: string, trimmed: string): string {
  const { qty, trail } = lineFixTail(trimmed);
  return `${indent}${head}${qty}${trail}`;
}

function lineFurnitureHead(trimmed: string): string | null {
  const t = trimmed
    .replace(/<!--.*?-->/g, "")
    .replace(/\s*\/\/.*$/, "")
    .trim();
  if (!t || t.startsWith("#") || t.startsWith("<<") || t.startsWith("//")) {
    return null;
  }
  if (/^[🪵🧩🪤🧽]/.test(t)) return null;
  if (SKIP_FURN_LINE.test(t)) return null;
  const head = componentHead(t);
  if (head) {
    if (skipFurnitureName(head) || isProducedPart(head)) return null;
    return head;
  }
  return t.length >= 3 && t.length <= 90 ? t : null;
}

const TYPOS: Array<{ re: RegExp; correct: string }> = [
  { re: /Цшна/gi, correct: "Ціна" },
  { re: /Цсна/gi, correct: "Ціна" },
  { re: /деровина/gi, correct: "деревина" },
  { re: /карказ/gi, correct: "Каркас" },
  { re: /компонети/gi, correct: "компоненти" },
  { re: /напівфабрікат/gi, correct: "напівфабрикат" },
  { re: /сборка/gi, correct: "збірка" },
  { re: /атримбут/gi, correct: "атрибут" },
  { re: /обємі/gi, correct: "об'ємі" },
  { re: /труегольн/gi, correct: "трикутн" },
  { re: /накладная/gi, correct: "Накладна" },
  { re: /холофайбер/gi, correct: "Холлофайбер" },
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

export function lintSpec(
  content: string,
  aliases: Map<string, string> = new Map(),
  furnitureCanons: string[] = [],
  nameCanons: string[] = [],
): LintHit[] {
  const lines = content.split("\n");
  const commented = lineHtmlCommentFlags(content);
  const hits: LintHit[] = [];
  let seq = 0;
  const furnIndex =
    aliases.size > 0 || furnitureCanons.length > 0
      ? furnitureSearchKeys(aliases, furnitureCanons)
      : null;
  const suffixIndex = suffixesByInner(nameCanons);
  const hasCanon = aliases.size > 0 && (nameCanons.length > 0 || suffixIndex.size > 0);
  let inShop9 = false;
  let shop9Line: number | null = null;
  const newFurn: string[] = [];
  let newFurnLine: number | null = null;
  const newModels: string[] = [];
  let newModelLine: number | null = null;

  function copyFix(label: string, text: string, line: number): QuickFix {
    return {
      id: `furn-copy-${seq++}`,
      label,
      action: "copy",
      line,
      replacement: text,
    };
  }

  function warnNewFurniture(head: string, line: number, original: string): void {
    hits.push({
      kind: "warning",
      source: "lint",
      line,
      message: `Нова фурнітура: «${head}»`,
      original,
      fixes: [copyFix("Скопіювати", head, line)],
    });
    if (!newFurn.includes(head)) newFurn.push(head);
    if (newFurnLine == null) newFurnLine = line;
  }

  function noteNewPatternB(head: string, line: number): void {
    const model = patternBModelSuffix(head, suffixIndex);
    if (!model) return;
    const innerKey = head.match(/\[([^\]]+)\]/)?.[1] ?? "";
    const allowed = suffixIndex.get(normNameKey(innerKey));
    if (allowed?.has(normNameKey(model))) return;
    const p = head.match(/^([🪵🧩🪤🧽]*\[[^\]]+\])/u);
    const full = p ? `${p[1]} ${model}` : head;
    if (!newModels.includes(full)) newModels.push(full);
    if (newModelLine == null) newModelLine = line;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const t = line.trim();
    const n = i + 1;

    if (WORKSHOP_HDR.test(t)) {
      inShop9 = SHOP9_HDR.test(t);
      if (inShop9) shop9Line = n;
    }

    if (commented[i] || t.startsWith("<!--")) {
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

    let furnitureHit = false;
    if (furnIndex && furnIndex.size > 0) {
      const head = lineFurnitureHead(t);
      const qtyHead = componentHead(t);
      const allowFuzzy =
        Boolean(qtyHead) || (/^\[[^\]]+\]/.test(t) && !t.includes("("));
      if (head && (qtyHead || allowFuzzy || furnIndex.has(normNameKey(head)))) {
        const indent = line.match(/^\s*/)?.[0] ?? "";
        const exact = exactFurnitureCanon(head, aliases, furnIndex);
        if (exact) {
          if (displayName(exact) !== displayName(head)) {
            furnitureHit = true;
            hits.push({
              kind: "error",
              source: "lint",
              line: n,
              message: `Фурнітура: «${head}» → «${exact}»`,
              original: t,
              fixes: [
                {
                  id: `furn-${seq++}`,
                  label: `Замінити на «${exact}»`,
                  action: "replace-line",
                  line: n,
                  replacement: rebuiltFixLine(indent, exact, t),
                },
              ],
            });
          } else {
            furnitureHit = true;
          }
        } else if (allowFuzzy) {
          const ranked = fuzzyFurnitureCanons(head, furnIndex);
          const unique = uniqueFuzzyCanon(ranked);
          const suggest = unique ? [unique] : ranked.slice(0, 3);
          if (suggest.length > 0) {
            furnitureHit = true;
            const top = suggest
              .map((h) => `«${h.canon}» ${h.score}`)
              .join(", ");
            hits.push({
              kind: "warning",
              source: "lint",
              line: n,
              message: unique
                ? `Фурнітура ≈ «${unique.canon}» (fuzzball ${unique.score})`
                : `Фурнітура ≈ ${top}`,
              original: t,
              fixes: suggest.map((h) => ({
                id: `furn-fuzz-${seq++}`,
                label: `Замінити на «${h.canon}»`,
                action: "replace-line" as const,
                line: n,
                replacement: rebuiltFixLine(indent, h.canon, t),
              })),
            });
          } else if (inShop9 && qtyHead && !skipFurnitureName(head)) {
            furnitureHit = true;
            warnNewFurniture(head, n, t);
          }
        } else if (
          inShop9 &&
          qtyHead &&
          !exact &&
          !skipFurnitureName(head)
        ) {
          furnitureHit = true;
          warnNewFurniture(head, n, t);
        }
      }
    }

    if (!furnitureHit && hasCanon) {
      const canonHead = lineCanonHead(t);
      if (canonHead) {
        const next = rewriteCanonHead(canonHead, aliases, suffixIndex);
        if (next) {
          furnitureHit = true;
          const indent = line.match(/^\s*/)?.[0] ?? "";
          hits.push({
            kind: "error",
            source: "lint",
            line: n,
            message: `Назва: «${canonHead}» → «${next}»`,
            original: t,
            fixes: [
              {
                id: `canon-${seq++}`,
                label: `Замінити на «${next}»`,
                action: "replace-line",
                line: n,
                replacement: rebuiltFixLine(indent, next, t),
              },
            ],
          });
          noteNewPatternB(next, n);
        } else {
          noteNewPatternB(canonHead, n);
        }
      }
    }

    if (!furnitureHit) for (const typo of TYPOS) {
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

    const gluedDash = t.match(
      /([\s\]\)])-(\d[\d,.]*)\s*([а-яА-ЯҐЄІЇa-zA-Z][а-яА-ЯҐЄІЇa-zA-Z0-9.²³]*)\s*$/u,
    );
    if (gluedDash && !/\s-\s/.test(t.slice(Math.max(0, t.lastIndexOf("-") - 1)))) {
      const pre =
        gluedDash[1] === "]" || gluedDash[1] === ")"
          ? `${gluedDash[1]} `
          : gluedDash[1];
      const replacement = t.replace(
        /([\s\]\)])-(\d[\d,.]*)\s*([а-яА-ЯҐЄІЇa-zA-Z][а-яА-ЯҐЄІЇa-zA-Z0-9.²³]*)\s*$/u,
        `${pre}- ${gluedDash[2]} ${gluedDash[3]}`,
      );
      hits.push({
        kind: "error",
        source: "lint",
        line: n,
        message: "Немає пробілу після «-» перед кількістю. Має бути «- N uom».",
        original: t,
        fixes: [
          {
            id: `dash-qty-${seq++}`,
            label: `Пробіл: «- ${gluedDash[2]} ${gluedDash[3]}»`,
            action: "replace-line",
            line: n,
            replacement,
          },
        ],
      });
    }

    const gluedUom = t.match(/(-\s*[\d,.]+)([а-яА-ЯҐЄІЇa-zA-Z²³])/u);
    if (gluedUom) {
      hits.push({
        kind: "error",
        source: "lint",
        line: n,
        message: "Немає пробілу між числом і одиницею виміру.",
        original: t,
        fixes: [
          {
            id: `uom-space-${seq++}`,
            label: "Вставити пробіл перед UOM",
            action: "replace-line",
            line: n,
            replacement: t.replace(
              /(-\s*[\d,.]+)([а-яА-ЯҐЄІЇa-zA-Z²³])/u,
              "$1 $2",
            ),
          },
        ],
      });
    }
  }

  if (newModels.length > 0) {
    const loc = newModelLine ?? 1;
    hits.push({
      kind: "warning",
      source: "lint",
      line: loc,
      message: `Нові моделі (Pattern B), немає в right_names (${newModels.length})`,
      original: newModels.join("\n"),
      fixes: [copyFix("Скопіювати всі", newModels.join("\n"), loc)],
    });
  }

  if (newFurn.length > 0) {
    const loc = shop9Line ?? newFurnLine ?? 1;
    hits.push({
      kind: "warning",
      source: "lint",
      line: loc,
      message: `У документі є нові елементи фурнітури (${newFurn.length})`,
      original: newFurn.join("\n"),
      fixes: [
        copyFix("Скопіювати всі", newFurn.join("\n"), loc),
      ],
    });
  }

  for (let i = 0; i < lines.length; i++) {
    if (commented[i]) continue;
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
    if (commented[i]) return;
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
    if (commented[i]) continue;

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
  if (fix.action === "goto-line" || fix.action === "copy") return content;
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
