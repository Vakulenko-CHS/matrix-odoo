/**
 * Sync накладки + кольоровий ламінат-лист from temp/Накладки.tsv.
 *
 * Phases:
 *   1. attr Ширина Кромки [20мм,40мм]
 *   2. [Кромка] += Ширина Кромки; remap BOM lines → (color, 20мм)
 *   3. reshape 🧩[Ламінат кольоровий - лист]: Ламінат Розмір × Колір (no ❌)
 *   4. BOMs for colored sheets (lam/krom/ops from TSV)
 *   5. fix listed 🪤[Накладка] … (color attr + consume sheet)
 *   6. archive leftover size-in-name laminate tmpls
 *
 *   npx ts-node --transpile-only src/tools/sync-nakladky.ts --check
 *   npx ts-node --transpile-only src/tools/sync-nakladky.ts --apply
 *   npx ts-node --transpile-only src/tools/sync-nakladky.ts --apply --phase=1,2,3
 */
import * as fs from "fs";
import * as path from "path";
import {
  authenticate,
  create,
  executeKw,
  searchRead,
  unlink,
  write,
} from "../api/odoo";
import { sleep } from "./odooPaged";

const COLORED_SHEET = "🧩[Ламінат кольоровий - лист]";
const KROM_TMPL = "[Кромка]";
const LAM_TMPL = "[Ламінат]";
const ATTR_WIDTH = "Ширина Кромки";
const ATTR_SIZE = "Ламінат Розмір";
const ATTR_COLOR = "Колір Ламінату";
const ATTR_MODEL = "Модель";
const WC_SHEET = "Цех №3-0 ЛДСП (Нарізка Ламінату)";
const WC_OVERLAY = "Цех №3-2 ЛДСП (Нарізка Накладок)";
const WIDTH_DEFAULT = "20мм";
const WIDTH_ELEGANT = "40мм";

const COLORS = ["Венге", "Трифе", "Дуб крарт", "Білий"] as const;

/** TSV sizes (col B), unique. */
const TSV_SIZES = [
  "758x456",
  "500x260",
  "1006x198",
  "920x198",
  "1250x300",
  "750x198",
  "1000x165",
  "1260x205",
  "1940x70",
  "250x70",
  "1370x70",
  "700x70",
  "1090x250",
  "1660x250",
  "1640x250",
  "1070x250",
  "240x303",
  "100x303",
] as const;

/** Old Модель values → канон size. */
const OLD_MODEL_TO_SIZE: Record<string, string> = {
  "Ширина 32 : 1070x250": "1070x250",
  "Ширина 16 : 1940x70": "1940x70",
  "250x70": "250x70",
  "1006x198": "1006x198",
};

type SheetSpec = {
  size: string;
  lamQty: number;
  cutPrice: number;
  gluePrice: number | null;
  kromQty: number | null;
  drillPrice: number | null; // Присадка col G
};

/** Overlay id → consume sheets + edge width + склейка. */
type OverlayFix = {
  id: number;
  name: string;
  sheets: { size: string; qty: number }[];
  edgeWidth: string | null; // null = no krom on sheet (still sheet may have null krom)
  gluePrice: number | null; // col H склейка on overlay BOM
};

