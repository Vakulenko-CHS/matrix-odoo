/**
 * T-QAL-02: sale order name (S00254) on quality.check — «Перевірки в процесі».
 * Related only (0 extra Studio loc).
 *
 *   npm run studio-qal02-so
 *   npm run studio-qal02-so -- --apply
 */
import { authenticate, create, searchRead, write } from "../api/odoo";

const APPLY = process.argv.includes("--apply");
const FIELD = "x_studio_so_order_name";
const LABEL = "Накладна";
const RELATED = "production_id.sale_line_id.order_id.name";

const LIST_VIEW = {
  name: "matrix: QC list SO order",
  // After T-DESC list column; fallback anchor is product_id (see ensureView priority).
  arch: `<data>
  <xpath expr="//field[@name='x_studio_so_line_note']" position="before">
    <field name="${FIELD}" string="Накладна" optional="show"/>
  </xpath>
</data>`,
};


const FORM_VIEW = {
  name: "matrix: QC form SO order",
  arch: `<data>
  <xpath expr="//field[@name='production_id'][not(@invisible='1')]" position="before">
    <field name="${FIELD}" readonly="1"/>
  </xpath>
</data>`,
};

async function modelId(model: string): Promise<number> {
  const [row] = await searchRead<{ id: number }>("ir.model", [["model", "=", model]], ["id"], 1);
  if (!row) throw new Error(`no ir.model ${model}`);
  return row.id;
}

async function inheritParent(model: string, type: "form" | "list"): Promise<number> {
  const views = await searchRead<{ id: number }>(
    "ir.ui.view",
    [
      ["model", "=", model],
      ["type", "=", type],
      ["inherit_id", "=", false],
      ["mode", "=", "primary"],
    ],
    ["id"],
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

async function ensureField() {
  const found = await searchRead<{ id: number; related?: string }>(
    "ir.model.fields",
    [
      ["model", "=", "quality.check"],
      ["name", "=", FIELD],
    ],
    ["id", "related"],
    1,
  );
  if (found.length) {
    console.log(`ok      quality.check.${FIELD} id=${found[0].id} related=${found[0].related}`);
    if (APPLY && found[0].related !== RELATED) {
      await write("ir.model.fields", [found[0].id], { related: RELATED });
      console.log(`updated related → ${RELATED}`);
    }
    return;
  }
  console.log(`${APPLY ? "CREATE" : "would"} quality.check.${FIELD} related=${RELATED}`);
  if (!APPLY) return;
  const id = await create("ir.model.fields", {
    name: FIELD,
    field_description: LABEL,
    model_id: await modelId("quality.check"),
    ttype: "char",
    related: RELATED,
    store: false,
    readonly: true,
    copied: false,
    state: "manual",
  });
  console.log(`created field id=${id}`);
}

async function ensureView(viewName: string, viewType: "form" | "list", arch: string) {
  const found = await searchRead<{ id: number }>(
    "ir.ui.view",
    [
      ["name", "=", viewName],
      ["model", "=", "quality.check"],
    ],
    ["id"],
    1,
  );
  const parent = await inheritParent("quality.check", viewType);
  const priority = viewType === "list" ? 32 : 16;
  const vals = {
    name: viewName,
    model: "quality.check",
    type: viewType,
    inherit_id: parent,
    mode: "extension",
    arch_db: arch,
    priority,
  };
  if (found.length) {
    console.log(`${APPLY ? "UPDATE" : "ok"} view ${viewName} id=${found[0].id} parent=${parent}`);
    if (APPLY) await write("ir.ui.view", [found[0].id], vals);
    return;
  }
  console.log(`${APPLY ? "CREATE" : "would"} view ${viewName} parent=${parent}`);
  if (!APPLY) return;
  const id = await create("ir.ui.view", vals);
  console.log(`created view id=${id}`);
}

async function sample() {
  const rows = await searchRead<{
    id: number;
    name: string;
    production_id: [number, string] | false;
  }>(
    "quality.check",
    [["production_id", "!=", false]],
    ["id", "name", "production_id", FIELD],
    5,
  );
  for (const r of rows) {
    console.log(`sample qc=${r.id} ${r.name} ${FIELD}=${String((r as Record<string, unknown>)[FIELD] ?? "—")}`);
  }
}

async function main() {
  await authenticate();

  const mp = await searchRead("mrp.production", [["sale_line_id", "!=", false]], ["id"], 1);
  if (!mp.length) {
    console.warn("warn: no MO with sale_line_id — chain may be empty on some QC");
  }

  await ensureField();
  await ensureView(LIST_VIEW.name, "list", LIST_VIEW.arch);
  await ensureView(FORM_VIEW.name, "form", FORM_VIEW.arch);

  if (APPLY) await sample();
  console.log(APPLY ? "done (apply)" : "dry-run — pass --apply to write");
}

main().catch((err) => {
  console.error("[FATAL]", err instanceof Error ? err.message : err);
  process.exit(1);
});
