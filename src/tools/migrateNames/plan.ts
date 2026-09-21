import { normNameKey } from "../../validator/nameKey";
import {
  ArchiveItem,
  CanonItem,
  fixCat,
} from "./parseSpec";

export interface LiveTemplate {
  id: number;
  name: string;
  type: string;
  category: string;
  categoryId: number | null;
  uom: string;
  attrNames: string[];
  variants: number;
  bomCount: number;
}

export interface LiveCategory {
  id: number;
  completeName: string;
}

export type OpKind =
  | "keep"
  | "rename"
  | "update"
  | "merge-archive"
  | "archive"
  | "create"
  | "orphan"
  | "cat-rename";

export interface PlanOp {
  kind: OpKind;
  id?: number;
  from?: string;
  to?: string;
  category?: string;
  uom?: string;
  type?: string;
  attrs?: string[];
  reason?: string;
  bomCount?: number;
  changes?: string[];
}

export interface PlanIssue {
  level: "blocker" | "warning";
  message: string;
}

export interface MigratePlan {
  ops: PlanOp[];
  issues: PlanIssue[];
  counts: Record<OpKind, number>;
}

function indexCanons(canons: CanonItem[]): {
  byKey: Map<string, CanonItem>;
  conflicts: string[];
} {
  const byKey = new Map<string, CanonItem>();
  const conflicts: string[] = [];
  const claim = (raw: string, item: CanonItem): void => {
    const k = normNameKey(raw);
    if (!k) return;
    const prev = byKey.get(k);
    if (prev && prev.name !== item.name) {
      conflicts.push(`аліас «${raw}» → ${prev.name} і ${item.name}`);
      return;
    }
    byKey.set(k, item);
  };
  for (const c of canons) {
    claim(c.name, c);
    for (const a of c.aliases) claim(a, c);
  }
  return { byKey, conflicts };
}

function attrMismatch(
  live: string[],
  expected: string[] | null,
): string | null {
  if (expected == null) return null;
  const a = [...live].map(normNameKey).sort();
  const b = [...expected].map(normNameKey).sort();
  if (a.length === b.length && a.every((x, i) => x === b[i])) return null;
  const have = live.length ? live.join(", ") : "—";
  const want = expected.length ? expected.join(", ") : "без атрибутів";
  return `attrs [${have}] → [${want}]`;
}

function pickKeep(
  lives: LiveTemplate[],
  canon: CanonItem,
  archiveIds: Set<number>,
): LiveTemplate {
  const exact = lives.find((l) => l.name === canon.name);
  if (exact) return exact;
  const notArch = lives.find((l) => !archiveIds.has(l.id));
  if (notArch) return notArch;
  return [...lives].sort(
    (a, b) => b.variants - a.variants || a.id - b.id,
  )[0];
}

function productChanges(
  live: LiveTemplate,
  canon: CanonItem,
): string[] {
  const out: string[] = [];
  const liveCat = fixCat(live.category);
  if (liveCat !== canon.category && live.category !== canon.category) {
    out.push(`категорія «${live.category}» → «${canon.category}»`);
  }
  if (live.uom && canon.uom && live.uom !== canon.uom) {
    out.push(`uom ${live.uom} → ${canon.uom}`);
  }
  if (canon.expectedType && live.type !== canon.expectedType) {
    out.push(`type ${live.type} → ${canon.expectedType}`);
  }
  const attrs = attrMismatch(live.attrNames, canon.expectedAttrNames);
  if (attrs) out.push(attrs);
  return out;
}

