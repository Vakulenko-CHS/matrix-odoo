/**
 * Builds right_names.md (target Odoo names) from temp/odoo-all-names.tsv.
 * Does not write Odoo. Re-run after a fresh dump-names:
 *
 *   npm run dump-names && npx ts-node src/tools/build-name-canon.ts
 */
import * as fs from "fs";
import * as path from "path";

interface Row {
  id: string;
  category: string;
  name: string;
  uom: string;
  type: string;
  attrs: number;
}

const TSV = path.resolve("temp/odoo-all-names.tsv");
const OUT = path.resolve("right_names.md");

const CAT_FIX: Array<[RegExp, string]> = [
  [/Деровини/g, "Деревини"],
  [/Карказ/g, "Каркас"],
  [/напівфабрікат/g, "напівфабрикат"],
  [/сборка/g, "збірка"],
];

const KEEP_BARE = new Set([
  "[ДВП дно]",
  "[ДВП]",
  "[ДСП]",
  "[Кромка]",
  "[Ламінат]",
  "🧩[Ламінат - лист]",
  "🧩[Ламінат кольоровий - лист]",
  "[Войлок]",
  "[Поролон]",
  "[Синтепон]",
  "[Флізелін]",
  "[Тканина]",
  "[Боннель]",
]);

const DELETE_EXACT = new Set([
  "[ДВП дно] Двп Белое\\Двп",
  "🧩[Ламінат кольоровий - лист] 1006x198",
  "🧩[Ламінат кольоровий - лист] 500Х260",
  "🧩[Ламінат - кольоровий] 1006х198",
  "Ламінат",
  "Перевірка Якості",
]);

const FURNITURE_OLD = new Set([
  "Алігатор оц",
  "Блюз",
  "Блюз 83",
  "Додатковий пруж.блюз",
  "Зацеп",
  "Зацеп краб",
  "[Соединитель] 83 єконом",
  "Соединитель 83 эконом",
  "Стопор",
  "Стопор к еврокніжке",
  "Стопор к евпрокнижке",
  "Тік-так",
  "Распорка",
  "Крюк 312",
  "Опора средняя",
  "[Колесо] д 50 Резиновое Плоское",
  "[Колесо] h32",
  "[Петля]",
  "[Ніжка]",
]);

const COVER_INNERS = [
  "Чохол - напівфабрикат",
  "Чохол - нарізані матеріали",
];

/** Pattern B: generic 🪤[Накладка] (attrs) → per-model templates. */
const OVERLAY_CAT = "Цех / №3-2 [Накладка нарізка деталей]";
const OVERLAY_MODELS: Array<{ model: string; aliases?: string[] }> = [
  { model: "Бар Елегант", aliases: ["бар Елегант"] },
  { model: "Д.Елегант БН" },
  { model: "Д.Елегант НН" },
  { model: "Д.Елегант ПБ" },
  { model: "Д.Елегант ПН" },
  { model: "Д.Еллі" },
  { model: "Д.Ельдорадо" },
  { model: "Д.Ельдорадо-1" },
  { model: "Д.Леон-Люкс", aliases: ["Д. Леон-Люкс"] },
  { model: "Д.Леон-Т" },
  { model: "Д.Сітті" },
  { model: "Полка Елегант", aliases: ["полка Елегант"] },
  { model: "Реал-2Т" },
  { model: "Реал-Т" },
  { model: "Угол Елегант БН" },
  { model: "Угол Елегант НН" },
  { model: "Угол Елегант ПН" },
  { model: "Угол Смарт-1 ПН" },
  { model: "Угол Смарт-2 НН" },
];

function q(s: string): string {
  return JSON.stringify(s);
}

function fixCat(s: string): string {
  let o = s;
  for (const [re, to] of CAT_FIX) o = o.replace(re, to);
  return o;
}

function parseBrackets(name: string): {
  emoji: string;
  inner: string | null;
  suffix: string;
} {
  const m = name.match(/^([🪵🧩🪤🧽]*)\[([^\]]+)\]\s*(.*)$/u);
  if (!m) return { emoji: "", inner: null, suffix: "" };
  return { emoji: m[1], inner: m[2], suffix: m[3].trim() };
}

