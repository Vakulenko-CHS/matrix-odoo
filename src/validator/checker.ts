import * as fs from "fs";
import * as path from "path";
import { lineHtmlCommentFlags } from "../tools/htmlComment";

export interface CheckError {
  line: number;
  severity: "error" | "warning";
  message: string;
  original: string;
}

export interface CheckResult {
  errors: CheckError[];
  warnings: CheckError[];
  valid: boolean;
}

export interface KnownCatalog {
  set: Set<string>;
  labels: string[];
}

interface FoamBlock {
  lineNum: number;
  variant: "Звичайний Блок" | "Посилений Блок" | null;
  outputLine: string;
  matLines: string[];
}

export function parseKnownCatalog(content: string): KnownCatalog {
  const set = new Set<string>();
  const labels: string[] = [];

  function addName(raw: string): void {
    const name = raw
      .trim()
      .replace(/^[🪵🧩🪤🧽]+/u, "")  // strip emoji prefix
      .replace(/^\[|\]$/g, "")         // strip surrounding brackets
      .trim();
    if (!name || set.has(name.toLowerCase())) return;
    set.add(name.toLowerCase());
    labels.push(name);
  }

  // Lines with explicit "Товар:" prefix
  const re1 = /Товар:\s*"?([^"\n\r]+)"?/g;
  let m: RegExpExecArray | null;
  while ((m = re1.exec(content)) !== null) addName(m[1]);

  // Standalone product lines without "Товар:" prefix: "🧩[Name]" or "[Name]"
  const re2 = /^[🪵🧩🪤🧽]*\[([^\]]+)\]\s*$/gmu;
  while ((m = re2.exec(content)) !== null) addName(m[1]);

  return { set, labels };
}

export function parseKnownProducts(content: string): Set<string> {
  return parseKnownCatalog(content).set;
}

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

function extractTemplatePrefixes(labels: string[]): Set<string> {
  const prefixes = new Set<string>();
  for (const label of labels) {
    const first = label.trim().split(/\s/)[0].toLowerCase();
    if (first) prefixes.add(first);
  }
  return prefixes;
}

function similarKnownNames(needle: string, labels: string[], limit = 3): string[] {
  const q = needle.toLowerCase();
  const maxDist = Math.max(2, Math.min(5, Math.floor(q.length / 3)));
  return labels
    .map((label) => ({ label, d: levenshtein(q, label.toLowerCase()) }))
    .filter((x) => x.d > 0 && x.d <= maxDist)
    .sort((a, b) => a.d - b.d || a.label.length - b.label.length)
    .slice(0, limit)
    .map((x) => x.label);
}

const KNOWN_UOMS = new Set([
  "шт",
  "шт.",
  "м",
  "m",
  "м²",
  "m²",
  "m2",
  " m²",
  "м³",
  "m³",
  "m3",
  " m³",
  "кг",
  "kg",
  "г",
  "g",
  "метр",
]);

// Канонічні UOM після форматування — те що checker вважає "правильним"
const CANONICAL_UOMS = new Set(["шт.", "m", "m²", "m³", "кг", "г"]);

const UOM_SUGGESTION: Record<string, string> = {
  шт: "шт.",
  kg: "кг",
  g: "г",
  м: "m",
  метр: "m",
  м2: "m²",
  m2: "m²",
  м3: "m³",
  m3: "m³",
};

function normalizeUom(s: string): string {
  return s.toLowerCase().replace(/\s+/g, "").replace(/\.$/, "");
}

function isKnownUom(uomStr: string): boolean {
  const s = normalizeUom(uomStr);
  return KNOWN_UOMS.has(s) || s.includes("²") || s.includes("³");
}

function canonicalUomHint(uomStr: string): string | undefined {
  return (
    UOM_SUGGESTION[uomStr.replace(/\.$/, "")] ??
    UOM_SUGGESTION[uomStr.toLowerCase().replace(/\.$/, "")]
  );
}

// Перевірити що emoji стоїть перед дужкою, а не всередині
function checkEmojiPosition(line: string): boolean {
  const EMOJIS = ["🪵", "🧩", "🪤🧽", "🪤"];
  for (const emoji of EMOJIS) {
    if (line.includes(`[`) && line.includes(emoji)) {
      const bracketIdx = line.indexOf("[");
      const emojiIdx = line.indexOf(emoji);
      if (emojiIdx > bracketIdx) return false; // emoji всередині або після дужки
    }
  }
  return true;
}

// Перевірити пробіл після крапки в атрибутах
function checkAttrDotSpaces(line: string): boolean {
  const attrMatch = line.match(/\(([^)]+)\)/g);
  if (!attrMatch) return true;
  for (const attr of attrMatch) {
    if (/\.\s+[А-ЯҐЄІЇа-яґєії]/.test(attr)) return false;
  }
  return true;
}

