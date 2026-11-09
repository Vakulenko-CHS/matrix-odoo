/**
 * Related SO-line description on MO / WO / quality.check (no Python = 0 extra Studio loc).
 *
 *   npm run studio-so-note
 *   npm run studio-so-note -- --apply
 */
import { authenticate, create, executeKw, searchRead, write } from "../api/odoo";

const APPLY = process.argv.includes("--apply");
const FIELD = "x_studio_so_line_note";
const LABEL = "Опис замовлення";

type Target = {
  model: string;
  related: string;
  viewName: string;
  viewType: "form" | "list";
  arch: string;
};

const TARGETS: Target[] = [
  {
    model: "mrp.production",
    related: "sale_line_id.name",
    viewName: "matrix: MO SO line note",
    viewType: "form",
    arch: `<data>
  <xpath expr="//field[@name='product_id'][@default_focus='1']" position="after">
    <field name="${FIELD}" readonly="1"/>
  </xpath>
</data>`,
  },
  {
    model: "mrp.workorder",
    related: "production_id.sale_line_id.name",
    viewName: "matrix: WO SO line note",
    viewType: "form",
    arch: `<data>
  <xpath expr="//field[@name='production_id'][@force_save='1']" position="after">
    <field name="${FIELD}" readonly="1"/>
  </xpath>
</data>`,
  },
  {
    model: "quality.check",
    related: "production_id.sale_line_id.name",
    viewName: "matrix: QC form SO line note",
    viewType: "form",
    arch: `<data>
  <xpath expr="//field[@name='production_id'][not(@invisible='1')]" position="after">
    <field name="${FIELD}" readonly="1"/>
  </xpath>
</data>`,
  },
  {
    model: "quality.check",
    related: "production_id.sale_line_id.name",
    viewName: "matrix: QC list SO line note",
    viewType: "list",
    arch: `<data>
  <xpath expr="//field[@name='product_id'][@optional='show']" position="after">
    <field name="${FIELD}" optional="show"/>
  </xpath>
</data>`,
  },
];

function loc(code: string): number {
  return (code || "")
    .split("\n")
    .filter((l) => {
      const t = l.trim();
      return t.length > 0 && !t.startsWith("#");
    }).length;
}

async function studioLoc(): Promise<number> {
  const fields = await searchRead<{ compute: string }>(
    "ir.model.fields",
    [
      ["state", "=", "manual"],
      ["compute", "!=", false],
    ],
    ["compute"],
    0,
  );
  let n = 0;
  for (const f of fields) n += loc(f.compute);
  const autos = await searchRead<{ action_server_ids: number[] }>("base.automation", [], ["action_server_ids"], 0);
  const ids = autos.flatMap((a) => a.action_server_ids);
  if (ids.length) {
    const acts = await searchRead<{ code: string }>("ir.actions.server", [["id", "in", ids]], ["code"], 0);
    for (const a of acts) n += loc(a.code || "");
  }
  return n;
}

async function modelId(model: string): Promise<number> {
  const [row] = await searchRead<{ id: number }>("ir.model", [["model", "=", model]], ["id"], 1);
  if (!row) throw new Error(`no ir.model ${model}`);
  return row.id;
}

async function ensureField(model: string, related: string, ttype: string) {
  const found = await searchRead<{ id: number; related?: string; compute?: string }>(
    "ir.model.fields",
    [
      ["model", "=", model],
      ["name", "=", FIELD],
    ],
    ["id", "related", "compute"],
    1,
  );
  if (found.length) {
    console.log(`ok      ${model}.${FIELD} id=${found[0].id} related=${found[0].related}`);
    return;
  }
  console.log(`${APPLY ? "CREATE" : "would"} ${model}.${FIELD} related=${related} ttype=${ttype}`);
  if (!APPLY) return;
  const id = await create("ir.model.fields", {
    name: FIELD,
    field_description: LABEL,
    model_id: await modelId(model),
    ttype,
    related,
    store: false,
    readonly: true,
    copied: false,
    state: "manual",
  });
  console.log(`created field id=${id}`);
}