const OVERLAY_FIXES: OverlayFix[] = [
  {
    id: 1247,
    name: "🪤[Накладка] Бар Елегант",
    sheets: [{ size: "1090x250", qty: 1 }],
    edgeWidth: WIDTH_ELEGANT,
    gluePrice: null,
  },
  {
    id: 1248,
    name: "🪤[Накладка] Д.Елегант БН",
    sheets: [{ size: "1090x250", qty: 1 }],
    edgeWidth: WIDTH_ELEGANT,
    gluePrice: null,
  },
  {
    id: 1249,
    name: "🪤[Накладка] Д.Елегант НН",
    sheets: [{ size: "1090x250", qty: 1 }],
    edgeWidth: WIDTH_ELEGANT,
    gluePrice: null,
  },
  {
    id: 1250,
    name: "🪤[Накладка] Д.Елегант ПБ",
    sheets: [{ size: "1090x250", qty: 1 }],
    edgeWidth: WIDTH_ELEGANT,
    gluePrice: null,
  },
  {
    id: 1251,
    name: "🪤[Накладка] Д.Елегант ПН",
    sheets: [{ size: "1090x250", qty: 1 }],
    edgeWidth: WIDTH_ELEGANT,
    gluePrice: null,
  },
  {
    id: 1252,
    name: "🪤[Накладка] Д.Еллі",
    sheets: [
      { size: "240x303", qty: 1 },
      { size: "100x303", qty: 2 },
    ],
    edgeWidth: null,
    gluePrice: null,
  },
  {
    id: 1253,
    name: "🪤[Накладка] Д.Ельдорадо",
    sheets: [{ size: "1070x250", qty: 1 }],
    edgeWidth: WIDTH_DEFAULT,
    gluePrice: null,
  },
  {
    id: 1254,
    name: "🪤[Накладка] Д.Ельдорадо-1",
    sheets: [{ size: "1070x250", qty: 1 }],
    edgeWidth: WIDTH_DEFAULT,
    gluePrice: null,
  },
  {
    id: 1255,
    name: "🪤[Накладка] Д.Леон-Люкс",
    sheets: [{ size: "1006x198", qty: 2 }],
    edgeWidth: WIDTH_DEFAULT,
    gluePrice: null,
  },
  {
    id: 1256,
    name: "🪤[Накладка] Д.Леон-Т",
    sheets: [{ size: "920x198", qty: 1 }],
    edgeWidth: WIDTH_DEFAULT,
    gluePrice: null,
  },
  {
    id: 1257,
    name: "🪤[Накладка] Д.Сітті",
    sheets: [{ size: "1006x198", qty: 2 }],
    edgeWidth: WIDTH_DEFAULT,
    gluePrice: null,
  },
  {
    id: 1258,
    name: "🪤[Накладка] Полка Елегант",
    sheets: [{ size: "1090x250", qty: 1 }],
    edgeWidth: WIDTH_ELEGANT,
    gluePrice: null,
  },
  {
    id: 1259,
    name: "🪤[Накладка] Реал-2Т",
    sheets: [{ size: "500x260", qty: 1 }],
    edgeWidth: WIDTH_DEFAULT,
    gluePrice: null,
  },
  {
    id: 1260,
    name: "🪤[Накладка] Реал-Т",
    sheets: [{ size: "500x260", qty: 1 }],
    edgeWidth: WIDTH_DEFAULT,
    gluePrice: null,
  },
  {
    id: 1261,
    name: "🪤[Накладка] Угол Елегант БН",
    sheets: [{ size: "1660x250", qty: 1 }],
    edgeWidth: WIDTH_ELEGANT,
    gluePrice: null,
  },
  {
    id: 1262,
    name: "🪤[Накладка] Угол Елегант НН",
    sheets: [{ size: "1660x250", qty: 1 }],
    edgeWidth: WIDTH_ELEGANT,
    gluePrice: null,
  },
  {
    id: 1263,
    name: "🪤[Накладка] Угол Елегант ПН",
    sheets: [{ size: "1660x250", qty: 1 }],
    edgeWidth: WIDTH_ELEGANT,
    gluePrice: null,
  },
  {
    id: 1264,
    name: "🪤[Накладка] Угол Смарт-1 ПН",
    sheets: [{ size: "1640x250", qty: 1 }],
    edgeWidth: WIDTH_DEFAULT,
    gluePrice: null,
  },
  {
    id: 1265,
    name: "🪤[Накладка] Угол Смарт-2 НН",
    sheets: [{ size: "1640x250", qty: 1 }],
    edgeWidth: WIDTH_DEFAULT,
    gluePrice: null,
  },
];

const ARCHIVE_TMPLS = [1025, 1011, 943];

function nearly(a: number, b: number, eps = 1e-6): boolean {
  return Math.abs(a - b) <= eps;
}

function parsePhases(argv: string[]): Set<number> {
  const raw = argv.find((a) => a.startsWith("--phase="));
  if (!raw) return new Set([1, 2, 3, 4, 5, 6]);
  return new Set(
    raw
      .slice("--phase=".length)
      .split(",")
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => n >= 1 && n <= 6),
  );
}

function parseNakladkyTsv(file: string): Map<string, SheetSpec> {
  const lines = fs.readFileSync(file, "utf-8").split(/\r?\n/);
  const bySize = new Map<string, SheetSpec>();
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const cols = line.split("\t");
    const model = (cols[0] || "").trim();
    const sizeRaw = (cols[1] || "").trim();
    if (!sizeRaw || !/\d/.test(sizeRaw)) continue;
    // strip -1шт / -2шт suffixes
    const size = sizeRaw.replace(/-\d+шт$/i, "").replace(/\s+/g, "");
    const lamQty = parseFloat((cols[2] || "").replace(",", "."));
    const cutPrice = parseFloat((cols[3] || "").replace(",", "."));
    const glueRaw = (cols[4] || "").trim();
    const kromRaw = (cols[5] || "").trim();
    const drillRaw = (cols[6] || "").trim();
    const gluePrice =
      glueRaw === "" || glueRaw.toLowerCase() === "null"
        ? null
        : parseFloat(glueRaw.replace(",", "."));
    const kromQty =
      kromRaw === "" || kromRaw.toLowerCase() === "null"
        ? null
        : parseFloat(kromRaw.replace(",", "."));
    const drillPrice =
      drillRaw === "" ||
      drillRaw.toLowerCase() === "null" ||
      drillRaw === "?"
        ? null
        : parseFloat(drillRaw.replace(",", "."));
    if (Number.isNaN(lamQty) || Number.isNaN(cutPrice)) {
      console.warn(`skip bad sheet row model=${model} size=${sizeRaw}`);
      continue;
    }
    if (!bySize.has(size)) {
      bySize.set(size, {
        size,
        lamQty,
        cutPrice,
        gluePrice,
        kromQty,
        drillPrice,
      });
    }
  }
  return bySize;
}

