/**
 * T-COST-01: BOM собівартість (матеріали standard_price × qty + piece-rate операції)
 * у діалозі «Шукати більше…» / «Пошук: Товар» (list) + підказка в каталозі SO.
 *
 *   npm run cost01-bom
 *   npm run cost01-bom -- --apply
 */
import { authenticate, create, searchRead, write } from "../api/odoo";

const APPLY = process.argv.includes("--apply");
const FIELD = "x_studio_bom_cost";
const LINE_FIELD = "x_studio_product_bom_cost";
const LABEL = "Собівартість";

/** Матеріали + Σ x_studio_piece_rate_2; BOM за variant, інакше template. */
const COMPUTE = `for p in self:
    b=p.env['mrp.bom'].search([('product_id','=',p.id),('type','=','normal')],limit=1) or p.env['mrp.bom'].search([('product_tmpl_id','=',p.product_tmpl_id.id),('product_id','=',False),('type','=','normal')],limit=1)
    p['${FIELD}']=sum(x.product_qty*(x.product_id.standard_price or 0) for x in b.bom_line_ids)+sum(x.x_studio_piece_rate_2 or 0 for x in b.operation_ids) if b else 0.0`;

/** Шаблон у «Пошук: Товар» = product.template list (521), не product.product. */
const TMPL_COMPUTE = `for t in self:
    v=t.product_variant_ids[:1]
    t['${FIELD}']=v.x_studio_bom_cost if v else 0.0`;

const CATALOG_VIEW = {
  name: "matrix: product catalog BOM cost",
  inheritId: 486,
  arch: `<data>
  <field name="id" position="after">
    <field name="currency_id" invisible="1"/>
    <field name="${FIELD}" invisible="1"/>
  </field>
  <xpath expr="//div[@name='o_kanban_price']" position="after">
    <div class="text-muted small" groups="sales_team.group_sale_manager">
      <span>${LABEL}: </span>
      <field name="${FIELD}" widget="monetary" options="{'currency_field': 'currency_id'}" nolabel="1"/>
    </div>
  </xpath>
</data>`,
};

/** Вадим: Продажі → рядок SO → Товар → «Шукати більше…» → колонка «Вартість». */
const LIST_VIEW = {
  name: "matrix: product list BOM cost (sale search)",
  inheritId: 479,
  arch: `<data>
  <xpath expr="//field[@name='lst_price']" position="after">
    <field name="currency_id" column_invisible="True"/>
    <field name="${FIELD}" string="${LABEL}" optional="show" widget="monetary"
      options="{'currency_field': 'currency_id'}" groups="sales_team.group_sale_manager"/>
  </xpath>
</data>`,
};

const LIST_TMPL_VIEW = {
  name: "matrix: product template list BOM cost",
  inheritId: 521,
  arch: `<data>
  <xpath expr="//field[@name='list_price']" position="after">
    <field name="${FIELD}" string="${LABEL}" optional="show" widget="monetary"
      options="{'currency_field': 'currency_id'}" groups="sales_team.group_sale_manager"/>
  </xpath>
</data>`,
};

const FORM_TMPL_VIEW = {
  name: "matrix: product template form BOM cost",
  inheritId: 475,
  arch: `<data>
  <xpath expr="//group[@name='group_standard_price']//field[@name='list_price']" position="after">
    <field name="${FIELD}" string="${LABEL}" readonly="1" widget="monetary"
      options="{'currency_field': 'currency_id'}" groups="sales_team.group_sale_manager"/>
  </xpath>
</data>`,
};

const FORM_VIEW = {
  name: "matrix: product form BOM cost",
  inheritId: 482,
  arch: `<data>
  <xpath expr="//group[@name='group_standard_price']//field[@name='list_price']" position="after">
    <field name="${FIELD}" string="${LABEL}" readonly="1" widget="monetary"
      options="{'currency_field': 'currency_id'}" groups="sales_team.group_sale_manager"/>
  </xpath>
</data>`,
};

/** Таблиця рядків на КП/замовленні (як на скріншоті S00272). */
const SO_LINE_VIEW = {
  name: "matrix: sale order line bom cost",
  inheritId: 2729,
  arch: `<data>
  <xpath expr="//field[@name='order_line']/list//field[@name='price_unit']" position="after">
    <field name="${LINE_FIELD}" string="${LABEL}" optional="show" readonly="1" widget="monetary"
      options="{'currency_field': 'currency_id'}" groups="sales_team.group_sale_manager"/>
  </xpath>
</data>`,
};

const SAMPLE_TMPL = "Диван Верадо Колеса";

