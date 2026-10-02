import { normNameKey } from "../../validator/nameKey";
import { isPatternBInner } from "../../validator/canonRewrite";
import {
  ArchiveItem,
  CanonItem,
  fixCat,
} from "./parseSpec";
import {
  LiveCategory,
  LiveTemplate,
  MigratePlan,
  PlanIssue,
  buildMigratePlan,
} from "./plan";
import { workshopRankFromProductName } from "./journal";

export interface UsageScore {
  bomAsTemplate: number;
  bomAsComponent: number;
  variants: number;
  total: number;
}

export interface CandidateRow {
  id: number;
  name: string;
  type: string;
  category: string;
  uom: string;
  attrNames: string[];
  usage: UsageScore;
  willArchive: boolean;
}

export interface MergeGroupDetail {
  phase: "merge";
  canon: string;
  source: string;
  category: string;
  uom: string;
  allowedAttrs: string[] | null;
  expectedType?: string;
  note?: string;
  winner: CandidateRow;
  losers: CandidateRow[];
  steps: string[];
  needsBomRemap: boolean;
}

export interface RenameDetail {
  phase: "rename";
  id: number;
  from: string;
  to: string;
  category: string;
  changes: string[];
  usage: UsageScore;
}

export interface UpdateDetail {
  phase: "update";
  id: number;
  name: string;
  changes: string[];
}

export interface CreateDetail {
  phase: "create";
  name: string;
  category: string;
  uom: string;
  allowedAttrs: string[] | null;
  expectedType?: string;
  note?: string;
  reason: "missing-in-odoo";
}

export interface PatternBSplitDetail {
  phase: "pattern-b-split";
  universalId: number;
  universalName: string;
  universalAttrs: string[];
  reason: string;
  bomAsTemplate: number;
  variants: number;
  allowedAttrsOnChildren: string[] | null;
  /** Existing per-model templates already in Odoo for this inner */
  existingChildren: Array<{ id: number; name: string; model: string }>;
  /** Canon children to create if missing */
  createChildren: Array<{ name: string; model: string; allowedAttrs: string[] | null }>;
  steps: string[];
  blockedUntilBomRemap: true;
}

export interface ArchiveDetail {
  phase: "archive";
  id: number;
  name: string;
  reason: string;
  bomAsTemplate: number;
  variants: number;
  after: "pattern-b-remap" | "merge-remap" | "safe";
}

export interface DetailedMigratePlan {
  when: string;
  phases: string[];
  summary: {
    mergeGroups: number;
    renames: number;
    updates: number;
    creates: number;
    patternBSplits: number;
    archives: number;
    catRenames: number;
    keeps: number;
  };
  catRenames: Array<{ id: number; from: string; to: string }>;
  mergeGroups: MergeGroupDetail[];
  renames: RenameDetail[];
  updates: UpdateDetail[];
  creates: CreateDetail[];
  patternBSplits: PatternBSplitDetail[];
  archives: ArchiveDetail[];
  issues: PlanIssue[];
  opsCounts: MigratePlan["counts"];
}

function usageOf(t: LiveTemplate): UsageScore {
  const bomAsTemplate = t.bomCount;
  const bomAsComponent = t.componentUse ?? 0;
  const variants = t.variants;
  return {
    bomAsTemplate,
    bomAsComponent,
    variants,
    total: bomAsTemplate * 10 + bomAsComponent + variants,
  };
}

function toCandidate(t: LiveTemplate, willArchive: boolean): CandidateRow {
  return {
    id: t.id,
    name: t.name,
    type: t.type,
    category: t.category,
    uom: t.uom,
    attrNames: [...t.attrNames],
    usage: usageOf(t),
    willArchive,
  };
}

function pickWinner(
  lives: LiveTemplate[],
  canon: CanonItem,
  archiveIds: Set<number>,
): LiveTemplate {
  const ranked = [...lives].sort((a, b) => {
    const ua = usageOf(a).total;
    const ub = usageOf(b).total;
    if (ub !== ua) return ub - ua;
    if (a.name === canon.name && b.name !== canon.name) return -1;
    if (b.name === canon.name && a.name !== canon.name) return 1;
    if (archiveIds.has(a.id) !== archiveIds.has(b.id)) {
      return archiveIds.has(a.id) ? 1 : -1;
    }
    return a.id - b.id;
  });
  return ranked[0];
}

function parseBracketInner(name: string): string | null {
  const m = name.match(/\[([^\]]+)\]/);
  return m ? m[1] : null;
}

function modelSuffix(name: string): string | null {
  const m = name.match(/\]\s+(.+)$/);
  if (!m) return null;
  let s = m[1].trim();
  if (s.startsWith("(")) return null;
  const p = s.indexOf("(");
  if (p >= 0) s = s.slice(0, p).trim();
  return s || null;
}

