/**
 * Finish migration leftovers: Pattern B 36/216 + furniture Ніжка/Петля + ДВП 1020.
 *   npx ts-node --transpile-only src/tools/migrate-finish-tails.ts --apply
 */
import * as fs from "fs";
import * as path from "path";
import {
  authenticate,
  executeKw,
  searchRead,
  unlink,
  write,
} from "../api/odoo";
import {
  JournalEntry,
  MigrationJournal,
  saveJournal,
} from "./migrateNames/journal";
import { sleep } from "./odooPaged";

function push(
  entries: JournalEntry[],
  partial: Omit<JournalEntry, "seq" | "status"> & { status?: JournalEntry["status"] },
): void {
  entries.push({
    ...partial,
    seq: entries.length + 1,
    status: partial.status ?? "done",
  });
}

async function variantsOf(tmplId: number) {
  return searchRead<{ id: number; display_name: string }>(
    "product.product",
    [["product_tmpl_id", "=", tmplId]],
    ["id", "display_name"],
  );
}

async function defaultVariant(tmplId: number): Promise<number> {
  const vs = await variantsOf(tmplId);
  if (!vs.length) throw new Error(`no variant on tmpl ${tmplId}`);
  return vs[0].id;
}

async function dropBom(bomId: number): Promise<void> {
  try {
    await write("mrp.bom", [bomId], { active: false });
  } catch {
    await unlink("mrp.bom", [bomId]);
  }
}

async function archiveTemplate(tmplId: number, say: (s: string) => void): Promise<void> {
  const boms = await executeKw<{ id: number }[]>(
    "mrp.bom",
    "search_read",
    [[["product_tmpl_id", "=", tmplId]]],
    { fields: ["id"], context: { lang: "uk_UA", active_test: false } },
  );
  for (const b of boms) {
    try {
      await dropBom(b.id);
    } catch (e) {
      say(`  WARN drop bom ${b.id}: ${e instanceof Error ? e.message.slice(0, 80) : e}`);
    }
  }
  await write("product.template", [tmplId], { active: false });
}

/** Remap all bom.lines from fromVariantIds → toVariantId (active parents preferred, all ok). */
async function remapLines(
  fromVariantIds: number[],
  toVariantId: number,
  say: (s: string) => void,
): Promise<number> {
  if (!fromVariantIds.length) return 0;
  let n = 0;
  for (let i = 0; i < fromVariantIds.length; i += 200) {
    const chunk = fromVariantIds.slice(i, i + 200);
    const lines = await searchRead<{ id: number; product_id: [number, string] }>(
      "mrp.bom.line",
      [["product_id", "in", chunk]],
      ["id", "product_id"],
    );
    for (const line of lines) {
      if (line.product_id[0] === toVariantId) continue;
      await write("mrp.bom.line", [line.id], { product_id: toVariantId });
      n++;
      await sleep(20);
    }
  }
  say(`    remapped ${n} lines → product ${toVariantId}`);
  return n;
}

function matchKey(display: string): string {
  const m = display.match(/\(([^)]+)\)\s*$/);
  return (m?.[1] ?? display).trim().toLowerCase().replace(/\s+/g, "");
}

