/**
 * Make every workshop employee ("(Цех" in the name) eligible for Worker Pay
 * runs: structure type Worker + contract start date on the current version.
 * Existing contract dates are kept.
 *
 *   npx ts-node --transpile-only src/tools/payroll/worker-contracts.ts
 *   npx ts-node --transpile-only src/tools/payroll/worker-contracts.ts --apply
 */
import { authenticate, executeKw, searchRead, write } from "../../api/odoo";
import { CONTRACT_START, EXCLUDED_EMPLOYEES, WORKER_STRUCT_TYPE, normName } from "./config";

const APPLY = process.argv.includes("--apply");

type Version = {
  id: number;
  structure_type_id: [number, string] | false;
  contract_date_start: string | false;
};

async function run() {
  await authenticate();
  const [type] = await searchRead<{ id: number }>(
    "hr.payroll.structure.type",
    [["name", "=", WORKER_STRUCT_TYPE]],
    ["id"],
    1,
  );
  if (!type) throw new Error(`structure type "${WORKER_STRUCT_TYPE}" not found`);

  const excluded = new Set(EXCLUDED_EMPLOYEES.map(normName));
  const emps = await searchRead<{ id: number; name: string; version_id: [number, string] | false }>(
    "hr.employee",
    [["name", "ilike", "(Цех"]],
    ["id", "name", "version_id"],
    1000,
  );

  let changes = 0;
  for (const e of emps) {
    if (excluded.has(normName(e.name)) || !e.version_id) continue;
    const [v] = await executeKw<Version[]>("hr.version", "read", [[e.version_id[0]]], {
      fields: ["structure_type_id", "contract_date_start"],
    });
    const vals: Record<string, unknown> = {};
    if (!v.structure_type_id || v.structure_type_id[0] !== type.id) vals.structure_type_id = type.id;
    if (!v.contract_date_start) vals.contract_date_start = CONTRACT_START;
    if (!Object.keys(vals).length) {
      console.log(`ok      ${normName(e.name)}`);
      continue;
    }
    changes++;
    console.log(`SET     ${normName(e.name).padEnd(32)} ${JSON.stringify(vals)}`);
    if (APPLY) await write("hr.version", [v.id], vals);
  }
  console.log(`${changes} change(s)${APPLY ? " applied" : " — dry run, pass --apply"}`);
}

run().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