async function inheritParent(model: string, type: "form" | "list"): Promise<number> {
  const views = await searchRead<{ id: number; name: string }>(
    "ir.ui.view",
    [
      ["model", "=", model],
      ["type", "=", type],
      ["inherit_id", "=", false],
      ["mode", "=", "primary"],
    ],
    ["id", "name"],
    20,
  );
  if (views[0]) return views[0].id;
  const any = await searchRead<{ id: number }>(
    "ir.ui.view",
    [
      ["model", "=", model],
      ["type", "=", type],
      ["inherit_id", "=", false],
    ],
    ["id"],
    1,
  );
  if (!any[0]) throw new Error(`no ${type} view for ${model}`);
  return any[0].id;
}

async function ensureView(t: Target) {
  const found = await searchRead<{ id: number }>(
    "ir.ui.view",
    [
      ["name", "=", t.viewName],
      ["model", "=", t.model],
    ],
    ["id"],
    1,
  );
  const parent = await inheritParent(t.model, t.viewType);
  const vals = {
    name: t.viewName,
    model: t.model,
    type: t.viewType,
    inherit_id: parent,
    mode: "extension",
    arch_db: t.arch,
  };
  if (found.length) {
    console.log(`${APPLY ? "UPDATE" : "ok"} view ${t.viewName} id=${found[0].id} parent=${parent}`);
    if (APPLY) await write("ir.ui.view", [found[0].id], vals);
    return;
  }
  console.log(`${APPLY ? "CREATE" : "would"} view ${t.viewName} parent=${parent}`);
  if (!APPLY) return;
  const id = await create("ir.ui.view", vals);
  console.log(`created view id=${id}`);
}

async function sampleNote() {
  const mos = await searchRead<{ id: number; name: string; sale_line_id: [number, string] | false }>(
    "mrp.production",
    [["sale_line_id", "!=", false]],
    ["id", "name", "sale_line_id"],
    3,
  );
  for (const mo of mos) {
    const lineId = Array.isArray(mo.sale_line_id) ? mo.sale_line_id[0] : 0;
    const [line] = await searchRead<{ name: string }>("sale.order.line", [["id", "=", lineId]], ["name"], 1);
    const rec = await searchRead<Record<string, unknown>>("mrp.production", [["id", "=", mo.id]], ["name", FIELD], 1);
    console.log(`sample ${mo.name} line=${line?.name?.slice(0, 80)} field=${String(rec[0]?.[FIELD] ?? "").slice(0, 80)}`);
  }
}

async function main() {
  await authenticate();
  const before = await studioLoc();
  console.log(`studio loc before ${before}/100`);

  const fg = await executeKw<Record<string, { type?: string; related?: string }>>("sale.order.line", "fields_get", [
    ["name"],
  ], { attributes: ["type", "related"] });
  const ttype = fg.name?.type === "html" ? "html" : fg.name?.type === "char" ? "char" : "text";
  console.log(`sale.order.line.name ttype=${fg.name?.type} → ${ttype}`);

  const mp = await executeKw<Record<string, { type?: string }>>("mrp.production", "fields_get", [["sale_line_id"]], {
    attributes: ["type"],
  });
  if (!mp.sale_line_id) throw new Error("mrp.production.sale_line_id missing — abort");

  const models = [...new Set(TARGETS.map((t) => t.model))];
  for (const model of models) {
    const rel = TARGETS.find((t) => t.model === model)!.related;
    await ensureField(model, rel, ttype);
  }
  for (const t of TARGETS) await ensureView(t);

  const after = await studioLoc();
  console.log(`studio loc after ${after}/100`);
  if (after > 100) throw new Error("ABORT: billed loc > 100");
  if (APPLY) await sampleNote();
}

main().catch((err) => {
  console.error("[FATAL]", err instanceof Error ? err.message : err);
  process.exit(1);
});