async function main(): Promise<void> {
  if (!process.argv.includes("--apply")) {
    console.error("Usage: … migrate-finish-tails.ts --apply");
    process.exit(2);
  }
  await authenticate();
  const when = new Date().toISOString().slice(0, 19).replace("T", " ");
  const journal: MigrationJournal = {
    version: 1,
    when,
    mode: "apply",
    note: "Finish tails: archive 36/216; furniture remap Ніжка/Петля; merge ДВП 1020→213.",
    phases: ["6b tails", "8 furniture"],
    entries: [],
  };
  const log: string[] = [];
  const say = (s: string) => {
    console.log(s);
    log.push(s);
  };

  // ── 36 + 216: only archived parents left → archive ─────────────
  for (const id of [36, 216]) {
    say(`[tail] archive Pattern B leftover ${id}`);
    const rows = await executeKw<Array<{ id: number; active: boolean; name: string }>>(
      "product.template",
      "search_read",
      [[["id", "=", id]]],
      {
        fields: ["id", "active", "name"],
        limit: 1,
        context: { lang: "uk_UA", active_test: false },
      },
    );
    if (!rows.length || !rows[0].active) {
      say(`  skip ${id}`);
      continue;
    }
    await archiveTemplate(id, say);
    push(journal.entries, {
      phase: 6,
      workshopRank: id === 36 ? 2 : 5,
      workshopLabel: rows[0].name,
      type: "archive-template",
      summary: `archive leftover ${id} «${rows[0].name}»`,
      forward: { id, active: false },
      reverse: { type: "unarchive-template", vals: { id, active: true } },
    });
    say(`  OK archive ${id}`);
  }

  // ── 1020 → 213 [ДВП дно] ───────────────────────────────────────
  say(`[tail] merge ДВП 1020 → 213`);
  const dvpWinner = 213;
  const dvpLoser = 1020;
  const toDvp = await defaultVariant(dvpWinner);
  const fromDvp = await variantsOf(dvpLoser);
  const nDvp = await remapLines(
    fromDvp.map((v) => v.id),
    toDvp,
    say,
  );
  // also move any BOM owned by loser
  const loserBoms = await searchRead<{ id: number }>(
    "mrp.bom",
    [["product_tmpl_id", "=", dvpLoser]],
    ["id"],
  );
  for (const b of loserBoms) {
    try {
      await write("mrp.bom", [b.id], {
        product_tmpl_id: dvpWinner,
        product_id: toDvp,
      });
    } catch {
      await dropBom(b.id);
    }
  }
  await archiveTemplate(dvpLoser, say);
  push(journal.entries, {
    phase: 8,
    workshopRank: 0,
    workshopLabel: "[ДВП дно]",
    type: "remap-bom-line-component",
    summary: `merge ${dvpLoser}→${dvpWinner} lines=${nDvp}`,
    forward: { from: dvpLoser, to: dvpWinner, lines: nDvp },
    reverse: {
      type: "remap-bom-line-component",
      vals: { note: "restore from dump-full" },
    },
  });
  push(journal.entries, {
    phase: 8,
    workshopRank: 0,
    workshopLabel: "[ДВП дно]",
    type: "archive-template",
    summary: `archive ${dvpLoser}`,
    forward: { id: dvpLoser, active: false },
    reverse: { type: "unarchive-template", vals: { id: dvpLoser, active: true } },
  });
  say(`  OK archive ${dvpLoser}`);

  // ── Ніжка 10 → furniture ───────────────────────────────────────
  say(`[tail] remap [Ніжка] 10 → furniture`);
  const nizhkaMap: Array<{ key: string; tmplId: number; label: string }> = [
    { key: "h30", tmplId: 1273, label: "Ніжка під шуруп Н30" },
    { key: "h50кругла", tmplId: 1274, label: "Ніжка під шуруп Н50" },
    { key: "h50прямокутна", tmplId: 1275, label: "Ніжка Н50 прямокутна" },
    { key: "трикутна", tmplId: 1276, label: "Ніжка трикутна" },
    { key: "h32", tmplId: 403, label: "Опора ролик Н32" },
  ];
  const nizhkaVars = await variantsOf(10);
  let nizhkaLines = 0;
  for (const v of nizhkaVars) {
    const key = matchKey(v.display_name);
    const hit = nizhkaMap.find((m) => key === m.key || key.includes(m.key));
    if (!hit) {
      say(`  WARN no map for ${v.display_name}`);
      continue;
    }
    const toId = await defaultVariant(hit.tmplId);
    say(`  ${v.display_name} → ${hit.label} (${toId})`);
    nizhkaLines += await remapLines([v.id], toId, say);
    push(journal.entries, {
      phase: 8,
      workshopRank: 0,
      workshopLabel: "[Ніжка]",
      type: "remap-bom-line-component",
      summary: `nizhka var ${v.id} → tmpl ${hit.tmplId}`,
      forward: { fromVariant: v.id, toVariant: toId, toTmpl: hit.tmplId },
      reverse: {
        type: "remap-bom-line-component",
        vals: { fromVariant: toId, toVariant: v.id },
      },
    });
  }
  await archiveTemplate(10, say);
  push(journal.entries, {
    phase: 8,
    workshopRank: 0,
    workshopLabel: "[Ніжка]",
    type: "archive-template",
    summary: `archive [Ніжка] 10 after remap lines=${nizhkaLines}`,
    forward: { id: 10, active: false },
    reverse: { type: "unarchive-template", vals: { id: 10, active: true } },
  });
  say(`  OK archive 10`);

  // ── Петля 8 → Завіса* ──────────────────────────────────────────
  say(`[tail] remap [Петля] 8 → Завіса`);
  const petlyaMap: Array<{ keys: string[]; tmplId: number; label: string }> = [
    {
      keys: ["накладка", "накладная"],
      tmplId: 1269,
      label: "Завіса Накладна",
    },
    {
      keys: ["велика", "большая"],
      tmplId: 1271,
      label: "Завіса 190 113.02 Етера пласт",
    },
    {
      keys: ["к113.01", "k113.01", "к.113.01", "петляк113.01"],
      tmplId: 1272,
      label: "Завіса К 113.01",
    },
  ];
  const petlyaVars = await variantsOf(8);
  let petlyaLines = 0;
  for (const v of petlyaVars) {
    const key = matchKey(v.display_name);
    const hit = petlyaMap.find((m) =>
      m.keys.some((k) => key === k || key.includes(k.replace(/\./g, "")) || key.replace(/\./g, "") === k.replace(/\./g, "")),
    );
    if (!hit) {
      say(`  WARN no map for ${v.display_name} key=${key}`);
      continue;
    }
    const toId = await defaultVariant(hit.tmplId);
    say(`  ${v.display_name} → ${hit.label} (${toId})`);
    petlyaLines += await remapLines([v.id], toId, say);
    push(journal.entries, {
      phase: 8,
      workshopRank: 0,
      workshopLabel: "[Петля]",
      type: "remap-bom-line-component",
      summary: `petlya var ${v.id} → tmpl ${hit.tmplId}`,
      forward: { fromVariant: v.id, toVariant: toId, toTmpl: hit.tmplId },
      reverse: {
        type: "remap-bom-line-component",
        vals: { fromVariant: toId, toVariant: v.id },
      },
    });
  }
  await archiveTemplate(8, say);
  push(journal.entries, {
    phase: 8,
    workshopRank: 0,
    workshopLabel: "[Петля]",
    type: "archive-template",
    summary: `archive [Петля] 8 after remap lines=${petlyaLines}`,
    forward: { id: 8, active: false },
    reverse: { type: "unarchive-template", vals: { id: 8, active: true } },
  });
  say(`  OK archive 8`);

  // ── verify ─────────────────────────────────────────────────────
  say(`[verify]`);
  for (const id of [36, 216, 10, 8, 1020]) {
    const rows = await executeKw<Array<{ id: number; active: boolean; name: string }>>(
      "product.template",
      "search_read",
      [[["id", "=", id]]],
      {
        fields: ["id", "active", "name"],
        limit: 1,
        context: { lang: "uk_UA", active_test: false },
      },
    );
    say(`  ${id} active=${rows[0]?.active} «${rows[0]?.name}»`);
  }

  const paths = saveJournal(journal);
  fs.writeFileSync(
    path.resolve("temp/migrate-finish-tails.log"),
    log.join("\n") + "\n",
    "utf-8",
  );
  console.log(`[finish-tails] done entries=${journal.entries.length}`);
  console.log(`[finish-tails] ${paths.mdPath}`);
}

main().catch((err) => {
  console.error("[finish-tails]", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
