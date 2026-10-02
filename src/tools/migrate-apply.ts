/**
 * Apply migrate phases (write to Odoo).
 *
 *   npm run migrate-apply -- --apply --phases=1-5
 *   npm run migrate-apply -- --apply --phases=6-8
 *
 * Requires prior dry-run plan at temp/migrate-detailed-plan.json
 */
import * as fs from "fs";
import * as path from "path";
import {
  authenticate,
  create,
  executeKw,
  searchRead,
  write,
} from "../api/odoo";
import type { DetailedMigratePlan } from "./migrateNames/detailedPlan";
import {
  JournalEntry,
  MigrationJournal,
  saveJournal,
} from "./migrateNames/journal";
import {
  applyPatternBSplits,
  applyPhase7Creates,
  applyPhase8Archives,
} from "./migrateNames/patternBApply";
import { sleep } from "./odooPaged";

function leafCatName(completeTo: string): string {
  const parts = completeTo.split(" / ");
  return parts[parts.length - 1] ?? completeTo;
}

async function ensurePoslugy(): Promise<{ id: number; created: boolean }> {
  const existing = await searchRead<{ id: number; name: string }>(
    "product.category",
    [["name", "=", "Послуги"]],
    ["id", "name"],
    5,
  );
  if (existing.length) return { id: existing[0].id, created: false };
  const id = await create("product.category", { name: "Послуги" });
  return { id, created: true };
}

async function variantsOf(tmplId: number): Promise<
  Array<{ id: number; display_name: string }>
> {
  return searchRead("product.product", [["product_tmpl_id", "=", tmplId]], [
    "id",
    "display_name",
  ]);
}

/** Prefer exact display match, else color token in parens, else first/Білий. */
function mapVariant(
  fromDisplay: string,
  toVariants: Array<{ id: number; display_name: string }>,
  preferWhite = false,
): number {
  const exact = toVariants.find((v) => v.display_name === fromDisplay);
  if (exact) return exact.id;
  const color = fromDisplay.match(/\(([^)]+)\)\s*$/)?.[1]?.trim();
  if (color) {
    const hit = toVariants.find((v) => v.display_name.includes(`(${color})`));
    if (hit) return hit.id;
  }
  if (preferWhite) {
    const w = toVariants.find((v) => /\(Білий\)/.test(v.display_name));
    if (w) return w.id;
  }
  return toVariants[0]?.id;
}

async function remapBomLines(
  fromTmplId: number,
  toTmplId: number,
  preferWhite = false,
): Promise<{ lines: number; map: Record<number, number> }> {
  const fromVs = await variantsOf(fromTmplId);
  const toVs = await variantsOf(toTmplId);
  if (!toVs.length) throw new Error(`no variants on winner tmpl ${toTmplId}`);
  const map: Record<number, number> = {};
  for (const fv of fromVs) {
    map[fv.id] = mapVariant(fv.display_name, toVs, preferWhite);
  }
  const fromIds = fromVs.map((v) => v.id);
  if (!fromIds.length) return { lines: 0, map };

  const lines = await searchRead<{ id: number; product_id: [number, string] }>(
    "mrp.bom.line",
    [["product_id", "in", fromIds]],
    ["id", "product_id"],
  );
  for (const line of lines) {
    const oldId = line.product_id[0];
    const newId = map[oldId];
    if (newId && newId !== oldId) {
      await write("mrp.bom.line", [line.id], { product_id: newId });
      await sleep(30);
    }
  }

  // BOMs whose product_tmpl_id is the loser
  const boms = await searchRead<{ id: number }>(
    "mrp.bom",
    [["product_tmpl_id", "=", fromTmplId]],
    ["id"],
  );
  for (const bom of boms) {
    await write("mrp.bom", [bom.id], { product_tmpl_id: toTmplId });
    await sleep(30);
  }

  return { lines: lines.length, map };
}

async function stripAllAttrLines(tmplId: number): Promise<number[]> {
  const lines = await searchRead<{ id: number }>(
    "product.template.attribute.line",
    [["product_tmpl_id", "=", tmplId]],
    ["id"],
  );
  const ids = lines.map((l) => l.id);
  if (ids.length) {
    // unlink attr lines — Odoo regenerates variants
    await executeKw("product.template.attribute.line", "unlink", [ids]);
  }
  return ids;
}