async function ensureAttr(
  name: string,
  values: string[],
): Promise<{ attrId: number; valueIds: Map<string, number> }> {
  let attrs = await searchRead<{ id: number }>(
    "product.attribute",
    [["name", "=", name]],
    ["id"],
    1,
  );
  let attrId: number;
  if (!attrs.length) {
    attrId = await create("product.attribute", {
      name,
      create_variant: "always",
      display_type: "radio",
    });
    console.log(`  + attr ${name} id=${attrId}`);
  } else {
    attrId = attrs[0].id;
    console.log(`  = attr ${name} id=${attrId}`);
  }
  const valueIds = new Map<string, number>();
  for (const vn of values) {
    const found = await searchRead<{ id: number }>(
      "product.attribute.value",
      [
        ["attribute_id", "=", attrId],
        ["name", "=", vn],
      ],
      ["id"],
      1,
    );
    if (found.length) {
      valueIds.set(vn, found[0].id);
    } else {
      const id = await create("product.attribute.value", {
        attribute_id: attrId,
        name: vn,
      });
      valueIds.set(vn, id);
      console.log(`  + value ${name}=${vn} id=${id}`);
    }
  }
  return { attrId, valueIds };
}

async function getAttrValues(
  attrName: string,
): Promise<{ attrId: number; byName: Map<string, number> }> {
  const attrs = await searchRead<{ id: number }>(
    "product.attribute",
    [["name", "=", attrName]],
    ["id"],
    1,
  );
  if (!attrs.length) throw new Error(`attr missing: ${attrName}`);
  const vals = await searchRead<{ id: number; name: string }>(
    "product.attribute.value",
    [["attribute_id", "=", attrs[0].id]],
    ["id", "name"],
  );
  return {
    attrId: attrs[0].id,
    byName: new Map(vals.map((v) => [v.name, v.id])),
  };
}

async function findProductByDisplay(
  tmplId: number,
  displayName: string,
): Promise<number | null> {
  const vars = await searchRead<{ id: number; display_name: string }>(
    "product.product",
    [["product_tmpl_id", "=", tmplId]],
    ["id", "display_name"],
  );
  const hit = vars.find((v) => v.display_name === displayName);
  return hit?.id ?? null;
}

async function findProductContains(
  tmplId: number,
  parts: string[],
): Promise<{ id: number; display_name: string } | null> {
  const vars = await searchRead<{ id: number; display_name: string }>(
    "product.product",
    [["product_tmpl_id", "=", tmplId]],
    ["id", "display_name"],
  );
  const hit = vars.find((v) => parts.every((p) => v.display_name.includes(p)));
  return hit ?? null;
}

async function remapBomLines(
  fromIds: number[],
  toId: number,
): Promise<number> {
  if (!fromIds.length) return 0;
  const lines = await searchRead<{ id: number; product_id: [number, string] }>(
    "mrp.bom.line",
    [["product_id", "in", fromIds]],
    ["id", "product_id"],
  );
  let n = 0;
  for (const l of lines) {
    if (l.product_id[0] === toId) continue;
    await write("mrp.bom.line", [l.id], { product_id: toId });
    n++;
    await sleep(20);
  }
  return n;
}

async function ensureAttrLine(
  tmplId: number,
  attrId: number,
  valueIds: number[],
  apply: boolean,
): Promise<"create" | "update" | "ok"> {
  const lines = await searchRead<{
    id: number;
    attribute_id: [number, string];
    value_ids: number[];
  }>("product.template.attribute.line", [["product_tmpl_id", "=", tmplId]], [
    "id",
    "attribute_id",
    "value_ids",
  ]);
  const existing = lines.find((l) => l.attribute_id[0] === attrId);
  const sortedWant = [...valueIds].sort((a, b) => a - b);
  if (!existing) {
    if (apply) {
      await create("product.template.attribute.line", {
        product_tmpl_id: tmplId,
        attribute_id: attrId,
        value_ids: [[6, 0, valueIds]],
      });
    }
    return "create";
  }
  const sortedHave = [...existing.value_ids].sort((a, b) => a - b);
  const same =
    sortedHave.length === sortedWant.length &&
    sortedHave.every((v, i) => v === sortedWant[i]);
  if (same) return "ok";
  if (apply) {
    await write("product.template.attribute.line", [existing.id], {
      value_ids: [[6, 0, valueIds]],
    });
  }
  return "update";
}

async function dropAttrLine(
  tmplId: number,
  attrId: number,
  apply: boolean,
): Promise<boolean> {
  const lines = await searchRead<{ id: number; attribute_id: [number, string] }>(
    "product.template.attribute.line",
    [
      ["product_tmpl_id", "=", tmplId],
      ["attribute_id", "=", attrId],
    ],
    ["id", "attribute_id"],
  );
  if (!lines.length) return false;
  if (apply) {
    for (const l of lines) {
      await unlink("product.template.attribute.line", [l.id]);
      await sleep(40);
    }
  }
  return true;
}

async function phase1(apply: boolean): Promise<void> {
  console.log("\n=== PHASE 1: attr Ширина Кромки ===");
  if (apply) {
    await ensureAttr(ATTR_WIDTH, ["20мм", "40мм"]);
  } else {
    const attrs = await searchRead<{ id: number }>(
      "product.attribute",
      [["name", "=", ATTR_WIDTH]],
      ["id"],
      1,
    );
    if (!attrs.length) console.log("  MISS attr");
    else {
      const vals = await searchRead<{ name: string }>(
        "product.attribute.value",
        [["attribute_id", "=", attrs[0].id]],
        ["name"],
      );
      console.log(
        `  = attr id=${attrs[0].id} vals=${vals.map((v) => v.name).join(",")}`,
      );
    }
  }
}