function indexCanons(canons: CanonItem[]): Map<string, CanonItem> {
  const byKey = new Map<string, CanonItem>();
  for (const c of canons) {
    byKey.set(normNameKey(c.name), c);
    for (const a of c.aliases) byKey.set(normNameKey(a), c);
  }
  return byKey;
}

export function buildDetailedMigratePlan(
  canons: CanonItem[],
  archive: ArchiveItem[],
  live: LiveTemplate[],
  categories: LiveCategory[],
  extra: { laminateColorExists: boolean; poslugyExists: boolean },
  when: string,
): DetailedMigratePlan {
  const base = buildMigratePlan(canons, archive, live, categories, extra);
  const archiveIds = new Set(archive.map((a) => a.id));
  const byKey = indexCanons(canons);
  const liveById = new Map(live.map((t) => [t.id, t]));

  const groups = new Map<string, LiveTemplate[]>();
  for (const row of live) {
    const canon = byKey.get(normNameKey(row.name));
    if (!canon) continue;
    const list = groups.get(canon.name) ?? [];
    list.push(row);
    groups.set(canon.name, list);
  }

  const mergeGroups: MergeGroupDetail[] = [];
  const renames: RenameDetail[] = [];
  const updates: UpdateDetail[] = [];
  const creates: CreateDetail[] = [];

  for (const canon of canons) {
    const lives = groups.get(canon.name) ?? [];
    if (lives.length === 0) {
      creates.push({
        phase: "create",
        name: canon.name,
        category: canon.category,
        uom: canon.uom,
        allowedAttrs: canon.expectedAttrNames,
        expectedType: canon.expectedType,
        note: canon.note,
        reason: "missing-in-odoo",
      });
      continue;
    }

    const winner = pickWinner(lives, canon, archiveIds);
    const losers = lives.filter((l) => l.id !== winner.id);
    if (losers.length > 0) {
      const steps = [
        `обрати переможця id ${winner.id} (usage ${usageOf(winner).total})`,
        winner.name !== canon.name
          ? `rename «${winner.name}» → «${canon.name}»`
          : `ім'я вже канон «${canon.name}»`,
        canon.expectedAttrNames == null
          ? "attrs: не чіпати (немає allow-list у speці)"
          : canon.expectedAttrNames.length === 0
            ? "attrs: зняти всі (фурнітура / без атрибутів)"
            : `attrs allow-list: ${canon.expectedAttrNames.join(", ")} — злити value_ids з лузерів лише для цих`,
        ...losers.map(
          (l) =>
            `remap BOM/lines з id ${l.id} «${l.name}» → id ${winner.id}, потім archive ${l.id}`,
        ),
      ];
      mergeGroups.push({
        phase: "merge",
        canon: canon.name,
        source: canon.source,
        category: canon.category,
        uom: canon.uom,
        allowedAttrs: canon.expectedAttrNames,
        expectedType: canon.expectedType,
        note: canon.note,
        winner: toCandidate(winner, false),
        losers: losers.map((l) => toCandidate(l, true)),
        steps,
        needsBomRemap: losers.some(
          (l) => l.bomCount > 0 || (l.componentUse ?? 0) > 0,
        ),
      });
    } else if (winner.name !== canon.name) {
      const changes: string[] = [];
      if (fixCat(winner.category) !== canon.category) {
        changes.push(`cat «${winner.category}» → «${canon.category}»`);
      }
      renames.push({
        phase: "rename",
        id: winner.id,
        from: winner.name,
        to: canon.name,
        category: canon.category,
        changes,
        usage: usageOf(winner),
      });
    } else {
      const op = base.ops.find(
        (o) => o.kind === "update" && o.id === winner.id,
      );
      if (op?.changes?.length) {
        updates.push({
          phase: "update",
          id: winner.id,
          name: winner.name,
          changes: op.changes,
        });
      }
    }
  }

  // Pattern B: archive universals + children from canons with same inner
  const patternBSplits: PatternBSplitDetail[] = [];
  const childrenByInner = new Map<string, CanonItem[]>();
  for (const c of canons) {
    const inner = parseBracketInner(c.name);
    const model = modelSuffix(c.name);
    if (!inner || !model) continue;
    if (!isPatternBInner(inner)) continue;
    const k = normNameKey(inner);
    const list = childrenByInner.get(k) ?? [];
    list.push(c);
    childrenByInner.set(k, list);
  }

  for (const a of archive) {
    if (!/універсал/i.test(a.reason) && !/Pattern B|шаблон на модель/i.test(a.reason)) {
      continue;
    }
    const liveRow = liveById.get(a.id);
    const inner = parseBracketInner(a.name);
    if (!inner || !isPatternBInner(inner)) continue;
    const k = normNameKey(inner);
    const childCanons = childrenByInner.get(k) ?? [];
    const existingChildren: PatternBSplitDetail["existingChildren"] = [];
    const createChildren: PatternBSplitDetail["createChildren"] = [];
    for (const cc of childCanons) {
      const model = modelSuffix(cc.name);
      if (!model) continue;
      const hit = live.find((t) => normNameKey(t.name) === normNameKey(cc.name));
      if (hit) {
        existingChildren.push({ id: hit.id, name: hit.name, model });
      } else {
        createChildren.push({
          name: cc.name,
          model,
          allowedAttrs: cc.expectedAttrNames,
        });
      }
    }
    const allowed =
      childCanons.find((c) => c.expectedAttrNames != null)?.expectedAttrNames ??
      null;
    patternBSplits.push({
      phase: "pattern-b-split",
      universalId: a.id,
      universalName: a.name,
      universalAttrs: liveRow?.attrNames ?? [],
      reason: a.reason,
      bomAsTemplate: liveRow?.bomCount ?? 0,
      variants: liveRow?.variants ?? 0,
      allowedAttrsOnChildren: allowed,
      existingChildren,
      createChildren,
      steps: [
        `для кожної моделі: reuse existing або create «[…] Model»`,
        `attrs дитини: ${allowed == null ? "з note/канону" : allowed.length ? allowed.join(", ") : "немає"}`,
        `remap BOM з варіантів універсала (attr Модель=…) → child tmpl`,
        `archive id ${a.id} лише коли BOM=0`,
      ],
      blockedUntilBomRemap: true,
    });
  }

  // Sort Pattern B bottom→top before returning
  patternBSplits.sort(
    (a, b) =>
      workshopRankFromProductName(a.universalName) -
        workshopRankFromProductName(b.universalName) ||
      a.universalId - b.universalId,
  );

  const archives: ArchiveDetail[] = [];
  for (const op of base.ops.filter((o) => o.kind === "archive")) {
    const isPb = patternBSplits.some((p) => p.universalId === op.id);
    const isMergeLoser = mergeGroups.some((g) =>
      g.losers.some((l) => l.id === op.id),
    );
    archives.push({
      phase: "archive",
      id: op.id!,
      name: op.from ?? "",
      reason: op.reason ?? "",
      bomAsTemplate: op.bomCount ?? 0,
      variants: liveById.get(op.id!)?.variants ?? 0,
      after: isPb
        ? "pattern-b-remap"
        : isMergeLoser || (op.bomCount ?? 0) > 0
          ? "merge-remap"
          : "safe",
    });
  }

  // merge losers also appear as merge-archive in base ops — list under merge only
  const catRenames = base.ops
    .filter((o) => o.kind === "cat-rename")
    .map((o) => ({ id: o.id!, from: o.from!, to: o.to! }));

  return {
    when,
    phases: [
      "0 dump-full + UI backup + journal",
      "1 cat-rename",
      "2 create folder Послуги",
      "3 merge groups (winner by usage) — low workshop first",
      "4 rename singles — same id, bottom→top name families",
      "5 update (cat/type/attrs)",
      "6 pattern-b-split + BOM remap — Цех №1 → №9",
      "7 create missing (furniture etc.)",
      "8 archive (BOM=0 only)",
      "9 verify dry-run",
      "ROLLBACK: journal reverse LIFO",
    ],
    summary: {
      mergeGroups: mergeGroups.length,
      renames: renames.length,
      updates: updates.length,
      creates: creates.length,
      patternBSplits: patternBSplits.length,
      archives: archives.length,
      catRenames: catRenames.length,
      keeps: base.counts.keep,
    },
    catRenames,
    mergeGroups,
    renames,
    updates,
    creates,
    patternBSplits,
    archives,
    issues: base.issues,
    opsCounts: base.counts,
  };
}

