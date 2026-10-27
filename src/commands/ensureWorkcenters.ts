/**
 * Align mrp.workcenter rows with src/workcenters/canon.ts.
 * Creates missing shops (Цех №4-4) and renames Сборка→Збірка / wrong titles.
 *
 *   npx ts-node --transpile-only src/commands/ensureWorkcenters.ts
 *   npx ts-node --transpile-only src/commands/ensureWorkcenters.ts --apply
 */
import { authenticate, create, searchRead, write } from "../api/odoo";
import {
  ODOO_WORKCENTERS,
  extractWorkshopNum,
  type CanonWorkcenter,
} from "../workcenters/canon";

const APPLY = process.argv.includes("--apply");

type WcRow = {
  id: number;
  name: string;
  code: string | false;
  active: boolean;
};

function codeOf(row: WcRow): string {
  return row.code ? String(row.code) : "";
}

function pickRow(rows: WcRow[], wc: CanonWorkcenter): WcRow | undefined {
  const live = rows.filter((r) => r.active !== false);
  const pool = live.length ? live : rows;
  const byCode = pool.find((r) => codeOf(r) === wc.code);
  if (byCode) return byCode;
  const byNum = pool.filter((r) => extractWorkshopNum(r.name) === wc.num);
  return (
    byNum.find((r) => codeOf(r)) ??
    byNum.find((r) => r.name === wc.name) ??
    byNum[0]
  );
}

async function run() {
  await authenticate();
  const rows = await searchRead<WcRow>(
    "mrp.workcenter",
    [],
    ["id", "name", "code", "active"],
    500,
  );
  console.log(`workcenters in Odoo: ${rows.length}`);

  let creates = 0;
  let writes = 0;
  for (const wc of ODOO_WORKCENTERS) {
    const existing = pickRow(rows, wc);
    if (!existing) {
      console.log(`MISSING ${wc.code} ${wc.name}`);
      if (APPLY) {
        const id = await create("mrp.workcenter", {
          name: wc.name,
          code: wc.code,
          time_efficiency: 100,
        });
        console.log(`  created id=${id}`);
      }
      creates++;
      continue;
    }
    const patch: Record<string, string> = {};
    if (existing.name !== wc.name) patch.name = wc.name;
    if (codeOf(existing) !== wc.code) patch.code = wc.code;
    if (Object.keys(patch).length) {
      console.log(
        `RENAME id=${existing.id} "${existing.name}"/${codeOf(existing) || "∅"} → "${wc.name}"/${wc.code}`,
      );
      if (APPLY) {
        await write("mrp.workcenter", existing.id, patch);
        console.log("  written");
      }
      writes++;
    } else {
      console.log(`ok id=${existing.id} ${wc.code} ${wc.name}`);
    }
  }

  console.log(
    APPLY
      ? `done creates=${creates} writes=${writes}`
      : `DRY RUN creates=${creates} writes=${writes} — pass --apply to write`,
  );
}

run().catch((err) => {
  console.error("[FATAL]", err instanceof Error ? err.message : err);
  process.exit(1);
});