function pushJournal(
  entries: JournalEntry[],
  partial: Omit<JournalEntry, "seq" | "status"> & { status?: JournalEntry["status"] },
): void {
  entries.push({
    ...partial,
    seq: entries.length + 1,
    status: partial.status ?? "done",
  });
}

async function applyPhases15(plan: DetailedMigratePlan): Promise<MigrationJournal> {
  const when = new Date().toISOString().slice(0, 19).replace("T", " ");
  const journal: MigrationJournal = {
    version: 1,
    when,
    mode: "apply",
    note: "Phases 1–5 applied. Laminate size-in-name merges deferred (need size attr on winner).",
    phases: plan.phases.slice(0, 6),
    entries: [],
  };
  const log: string[] = [];
  const say = (s: string) => {
    console.log(s);
    log.push(s);
  };

  // ── 1 cat-rename ──────────────────────────────────────────────
  say("[1] cat-rename");
  for (const c of plan.catRenames) {
    const leaf = leafCatName(c.to);
    const before = await searchRead<{ id: number; name: string }>(
      "product.category",
      [["id", "=", c.id]],
      ["id", "name"],
      1,
    );
    const oldName = before[0]?.name ?? "";
    await write("product.category", [c.id], { name: leaf });
    pushJournal(journal.entries, {
      phase: 1,
      workshopRank: 0,
      workshopLabel: "categories",
      type: "cat-rename",
      summary: `cat ${c.id}: ${oldName} → ${leaf}`,
      forward: { id: c.id, name: leaf },
      reverse: { type: "cat-rename", vals: { id: c.id, name: oldName } },
    });
    say(`  OK ${c.id} → ${leaf}`);
    await sleep(50);
  }

  // ── 2 Послуги ─────────────────────────────────────────────────
  say("[2] category Послуги");
  const poslugy = await ensurePoslugy();
  pushJournal(journal.entries, {
    phase: 2,
    workshopRank: 0.5,
    workshopLabel: "Послуги",
    type: "create-category",
    summary: poslugy.created
      ? `created Послуги id=${poslugy.id}`
      : `Послуги already id=${poslugy.id}`,
    forward: { id: poslugy.id },
    reverse: poslugy.created
      ? { type: "archive-template", vals: { categoryId: poslugy.id, note: "unlink/archive category if empty" } }
      : { type: "create-category", vals: { note: "noop" } },
  });
  say(`  OK Послуги id=${poslugy.id} created=${poslugy.created}`);

  // ── 3 merges ──────────────────────────────────────────────────
  say("[3] merges");
  const deferred: string[] = [];
  for (const g of plan.mergeGroups) {
    const isSizeLaminate =
      g.canon.includes("Ламінат кольоровий - лист") &&
      g.losers.some((l) => /\d/.test(l.name) && /x|х|Х/i.test(l.name));

    if (isSizeLaminate) {
      deferred.push(g.canon);
      say(`  DEFER ${g.canon} (size-in-name → need size attr on winner ${g.winner.id})`);
      pushJournal(journal.entries, {
        phase: 3,
        workshopRank: 0,
        workshopLabel: g.category,
        type: "merge-pick-winner",
        summary: `DEFERRED ${g.canon}`,
        forward: { deferred: true, winnerId: g.winner.id, losers: g.losers.map((l) => l.id) },
        reverse: { type: "merge-pick-winner", vals: { note: "noop deferred" } },
        status: "skipped",
      });
      continue;
    }

    say(`  merge «${g.canon}» winner=${g.winner.id}`);
    const preferWhite = g.canon === "[Ламінат]";
    for (const loser of g.losers) {
      const { lines, map } = await remapBomLines(
        loser.id,
        g.winner.id,
        preferWhite,
      );
      pushJournal(journal.entries, {
        phase: 3,
        workshopRank: 0,
        workshopLabel: g.category,
        type: "remap-bom-line-component",
        summary: `remap ${loser.id}→${g.winner.id} lines=${lines}`,
        forward: { from: loser.id, to: g.winner.id, lines, map },
        reverse: {
          type: "remap-bom-line-component",
          vals: { mapInvert: Object.fromEntries(Object.entries(map).map(([a, b]) => [b, Number(a)])) },
          note: "approximate; prefer dump-full restore for lines",
        },
      });
      say(`    remap loser ${loser.id}: ${lines} lines`);

      await write("product.template", [loser.id], { active: false });
      pushJournal(journal.entries, {
        phase: 3,
        workshopRank: 0,
        workshopLabel: g.category,
        type: "archive-template",
        summary: `archive ${loser.id} «${loser.name}»`,
        forward: { id: loser.id, active: false },
        reverse: { type: "unarchive-template", vals: { id: loser.id, active: true } },
      });
      say(`    archive ${loser.id}`);
      await sleep(50);
    }

    const winVals: Record<string, unknown> = {};
    if (g.winner.name !== g.canon) winVals.name = g.canon;
    if (g.category === "Послуги") winVals.categ_id = poslugy.id;
    if (Object.keys(winVals).length) {
      const old = { name: g.winner.name };
      await write("product.template", [g.winner.id], winVals);
      pushJournal(journal.entries, {
        phase: 3,
        workshopRank: 0,
        workshopLabel: g.category,
        type: "rename-template",
        summary: `winner ${g.winner.id} ${JSON.stringify(winVals)}`,
        forward: { id: g.winner.id, ...winVals },
        reverse: { type: "rename-template", vals: { id: g.winner.id, name: old.name } },
      });
      say(`    winner write ${JSON.stringify(winVals)}`);
    }

    if (Array.isArray(g.allowedAttrs) && g.allowedAttrs.length === 0) {
      // furniture: strip attrs if any
      if (g.winner.attrNames.length) {
        const removed = await stripAllAttrLines(g.winner.id);
        pushJournal(journal.entries, {
          phase: 3,
          workshopRank: 0,
          workshopLabel: g.category,
          type: "set-attrs",
          summary: `strip attrs on ${g.winner.id}: ${removed.join(",")}`,
          forward: { id: g.winner.id, removed },
          reverse: {
            type: "set-attrs",
            vals: { note: "recreate attr lines from dump-full" },
          },
        });
      }
    }
    await sleep(80);
  }

  // ── 4 renames ─────────────────────────────────────────────────
  say(`[4] renames (${plan.renames.length})`);
  let renamed = 0;
  for (const r of plan.renames) {
    // skip if already merged away / archived
    const live = await searchRead<{ id: number; name: string; active: boolean }>(
      "product.template",
      [["id", "=", r.id]],
      ["id", "name", "active"],
      1,
    );
    if (!live.length || !live[0].active) {
      say(`  skip ${r.id} (missing/archived)`);
      continue;
    }
    if (live[0].name === r.to) {
      renamed++;
      continue;
    }
    // name collision?
    const clash = await searchRead<{ id: number }>(
      "product.template",
      [["name", "=", r.to], ["id", "!=", r.id], ["active", "=", true]],
      ["id"],
      1,
    );
    if (clash.length) {
      say(`  COLLISION skip ${r.id} «${r.from}» → «${r.to}» taken by ${clash[0].id}`);
      pushJournal(journal.entries, {
        phase: 4,
        workshopRank: 0,
        workshopLabel: r.category,
        type: "rename-template",
        summary: `COLLISION ${r.id} → ${r.to}`,
        forward: { id: r.id, to: r.to, clash: clash[0].id },
        reverse: { type: "rename-template", vals: { note: "noop" } },
        status: "skipped",
      });
      continue;
    }
    await write("product.template", [r.id], { name: r.to });
    pushJournal(journal.entries, {
      phase: 4,
      workshopRank: 0,
      workshopLabel: r.category,
      type: "rename-template",
      summary: `rename ${r.id} «${r.from}» → «${r.to}»`,
      forward: { id: r.id, name: r.to },
      reverse: { type: "rename-template", vals: { id: r.id, name: r.from } },
    });
    renamed++;
    if (renamed % 20 === 0) say(`  … ${renamed}/${plan.renames.length}`);
    await sleep(40);
  }
  say(`  OK renamed/skipped-done ${renamed}`);

  // ── 5 updates ─────────────────────────────────────────────────
  say("[5] updates");
  for (const u of plan.updates) {
    if (u.changes.some((c) => c.includes("type service → consu"))) {
      await write("product.template", [u.id], { type: "consu" });
      pushJournal(journal.entries, {
        phase: 5,
        workshopRank: 9,
        workshopLabel: u.name,
        type: "update-template",
        summary: `type consu on ${u.id}`,
        forward: { id: u.id, type: "consu" },
        reverse: { type: "update-template", vals: { id: u.id, type: "service" } },
      });
      say(`  OK ${u.id} type=consu`);
    }
  }

  if (deferred.length) {
    say(`[note] deferred merges: ${deferred.join("; ")}`);
  }

  journal.note += deferred.length
    ? ` Deferred: ${deferred.join(", ")}.`
    : "";

  const dir = path.resolve("temp");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "migrate-apply-1-5.log"),
    log.join("\n") + "\n",
    "utf-8",
  );
  return journal;
}

