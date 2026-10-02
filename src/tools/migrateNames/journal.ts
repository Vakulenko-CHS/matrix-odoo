/**
 * Migration change journal — forward steps + reverse for rollback.
 * Written on dry-run as planned chain; apply appends executed results.
 */
import * as fs from "fs";
import * as path from "path";

export type JournalOpType =
  | "cat-rename"
  | "create-category"
  | "merge-pick-winner"
  | "rename-template"
  | "update-template"
  | "remap-bom-product"
  | "remap-bom-line-component"
  | "set-attrs"
  | "create-template"
  | "archive-template"
  | "unarchive-template"
  | "phase-marker";

export interface JournalReverse {
  type: JournalOpType;
  vals: Record<string, unknown>;
  note?: string;
}

export interface JournalEntry {
  seq: number;
  phase: number;
  workshopRank: number;
  workshopLabel: string;
  type: JournalOpType;
  summary: string;
  /** Forward payload (what apply would do) */
  forward: Record<string, unknown>;
  /** Exact undo for this step (LIFO) */
  reverse: JournalReverse;
  dependsOn?: number[];
  status: "planned" | "done" | "skipped" | "failed" | "rolled_back";
}

export interface MigrationJournal {
  version: 1;
  when: string;
  mode: "planned" | "apply";
  note: string;
  phases: string[];
  entries: JournalEntry[];
}

/** Lower = process first (components before consumers). */
export function workshopRankFromCategory(cat: string): number {
  const c = cat.toLowerCase();
  if (/№\s*1\b|нарізка дерев/.test(c)) return 1;
  if (/№\s*2/.test(c)) return 2;
  if (/№\s*3-2|накладк/.test(c)) return 3.2;
  if (/№\s*3/.test(c)) return 3;
  if (/№\s*4/.test(c)) return 4;
  if (/№\s*5|поролон/.test(c)) return 5;
  if (/№\s*6/.test(c)) return 6;
  if (/№\s*7/.test(c)) return 7;
  if (/№\s*8/.test(c)) return 8;
  if (/№\s*9|подушк|наволоч/.test(c)) return 9;
  if (/фурнітур|сировина/.test(c)) return 0;
  if (/послуг/.test(c)) return 0.5;
  if (/готова/.test(c)) return 10;
  return 5;
}

export function workshopRankFromProductName(name: string): number {
  const n = name.toLowerCase();
  if (/нарізана деревина/.test(n)) return 1;
  if (/каркас - нарізані|бильце - нарізані|планка - нарізані|ламінат - нарізані/.test(n))
    return 2;
  if (/накладк/.test(n)) return 3.2;
  if (/ламінат/.test(n) && /лист/.test(n)) return 3;
  // Цех 6 before generic foam match (name contains «Поролон»)
  if (/каркас \+ поролон|напівфабрикат 2/.test(n)) return 6;
  if (/напівфабрикат/.test(n) && /планка|бильце|каркас/.test(n)) return 4;
  if (/поролон/.test(n)) return 5;
  if (/чохол - нарізані/.test(n)) return 7;
  if (/чохол - напівфабрикат/.test(n)) return 8;
  if (/подушк|наволоч/.test(n)) return 9;
  return 5;
}

export function saveJournal(
  journal: MigrationJournal,
  cwd = process.cwd(),
): { jsonPath: string; mdPath: string } {
  const dir = path.resolve(cwd, "temp", "migrate-journal");
  fs.mkdirSync(dir, { recursive: true });
  const stamp = journal.when.replace(/[: ]/g, "-").slice(0, 19);
  const jsonPath = path.join(dir, `journal-${stamp}.json`);
  const mdPath = path.join(dir, `journal-${stamp}.md`);
  const latestJson = path.join(dir, "journal-latest.json");
  const latestMd = path.join(dir, "journal-latest.md");

  fs.writeFileSync(jsonPath, `${JSON.stringify(journal, null, 2)}\n`, "utf-8");
  fs.writeFileSync(latestJson, `${JSON.stringify(journal, null, 2)}\n`, "utf-8");

  const md = renderJournalMarkdown(journal);
  fs.writeFileSync(mdPath, md, "utf-8");
  fs.writeFileSync(latestMd, md, "utf-8");
  return { jsonPath, mdPath };
}

export function renderJournalMarkdown(j: MigrationJournal): string {
  const lines: string[] = [
    "# Migration journal (rollback chain)",
    "",
    `When: ${j.when} · mode: **${j.mode}**`,
    "",
    j.note,
    "",
    "## Rollback",
    "",
    "Undo **from the bottom up** (highest `seq` first). Each entry has `reverse`.",
    "Apply will set `status=done` and keep the same reverse payload.",
    "",
    "## Phases",
    "",
    ...j.phases.map((p) => `- ${p}`),
    "",
    "## Chain (forward order = execution order)",
    "",
    `| seq | phase | rank | type | summary |`,
    `|---:|---:|---:|---|---|`,
  ];
  for (const e of j.entries) {
    lines.push(
      `| ${e.seq} | ${e.phase} | ${e.workshopRank} | ${e.type} | ${e.summary.replace(/\|/g, "/")} |`,
    );
  }
  lines.push("");
  lines.push(`Entries: ${j.entries.length}.`);
  lines.push("");
  return `${lines.join("\n")}\n`;
}

export function emptyJournal(when: string, mode: "planned" | "apply"): MigrationJournal {
  return {
    version: 1,
    when,
    mode,
    note:
      "Planned chain from dry-run. Not executed. Rollback = reverse LIFO after apply.",
    phases: [],
    entries: [],
  };
}
