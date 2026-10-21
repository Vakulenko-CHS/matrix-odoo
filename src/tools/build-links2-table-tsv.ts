/**
 * Build a clean links-2 TSV for spreadsheet (short comments only).
 * Uses temp/links-2-index.json (26 rows), not multiline links-2.tsv parse.
 *   npx ts-node --transpile-only src/tools/build-links2-table-tsv.ts
 */
import * as fs from "fs";
import * as path from "path";

interface IndexRow {
  name: string;
  url: string;
}

const SHORT_COMMENT: Record<string, string> = {
  "Диван Угол Леон-Люкс 200 Колеса": "",
  "Диван Угол Берлін": "Фурнітура: мех.Сабля(Балюта) — назва в Odoo?",
  "Диван Угол Берлін-2":
    "Косий/Прямий у цехах; мех.Сабля; [ДВП дно] vs [ДВП] у Ц2дс2",
  "Диван Угол Бонд-К": "Ц9: атрибут «Короб з шухлядкою» (Без короба / З шухлядкою), 396 vs 438 грн",
  "Диван Угол Угол Барселона-Т": "OK: Куток великий чорний у специ",
  "Диван Угол Прадо": "",
  "Диван Сітті": "Дубль URL з «Сітті глухі бил-ця»?",
  "Диван Угол Престиж 140": "мдф венге 165×1000 — SKU Odoo",
  "Диван Угол Престиж 200": "мдф венге 165×1000 — SKU Odoo",
  "Диван Угол Престиж Б-4": "",
  "Диван Угол Престиж ПБ-4": "мдф венге 165×1000",
  "Диван Угол Престиж-П": "мдф венге; виправлено {Б-4}→Б-4 локально",
  "Диван Угол Престиж 200М": "мдф венге 165×1000",
  "Диван Угол Престиж МБ-4": "мдф венге; виправлено {Б-4}→Б-4",
  "Диван Угол Престиж ПМ": "мдф венге 165×1000",
  "Диван Угол Престиж ПБ-4 Ніши":
    "Ламінат Ніши 100 у коментарі Ц3-1; мдф 250×1000",
  "Диван Угол Престиж ПБ-4 М*які Бил-ця":
    "Накладка 101x25 у коментарі Ц2дс1; мдф венге",
  "Диван Техас": "Pattern B — нові шаблони при імпорті",
  "Диван Джаз": "Pattern B",
  "Диван Сігма": "Pattern B",
  "Диван Престиж": "мдф венге 165×1000; Pattern B",
  "Диван Техас-2": "Pattern B",
  "Диван Угол Леон-Люкс 200 Колеса М*які Бильця": "",
  "Диван Угол Леон-Люкс 200 Механізм М*які Бильця":
    "Накладка 101x25 у коментарі Ц2дс1 — прибрати?",
  "Диван Угол Сітті":
    "Ланцюг: Д.Сітті/М.Ч→Угол Сітті (локально); лиш. Планка 263, накладка",
  "Диван Угол Монреаль": "Ланцюг: Д.Сітті/М.Ч→Угол Монреаль (локально)",
};

const SHORT_NEW: Record<string, string> = {
  "Диван Угол Берлін": "мех.Сабля(Балюта)",
  "Диван Угол Берлін-2": "мех.Сабля(Балюта)",
  "Диван Престиж": "мдф венге 165×1000",
  "Диван Угол Престиж 140": "мдф венге 165×1000",
  "Диван Угол Престиж 200": "мдф венге 165×1000",
  "Диван Угол Престиж Б-4": "мдф венге 165×1000",
  "Диван Угол Престиж ПБ-4": "мдф венге 165×1000",
  "Диван Угол Престиж-П": "мдф венге 165×1000",
  "Диван Угол Престиж 200М": "мдф венге 165×1000",
  "Диван Угол Престиж МБ-4": "мдф венге 165×1000",
  "Диван Угол Престиж ПМ": "мдф венге 165×1000",
  "Диван Угол Престиж ПБ-4 Ніши": "мдф венге 250×1000",
  "Диван Угол Престиж ПБ-4 М*які Бил-ця": "мдф венге 165×1000",
};

function escCell(s: string): string {
  if (!s) return "";
  if (/[\t\n\r"]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function statusFor(name: string, comment: string): string {
  if (name === "Диван Угол Монреаль") return "chain виправлено";
  if (name === "Диван Угол Сітті") return "chain частково";
  if (comment.includes("?")) return "питання";
  if (SHORT_NEW[name]) return "фурнітура";
  if (
    name.startsWith("Диван Техас") ||
    name === "Диван Джаз" ||
    name === "Диван Сігма" ||
    name === "Диван Престиж" ||
    name === "Диван Угол Прадо"
  )
    return "Pattern B";
  return "ready";
}

function main(): void {
  const indexPath = path.resolve("temp/links-2-index.json");
  const rows = JSON.parse(fs.readFileSync(indexPath, "utf-8")) as IndexRow[];
  const lines = [
    "Назва\tПосилання\tКоментар (коротко)\tНові компоненти (коротко)\tСтатус",
  ];
  for (const r of rows) {
    const comment = SHORT_COMMENT[r.name] ?? "";
    const neu = SHORT_NEW[r.name] ?? "";
    const status = statusFor(r.name, comment);
    lines.push(
      [
        escCell(r.name),
        escCell(r.url),
        escCell(comment),
        escCell(neu),
        escCell(status),
      ].join("\t"),
    );
  }
  const out = path.resolve("temp/links-2-table.tsv");
  fs.writeFileSync(out, lines.join("\n") + "\n", "utf-8");
  console.log(`Wrote ${rows.length} rows → ${out}`);
}

main();