async function phase2(apply: boolean): Promise<void> {
  console.log("\n=== PHASE 2: [Кромка] += Ширина Кромки ===");
  const width = apply
    ? await ensureAttr(ATTR_WIDTH, ["20мм", "40мм"])
    : await (async () => {
        const a = await getAttrValues(ATTR_WIDTH).catch(() => null);
        if (!a) throw new Error("attr Ширина Кромки missing — run phase 1 --apply first");
        return { attrId: a.attrId, valueIds: a.byName };
      })();
  const { attrId, valueIds } = width;
  const tmpls = await searchRead<{ id: number }>(
    "product.template",
    [["name", "=", KROM_TMPL]],
    ["id"],
    1,
  );
  if (!tmpls.length) throw new Error("tmpl [Кромка] missing");
  const tmplId = tmpls[0].id;

  // snapshot old variants by color
  const before = await searchRead<{ id: number; display_name: string }>(
    "product.product",
    [["product_tmpl_id", "=", tmplId]],
    ["id", "display_name"],
  );
  console.log(`  before vars=${before.length}`);

  const widthIds = [valueIds.get("20мм")!, valueIds.get("40мм")!];
  const action = await ensureAttrLine(tmplId, attrId, widthIds, apply);
  console.log(`  attr-line ${action}`);
  if (apply) await sleep(200);

  const after = await searchRead<{ id: number; display_name: string }>(
    "product.product",
    [["product_tmpl_id", "=", tmplId]],
    ["id", "display_name"],
  );
  console.log(`  after vars=${after.length}`);

  // Remap: old (Color) → new (Color, 20мм)
  for (const colorName of COLORS) {
    const oldOnes = before.filter(
      (v) =>
        v.display_name.includes(`(${colorName})`) ||
        v.display_name.endsWith(`(${colorName})`),
    );
    const neu = after.find(
      (v) =>
        v.display_name.includes(colorName) &&
        v.display_name.includes("20мм"),
    );
    if (!neu) {
      console.log(`  WARN no new krom for ${colorName}/20мм`);
      continue;
    }
    const fromIds = oldOnes.map((o) => o.id).filter((id) => id !== neu.id);
    // also remap any still-(color-only) if Odoo kept them
    const colorOnly = after.filter(
      (v) =>
        v.display_name === `${KROM_TMPL} (${colorName})` ||
        (v.display_name.includes(colorName) &&
          !v.display_name.includes("мм")),
    );
    const allFrom = [...new Set([...fromIds, ...colorOnly.map((c) => c.id)])];
    if (!apply) {
      const lines = allFrom.length
        ? await searchRead("mrp.bom.line", [["product_id", "in", allFrom]], [
            "id",
          ])
        : [];
      console.log(
        `  would remap ${colorName}: from=${allFrom.length} lines≈${lines.length} → ${neu.id} ${neu.display_name}`,
      );
      continue;
    }
    const n = await remapBomLines(allFrom, neu.id);
    console.log(`  remapped ${colorName}: ${n} lines → ${neu.display_name}`);
  }
}

async function phase3(apply: boolean): Promise<void> {
  console.log("\n=== PHASE 3: reshape colored sheet attrs ===");
  const tmpls = await searchRead<{ id: number }>(
    "product.template",
    [["name", "=", COLORED_SHEET]],
    ["id"],
    1,
  );
  if (!tmpls.length) throw new Error(`tmpl missing ${COLORED_SHEET}`);
  const tmplId = tmpls[0].id;

  const sizeAttr = await getAttrValues(ATTR_SIZE);
  const colorAttr = await getAttrValues(ATTR_COLOR);
  const modelAttr = await getAttrValues(ATTR_MODEL);

  const sizeIds = TSV_SIZES.map((s) => {
    const id = sizeAttr.byName.get(s);
    if (!id) throw new Error(`Ламінат Розмір missing ${s}`);
    return id;
  });
  const colorIds = COLORS.map((c) => {
    const id = colorAttr.byName.get(c);
    if (!id) throw new Error(`Колір missing ${c}`);
    return id;
  });

  // snapshot old variants for remap
  const before = await searchRead<{ id: number; display_name: string }>(
    "product.product",
    [["product_tmpl_id", "=", tmplId]],
    ["id", "display_name"],
  );

  const sizeAction = await ensureAttrLine(
    tmplId,
    sizeAttr.attrId,
    sizeIds,
    apply,
  );
  console.log(`  size-line ${sizeAction} n=${sizeIds.length}`);
  const colorAction = await ensureAttrLine(
    tmplId,
    colorAttr.attrId,
    colorIds,
    apply,
  );
  console.log(`  color-line ${colorAction} n=${colorIds.length}`);

  const dropped = await dropAttrLine(tmplId, modelAttr.attrId, apply);
  console.log(`  drop Модель ${dropped ? (apply ? "DONE" : "WOULD") : "none"}`);

  if (apply) await sleep(300);

  const after = await searchRead<{ id: number; display_name: string }>(
    "product.product",
    [["product_tmpl_id", "=", tmplId]],
    ["id", "display_name"],
  );
  console.log(`  vars before=${before.length} after=${after.length}`);

  // Remap BOM lines from old model-labelled variants → new size×color
  for (const old of before) {
    let size: string | null = null;
    let color: string | null = null;
    for (const [oldModel, canon] of Object.entries(OLD_MODEL_TO_SIZE)) {
      if (old.display_name.includes(oldModel)) {
        size = canon;
        break;
      }
    }
    // also plain size already in name
    if (!size) {
      for (const s of TSV_SIZES) {
        if (old.display_name.includes(s)) {
          size = s;
          break;
        }
      }
    }
    for (const c of COLORS) {
      if (old.display_name.includes(c)) {
        color = c;
        break;
      }
    }
    if (!size || !color) {
      console.log(`  skip remap (parse fail): ${old.display_name}`);
      continue;
    }
    const targetName = `${COLORED_SHEET} (${size}, ${color})`;
    const neu = after.find((v) => v.display_name === targetName);
    if (!neu) {
      console.log(`  WARN no target ${targetName}`);
      continue;
    }
    if (neu.id === old.id) continue;
    if (!apply) {
      const lines = await searchRead("mrp.bom.line", [["product_id", "=", old.id]], [
        "id",
      ]);
      if (lines.length) {
        console.log(
          `  would remap ${old.id} → ${neu.id} (${lines.length} lines) ${old.display_name}`,
        );
      }
      continue;
    }
    const n = await remapBomLines([old.id], neu.id);
    if (n) console.log(`  remapped ${n}: ${old.display_name} → ${targetName}`);
  }
}