export function buildMigratePlan(
  canons: CanonItem[],
  archive: ArchiveItem[],
  live: LiveTemplate[],
  categories: LiveCategory[],
  extra: { laminateColorExists: boolean; poslugyExists: boolean },
): MigratePlan {
  const ops: PlanOp[] = [];
  const issues: PlanIssue[] = [];
  const archiveIds = new Set(archive.map((a) => a.id));
  const archiveReason = new Map(archive.map((a) => [a.id, a.reason]));
  const { byKey, conflicts } = indexCanons(canons);
  for (const c of conflicts) {
    issues.push({ level: "blocker", message: `спек: ${c}` });
  }

  for (const cat of categories) {
    const to = fixCat(cat.completeName);
    if (to !== cat.completeName) {
      ops.push({
        kind: "cat-rename",
        id: cat.id,
        from: cat.completeName,
        to,
      });
    }
  }

  const usedLive = new Set<number>();
  const coveredCanon = new Set<string>();
  const groups = new Map<string, LiveTemplate[]>();
  const unmatched: LiveTemplate[] = [];

  for (const row of live) {
    const canon = byKey.get(normNameKey(row.name));
    if (!canon) {
      unmatched.push(row);
      continue;
    }
    const list = groups.get(canon.name) ?? [];
    list.push(row);
    groups.set(canon.name, list);
  }

  const liveNameToId = new Map<string, number>();
  for (const row of live) liveNameToId.set(row.name, row.id);

  for (const canon of canons) {
    const lives = groups.get(canon.name) ?? [];
    if (lives.length === 0) {
      ops.push({
        kind: "create",
        to: canon.name,
        category: canon.category,
        uom: canon.uom,
        type: canon.expectedType,
        attrs: canon.expectedAttrNames ?? undefined,
        reason: canon.note,
      });
      coveredCanon.add(canon.name);
      continue;
    }

    const keep = pickKeep(lives, canon, archiveIds);
    usedLive.add(keep.id);
    coveredCanon.add(canon.name);

    const extras = lives.filter((l) => l.id !== keep.id);
    for (const extraLive of extras) {
      usedLive.add(extraLive.id);
      ops.push({
        kind: "merge-archive",
        id: extraLive.id,
        from: extraLive.name,
        to: canon.name,
        reason: `злиття в id ${keep.id}`,
        bomCount: extraLive.bomCount,
      });
      if (extraLive.bomCount > 0) {
        issues.push({
          level: "warning",
          message: `merge id ${extraLive.id} «${extraLive.name}»: ${extraLive.bomCount} BOM лишаться на старому шаблоні`,
        });
      }
    }

    const changes = productChanges(keep, canon);
    if (keep.name !== canon.name) {
      const taken = liveNameToId.get(canon.name);
      if (taken != null && taken !== keep.id && !usedLive.has(taken)) {
        issues.push({
          level: "blocker",
          message: `rename id ${keep.id} → «${canon.name}», але ім'я вже в id ${taken}`,
        });
      }
      ops.push({
        kind: "rename",
        id: keep.id,
        from: keep.name,
        to: canon.name,
        category: canon.category,
        uom: canon.uom,
        changes: changes.length ? changes : undefined,
        bomCount: keep.bomCount,
      });
    } else if (changes.length) {
      ops.push({
        kind: "update",
        id: keep.id,
        from: keep.name,
        to: canon.name,
        changes,
        bomCount: keep.bomCount,
      });
    } else {
      ops.push({
        kind: "keep",
        id: keep.id,
        from: keep.name,
        to: canon.name,
      });
    }
  }

  for (const row of unmatched) {
    usedLive.add(row.id);
    if (archiveIds.has(row.id)) {
      ops.push({
        kind: "archive",
        id: row.id,
        from: row.name,
        reason: archiveReason.get(row.id) ?? "архів зі спеки",
        attrs: row.attrNames,
        bomCount: row.bomCount,
      });
      if (row.bomCount > 0) {
        issues.push({
          level: "warning",
          message: `archive id ${row.id} «${row.name}»: ${row.bomCount} BOM / ${row.variants} var — треба перенести або залишити hanging`,
        });
      }
      continue;
    }
    ops.push({
      kind: "orphan",
      id: row.id,
      from: row.name,
      category: row.category,
      reason: "немає в right_names.md / furniture",
    });
    issues.push({
      level: "warning",
      message: `orphan id ${row.id} «${row.name}» — не в каноні`,
    });
  }

  for (const row of live) {
    if (usedLive.has(row.id)) continue;
    ops.push({
      kind: "orphan",
      id: row.id,
      from: row.name,
      reason: "не зіставлено",
    });
  }

  const overlayCreates = ops.filter(
    (o) => o.kind === "create" && o.attrs?.includes("Колір Ламінату"),
  );
  if (overlayCreates.length && !extra.laminateColorExists) {
    issues.push({
      level: "blocker",
      message: `немає атрибута «Колір Ламінату» — ${overlayCreates.length} накладок не створити`,
    });
  }
  const needPoslugy = ops.some((o) => {
    if (o.category === "Послуги") return true;
    if (o.kind !== "update" && o.kind !== "rename") return false;
    return Boolean(o.changes?.some((c) => c.includes("Послуги")));
  });
  if (needPoslugy && !extra.poslugyExists) {
    issues.push({
      level: "warning",
      message: "категорії «Послуги» немає — dry-run: треба створити папку",
    });
  }

  const counts = {
    keep: 0,
    rename: 0,
    update: 0,
    "merge-archive": 0,
    archive: 0,
    create: 0,
    orphan: 0,
    "cat-rename": 0,
  } satisfies Record<OpKind, number>;
  for (const op of ops) counts[op.kind]++;

  return { ops, issues, counts };
}