function fixSuffix(s: string): string {
  return s
    .replace(/компонети/g, "компоненти")
    .replace(/М Ч /g, "М.Ч.")
    .replace(/100ДСП/g, "100 ДСП");
}

function fixInner(inner: string): string {
  return inner.replace(/компонети/g, "компоненти");
}

function splitCover(inner: string): { type: string; model: string } | null {
  for (const type of COVER_INNERS) {
    if (inner === type) return null;
    if (inner.startsWith(`${type} `)) {
      return { type, model: inner.slice(type.length).trim() };
    }
  }
  return null;
}

function readTsv(): Row[] {
  const raw = fs.readFileSync(TSV, "utf-8");
  return raw
    .trim()
    .split("\n")
    .slice(1)
    .map((line) => {
      const [id, category, name, uom, , type, , attrs] = line.split("\t");
      return {
        id,
        category,
        name,
        uom,
        type,
        attrs: Number(attrs),
      };
    });
}

interface CanonItem {
  category: string;
  name: string;
  uom: string;
  aliases: string[];
  note?: string;
}

interface ArchiveItem {
  id: string;
  name: string;
  reason: string;
}

function uniq(xs: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of xs) {
    const k = x.replace(/\s+/g, " ").trim();
    if (!k || seen.has(k.toLowerCase())) continue;
    seen.add(k.toLowerCase());
    out.push(k);
  }
  return out;
}