async function resolveKromId(
  kromTmplId: number,
  color: string,
  width: string,
): Promise<number> {
  const name = `${KROM_TMPL} (${color}, ${width})`;
  let id = await findProductByDisplay(kromTmplId, name);
  if (id) return id;
  // fallback color-only
  id = await findProductByDisplay(kromTmplId, `${KROM_TMPL} (${color})`);
  if (id) return id;
  const fuzzy = await findProductContains(kromTmplId, [color, width]);
  if (fuzzy) return fuzzy.id;
  throw new Error(`krom not found ${color}/${width}`);
}

async function resolveLamId(lamTmplId: number, color: string): Promise<number> {
  const id = await findProductByDisplay(lamTmplId, `${LAM_TMPL} (${color})`);
  if (!id) throw new Error(`lam not found ${color}`);
  return id;
}

async function resolveSheetVariant(
  sheetTmplId: number,
  size: string,
  color: string,
): Promise<number> {
  const name = `${COLORED_SHEET} (${size}, ${color})`;
  const id = await findProductByDisplay(sheetTmplId, name);
  if (!id) throw new Error(`sheet variant missing ${name}`);
  return id;
}

async function syncSheetBom(
  bomId: number,
  productName: string,
  spec: SheetSpec,
  color: string,
  lamId: number,
  kromId: number | null,
  wcId: number,
  apply: boolean,
): Promise<string[]> {
  const problems: string[] = [];
  const cutName = `Операція (Цех №3-0) Порізка - ${productName}`;
  const glueName = `Операція (Цех №3-0) Поклейка - ${productName}`;
  const drillName = `Операція (Цех №3-0) Присадка - ${productName}`;

  const lines = await searchRead<{
    id: number;
    product_id: [number, string];
    product_qty: number;
    operation_id: [number, string] | false;
  }>("mrp.bom.line", [["bom_id", "=", bomId]], [
    "id",
    "product_id",
    "product_qty",
    "operation_id",
  ]);
  const ops = await searchRead<{
    id: number;
    name: string;
    workcenter_id: [number, string];
    sequence: number;
    x_studio_piece_rate_2: number;
  }>("mrp.routing.workcenter", [["bom_id", "=", bomId]], [
    "id",
    "name",
    "workcenter_id",
    "sequence",
    "x_studio_piece_rate_2",
  ]);

  let cutOp = ops.find((o) => /Порізка/i.test(o.name));
  let glueOp = ops.find((o) => /Поклейка/i.test(o.name));
  let drillOp = ops.find((o) => /Присадка/i.test(o.name));
  const lamLine = lines.find((l) => l.product_id[0] === lamId);
  const kromLine =
    kromId != null ? lines.find((l) => l.product_id[0] === kromId) : undefined;
  // any krom line (old id)
  const anyKrom = lines.find((l) => /\[Кромка\]/.test(l.product_id[1]));
  const extra = lines.filter((l) => {
    if (l.product_id[0] === lamId) return false;
    if (kromId != null && l.product_id[0] === kromId) return false;
    if (anyKrom && l.id === anyKrom.id && kromId != null) return false;
    return true;
  });

  if (!lamLine) problems.push("no lam");
  else if (!nearly(lamLine.product_qty, spec.lamQty)) {
    problems.push(`lam ${lamLine.product_qty}≠${spec.lamQty}`);
  }
  if (spec.kromQty == null) {
    if (anyKrom) problems.push("has krom but TSV null");
  } else {
    if (!anyKrom && !kromLine) problems.push("no krom");
    else {
      const k = kromLine || anyKrom!;
      if (!nearly(k.product_qty, spec.kromQty)) {
        problems.push(`krom ${k.product_qty}≠${spec.kromQty}`);
      }
    }
  }
  if (!cutOp) problems.push("no cut");
  else if (!nearly(cutOp.x_studio_piece_rate_2 ?? 0, spec.cutPrice)) {
    problems.push(`cut ${cutOp.x_studio_piece_rate_2}≠${spec.cutPrice}`);
  }
  if (spec.gluePrice == null) {
    if (glueOp) problems.push("has glue");
  } else if (!glueOp) problems.push("no glue");
  else if (!nearly(glueOp.x_studio_piece_rate_2 ?? 0, spec.gluePrice)) {
    problems.push(`glue ${glueOp.x_studio_piece_rate_2}≠${spec.gluePrice}`);
  }
  if (spec.drillPrice == null) {
    if (drillOp) problems.push("has drill");
  } else if (!drillOp) problems.push("no drill");
  else if (!nearly(drillOp.x_studio_piece_rate_2 ?? 0, spec.drillPrice)) {
    problems.push(`drill ${drillOp.x_studio_piece_rate_2}≠${spec.drillPrice}`);
  }

  if (!apply) return problems;

  // apply ops
  if (!cutOp) {
    const id = await create("mrp.routing.workcenter", {
      name: cutName,
      bom_id: bomId,
      workcenter_id: wcId,
      sequence: 1,
      x_studio_piece_rate_2: spec.cutPrice,
    });
    cutOp = {
      id,
      name: cutName,
      workcenter_id: [wcId, WC_SHEET],
      sequence: 1,
      x_studio_piece_rate_2: spec.cutPrice,
    };
  } else {
    await write("mrp.routing.workcenter", [cutOp.id], {
      name: cutName,
      workcenter_id: wcId,
      sequence: 1,
      x_studio_piece_rate_2: spec.cutPrice,
    });
  }

  if (spec.gluePrice == null) {
    if (glueOp) await unlink("mrp.routing.workcenter", [glueOp.id]);
    glueOp = undefined;
  } else if (!glueOp) {
    const id = await create("mrp.routing.workcenter", {
      name: glueName,
      bom_id: bomId,
      workcenter_id: wcId,
      sequence: 2,
      x_studio_piece_rate_2: spec.gluePrice,
    });
    glueOp = {
      id,
      name: glueName,
      workcenter_id: [wcId, WC_SHEET],
      sequence: 2,
      x_studio_piece_rate_2: spec.gluePrice,
    };
  } else {
    await write("mrp.routing.workcenter", [glueOp.id], {
      name: glueName,
      workcenter_id: wcId,
      sequence: 2,
      x_studio_piece_rate_2: spec.gluePrice,
    });
  }

  if (spec.drillPrice == null) {
    if (drillOp) await unlink("mrp.routing.workcenter", [drillOp.id]);
    drillOp = undefined;
  } else if (!drillOp) {
    const id = await create("mrp.routing.workcenter", {
      name: drillName,
      bom_id: bomId,
      workcenter_id: wcId,
      sequence: 3,
      x_studio_piece_rate_2: spec.drillPrice,
    });
    drillOp = {
      id,
      name: drillName,
      workcenter_id: [wcId, WC_SHEET],
      sequence: 3,
      x_studio_piece_rate_2: spec.drillPrice,
    };
  } else {
    await write("mrp.routing.workcenter", [drillOp.id], {
      name: drillName,
      workcenter_id: wcId,
      sequence: 3,
      x_studio_piece_rate_2: spec.drillPrice,
    });
  }

  // lines
  if (!lamLine) {
    await create("mrp.bom.line", {
      bom_id: bomId,
      product_id: lamId,
      product_qty: spec.lamQty,
      operation_id: cutOp!.id,
    });
  } else {
    await write("mrp.bom.line", [lamLine.id], {
      product_qty: spec.lamQty,
      operation_id: cutOp!.id,
      product_id: lamId,
    });
  }

  if (spec.kromQty == null || !glueOp || kromId == null) {
    if (anyKrom) await unlink("mrp.bom.line", [anyKrom.id]);
  } else if (!anyKrom) {
    await create("mrp.bom.line", {
      bom_id: bomId,
      product_id: kromId,
      product_qty: spec.kromQty,
      operation_id: glueOp.id,
    });
  } else {
    await write("mrp.bom.line", [anyKrom.id], {
      product_id: kromId,
      product_qty: spec.kromQty,
      operation_id: glueOp.id,
    });
  }

  for (const e of extra) {
    if (anyKrom && e.id === anyKrom.id) continue;
    await unlink("mrp.bom.line", [e.id]);
  }

  return [];
}

