/**
 * T-QAL-01: Quality app access for ВТК staff + Worker Pay on their contracts.
 *
 *   npm run qal01-vtk
 *   npm run qal01-vtk -- --apply
 */
import { authenticate, executeKw, searchRead, write } from "../api/odoo";
import { CONTRACT_START, WORKER_STRUCT_TYPE, normName } from "../tools/payroll/config";

const APPLY = process.argv.includes("--apply");

/** Vadim §4 — ВТК: Таня, Ліза, Оксана (hr.employee names in Odoo). */
const VTK_EMPLOYEE_NAMES = ["Мочалова Тетяна", "Мочалова Єлизавета", "Оксана"] as const;

/** res.groups «Якість / Користувач» (prod). */
const QUALITY_USER_GROUP_ID = 44;

async function workerStructTypeId(): Promise<number> {
  const [row] = await searchRead<{ id: number }>(
    "hr.payroll.structure.type",
    [["name", "=", WORKER_STRUCT_TYPE]],
    ["id"],
    1,
  );
  if (!row) throw new Error(`structure type "${WORKER_STRUCT_TYPE}" not found`);
  return row.id;
}

async function ensureQualityGroup(userId: number, login: string) {
  const [u] = await searchRead<{ group_ids: number[] }>("res.users", [["id", "=", userId]], ["group_ids"], 1);
  const ids = u.group_ids || [];
  if (ids.includes(QUALITY_USER_GROUP_ID)) {
    console.log(`ok      user ${login} already has Якість / Користувач`);
    return;
  }
  console.log(`${APPLY ? "SET" : "would"} user ${login} +group Якість / Користувач (${QUALITY_USER_GROUP_ID})`);
  if (APPLY) await write("res.users", [userId], { group_ids: [[4, QUALITY_USER_GROUP_ID]] });
}

async function ensureWorkerVersion(empId: number, empName: string, structId: number) {
  const [e] = await searchRead<{ version_id: [number, string] | false }>(
    "hr.employee",
    [["id", "=", empId]],
    ["version_id"],
    1,
  );
  if (!e?.version_id) {
    console.log(`SKIP    ${empName} — no hr.version`);
    return;
  }
  const [v] = await executeKw<{
    structure_type_id: [number, string] | false;
    contract_date_start: string | false;
  }>("hr.version", "read", [[e.version_id[0]]], {
    fields: ["structure_type_id", "contract_date_start"],
  });
  const vals: Record<string, unknown> = {};
  if (!v.structure_type_id || v.structure_type_id[0] !== structId) vals.structure_type_id = structId;
  if (!v.contract_date_start) vals.contract_date_start = CONTRACT_START;
  if (!Object.keys(vals).length) {
    console.log(`ok      ${normName(empName)} Worker Pay version`);
    return;
  }
  console.log(`${APPLY ? "SET" : "would"} ${normName(empName)} version ${JSON.stringify(vals)}`);
  if (APPLY) await write("hr.version", [e.version_id[0]], vals);
}

async function main() {
  await authenticate();
  const structId = await workerStructTypeId();
  console.log(`Worker structure type id=${structId}`);

  const emps = await searchRead<{ id: number; name: string; user_id: [number, string] | false }>(
    "hr.employee",
    [["name", "in", [...VTK_EMPLOYEE_NAMES]]],
    ["id", "name", "user_id"],
    10,
  );
  const missing = VTK_EMPLOYEE_NAMES.filter((n) => !emps.some((e) => normName(e.name) === normName(n)));
  if (missing.length) console.warn(`warn: employees not found: ${missing.join(", ")}`);

  for (const e of emps) {
    await ensureWorkerVersion(e.id, e.name, structId);
    if (Array.isArray(e.user_id)) {
      const login = e.user_id[1];
      await ensureQualityGroup(e.user_id[0], login);
    } else {
      console.log(`NOTE    ${e.name} — no res.users; create login for Якість UI (див. T-USR-01)`);
    }
  }

  console.log(APPLY ? "done (apply)" : "dry-run — pass --apply");
  console.log("next: npm run payroll-rules -- --apply && npm run payroll-default-worker -- --apply");
}

main().catch((err) => {
  console.error("[FATAL]", err instanceof Error ? err.message : err);
  process.exit(1);
});