function loc(code: string): number {
  return code
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

async function ensureProductField() {
  const found = await searchRead<{ id: number; compute?: string }>(
    "ir.model.fields",
    [
      ["model", "=", "product.product"],
      ["name", "=", FIELD],
    ],
    ["id", "compute"],
    1,
  );
  if (found.length) {
    console.log(`ok      product.product.${FIELD} id=${found[0].id}`);
    if (APPLY) {
      const patch: Record<string, unknown> = {};
      if (found[0].compute !== COMPUTE) patch.compute = COMPUTE;
      patch.field_description = LABEL;
      if (Object.keys(patch).length) {
        await write("ir.model.fields", [found[0].id], patch);
        console.log("updated product field", Object.keys(patch).join(", "));
      }
    }
    return;
  }
  console.log(`${APPLY ? "CREATE" : "would"} product.product.${FIELD} compute (${loc(COMPUTE)} loc)`);
  if (!APPLY) return;
  const id = await create("ir.model.fields", {
    name: FIELD,
    field_description: LABEL,
    model_id: await modelId("product.product"),
    ttype: "float",
    compute: COMPUTE,
    depends: "product_tmpl_id",
    store: false,
    readonly: true,
    copied: false,
    state: "manual",
  });
  console.log(`created field id=${id}`);
}

async function ensureTemplateField() {
  const found = await searchRead<{ id: number; compute?: string }>(
    "ir.model.fields",
    [
      ["model", "=", "product.template"],
      ["name", "=", FIELD],
    ],
    ["id", "compute"],
    1,
  );
  if (found.length) {
    console.log(`ok      product.template.${FIELD} id=${found[0].id}`);
    if (APPLY) {
      const patch: Record<string, unknown> = { field_description: LABEL };
      if (found[0].compute !== TMPL_COMPUTE) patch.compute = TMPL_COMPUTE;
      await write("ir.model.fields", [found[0].id], patch);
      console.log("updated template field");
    }
    return;
  }
  console.log(`${APPLY ? "CREATE" : "would"} product.template.${FIELD} (${loc(TMPL_COMPUTE)} loc)`);
  if (!APPLY) return;
  const id = await create("ir.model.fields", {
    name: FIELD,
    field_description: LABEL,
    model_id: await modelId("product.template"),
    ttype: "float",
    compute: TMPL_COMPUTE,
    depends: "product_variant_ids, product_variant_ids.x_studio_bom_cost",
    store: false,
    readonly: true,
    copied: false,
    state: "manual",
  });
  console.log(`created template field id=${id}`);
}

async function ensureSoLineField() {
  const related = "product_id.x_studio_bom_cost";
  const found = await searchRead<{ id: number; related?: string }>(
    "ir.model.fields",
    [
      ["model", "=", "sale.order.line"],
      ["name", "=", LINE_FIELD],
    ],
    ["id", "related"],
    1,
  );
  if (found.length) {
    console.log(`ok      sale.order.line.${LINE_FIELD} id=${found[0].id}`);
    if (APPLY && found[0].related !== related) {
      await write("ir.model.fields", [found[0].id], { related, field_description: LABEL });
    }
    return;
  }
  console.log(`${APPLY ? "CREATE" : "would"} sale.order.line.${LINE_FIELD} related=${related}`);
  if (!APPLY) return;
  const id = await create("ir.model.fields", {
    name: LINE_FIELD,
    field_description: LABEL,
    model_id: await modelId("sale.order.line"),
    ttype: "float",
    related,
    store: false,
    readonly: true,
    copied: false,
    state: "manual",
  });
  console.log(`created line field id=${id}`);
}

async function ensureView(
  name: string,
  inheritId: number,
  arch: string,
  viewType: "kanban" | "form" | "list",
  model = "product.product",
) {
  const found = await searchRead<{ id: number }>(
    "ir.ui.view",
    [
      ["name", "=", name],
      ["model", "=", model],
    ],
    ["id"],
    1,
  );
  const vals = {
    name,
    model,
    type: viewType,
    inherit_id: inheritId,
    mode: "extension",
    arch_db: arch,
    priority: 24,
  };
  if (found.length) {
    console.log(`${APPLY ? "UPDATE" : "ok"} view ${name} id=${found[0].id}`);
    if (APPLY) await write("ir.ui.view", [found[0].id], vals);
    return;
  }
  console.log(`${APPLY ? "CREATE" : "would"} view ${name} parent=${inheritId}`);
  if (!APPLY) return;
  const id = await create("ir.ui.view", vals);
  console.log(`created view id=${id}`);
}

async function drySampleCost() {
  const [tmpl] = await searchRead<{ id: number }>(
    "product.template",
    [["name", "=", SAMPLE_TMPL]],
    ["id"],
    1,
  );
  if (!tmpl) {
    console.warn(`warn: template ${SAMPLE_TMPL} not found`);
    return;
  }
  const [variant] = await searchRead<{ id: number; name: string }>(
    "product.product",
    [["product_tmpl_id", "=", tmpl.id]],
    ["id", "name"],
    1,
  );
  if (!variant) return;
  const [bom] = await searchRead<{ id: number }>(
    "mrp.bom",
    [
      "|",
      ["product_id", "=", variant.id],
      "&",
      ["product_tmpl_id", "=", tmpl.id],
      ["product_id", "=", false],
      ["type", "=", "normal"],
    ],
    ["id"],
    1,
  );
  if (!bom) {
    console.log(`sample ${variant.name} id=${variant.id}: no BOM`);
    return;
  }
  const lines = await searchRead<{ product_qty: number; product_id: [number, string] }>(
    "mrp.bom.line",
    [["bom_id", "=", bom.id]],
    ["product_qty", "product_id"],
    0,
  );
  const ops = await searchRead<{ x_studio_piece_rate_2: number }>(
    "mrp.routing.workcenter",
    [["bom_id", "=", bom.id]],
    ["x_studio_piece_rate_2"],
    0,
  );
  const pids = [...new Set(lines.map((l) => l.product_id[0]))];
  const prices = await searchRead<{ id: number; standard_price: number }>(
    "product.product",
    [["id", "in", pids]],
    ["id", "standard_price"],
    0,
  );
  const pmap = new Map(prices.map((p) => [p.id, p.standard_price || 0]));
  let m = 0;
  for (const ln of lines) m += ln.product_qty * (pmap.get(ln.product_id[0]) || 0);
  const l = ops.reduce((s, o) => s + (o.x_studio_piece_rate_2 || 0), 0);
  console.log(
    `sample ${variant.name} id=${variant.id} bom=${bom.id}: mat=${m} labor=${l} total=${m + l} (до Odoo-поля)`,
  );
}

async function readComputedField() {
  const [tmpl] = await searchRead<{ id: number }>("product.template", [["name", "=", SAMPLE_TMPL]], ["id"], 1);
  if (!tmpl) return;
  const [variant] = await searchRead<Record<string, unknown>>(
    "product.product",
    [["product_tmpl_id", "=", tmpl.id]],
    ["id", "name", FIELD],
    1,
  );
  if (!variant) return;
  console.log(`live ${variant.name} id=${variant.id} ${FIELD}=${variant[FIELD]}`);
}

async function main() {
  await authenticate();
  const before = await studioLoc();
  const [prodFld] = await searchRead("ir.model.fields", [["model", "=", "product.product"], ["name", "=", FIELD]], ["id"], 1);
  const [tmplFld] = await searchRead("ir.model.fields", [["model", "=", "product.template"], ["name", "=", FIELD]], ["id"], 1);
  const add = (prodFld ? 0 : loc(COMPUTE)) + (tmplFld ? 0 : loc(TMPL_COMPUTE));
  const projected = before + add;
  console.log(`studio loc ~${before} + ${add} => ${projected} (cap 100)`);
  if (projected > 100) {
    console.error("ABORT: would exceed Studio billed loc cap");
    process.exit(1);
  }

  await drySampleCost();
  await ensureProductField();
  await ensureTemplateField();
  await ensureSoLineField();
  await ensureView(LIST_VIEW.name, LIST_VIEW.inheritId, LIST_VIEW.arch, "list");
  await ensureView(LIST_TMPL_VIEW.name, LIST_TMPL_VIEW.inheritId, LIST_TMPL_VIEW.arch, "list", "product.template");
  await ensureView(CATALOG_VIEW.name, CATALOG_VIEW.inheritId, CATALOG_VIEW.arch, "kanban");
  await ensureView(FORM_TMPL_VIEW.name, FORM_TMPL_VIEW.inheritId, FORM_TMPL_VIEW.arch, "form", "product.template");
  await ensureView(FORM_VIEW.name, FORM_VIEW.inheritId, FORM_VIEW.arch, "form");
  await ensureView(SO_LINE_VIEW.name, SO_LINE_VIEW.inheritId, SO_LINE_VIEW.arch, "form", "sale.order");

  if (APPLY) {
    await readComputedField();
    const after = await studioLoc();
    console.log(`studio loc after apply ~${after}`);
  }
  console.log(APPLY ? "done (apply)" : "dry-run — pass --apply to write Odoo");
}

main().catch((err) => {
  console.error("[FATAL]", err instanceof Error ? err.message : err);
  process.exit(1);
});