async function applyPhases68(plan: DetailedMigratePlan): Promise<MigrationJournal> {
  const when = new Date().toISOString().slice(0, 19).replace("T", " ");
  const journal: MigrationJournal = {
    version: 1,
    when,
    mode: "apply",
    note:
      "Phases 6–8. [Подушка]/67 and typo foam 45 = archive-only (no live active furniture). Archived parents ignored on component remap.",
    phases: plan.phases.slice(6, 9),
    entries: [],
  };
  const log: string[] = [];
  const say = (s: string) => {
    console.log(s);
    log.push(s);
  };

  await applyPatternBSplits(plan.patternBSplits, journal.entries, say);

  const pbCreateNames = new Set(
    plan.patternBSplits.flatMap((s) => s.createChildren.map((c) => c.name)),
  );
  await applyPhase7Creates(plan.creates, pbCreateNames, journal.entries, say);

  const skipArchive = new Set([
    ...plan.patternBSplits.map((s) => s.universalId),
    ...plan.mergeGroups.flatMap((g) => g.losers.map((l) => l.id)),
  ]);
  await applyPhase8Archives(plan.archives, skipArchive, journal.entries, say);

  const dir = path.resolve("temp");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "migrate-apply-6-8.log"),
    log.join("\n") + "\n",
    "utf-8",
  );
  return journal;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (!args.includes("--apply")) {
    console.error(
      "Usage: npx ts-node src/tools/migrate-apply.ts --apply --phases=1-5|6-8",
    );
    process.exit(2);
  }
  const phasesArg = args.find((a) => a.startsWith("--phases="))?.slice(9) ?? "1-5";

  const planPath = path.resolve("temp/migrate-detailed-plan.json");
  if (!fs.existsSync(planPath)) {
    console.error("Missing temp/migrate-detailed-plan.json — run dry-run first.");
    process.exit(2);
  }
  const plan = JSON.parse(
    fs.readFileSync(planPath, "utf-8"),
  ) as DetailedMigratePlan;

  await authenticate();

  let journal: MigrationJournal;
  if (phasesArg === "1-5") {
    console.log("[migrate-apply] WRITE to Odoo — phases 1-5");
    journal = await applyPhases15(plan);
  } else if (phasesArg === "6-8" || phasesArg === "6") {
    console.log("[migrate-apply] WRITE to Odoo — phases 6-8");
    journal = await applyPhases68(plan);
  } else {
    console.error("Supported --phases=1-5 or --phases=6-8");
    process.exit(2);
  }

  const paths = saveJournal(journal);
  console.log("");
  console.log(`[migrate-apply] done. journal entries=${journal.entries.length}`);
  console.log(`[migrate-apply] ${paths.mdPath}`);
  console.log(`[migrate-apply] ${paths.jsonPath}`);
}

main().catch((err) => {
  console.error("[migrate-apply]", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