// Перевірити кількість: qty > 0
function checkQty(qtyStr: string): boolean {
  const qty = parseFloat(qtyStr.replace(",", "."));
  return qty > 0;
}

export function checkDocumentContent(
  content: string,
  knownProducts: Set<string> = new Set(),
  knownLabels: string[] = [...knownProducts],
): CheckResult {
  const lines = content.split("\n");
  const commented = lineHtmlCommentFlags(content);
  const errors: CheckError[] = [];
  const warnings: CheckError[] = [];
  const knownTemplatePrefixes = extractTemplatePrefixes(knownLabels);

  let inWorkshop = false;
  let hasWorkshops = false;
  let workshopHasPrice = false;
  let workshopHasContent = false;
  let workshopLabel = "";
  let workshopHeaderLine = 0;

  const warnMissingPrice = () => {
    if (inWorkshop && !workshopHasPrice && workshopHasContent) {
      warnings.push({
        line: workshopHeaderLine,
        severity: "warning",
        message: `Цех "${workshopLabel}" не має рядка "Ціна"`,
        original: "",
      });
    }
  };

  // ─── Foam variant tracking (Цех №5) ─────────────────────────────────────────
  const FOAM_OUTPUT_RE = /🧩\[Поролон - нарізані компоненти\]/u;
  const FOAM_VARIANT_RE = /@Диван Пружинний Блок=(Звичайний Блок|Посилений Блок)/;
  const FOAM_DOUBLE_RES: RegExp[] = [
    /\[Поролон\]\s*\(ST-2233\s*\(2000x1600x40x70\)\)/u,
    /\[Войлок\]\s*\(1\.60\)/u,
  ];

  let inWorkshop5 = false;
  const foamBlocks5: FoamBlock[] = [];
  let currentFoam5: FoamBlock | null = null;

  const flushFoam5 = () => {
    if (currentFoam5) {
      foamBlocks5.push({ ...currentFoam5 });
      currentFoam5 = null;
    }
  };

  const buildFoamSuggestion = (
    existing: FoamBlock,
    target: "Звичайний Блок" | "Посилений Блок",
  ): string => {
    const multiplier = target === "Посилений Блок" ? 2 : 0.5;
    const newOutputLine = existing.outputLine.includes("@Диван Пружинний Блок=")
      ? existing.outputLine.replace(FOAM_VARIANT_RE, `@Диван Пружинний Блок=${target}`)
      : `${existing.outputLine} // @Диван Пружинний Блок=${target}`;
    const newMatLines = existing.matLines.map((matLine) => {
      if (!FOAM_DOUBLE_RES.some((re) => re.test(matLine))) return matLine;
      return matLine.replace(/-\s*([\d.,]+)\s*([^\s]+)\s*$/, (_, qty, uom) => {
        const newQty = parseFloat(qty.replace(",", ".")) * multiplier;
        return `- ${parseFloat(newQty.toFixed(3))} ${uom}`;
      });
    });
    return [newOutputLine, ...newMatLines].join("\n");
  };

  const validateFoam5 = () => {
    flushFoam5();
    if (foamBlocks5.length === 0 || foamBlocks5.length >= 2) {
      foamBlocks5.length = 0;
      currentFoam5 = null;
      return;
    }
    const existing = foamBlocks5[0];
    const missingVariant =
      existing.variant === "Посилений Блок" ? "Звичайний Блок" : "Посилений Блок";
    const suggestion = buildFoamSuggestion(existing, missingVariant);
    warnings.push({
      line: existing.lineNum,
      severity: "warning",
      message:
        `Цех №5: відсутній варіант "${missingVariant}" для [Поролон - нарізані компоненти]. ` +
        `Запропонований блок:\n\nабо\n\n${suggestion}`,
      original: "",
    });
    foamBlocks5.length = 0;
    currentFoam5 = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) continue;
    if (commented[i]) continue;

    // Workshop header (тільки якщо є "№" — щоб не чіпати "## Цехи:" тощо)
    if (trimmed.startsWith("#") && trimmed.includes("№")) {
      warnMissingPrice();
      const m = trimmed.match(
        /^#+\s*Цех\s+№([\w-]+)\s+(.+?)\s+-\s+(\S+)\s+[“"](.+?)["”]\s*$/,
      );
      if (!m) {
        errors.push({
          line: lineNum,
          severity: "error",
          message: `Некоректний заголовок цеху. Очікується: # Цех №N Назва - КОД "Операція (Цех №N)"`,
          original: trimmed,
        });
      }
      workshopLabel = trimmed.match(/^#+\s*(Цех\s+№[\w-]+)/)?.[1] ?? trimmed;
      workshopHeaderLine = lineNum;
      workshopHasPrice = false;
      workshopHasContent = false;
      inWorkshop = true;
      hasWorkshops = true;
      if (inWorkshop5) validateFoam5();
      const wsNumM = trimmed.match(/Цех\s+№([\w-]+)/);
      inWorkshop5 = wsNumM ? wsNumM[1] === "5" : false;
      if (inWorkshop5) { foamBlocks5.length = 0; currentFoam5 = null; }
      continue;
    }

    // Detect Ціна line (before inWorkshop check so it fires inside workshop context)
    if (inWorkshop) {
      const priceMatch = trimmed.match(/^Ціна\s+([\d.]+)\s*грн/i);
      if (priceMatch) {
        workshopHasPrice = true;
        const price = parseFloat(priceMatch[1]);
        if (price === 0 && /<!--\s*\?\s*-->/.test(trimmed)) {
          warnings.push({
            line: lineNum,
            severity: "warning",
            message: `Ціна = 0 у цеху "${workshopLabel}" — ще не підтверджена. Зітріть «<!-- ? -->», якщо нуль правильний.`,
            original: trimmed,
          });
        }
        continue;
      }
    }

    if (!inWorkshop) continue;

    workshopHasContent = true;

    if (inWorkshop5) {
      if (trimmed === "або" || trimmed === "Або") {
        flushFoam5();
      } else if (FOAM_OUTPUT_RE.test(trimmed)) {
        flushFoam5();
        const varM = trimmed.match(FOAM_VARIANT_RE);
        currentFoam5 = {
          lineNum,
          variant: varM ? (varM[1] as "Звичайний Блок" | "Посилений Блок") : null,
          outputLine: trimmed,
          matLines: [],
        };
      } else if (currentFoam5 && trimmed.startsWith("[") && /- [\d.,]+/.test(trimmed)) {
        currentFoam5.matLines.push(trimmed);
      }
    }

    if (
      trimmed.startsWith("//") ||
      trimmed.startsWith("<<") ||
      trimmed.startsWith("<!--") ||
      trimmed === "або" ||
      trimmed === "Або" ||
      trimmed === "---"
    )
      continue;

    // Check emoji position
    if (!checkEmojiPosition(line)) {
      errors.push({
        line: lineNum,
        severity: "error",
        message: `Emoji має стояти ПЕРЕД дужкою: 🪵[Назва], не [Назва - 🪵 слово]`,
        original: trimmed,
      });
    }

    // Check dot spaces in attributes
    if (!checkAttrDotSpaces(line)) {
      errors.push({
        line: lineNum,
        severity: "error",
        message: `Пробіл після крапки в атрибуті. Правильно: (Б.Нео), не (Б. Нео)`,
        original: trimmed,
      });
    }

    // Check "100 ДСП" with space
    if (/\(.*100\s+ДСП.*\)/.test(line)) {
      errors.push({
        line: lineNum,
        severity: "error",
        message: `Пробіл між "100" і "ДСП". Правильно: (100ДСП Механізм)`,
        original: trimmed,
      });
    }

    // Check known material names
    if (/\bКрошка\b/i.test(trimmed)) {
      errors.push({
        line: lineNum,
        severity: "error",
        message: `Неправильна назва: "Крошка ППУ" → "Крихта ППУ"`,
        original: trimmed,
      });
    }
    if (/\bдеровина\b/i.test(trimmed)) {
      errors.push({
        line: lineNum,
        severity: "error",
        message: `Друкарська помилка: "деровина" → "деревина"`,
        original: trimmed,
      });
    }

    // Check [Name] attr - qty without parens around attr (syntax violation)
    if (/\[[^\]]+\]\s+[^(\s\-][^\s\-]*\s+-\s*[\d]/.test(trimmed)) {
      errors.push({
        line: lineNum,
        severity: "error",
        message: `Атрибут після назви має бути в дужках: "[Назва] (Атрибут)", не "[Назва] Атрибут"`,
        original: trimmed,
      });
    }

    // Check bare product with numeric model identifier (e.g. "Планка 198 - 1 шт.")
    if (
      !trimmed.startsWith("[") &&
      !trimmed.startsWith("//") &&
      !trimmed.startsWith("(") &&
      !trimmed.startsWith("#") &&
      /^[А-ЯҐЄІЇа-яґєіїє][\wА-ЯҐЄІЇа-яґєіїє\s-]*?\s+\d{2,}\w*\s+-\s*[\d,.]+/.test(
        trimmed,
      )
    ) {
      warnings.push({
        line: lineNum,
        severity: "warning",
        message: `Можливо потрібні квадратні дужки: "${trimmed.split(" - ")[0].trim()}" — перевірте чи це компонент-специфікатор`,
        original: trimmed,
      });
    }

    // Check UOM in component lines
    const compQtyMatch = line.match(/-\s*([\d,.]+)\s*([^\s]+)\s*$/);
    if (compQtyMatch) {
      const qtyStr = compQtyMatch[1];
      const uomStr = compQtyMatch[2];
      if (!checkQty(qtyStr)) {
        warnings.push({
          line: lineNum,
          severity: "warning",
          message: `Кількість = 0 або від'ємна: "${qtyStr}"`,
          original: trimmed,
        });
      }
      if (!isKnownUom(uomStr)) {
        const hint = canonicalUomHint(uomStr);
        const suggestion = hint
          ? ` → "${hint}"`
          : ". Відомі: шт., m, m², m³, кг, г";
        warnings.push({
          line: lineNum,
          severity: "warning",
          message: `Невідома одиниця виміру: "${uomStr}"${suggestion}`,
          original: trimmed,
        });
      } else if (
        !CANONICAL_UOMS.has(
          uomStr.replace(/\.$/, "") === "шт" ? "шт." : uomStr,
        ) &&
        !CANONICAL_UOMS.has(uomStr)
      ) {
        const hint = canonicalUomHint(uomStr);
        if (hint) {
          warnings.push({
            line: lineNum,
            severity: "warning",
            message: `Нестандартна одиниця виміру: "${uomStr}" → "${hint}"`,
            original: trimmed,
          });
        }
      }
    }

    // Check product names against known templates
    if (knownProducts.size > 0) {
      const bracketMatch = trimmed.match(/\[([^\]]+)\]/);
      if (bracketMatch) {
        const productName = bracketMatch[1].trim().toLowerCase();
        if (!knownProducts.has(productName)) {
          const shown = bracketMatch[1].trim();
          const near = similarKnownNames(shown, knownLabels);
          if (near.length > 0) {
            // Similar name found — likely a typo, suggest correction
            warnings.push({
              line: lineNum,
              severity: "warning",
              message: `Товар "${shown}" не знайдено в right_names_odoo_base.md. Схожі: ${near.map((n) => `«${n}»`).join(", ")}`,
              original: trimmed,
            });
          } else {
            // No similar name — check if it's a completely new template (unknown first word)
            const firstWord = shown.split(/\s/)[0].toLowerCase();
            if (!knownTemplatePrefixes.has(firstWord)) {
              warnings.push({
                line: lineNum,
                severity: "warning",
                message: `Новий шаблон товару "${shown}" — перевірте правильність назви`,
                original: trimmed,
              });
            }
            // Known prefix → new product variant, no warning needed
          }
        }
      }
    }
  }

  // Check last workshop price
  warnMissingPrice();
  if (inWorkshop5) validateFoam5();

  if (!hasWorkshops) {
    errors.push({
      line: 0,
      severity: "error",
      message: `Файл не містить жодного заголовку цеху (# Цех №N ...)`,
      original: "",
    });
  }

  return {
    errors,
    warnings,
    valid: errors.length === 0,
  };
}