export function renderDetailedPlanMarkdown(plan: DetailedMigratePlan): string {
  const lines: string[] = [
    "# Детальний план міграції (без write)",
    "",
    `Знімок: ${plan.when}`,
    "",
    "## Порядок фаз",
    "",
    ...plan.phases.map((p) => `- ${p}`),
    "",
    "## Підсумок",
    "",
    `| Що | N |`,
    `|---|---|`,
    `| merge-груп | ${plan.summary.mergeGroups} |`,
    `| rename | ${plan.summary.renames} |`,
    `| update | ${plan.summary.updates} |`,
    `| create | ${plan.summary.creates} |`,
    `| Pattern B split | ${plan.summary.patternBSplits} |`,
    `| archive | ${plan.summary.archives} |`,
    `| cat-rename | ${plan.summary.catRenames} |`,
    `| keep | ${plan.summary.keeps} |`,
    "",
  ];

  if (plan.issues.length) {
    lines.push("## Issues", "");
    for (const i of plan.issues) lines.push(`- **${i.level}** ${i.message}`);
    lines.push("");
  }

  if (plan.catRenames.length) {
    lines.push("## 1. Cat rename", "");
    for (const c of plan.catRenames) {
      lines.push(`- \`${c.id}\` ${c.from} → ${c.to}`);
    }
    lines.push("");
  }

  if (plan.mergeGroups.length) {
    lines.push("## 3. Merge-групи (переможець = max usage)", "");
    for (const g of plan.mergeGroups) {
      lines.push(`### ${g.canon}`);
      lines.push("");
      lines.push(
        `- **winner** \`${g.winner.id}\` «${g.winner.name}» · usage ${g.winner.usage.total} (BOM ${g.winner.usage.bomAsTemplate} + as-comp ${g.winner.usage.bomAsComponent} + var ${g.winner.usage.variants})`,
      );
      lines.push(
        `- allowedAttrs: ${g.allowedAttrs == null ? "—" : g.allowedAttrs.length ? g.allowedAttrs.join(", ") : "(немає)"}`,
      );
      lines.push(`- needsBomRemap: ${g.needsBomRemap}`);
      for (const l of g.losers) {
        lines.push(
          `- loser \`${l.id}\` «${l.name}» · usage ${l.usage.total} · attrs [${l.attrNames.join(", ") || "—"}]`,
        );
      }
      lines.push("- steps:");
      for (const s of g.steps) lines.push(`  1. ${s}`);
      lines.push("");
    }
  }

  if (plan.renames.length) {
    lines.push("## 4. Rename (один id, без merge)", "");
    for (const r of plan.renames.slice(0, 40)) {
      lines.push(
        `- \`${r.id}\` ${r.from} → ${r.to}${r.changes.length ? ` · ${r.changes.join("; ")}` : ""}`,
      );
    }
    if (plan.renames.length > 40) {
      lines.push(`- … ще ${plan.renames.length - 40} у JSON`);
    }
    lines.push("");
  }

  if (plan.updates.length) {
    lines.push("## 5. Update", "");
    for (const u of plan.updates) {
      lines.push(`- \`${u.id}\` ${u.name} — ${u.changes.join("; ")}`);
    }
    lines.push("");
  }

  if (plan.patternBSplits.length) {
    lines.push("## 6. Pattern B split (універсал → моделі), порядок Цех 1→9", "");
    for (const p of plan.patternBSplits) {
      const rank = workshopRankFromProductName(p.universalName);
      lines.push(`### \`rank ${rank}\` \`${p.universalId}\` ${p.universalName}`);
      lines.push("");
      lines.push(
        `- BOM ${p.bomAsTemplate} · var ${p.variants} · live attrs [${p.universalAttrs.join(", ")}]`,
      );
      lines.push(
        `- children attrs: ${p.allowedAttrsOnChildren == null ? "—" : p.allowedAttrsOnChildren.join(", ") || "(немає)"}`,
      );
      lines.push(
        `- existing ${p.existingChildren.length} · create ${p.createChildren.length}`,
      );
      if (p.existingChildren.length) {
        lines.push(
          `- reuse: ${p.existingChildren.map((c) => `\`${c.id}\` ${c.model}`).join(", ")}`,
        );
      }
      if (p.createChildren.length) {
        const sample = p.createChildren.slice(0, 8).map((c) => c.model);
        lines.push(
          `- create models: ${sample.join(", ")}${p.createChildren.length > 8 ? ` …+${p.createChildren.length - 8}` : ""}`,
        );
      }
      lines.push(`- **archive лише після BOM remap**`);
      lines.push("");
    }
  }

  if (plan.creates.length) {
    lines.push("## 7. Create (немає в Odoo)", "");
    const furn = plan.creates.filter((c) => c.category.includes("Фурнітура"));
    const other = plan.creates.filter((c) => !c.category.includes("Фурнітура"));
    lines.push(`- фурнітура: ${furn.length}`);
    lines.push(`- інше: ${other.length}`);
    for (const c of other.slice(0, 25)) {
      lines.push(
        `- ${c.name} · cat ${c.category} · attrs ${c.allowedAttrs == null ? "—" : c.allowedAttrs.join(", ") || "∅"}`,
      );
    }
    if (other.length > 25) lines.push(`- … ще ${other.length - 25}`);
    lines.push("");
  }

  lines.push("## 8. Archive gate", "");
  const blocked = plan.archives.filter((a) => a.after !== "safe");
  const safe = plan.archives.filter((a) => a.after === "safe");
  lines.push(`- blocked until remap: ${blocked.length}`);
  lines.push(`- safe now: ${safe.length}`);
  for (const a of blocked) {
    lines.push(
      `- \`${a.id}\` ${a.name} — after=${a.after} · BOM ${a.bomAsTemplate}`,
    );
  }
  lines.push("");

  return `${lines.join("\n")}\n`;
}