function main(): void {
  const rows = readTsv();
  const byInner = new Map<string, { bare: Row[]; named: Row[] }>();
  for (const r of rows) {
    const p = parseBrackets(r.name);
    if (!p.inner) continue;
    if (!byInner.has(p.inner)) byInner.set(p.inner, { bare: [], named: [] });
    const g = byInner.get(p.inner)!;
    if (p.suffix) g.named.push(r);
    else g.bare.push(r);
  }

  const archive: ArchiveItem[] = [];
  const canons: CanonItem[] = [];
  const skip = new Set<string>();

  for (const r of rows) {
    if (DELETE_EXACT.has(r.name)) {
      archive.push({
        id: r.id,
        name: r.name,
        reason:
          r.name === "Ламінат"
            ? "злиття в [Ламінат]; у спеках → [Ламінат] (Білий)"
            : r.name === "Перевірка Якості"
              ? "лишаємо (Послуга) Перевірка Якості"
              : "видалити / злити",
      });
      skip.add(r.id);
      continue;
    }
    if (FURNITURE_OLD.has(r.name)) {
      archive.push({
        id: r.id,
        name: r.name,
        reason: "фурнітура → right_names_furniture.md",
      });
      skip.add(r.id);
      continue;
    }
  }

  for (const r of rows) {
    if (skip.has(r.id)) continue;
    const p = parseBrackets(r.name);
    if (p.inner && !p.suffix && !KEEP_BARE.has(r.name)) {
      const g = byInner.get(p.inner);
      const isCoverGeneric = COVER_INNERS.includes(p.inner);
      const isOverlayGeneric = p.inner === "Накладка";
      const hasNamed = Boolean(g && g.named.length > 0);
      if (hasNamed || isCoverGeneric || isOverlayGeneric) {
        archive.push({
          id: r.id,
          name: r.name,
          reason: "універсал А → архів; канон = окремий шаблон на модель (Б)",
        });
        skip.add(r.id);
      }
    }
  }

  for (const r of rows) {
    if (skip.has(r.id)) continue;
    const p = parseBrackets(r.name);
    const category = fixCat(r.category);
    const aliases: string[] = [];
    let name = r.name;
    let note: string | undefined;

    if (p.inner) {
      const cover = splitCover(p.inner);
      if (cover) {
        const type = fixInner(cover.type);
        const model = fixSuffix(cover.model);
        name = `${p.emoji}[${type}] ${model}`;
        aliases.push(r.name);
        aliases.push(`${p.emoji}[${type}] (${model})`);
        aliases.push(`[${p.inner}]`);
        aliases.push(`[${type}] (${model})`);
      } else {
        const inner = fixInner(p.inner);
        const suffix = fixSuffix(p.suffix);
        name = suffix
          ? `${p.emoji}[${inner}] ${suffix}`
          : `${p.emoji}[${inner}]`;
        if (name !== r.name) aliases.push(r.name);
        if (suffix) {
          aliases.push(`${p.emoji}[${inner}] (${suffix})`);
          aliases.push(`${p.emoji}[${p.inner}] (${p.suffix})`);
          aliases.push(`[${inner}] (${suffix})`);
          if (p.suffix !== suffix) {
            aliases.push(`${p.emoji}[${inner}] ${p.suffix}`);
            aliases.push(`${p.emoji}[${inner}] (${p.suffix})`);
          }
        }
      }
    } else {
      name = fixSuffix(r.name);
      if (name !== r.name) aliases.push(r.name);
    }

    if (r.name === "[Подушка] Д.Малібу") {
      note = "type=consu (зараз service — перенести в товари)";
    }
    if (r.name === "(Послуга) Перевірка Якості") {
      note = "категорія Послуги; аліас без префікса";
      aliases.push("Перевірка Якості");
    }
    if (r.name === "Плівка") {
      note = "Odoo UOM = g; у спеках кг; імпорт ×1000";
    }

    canons.push({
      category,
      name,
      uom: r.uom || "Одиниці",
      aliases: uniq(aliases.filter((a) => a !== name)),
      note,
    });
  }

  for (const item of OVERLAY_MODELS) {
    const name = `🪤[Накладка] ${item.model}`;
    const aliases = [
      `🪤[Накладка] (${item.model})`,
      `[Накладка] (${item.model})`,
      ...(item.aliases ?? []).flatMap((a) => [
        `🪤[Накладка] (${a})`,
        `[Накладка] (${a})`,
        `🪤[Накладка] ${a}`,
      ]),
    ];
    canons.push({
      category: OVERLAY_CAT,
      name,
      uom: "Одиниці",
      aliases: uniq(aliases),
      note: "атрибут лише %Колір Ламінату%; універсал 🪤[Накладка] — архів",
    });
  }

  const extraLaminate: CanonItem = {
    category: "Сировина / Дерево",
    name: "🧩[Ламінат кольоровий - лист]",
    uom: "Одиниці",
    aliases: [
      "🧩[Ламінат кольоровий - лист] 1006x198",
      "🧩[Ламінат кольоровий - лист] 500Х260",
      "🧩[Ламінат - кольоровий] 1006х198",
    ],
    note: "атрибути: (1006x198, %Колір Ламінату%) — розмір латиницею x",
  };
  if (!canons.some((c) => c.name === extraLaminate.name)) {
    canons.push(extraLaminate);
  } else {
    const hit = canons.find((c) => c.name === extraLaminate.name)!;
    hit.aliases = uniq([...hit.aliases, ...extraLaminate.aliases]);
    hit.note = extraLaminate.note;
  }

  const lam = canons.find((c) => c.name === "[Ламінат]");
  if (lam) {
    lam.aliases = uniq([...lam.aliases, "Ламінат"]);
    lam.note = "спек `Ламінат` → `[Ламінат] (Білий)`";
  }

  const byCat = new Map<string, CanonItem[]>();
  for (const c of canons) {
    if (!byCat.has(c.category)) byCat.set(c.category, []);
    byCat.get(c.category)!.push(c);
  }
  for (const list of byCat.values()) {
    list.sort((a, b) => a.name.localeCompare(b.name, "uk"));
  }
  const cats = [...byCat.keys()].sort((a, b) => a.localeCompare(b, "uk"));

  const out: string[] = [];
  out.push("# Канон назв (ціль БД)");
  out.push("");
  out.push(
    "Не генерується `npm run sync-base`. Odoo не чіпати, поки не буде команди.",
  );
  out.push(
    "Валідатор мерджить `right_names_odoo_base.md` + `right_names_furniture.md` + цей файл.",
  );
  out.push("Фурнітура (54 окремі товари) — `right_names_furniture.md`.");
  out.push("");
  out.push("## Правила");
  out.push("");
  out.push("- Архів ігноруємо.");
  out.push("- Канон цехів = окремий шаблон на модель (Б). Універсал з attrs — архів.");
  out.push(
    "- Модель **поза** дужками: `🪵[Каркас - нарізана деревина] Д.Малібу`.",
  );
  out.push(
    "- Справжні атрибути в дужках: `🧩[Ламінат кольоровий - лист] (1006x198, %Колір Ламінату%) - 2 шт.`.",
  );
  out.push("- Чохол 7–8: `🪤[Чохол - напівфабрикат] Д.Моллі` (модель не в `[ ]`).");
  out.push(
    "- Накладка 3-2: `🪤[Накладка] Д.Еллі (%Колір Ламінату%)` — окремий шаблон на модель, не універсал з attrs.",
  );
  out.push("- `компонети` → `компоненти`. `сборка` → `збірка`. `Бильце` — однина.");
  out.push("- `М Ч Нео` → `М.Ч.Нео`. `100ДСП` → `100 ДСП`.");
  out.push("- `[Боннель]` лишаємо. `[ДВП]` і `[ДВП дно]` лишаємо.");
  out.push("- Плівка: спек `кг`, Odoo `g`, імпорт ×1000.");
  out.push("- Скотч: `m` і в спеку, і в Odoo.");
  out.push(
    "- `(Послуга) Перевірка Якості` — категорія Послуги. Голі «Перевірка Якості» немає.",
  );
  out.push(
    "- Дивани: пара Колеса/Механізм — канон; Сітті ≠ Сітті Глухі; Нео / Нео 196 / Нео-3 різні; Угол Реал-Т окремо.",
  );
  out.push("");
  out.push("## Категорії (папки Odoo)");
  out.push("");
  out.push("| Було | Має бути |");
  out.push("|---|---|");
  out.push("| `Цех / №1 [Нарізка Деровини]` | `Цех / №1 [Нарізка Деревини]` |");
  out.push("| `Цех / №2-2 [Карказ нарізка деталей]` | `Цех / №2-2 [Каркас нарізка деталей]` |");
  out.push(
    "| `Цех / №4-2 [Карказ сборка напівфабрікат]` | `Цех / №4-2 [Каркас збірка напівфабрикат]` |",
  );
  out.push("| `… напівфабрікат` | `… напівфабрикат` |");
  out.push(
    "| `Цех / №6 [Карказ + Поролон - напівфабрікат]` | `Цех / №6 [Каркас + Поролон - напівфабрикат]` |",
  );
  out.push("| `сборка` | `збірка` |");
  out.push("| Без категорії (послуга ВТК) | `Послуги` |");
  out.push("");

  for (const cat of cats) {
    out.push(`## ${cat}`);
    out.push("");
    for (const item of byCat.get(cat)!) {
      out.push(`Товар: ${item.name}`);
      out.push(`uoms: ${q(item.uom)}`);
      if (item.aliases.length) {
        out.push(`Аліаси: ${item.aliases.map(q).join(", ")}`);
      }
      if (item.note) out.push(`// ${item.note}`);
      out.push("");
    }
    out.push("---");
    out.push("");
  }

  out.push("## Архів / злити (не канон)");
  out.push("");
  archive.sort((a, b) => a.name.localeCompare(b.name, "uk"));
  for (const a of archive) {
    out.push(`- \`${a.id}\` ${a.name} — ${a.reason}`);
  }
  out.push("");
  out.push(`Канон-товарів: ${canons.length}. Архів/злити: ${archive.length}.`);
  out.push("");

  fs.writeFileSync(OUT, out.join("\n"), "utf-8");
  console.log(`[build-name-canon] ${OUT}`);
  console.log(`[build-name-canon] canons ${canons.length} archive ${archive.length}`);
}

main();
