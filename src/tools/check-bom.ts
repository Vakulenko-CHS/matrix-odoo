import * as fs from "fs";
import * as path from "path";
import { SOFA_START_RE, stripSpecComment } from "./specLine";
import { lineHtmlCommentFlags } from "./htmlComment";

const EMOJI_RE = /^[🪵🧩🪤🧽]+/u;
const BRACKET_START = /^\[.+\]\s*\(/u;
const SECTION_RE = /^#+\s*(Цех\s*№[\d\-]+)/u;

// Broad qty pattern: "- N unit?" OR "- unit" at end of line.
// Also matches unit-only lines like "- шт." (missing number → [NOUNIT]).
const ANY_QTY_RE = /[-]\s*(?:[\d.,]+\s*(кг|m³|m²|дм²|m|шт\.?)?|(кг|m³|m²|дм²|m|шт\.?))\s*$/u;

// Narrower pattern used to extract qty+unit values for zero/nounit checks
const QTY_EXTRACT_RE = /[-]\s*([\d.,]*)\s*(кг|m³|m²|дм²|m|шт\.?)?\s*$/u;

const VALID_UNITS = new Set(["кг", "m", "m²", "m³", "шт", "шт.", "дм²"]);

// TODO: [CHECK] SPELLING_FIXES — авто-виправлення написання назв сировини/фурнітури.
// Помилка в написанні = товар не знаходить свій keyword у RAW_MATERIAL_CATEGORY
// (src/tools/importJson/template-bom/importer.ts) і залишається без категорії в Odoo.
// Додавати нові правила при виявленні нових орфографічних варіантів.
const SPELLING_FIXES: Array<{ wrong: RegExp; correct: string }> = [
  // "Тик -так" (и замість і, пробіл перед дефісом) → "Тік-так"
  { wrong: /Тик\s*-\s*так/u, correct: "Тік-так" },
];

// TODO: [CHECK] SERVICE_ITEMS — список назв сервісних товарів що ПОВИННІ мати
// префікс "(Послуга)" перед назвою. Без нього docToJson не виставляє isService:true
// → applyProductCategories (importer.ts) не пропускає товар при класифікації
// → він може отримати неправильну категорію або залишитись без неї в Odoo.
const SERVICE_ITEMS = new Set(["Перевірка Якості"]);

function stripComment(line: string): string {
  return stripSpecComment(line);
}

function isOutputLine(t: string): boolean {
  if (ANY_QTY_RE.test(t)) return false; // has qty → it's a component
  return (
    (EMOJI_RE.test(t) && t.includes("[")) ||
    BRACKET_START.test(t) ||
    SOFA_START_RE.test(t)
  );
}

function isAbo(t: string): boolean {
  return /^(або|Або|АБО)$/.test(t);
}

// A block is "conditional" when its output line has a "// @Attr=Value" tag.
// Conditional blocks are alternatives — they need "або" between them.
// Unconditional blocks (no // @) are produced in parallel — no "або" needed.
function hasConditionalTag(rawLine: string): boolean {
  return /\/\/\s*@/.test(rawLine);
}

interface Fix {
  lineIdx: number;
  content: string;
}

export function runBomCheck(
  content: string,
  fileName: string,
  applyTodos = true,
): { content: string; issues: string[] } {
  console.log(`\nBOM: ${fileName}`);
  const lines = content.split("\n");
  const commented = lineHtmlCommentFlags(content);
  const issues: string[] = [];
  const fixes: Fix[] = [];
  const pendingTodos = new Map<number, string[]>(); // lineIdx → todo messages

  // TODO: [CHECK] Pre-pass: spelling + service prefix ─────────────────────
  // Проходимо всі рядки ДО основного циклу. Pre-pass обробляє ВСІ рядки
  // (включно з # ВТК яку основний цикл пропускає бо вона не є "Цех №").
  for (let i = 0; i < lines.length; i++) {
    if (commented[i]) continue;
    // Spelling auto-fix: виправляємо відомі орфографічні варіанти назв
    // сировини/фурнітури що є ключовими словами у RAW_MATERIAL_CATEGORY.
    for (const rule of SPELLING_FIXES) {
      if (!rule.wrong.test(lines[i])) continue;
      const wrong = lines[i].match(rule.wrong)![0];
      lines[i] = lines[i].replace(rule.wrong, rule.correct);
      const msg = `[FIX] Написання: "${wrong}" → "${rule.correct}" (рядок ${i + 1})`;
      console.log(`  ${msg}`);
      issues.push(msg);
    }

    // Service prefix auto-fix: перевіряємо SERVICE_ITEMS рядки.
    // # ВТК не є "Цех №" і пропускається основним циклом — тому перевіряємо тут.
    // Рядки типу "Перевірка Якості - 1 шт." без "(Послуга)" виправляємо in-place.
    const trimmedLine = lines[i].trim();
    for (const svcName of SERVICE_ITEMS) {
      if (!trimmedLine.includes(svcName)) continue;
      if (trimmedLine.startsWith("(Послуга)")) break; // вже правильно
      const indent = lines[i].match(/^(\s*)/)?.[1] ?? "";
      lines[i] = indent + "(Послуга) " + lines[i].trimStart();
      const msg = `[FIX] Сервіс: додано "(Послуга)" до "${trimmedLine.replace(/\s*-\s*[\d.,]*\s*шт\.?\s*$/, "").trim()}"`;
      console.log(`  ${msg}`);
      issues.push(msg);
      break;
    }
  }

  let section = "";

  // Per-block state
  let blockOutputLine = -1;
  let blockOutputText = "";
  let blockIsConditional = false;
  let blockHasInputs = false;
  let blockIsPurchased = false; // true when output line has <!-- Купляється -->
  let seenAbo = true; // true at start of section so first block is always ok

  function flushBlock() {
    if (blockOutputLine < 0) return;
    if (!blockHasInputs) {
      if (blockIsPurchased) {
        // Purchased item — no BOM needed, just info
        console.log(`  [BUY] ${section}: "${blockOutputText}" — купляється, специфікація не потрібна`);
      } else {
        const msg = `[EMPTY] ${section}: порожня специфікація "${blockOutputText}"`;
        console.log(`  ${msg}`);
        issues.push(msg);
        fixes.push({ lineIdx: blockOutputLine, content: "<!-- TODO: записати компоненти -->" });
      }
    }
  }

  function resetBlock() {
    blockOutputLine = -1;
    blockOutputText = "";
    blockIsConditional = false;
    blockHasInputs = false;
    blockIsPurchased = false;
  }

  for (let i = 0; i < lines.length; i++) {
    if (commented[i]) continue;
    const raw = lines[i];
    const t = stripComment(raw);

    if (!t) continue;

    // Section header
    const hMatch = SECTION_RE.exec(t);
    if (hMatch) {
      flushBlock();
      resetBlock();
      section = hMatch[1];
      seenAbo = true;
      continue;
    }

    if (!section) continue;

    // "або" separator
    if (isAbo(t)) {
      flushBlock();
      resetBlock();
      seenAbo = true;
      continue;
    }

    // "---" горизонтальна лінія — роздільник між паралельними групами продуктів
    // (наприклад, Д.Леон-Люкс Механізм і 143П в одному цеху).
    // Це НЕ "або" (альтернатива), але скидає стан блоку щоб не спрацьовував
    // хибний [BREAK] "відсутнє або" між умовними блоками різних моделей.
    if (t === "---") {
      flushBlock();
      resetBlock();
      seenAbo = true;
      continue;
    }

    // Output line
    if (isOutputLine(t)) {
      const isConditional = hasConditionalTag(raw);

      // Flag missing "або" only when at least one of the two consecutive blocks is conditional
      if (blockOutputLine >= 0 && !seenAbo && (blockIsConditional || isConditional)) {
        const msg = `[BREAK] ${section}: відсутнє "або" перед "${t}"`;
        console.log(`  ${msg}`);
        issues.push(msg);
        // Insert TODO so the user sees the reason in the file
        const alreadyTodo = lines
          .slice(i + 1, i + 4)
          .some((l) => l.includes("<!-- TODO: [BREAK] відсутнє"));
        if (!alreadyTodo) {
          fixes.push({
            lineIdx: i,
            content: `<!-- TODO: [BREAK] відсутнє "або" перед цим рядком — два умовні блоки підряд. Додайте "або" між ними якщо це альтернативи, або "---" якщо це різні моделі -->`,
          });
        }
      }

      flushBlock();
      resetBlock();
      blockOutputLine = i;
      blockOutputText = t;
      blockIsConditional = isConditional;
      blockIsPurchased = /<!--\s*Купляється\s*-->/i.test(raw);
      seenAbo = false;
      continue;
    }

    // Component / material line with quantity
    if (ANY_QTY_RE.test(t) && blockOutputLine >= 0) {
      blockHasInputs = true;

      const m = QTY_EXTRACT_RE.exec(t);
      if (m) {
        const qtyStr = m[1];
        const unit = m[2];
        const lineTodos: string[] = [];

        if (!qtyStr) {
          const msg = `[NOUNIT] ${section}: відсутня кількість у "${t}"`;
          console.log(`  ${msg}`);
          issues.push(msg);
          lineTodos.push("відсутня кількість");
        } else {
          const qty = parseFloat(qtyStr.replace(",", "."));
          if (qty === 0) {
            const msg = `[ZERO] ${section}: нульова кількість у "${t}"`;
            console.log(`  ${msg}`);
            issues.push(msg);
            lineTodos.push("нульова кількість");
          }
        }

        if (!unit) {
          const msg = `[NOUNIT] ${section}: відсутня одиниця виміру у "${t}"`;
          console.log(`  ${msg}`);
          issues.push(msg);
          lineTodos.push("відсутня одиниця виміру");
        } else if (!VALID_UNITS.has(unit)) {
          const msg = `[NOUNIT] ${section}: невідома одиниця "${unit}" у "${t}"`;
          console.log(`  ${msg}`);
          issues.push(msg);
          lineTodos.push(`невідома одиниця "${unit}"`);
        }

        if (lineTodos.length > 0) {
          pendingTodos.set(i, lineTodos);
        }
      }
    }
  }

  flushBlock();

  // Convert per-line TODO messages to insert-after fixes
  for (const [lineIdx, msgs] of pendingTodos) {
    fixes.push({ lineIdx, content: `<!-- TODO: ${msgs.join("; ")} -->` });
  }

  if (issues.length === 0) console.log("  ✅ BOM в порядку.");
  if (!applyTodos || fixes.length === 0) {
    return { content: lines.join("\n"), issues };
  }

  fixes.sort((a, b) => b.lineIdx - a.lineIdx);
  const result = [...lines];
  for (const fix of fixes) {
    result.splice(fix.lineIdx + 1, 0, fix.content);
  }
  return { content: result.join("\n"), issues };
}

// ─── Entry point ─────────────────────────────────────────────────────────────

function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error("Usage: ts-node check-bom.ts <path-to-md-file>");
    process.exit(1);
  }
  const absPath = path.resolve(filePath);
  if (!fs.existsSync(absPath)) {
    console.error(`File not found: ${absPath}`);
    process.exit(1);
  }
  const original = fs.readFileSync(absPath, "utf-8");
  const fileName = path.basename(absPath);
  const { content: fixed, issues } = runBomCheck(original, fileName);
  console.log(`\nПомилок: ${issues.length}`);
  if (fixed !== original) {
    fs.writeFileSync(absPath, fixed, "utf-8");
    console.log("✅ Файл оновлено.");
  }
}

if (typeof require !== "undefined" && require.main === module) {
  main();
}