export function renderPlanMarkdown(
  plan: MigratePlan,
  when: string,
): string {
  const { ops, issues, counts } = plan;
  const lines: string[] = [
    "# Dry-run міграції назв",
    "",
    `Знімок: ${when}. Odoo не змінювали. Запис немає.`,
    "",
    "## Підсумок",
    "",
    `| Дія | N |`,
    `|---|---|`,
    `| keep | ${counts.keep} |`,
    `| rename | ${counts.rename} |`,
    `| update | ${counts.update} |`,
    `| merge-archive | ${counts["merge-archive"]} |`,
    `| archive | ${counts.archive} |`,
    `| create | ${counts.create} |`,
    `| orphan | ${counts.orphan} |`,
    `| cat-rename | ${counts["cat-rename"]} |`,
    `| blockers | ${issues.filter((i) => i.level === "blocker").length} |`,
    `| warnings | ${issues.filter((i) => i.level === "warning").length} |`,
    "",
  ];

  if (issues.length) {
    lines.push("## Проблеми", "");
    for (const i of issues) {
      lines.push(`- **${i.level}** ${i.message}`);
    }
    lines.push("");
  }

  const sections: Array<[OpKind, string]> = [
    ["cat-rename", "Папки категорій"],
    ["rename", "Rename"],
    ["update", "Update (категорія / uom / type / attrs)"],
    ["merge-archive", "Merge → архів зайвого id"],
    ["archive", "Архів"],
    ["create", "Create"],
    ["orphan", "Orphan (живі, не в каноні)"],
  ];

  for (const [kind, title] of sections) {
    const rows = ops.filter((o) => o.kind === kind);
    if (!rows.length) continue;
    lines.push(`## ${title}`, "");
    for (const o of rows) {
      const id = o.id != null ? `\`${o.id}\` ` : "";
      const name =
        o.from && o.to && o.from !== o.to
          ? `${o.from} → ${o.to}`
          : o.to ?? o.from ?? "";
      const extra = [
        o.category ? `cat ${o.category}` : "",
        o.uom ? `uom ${o.uom}` : "",
        o.attrs?.length ? `attrs ${o.attrs.join(", ")}` : "",
        o.changes?.join("; ") ?? "",
        o.reason ?? "",
        o.bomCount ? `BOM ${o.bomCount}` : "",
      ]
        .filter(Boolean)
        .join(" · ");
      lines.push(`- ${id}${name}${extra ? ` — ${extra}` : ""}`);
    }
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}