export function checkDocument(
  filePath: string,
  referenceBasePath?: string,
): CheckResult {
  const content = fs.readFileSync(filePath, "utf-8");
  if (!referenceBasePath || !fs.existsSync(referenceBasePath)) {
    return checkDocumentContent(content);
  }
  const catalog = parseKnownCatalog(fs.readFileSync(referenceBasePath, "utf-8"));
  return checkDocumentContent(content, catalog.set, catalog.labels);
}

export function formatCheckReport(
  result: CheckResult,
  filePath: string,
): string {
  const lines: string[] = [];
  const fileName = path.basename(filePath);

  lines.push(`# Звіт валідації: ${fileName}`);
  lines.push("");

  if (result.valid && result.warnings.length === 0) {
    lines.push("✅ Помилок не знайдено. Файл готовий до імпорту.");
    return lines.join("\n");
  }

  if (result.errors.length > 0) {
    lines.push(`## ❌ Помилки (${result.errors.length})`);
    lines.push("");
    for (const e of result.errors) {
      lines.push(`- **Рядок ${e.line}:** ${e.message}`);
      if (e.original) lines.push(`  > \`${e.original}\``);
    }
    lines.push("");
  }

  if (result.warnings.length > 0) {
    lines.push(`## ⚠️ Попередження (${result.warnings.length})`);
    lines.push("");
    for (const w of result.warnings) {
      lines.push(`- **Рядок ${w.line}:** ${w.message}`);
      if (w.original) lines.push(`  > \`${w.original}\``);
    }
  }

  return lines.join("\n");
}
