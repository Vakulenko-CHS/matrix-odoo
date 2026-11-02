/**
 * Upsert one Worker Pay salary rule per workshop: pay = qty_produced ×
 * operation Price Rate (x_studio_piece_rate_2) on done workorders finished in
 * the payslip period; every employee in employee_assigned_ids gets the full sum.
 *
 *   npx ts-node --transpile-only src/tools/payroll/worker-pay-rules.ts
 *   npx ts-node --transpile-only src/tools/payroll/worker-pay-rules.ts --apply
 */
import { authenticate, executeKw, searchRead, write } from "../../api/odoo";
import { ODOO_WORKCENTERS } from "../../workcenters/canon";
import { PAYROLL_SHOPS, WORKER_PAY_STRUCT } from "./config";

const APPLY = process.argv.includes("--apply");

type RuleRow = { id: number; code: string; name: string; amount_python_compute: string | false };

function ruleCode(wcId: number, wcName: string): string {
  return `# ${wcName} — оплата за штуку: qty_produced * Price Rate операції.
# Кожен призначений робітник (employee_assigned_ids) отримує повну суму.
WC_ID = ${wcId}
total = 0.0
wos = payslip.env['mrp.workorder'].search([
    ('workcenter_id', '=', WC_ID),
    ('state', '=', 'done'),
    ('date_finished', '>=', str(payslip.date_from) + ' 00:00:00'),
    ('date_finished', '<=', str(payslip.date_to) + ' 23:59:59'),
    ('employee_assigned_ids', 'in', [employee.id]),
])
for wo in wos:
    total += wo.qty_produced * (wo.operation_id.x_studio_piece_rate_2 or 0.0)
result = total
`;
}

async function run() {
  await authenticate();
  const [struct] = await searchRead<{ id: number }>(
    "hr.payroll.structure",
    [["name", "=", WORKER_PAY_STRUCT]],
    ["id"],
    1,
  );
  if (!struct) throw new Error(`structure "${WORKER_PAY_STRUCT}" not found`);

  const wcs = await searchRead<{ id: number; code: string | false; name: string }>(
    "mrp.workcenter",
    [],
    ["id", "code", "name"],
    500,
  );
  const rules = await searchRead<RuleRow>(
    "hr.salary.rule",
    [["struct_id", "=", struct.id]],
    ["id", "code", "name", "amount_python_compute"],
    500,
  );
  const template = rules.find((r) => r.code.startsWith("п-"));
  if (!template) throw new Error("no existing п-* rule to copy from");

  let changes = 0;
  for (const shop of PAYROLL_SHOPS) {
    const canon = ODOO_WORKCENTERS.find((w) => w.num === shop.num);
    const wc = canon && wcs.find((w) => w.code === canon.code);
    if (!wc) {
      console.log(`NO WORKCENTER ${shop.num}`);
      continue;
    }
    const code = ruleCode(wc.id, wc.name);
    const rule = rules.find((r) => r.code === shop.ruleCode);
    if (rule && rule.amount_python_compute === code) {
      console.log(`ok      ${shop.ruleCode.padEnd(8)} ${wc.name}`);
      continue;
    }
    changes++;
    console.log(`${rule ? "UPDATE" : "CREATE"}  ${shop.ruleCode.padEnd(8)} ${wc.name}`);
    if (!APPLY) continue;
    if (rule) {
      await write("hr.salary.rule", [rule.id], { amount_python_compute: code });
    } else {
      await executeKw("hr.salary.rule", "copy", [template.id], {
        default: { name: shop.ruleName, code: shop.ruleCode, amount_python_compute: code },
      });
    }
  }
  console.log(`${changes} change(s)${APPLY ? " applied" : " — dry run, pass --apply"}`);
}

run().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