async function phase4(apply: boolean): Promise<void> {
  console.log("\n=== PHASE 4: colored sheet BOMs ===");
  const specs = parseNakladkyTsv(path.resolve("temp/Накладки.tsv"));
  console.log(`  sizes from TSV: ${specs.size}`);

  const sheetT = (
    await searchRead<{ id: number }>(
      "product.template",
      [["name", "=", COLORED_SHEET]],
      ["id"],
      1,
    )
  )[0];
  const kromT = (
    await searchRead<{ id: number }>(
      "product.template",
      [["name", "=", KROM_TMPL]],
      ["id"],
      1,
    )
  )[0];
  const lamT = (
    await searchRead<{ id: number }>(
      "product.template",
      [["name", "=", LAM_TMPL]],
      ["id"],
      1,
    )
  )[0];
  const wc = (
    await searchRead<{ id: number }>(
      "mrp.workcenter",
      [["name", "=", WC_SHEET]],
      ["id"],
      1,
    )
  )[0];
  if (!sheetT || !kromT || !lamT || !wc) throw new Error("missing tmpl/wc");

  // elegant sizes use 40мм
  const elegantSizes = new Set(["1090x250", "1660x250"]);

  let bad = 0;
  let ok = 0;
  let created = 0;

  for (const [size, spec] of specs) {
    const width = elegantSizes.has(size) ? WIDTH_ELEGANT : WIDTH_DEFAULT;
    for (const color of COLORS) {
      const productName = `${COLORED_SHEET} (${size}, ${color})`;
      let productId: number;
      try {
        productId = await resolveSheetVariant(sheetT.id, size, color);
      } catch (e) {
        console.log(`  MISS variant ${productName}`);
        bad++;
        continue;
      }
      const lamId = await resolveLamId(lamT.id, color);
      let kromId: number | null = null;
      if (spec.kromQty != null) {
        kromId = await resolveKromId(kromT.id, color, width);
      }

      // find or create BOM for this variant
      let boms = await searchRead<{ id: number; code: string | false }>(
        "mrp.bom",
        [
          ["product_tmpl_id", "=", sheetT.id],
          ["product_id", "=", productId],
        ],
        ["id", "code"],
      );
      if (!boms.length) {
        // try by code
        boms = await searchRead<{ id: number; code: string | false }>(
          "mrp.bom",
          [
            ["product_tmpl_id", "=", sheetT.id],
            ["code", "=", productName],
          ],
          ["id", "code"],
        );
      }
      let bomId: number;
      if (!boms.length) {
        if (!apply) {
          console.log(`  MISS bom ${productName}`);
          bad++;
          continue;
        }
        bomId = await create("mrp.bom", {
          product_tmpl_id: sheetT.id,
          product_id: productId,
          product_qty: 1,
          type: "normal",
          code: productName,
        });
        created++;
        console.log(`  + bom ${bomId} ${productName}`);
      } else {
        bomId = boms[0].id;
        if (apply && boms[0].code !== productName) {
          await write("mrp.bom", [bomId], { code: productName, product_id: productId });
        }
      }

      const problems = await syncSheetBom(
        bomId,
        productName,
        spec,
        color,
        lamId,
        kromId,
        wc.id,
        apply,
      );
      if (problems.length) {
        bad++;
        console.log(`  BAD ${productName}: ${problems.join("; ")}`);
      } else {
        ok++;
      }
      await sleep(15);
    }
  }
  console.log(`  sheet-boms ok=${ok} bad=${bad} created=${created}`);
}

