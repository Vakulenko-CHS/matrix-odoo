/**
 * Studio automation: assign serial lots on sofa/bed MO create/write.
 * Keep Python tiny — Extra Modules bills per 100 loc (~80 live now).
 *
 *   npm run studio-auto-serial
 *   npm run studio-auto-serial -- --apply
 */
import { authenticate, create, executeKw, searchRead, write } from "../api/odoo";

const APPLY = process.argv.includes("--apply");
const NAME = "Авто SN на MO (готовий диван/ліжко)";
const CODE = `for rec in records:
    p, n = rec.product_id, int(rec.product_qty or 1)
    if p.tracking != 'serial' or rec.state in ('done', 'cancel'):
        continue
    ids = rec.lot_producing_ids.ids
    if not ids:
        ref = rec.sale_line_id.x_studio_x_so_line_uid if rec.sale_line_id else False
        ids = [rec.env['stock.lot'].create({'product_id': p.id, 'name': rec.env['ir.sequence'].next_by_code('stock.lot.serial'), 'ref': ref, 'company_id': rec.company_id.id}).id for _ in range(n)]
        rec.write({'lot_producing_ids': [(6, 0, ids)]})
    qc = rec.env['quality.check'].search(['|', ('production_id', '=', rec.id), '&', '&', ('product_id', '=', p.id), ('production_id', '=', False), ('quality_state', '=', 'none')], limit=1, order='id desc')
    if qc:
        qc.write({'production_id': rec.id, 'lot_ids': [(6, 0, ids)], 'finished_lot_ids': [(6, 0, ids)]})`;

function loc(code: string): number {
  return code.split("\n").filter((l) => {
    const t = l.trim();
    return t.length > 0 && !t.startsWith("#");
  }).length;
}

async function studioLoc(): Promise<number> {
  const fields = await searchRead<{ compute: string }>(
    "ir.model.fields",
    [["state", "=", "manual"], ["compute", "!=", false]],
    ["compute"],
    0,
  );
  let n = 0;
  for (const f of fields) n += loc(f.compute);
  const autos = await searchRead<{ action_server_ids: number[] }>(
    "base.automation",
    [],
    ["action_server_ids"],
    0,
  );
  const ids = autos.flatMap((a) => a.action_server_ids);
  if (ids.length) {
    const acts = await searchRead<{ code: string }>(
      "ir.actions.server",
      [["id", "in", ids]],
      ["code"],
      0,
    );
    for (const a of acts) n += loc(a.code || "");
  }
  return n;
}

async function main() {
  await authenticate();
  const add = loc(CODE);
  const before = await studioLoc();
  const existing = await searchRead<{ id: number; action_server_ids: number[] }>(
    "base.automation",
    [["name", "=", NAME]],
    ["id", "action_server_ids"],
    1,
  );
  let oldLoc = 0;
  if (existing[0]?.action_server_ids?.[0]) {
    const [act] = await searchRead<{ code: string }>(
      "ir.actions.server",
      [["id", "=", existing[0].action_server_ids[0]]],
      ["code"],
      1,
    );
    oldLoc = loc(act?.code || "");
  }
  const projected = before - oldLoc + add;
  console.log(`action loc ${oldLoc}→${add}; studio ${before}→${projected} (cap 100)`);
  if (projected > 100) {
    console.error("ABORT: would exceed 100 billed lines");
    process.exit(1);
  }
  if (!APPLY) {
    console.log("DRY RUN — pass --apply to create/update");
    return;
  }
  if (existing.length) {
    const actionId = existing[0].action_server_ids[0];
    await write("ir.actions.server", [actionId], { code: CODE });
    const after = await studioLoc();
    console.log(`updated action ${actionId}; studio loc ${after}`);
    return;
  }
  const [model] = await searchRead<{ id: number }>(
    "ir.model",
    [["model", "=", "mrp.production"]],
    ["id"],
    1,
  );
  const automationId = await create("base.automation", {
    name: NAME,
    model_id: model.id,
    trigger: "on_create_or_write",
    filter_domain: [["product_tracking", "=", "serial"]],
  });
  const actionId = await create("ir.actions.server", {
    name: NAME,
    model_id: model.id,
    state: "code",
    usage: "base_automation",
    base_automation_id: automationId,
    code: CODE,
  });
  const after = await studioLoc();
  console.log(`created automation ${automationId} action ${actionId}; studio loc ${after}`);
}

main().catch((err) => {
  console.error("[FATAL]", err instanceof Error ? err.message : err);
  process.exit(1);
});
