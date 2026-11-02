/**
 * Default worker per workcenter: adds mrp.workcenter.x_default_employee_id
 * (+ form field), fills it from config, and an automation that puts that
 * employee into employee_assigned_ids of every new workorder left unassigned.
 *
 *   npx ts-node --transpile-only src/tools/payroll/default-worker.ts
 *   npx ts-node --transpile-only src/tools/payroll/default-worker.ts --apply
 */
import { authenticate, create, searchRead, write } from "../../api/odoo";
import { ODOO_WORKCENTERS } from "../../workcenters/canon";
import { PAYROLL_SHOPS, normName } from "./config";

const APPLY = process.argv.includes("--apply");

const FIELD = "x_default_employee_id";
const VIEW_NAME = "mrp.workcenter.form.default.employee";
const AUTOMATION_NAME = "Призначити робітника за замовчуванням на робоче замовлення";

const ACTION_CODE = `# Якщо на робочому замовленні ще ніхто не призначений,
# підставляємо "Робітника за замовчуванням" з робочого центру.
for wo in records:
    emp = wo.workcenter_id.x_default_employee_id
    if emp and not wo.employee_assigned_ids:
        wo.write({'employee_assigned_ids': [(4, emp.id)]})
`;

async function modelId(model: string): Promise<number> {
  const [row] = await searchRead<{ id: number }>("ir.model", [["model", "=", model]], ["id"], 1);
  return row.id;
}

async function ensureField() {
  const found = await searchRead("ir.model.fields", [["model", "=", "mrp.workcenter"], ["name", "=", FIELD]], ["id"], 1);
  if (found.length) return console.log(`ok      field ${FIELD}`);
  console.log(`CREATE  field ${FIELD}`);
  if (!APPLY) return;
  await create("ir.model.fields", {
    name: FIELD,
    field_description: "Робітник за замовчуванням",
    model_id: await modelId("mrp.workcenter"),
    ttype: "many2one",
    relation: "hr.employee",
    state: "manual",
    on_delete: "set null",
  });
}

async function ensureView() {
  const found = await searchRead("ir.ui.view", [["name", "=", VIEW_NAME]], ["id"], 1);
  if (found.length) return console.log(`ok      view ${VIEW_NAME}`);
  console.log(`CREATE  view ${VIEW_NAME}`);
  if (!APPLY) return;
  const [base] = await searchRead<{ id: number }>(
    "ir.ui.view",
    [["model", "=", "mrp.workcenter"], ["type", "=", "form"], ["inherit_id", "=", false]],
    ["id"],
    1,
  );
  await create("ir.ui.view", {
    name: VIEW_NAME,
    model: "mrp.workcenter",
    type: "form",
    inherit_id: base.id,
    mode: "extension",
    arch_db: `<data><field name="alternative_workcenter_ids" position="after"><field name="${FIELD}" options="{'no_create': True}"/></field></data>`,
  });
}

async function ensureAutomation() {
  const found = await searchRead("base.automation", [["name", "=", AUTOMATION_NAME]], ["id"], 1);
  if (found.length) return console.log(`ok      automation "${AUTOMATION_NAME}"`);
  console.log(`CREATE  automation "${AUTOMATION_NAME}"`);
  if (!APPLY) return;
  const woModel = await modelId("mrp.workorder");
  const automationId = await create("base.automation", {
    name: AUTOMATION_NAME,
    model_id: woModel,
    trigger: "on_create",
  });
  await create("ir.actions.server", {
    name: "Призначити робітника за замовчуванням",
    model_id: woModel,
    state: "code",
    usage: "base_automation",
    base_automation_id: automationId,
    code: ACTION_CODE,
  });
}

async function ensureDefaults() {
  // Field must exist before it can be read; skip in a dry run on a fresh DB.
  const hasField = await searchRead("ir.model.fields", [["model", "=", "mrp.workcenter"], ["name", "=", FIELD]], ["id"], 1);
  if (!hasField.length) return console.log("skip    defaults (field not created yet)");

  const wcs = await searchRead<{ id: number; code: string | false; name: string; [FIELD]: [number, string] | false }>(
    "mrp.workcenter",
    [],
    ["id", "code", "name", FIELD],
    500,
  );
  const emps = await searchRead<{ id: number; name: string }>("hr.employee", [], ["id", "name"], 1000);
  for (const shop of PAYROLL_SHOPS) {
    const canon = ODOO_WORKCENTERS.find((w) => w.num === shop.num);
    const wc = canon && wcs.find((w) => w.code === canon.code);
    if (!wc) {
      console.log(`NO WORKCENTER ${shop.num}`);
      continue;
    }
    const emp = shop.defaultEmployee && emps.find((e) => normName(e.name) === normName(shop.defaultEmployee!));
    if (shop.defaultEmployee && !emp) {
      console.log(`NO EMPLOYEE "${shop.defaultEmployee}" for ${wc.name}`);
      continue;
    }
    const want = emp ? emp.id : false;
    const have = wc[FIELD] ? wc[FIELD][0] : false;
    if (want === have) {
      console.log(`ok      ${wc.name.padEnd(36)} ${emp ? emp.name : "—"}`);
      continue;
    }
    console.log(`SET     ${wc.name.padEnd(36)} ${emp ? emp.name : "—"}`);
    if (APPLY) await write("mrp.workcenter", [wc.id], { [FIELD]: want });
  }
}

async function run() {
  await authenticate();
  await ensureField();
  await ensureView();
  await ensureDefaults();
  await ensureAutomation();
  if (!APPLY) console.log("dry run — pass --apply");
}

run().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