async function ensureOverlayColorAttr(
  tmplId: number,
  colorAttrId: number,
  colorIds: number[],
  apply: boolean,
): Promise<void> {
  await ensureAttrLine(tmplId, colorAttrId, colorIds, apply);
}

async function phase5(apply: boolean): Promise<void> {
  console.log("\n=== PHASE 5: fix overlays ===");
  const colorAttr = await getAttrValues(ATTR_COLOR);
  const colorIds = COLORS.map((c) => colorAttr.byName.get(c)!);
  const sheetT = (
    await searchRead<{ id: number }>(
      "product.template",
      [["name", "=", COLORED_SHEET]],
      ["id"],
      1,
    )
  )[0];
  const wc = (
    await searchRead<{ id: number }>(
      "mrp.workcenter",
      [["name", "=", WC_OVERLAY]],
      ["id"],
      1,
    )
  )[0];
  if (!sheetT || !wc) throw new Error("sheet/wc missing");

  for (const fix of OVERLAY_FIXES) {
    const t = (
      await executeKw<any[]>("product.template", "search_read", [[["id", "=", fix.id]]], {
        fields: ["id", "name", "active"],
        context: { lang: "uk_UA", active_test: false },
      })
    )[0];
    if (!t) {
      console.log(`  MISS tmpl ${fix.id} ${fix.name}`);
      continue;
    }
    console.log(`  — ${fix.id} ${t.name}`);

    await ensureOverlayColorAttr(fix.id, colorAttr.attrId, colorIds, apply);
    if (apply) await sleep(150);

    const vars = await searchRead<{ id: number; display_name: string }>(
      "product.product",
      [["product_tmpl_id", "=", fix.id]],
      ["id", "display_name"],
    );

    for (const color of COLORS) {
      const variant =
        vars.find(
          (v) =>
            v.display_name.includes(`(${color})`) ||
            v.display_name === `${fix.name} (${color})`,
        ) ||
        // after attr add, name may be «tmpl (color)»
        vars.find((v) => v.display_name.includes(color));
      if (!variant) {
        console.log(`    MISS variant color=${color}`);
        continue;
      }

      const bomCode = `${fix.name} (${color})`;
      let boms = await searchRead<{ id: number; code: string | false; product_id: any }>(
        "mrp.bom",
        [
          ["product_tmpl_id", "=", fix.id],
          ["product_id", "=", variant.id],
        ],
        ["id", "code", "product_id"],
      );
      if (!boms.length) {
        boms = await searchRead<{ id: number; code: string | false; product_id: any }>(
          "mrp.bom",
          [
            ["product_tmpl_id", "=", fix.id],
            ["code", "=", bomCode],
          ],
          ["id", "code", "product_id"],
        );
      }

      // sheet component ids
      const wantLines: { productId: number; qty: number }[] = [];
      for (const sh of fix.sheets) {
        const pid = await resolveSheetVariant(sheetT.id, sh.size, color);
        wantLines.push({ productId: pid, qty: sh.qty });
      }

      if (!boms.length) {
        if (!apply) {
          console.log(`    MISS bom ${bomCode}`);
          continue;
        }
        const bomId = await create("mrp.bom", {
          product_tmpl_id: fix.id,
          product_id: variant.id,
          product_qty: 1,
          type: "normal",
          code: bomCode,
        });
        let glueOpId: number | false = false;
        if (fix.gluePrice != null) {
          glueOpId = await create("mrp.routing.workcenter", {
            name: `Операція (Цех №3-2) Склейка - ${bomCode}`,
            bom_id: bomId,
            workcenter_id: wc.id,
            sequence: 1,
            x_studio_piece_rate_2: fix.gluePrice,
          });
        }
        for (const wl of wantLines) {
          await create("mrp.bom.line", {
            bom_id: bomId,
            product_id: wl.productId,
            product_qty: wl.qty,
            ...(glueOpId ? { operation_id: glueOpId } : {}),
          });
        }
        console.log(`    + bom ${bomId} ${bomCode}`);
        continue;
      }

      const bomId = boms[0].id;
      if (apply) {
        await write("mrp.bom", [bomId], {
          code: bomCode,
          product_id: variant.id,
        });
      }

      const lines = await searchRead<{
        id: number;
        product_id: [number, string];
        product_qty: number;
      }>("mrp.bom.line", [["bom_id", "=", bomId]], [
        "id",
        "product_id",
        "product_qty",
      ]);

      const problems: string[] = [];
      for (const wl of wantLines) {
        const hit = lines.find((l) => l.product_id[0] === wl.productId);
        if (!hit) problems.push(`miss sheet ${wl.productId} qty=${wl.qty}`);
        else if (!nearly(hit.product_qty, wl.qty)) {
          problems.push(`qty ${hit.product_qty}≠${wl.qty}`);
        }
      }
      const extras = lines.filter(
        (l) => !wantLines.some((w) => w.productId === l.product_id[0]),
      );
      if (extras.length) problems.push(`extra=${extras.length}`);

      if (problems.length) {
        console.log(`    BAD ${bomCode}: ${problems.join("; ")}`);
        if (apply) {
          // rewrite lines
          for (const l of lines) await unlink("mrp.bom.line", [l.id]);
          for (const wl of wantLines) {
            await create("mrp.bom.line", {
              bom_id: bomId,
              product_id: wl.productId,
              product_qty: wl.qty,
            });
          }
          console.log(`    fixed ${bomCode}`);
        }
      } else {
        console.log(`    ok ${bomCode}`);
      }
      await sleep(20);
    }
  }
}

