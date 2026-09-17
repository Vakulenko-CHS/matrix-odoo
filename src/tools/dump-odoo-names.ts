/**
 * Read-only dump of every product.template (+ variant count) from live Odoo.
 * Does not write Odoo or right_names_*.md.
 *
 *   npm run dump-names
 *
 * Output (gitignored): temp/odoo-all-names.md, temp/odoo-all-names.tsv
 */
import * as fs from "fs";
import * as path from "path";
import { authenticate, executeKw } from "../api/odoo";

interface Tmpl {
  id: number;
  name: string;
  default_code: string | false;
  type: string;
  active: boolean;
  categ_id: [number, string] | false;
  uom_id: [number, string] | false;
  attribute_line_ids: number[];
  product_variant_count?: number;
}

interface Category {
  id: number;
  complete_name: string;
}

const PAGE = 500;
const PAUSE_MS = 250;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function searchReadPaged<T>(
  model: string,
  fields: string[],
): Promise<T[]> {
  const out: T[] = [];
  let offset = 0;
  for (;;) {
    const batch = await executeKw<T[]>(model, "search_read", [[]], {
      fields,
      limit: PAGE,
      offset,
      context: { lang: "uk_UA", active_test: true },
    });
    out.push(...batch);
    process.stderr.write(
      `[dump-names] ${model} +${batch.length} (total ${out.length})\n`,
    );
    if (batch.length < PAGE) break;
    offset += PAGE;
    await sleep(PAUSE_MS);
  }
  return out;
}

function tsvCell(s: string): string {
  return s.replace(/\t/g, " ").replace(/\r?\n/g, " ").trim();
}

function catName(
  t: Tmpl,
  catById: Map<number, string>,
): string {
  if (!t.categ_id) return "Без категорії";
  return catById.get(t.categ_id[0]) ?? t.categ_id[1] ?? "Невідома";
}

async function main(): Promise<void> {
  console.log("[dump-names] Odoo read-only. Canon files untouched.");
  await authenticate();
  await sleep(PAUSE_MS);

  const categories = await searchReadPaged<Category>("product.category", [
    "id",
    "complete_name",
  ]);
  await sleep(PAUSE_MS);
  const templates = (await searchReadPaged<Tmpl>("product.template", [
    "id",
    "name",
    "default_code",
    "type",
    "active",
    "categ_id",
    "uom_id",
    "attribute_line_ids",
    "product_variant_count",
  ])).filter((t) => t.active);

  const catById = new Map(categories.map((c) => [c.id, c.complete_name]));

  const sorted = [...templates].sort((a, b) => {
    const ca = catName(a, catById);
    const cb = catName(b, catById);
    const c = ca.localeCompare(cb, "uk");
    if (c !== 0) return c;
    return a.name.localeCompare(b.name, "uk") || a.id - b.id;
  });

  const dir = path.resolve("temp");
  fs.mkdirSync(dir, { recursive: true });

  const tsvPath = path.join(dir, "odoo-all-names.tsv");
  const mdPath = path.join(dir, "odoo-all-names.md");
  const when = new Date().toISOString().slice(0, 19).replace("T", " ");

  const tsv = [
    [
      "id",
      "category",
      "name",
      "uom",
      "default_code",
      "type",
      "active",
      "attr_lines",
      "variants",
    ].join("\t"),
  ];
  for (const t of sorted) {
    tsv.push(
      [
        t.id,
        tsvCell(catName(t, catById)),
        tsvCell(t.name),
        tsvCell(t.uom_id ? t.uom_id[1] : ""),
        tsvCell(t.default_code || ""),
        t.type,
        t.active ? "1" : "0",
        t.attribute_line_ids?.length ?? 0,
        t.product_variant_count ?? 0,
      ].join("\t"),
    );
  }
  fs.writeFileSync(tsvPath, `${tsv.join("\n")}\n`, "utf-8");

  const md: string[] = [
    `# Odoo — усі шаблони товарів`,
    ``,
    `Знімок: ${when}. Тільки читання. Не канон, не sync-base. Архів (active=false) пропущено.`,
    `Шаблонів: ${templates.length}. Категорій: ${categories.length}. Варіанти — колонка var (не окремий дамп).`,
    ``,
  ];

  let lastCat = "";
  for (const t of sorted) {
    const cat = catName(t, catById);
    if (cat !== lastCat) {
      md.push(`## ${cat}`, ``);
      lastCat = cat;
    }
    const attrs = t.attribute_line_ids?.length ?? 0;
    const nVar = t.product_variant_count ?? 0;
    const code = t.default_code ? ` · ${t.default_code}` : "";
    const dead = t.active ? "" : " · inactive";
    md.push(
      `- \`${t.id}\` ${t.name} — ${t.uom_id ? t.uom_id[1] : "?"} · attrs ${attrs} · var ${nVar}${code}${dead}`,
    );
  }
  md.push("");
  fs.writeFileSync(mdPath, md.join("\n"), "utf-8");

  console.log(`[dump-names] ${mdPath}`);
  console.log(`[dump-names] ${tsvPath}`);
}

main().catch((err) => {
  console.error("[dump-names]", err instanceof Error ? err.message : err);
  process.exit(1);
});