async function phase6(apply: boolean): Promise<void> {
  console.log("\n=== PHASE 6: archive leftover size-in-name ===");
  for (const id of ARCHIVE_TMPLS) {
    const t = (
      await executeKw<any[]>("product.template", "search_read", [[["id", "=", id]]], {
        fields: ["id", "name", "active"],
        context: { lang: "uk_UA", active_test: false },
      })
    )[0];
    if (!t) {
      console.log(`  miss ${id}`);
      continue;
    }
    const vars = await searchRead<{ id: number }>(
      "product.product",
      [["product_tmpl_id", "=", id]],
      ["id"],
    );
    const asComp = vars.length
      ? await searchRead("mrp.bom.line", [["product_id", "in", vars.map((v) => v.id)]], [
          "id",
        ])
      : [];
    if (asComp.length) {
      console.log(`  SKIP ${id} ${t.name} asComp=${asComp.length}`);
      continue;
    }
    if (!t.active) {
      console.log(`  already archived ${id} ${t.name}`);
      continue;
    }
    console.log(`  ${apply ? "ARCHIVE" : "would archive"} ${id} ${t.name}`);
    if (apply) {
      await write("product.template", [id], { active: false });
    }
  }
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const phases = parsePhases(process.argv);
  console.log(
    `[nakladky] mode=${apply ? "APPLY" : "CHECK"} phases=${[...phases].join(",")}`,
  );
  await authenticate();

  if (phases.has(1)) await phase1(apply);
  if (phases.has(2)) await phase2(apply);
  if (phases.has(3)) await phase3(apply);
  if (phases.has(4)) await phase4(apply);
  if (phases.has(5)) await phase5(apply);
  if (phases.has(6)) await phase6(apply);

  console.log("\n[nakladky] done");
}

main().catch((e) => {
  console.error("[nakladky]", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
