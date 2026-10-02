import type { DetailedMigratePlan } from "./detailedPlan";
import {
  JournalEntry,
  MigrationJournal,
  emptyJournal,
  workshopRankFromCategory,
  workshopRankFromProductName,
} from "./journal";

function push(
  entries: JournalEntry[],
  partial: Omit<JournalEntry, "seq" | "status">,
): void {
  entries.push({ ...partial, seq: entries.length + 1, status: "planned" });
}

/** Build ordered journal: low workshop rank first, then merge before split consumers. */
export function buildJournalFromDetailed(
  plan: DetailedMigratePlan,
): MigrationJournal {
  const j = emptyJournal(plan.when, "planned");
  j.phases = [
    ...plan.phases,
    "ROLLBACK: reverse journal LIFO (highest seq → 1)",
  ];
  const entries: JournalEntry[] = [];

  // Phase 1 — cats
  for (const c of plan.catRenames) {
    push(entries, {
      phase: 1,
      workshopRank: 0,
      workshopLabel: "categories",
      type: "cat-rename",
      summary: `cat ${c.id}: ${c.from} → ${c.to}`,
      forward: { model: "product.category", id: c.id, name: c.to },
      reverse: {
        type: "cat-rename",
        vals: { model: "product.category", id: c.id, name: c.from },
      },
    });
  }

  // Phase 2 — Послуги folder
  push(entries, {
    phase: 2,
    workshopRank: 0.5,
    workshopLabel: "Послуги",
    type: "create-category",
    summary: "ensure category Послуги",
    forward: { model: "product.category", name: "Послуги" },
    reverse: {
      type: "archive-template",
      vals: { note: "archive category Послуги if we created it (id from apply log)" },
      note: "only if created in this run",
    },
  });

  // Phase 3 — merges (furniture first = rank 0)
  const merges = [...plan.mergeGroups].sort((a, b) => {
    const ra = workshopRankFromCategory(a.category);
    const rb = workshopRankFromCategory(b.category);
    return ra - rb || a.canon.localeCompare(b.canon, "uk");
  });
  for (const g of merges) {
    const rank = workshopRankFromCategory(g.category);
    push(entries, {
      phase: 3,
      workshopRank: rank,
      workshopLabel: g.category,
      type: "merge-pick-winner",
      summary: `merge «${g.canon}»: winner ${g.winner.id}, losers [${g.losers.map((l) => l.id).join(",")}]`,
      forward: {
        winnerId: g.winner.id,
        loserIds: g.losers.map((l) => l.id),
        canon: g.canon,
        allowedAttrs: g.allowedAttrs,
      },
      reverse: {
        type: "merge-pick-winner",
        vals: {
          note: "restore loser names/active; re-point BOM lines back using id map from apply",
          winnerId: g.winner.id,
          loserIds: g.losers.map((l) => l.id),
        },
      },
    });
    if (g.winner.name !== g.canon) {
      push(entries, {
        phase: 3,
        workshopRank: rank,
        workshopLabel: g.category,
        type: "rename-template",
        summary: `rename ${g.winner.id} «${g.winner.name}» → «${g.canon}»`,
        forward: {
          model: "product.template",
          id: g.winner.id,
          name: g.canon,
        },
        reverse: {
          type: "rename-template",
          vals: {
            model: "product.template",
            id: g.winner.id,
            name: g.winner.name,
          },
        },
      });
    }
    for (const loser of g.losers) {
      push(entries, {
        phase: 3,
        workshopRank: rank,
        workshopLabel: g.category,
        type: "remap-bom-line-component",
        summary: `remap BOM components ${loser.id} → ${g.winner.id}`,
        forward: { fromTmplId: loser.id, toTmplId: g.winner.id },
        reverse: {
          type: "remap-bom-line-component",
          vals: { fromTmplId: g.winner.id, toTmplId: loser.id },
          note: "needs variant map saved at apply time",
        },
      });
      push(entries, {
        phase: 3,
        workshopRank: rank,
        workshopLabel: g.category,
        type: "archive-template",
        summary: `archive loser ${loser.id} «${loser.name}»`,
        forward: { id: loser.id, active: false },
        reverse: {
          type: "unarchive-template",
          vals: { id: loser.id, active: true },
        },
      });
    }
  }

  // Phase 4 — renames singles, low rank first
  const renames = [...plan.renames].sort((a, b) => {
    const ra = workshopRankFromProductName(a.from);
    const rb = workshopRankFromProductName(b.from);
    return ra - rb || a.id - b.id;
  });
  for (const r of renames) {
    const rank = workshopRankFromProductName(r.from);
    push(entries, {
      phase: 4,
      workshopRank: rank,
      workshopLabel: r.category,
      type: "rename-template",
      summary: `rename ${r.id} «${r.from}» → «${r.to}»`,
      forward: { id: r.id, name: r.to },
      reverse: { type: "rename-template", vals: { id: r.id, name: r.from } },
    });
  }

  // Phase 5 — updates
  for (const u of plan.updates) {
    push(entries, {
      phase: 5,
      workshopRank: workshopRankFromProductName(u.name),
      workshopLabel: u.name,
      type: "update-template",
      summary: `update ${u.id} ${u.name}: ${u.changes.join("; ")}`,
      forward: { id: u.id, changes: u.changes },
      reverse: {
        type: "update-template",
        vals: { id: u.id, note: "restore prior categ/type from apply snapshot" },
      },
    });
  }

  // Phase 6 — Pattern B bottom-up
  const splits = [...plan.patternBSplits].sort((a, b) => {
    const ra = workshopRankFromProductName(a.universalName);
    const rb = workshopRankFromProductName(b.universalName);
    return ra - rb || a.universalId - b.universalId;
  });
  for (const s of splits) {
    const rank = workshopRankFromProductName(s.universalName);
    for (const child of s.createChildren) {
      push(entries, {
        phase: 6,
        workshopRank: rank,
        workshopLabel: s.universalName,
        type: "create-template",
        summary: `create «${child.name}» attrs=[${(child.allowedAttrs ?? []).join(",")}]`,
        forward: {
          name: child.name,
          allowedAttrs: child.allowedAttrs,
          fromUniversalId: s.universalId,
        },
        reverse: {
          type: "archive-template",
          vals: { name: child.name, note: "archive created id from apply log" },
        },
      });
    }
    push(entries, {
      phase: 6,
      workshopRank: rank,
      workshopLabel: s.universalName,
      type: "remap-bom-product",
      summary: `Pattern B remap BOM from universal ${s.universalId} «${s.universalName}» → children (BOM ${s.bomAsTemplate}, var ${s.variants})`,
      forward: {
        universalId: s.universalId,
        existingChildren: s.existingChildren,
        createChildren: s.createChildren.map((c) => c.name),
        allowedAttrs: s.allowedAttrsOnChildren,
      },
      reverse: {
        type: "remap-bom-product",
        vals: {
          note: "re-point BOM product_tmpl_id / lines back to universal using apply map",
          universalId: s.universalId,
        },
      },
    });
    push(entries, {
      phase: 6,
      workshopRank: rank,
      workshopLabel: s.universalName,
      type: "archive-template",
      summary: `archive universal ${s.universalId} after remap (BOM must be 0)`,
      forward: { id: s.universalId, active: false, gate: "bomCount===0" },
      reverse: {
        type: "unarchive-template",
        vals: { id: s.universalId, active: true },
      },
    });
  }

  // Phase 7 — creates not covered by pattern B children already in phase 6
  const pbCreateNames = new Set(
    plan.patternBSplits.flatMap((s) => s.createChildren.map((c) => c.name)),
  );
  const creates = plan.creates
    .filter((c) => !pbCreateNames.has(c.name))
    .sort(
      (a, b) =>
        workshopRankFromCategory(a.category) -
          workshopRankFromCategory(b.category) ||
        a.name.localeCompare(b.name, "uk"),
    );
  for (const c of creates) {
    push(entries, {
      phase: 7,
      workshopRank: workshopRankFromCategory(c.category),
      workshopLabel: c.category,
      type: "create-template",
      summary: `create missing «${c.name}»`,
      forward: {
        name: c.name,
        category: c.category,
        allowedAttrs: c.allowedAttrs,
      },
      reverse: {
        type: "archive-template",
        vals: { name: c.name, note: "archive created id" },
      },
    });
  }

  // Phase 8 — remaining archives (safe / furniture attrs templates)
  for (const a of plan.archives) {
    if (plan.patternBSplits.some((s) => s.universalId === a.id)) continue;
    if (plan.mergeGroups.some((g) => g.losers.some((l) => l.id === a.id))) {
      continue;
    }
    push(entries, {
      phase: 8,
      workshopRank: workshopRankFromProductName(a.name),
      workshopLabel: a.name,
      type: "archive-template",
      summary: `archive ${a.id} «${a.name}» after=${a.after}`,
      forward: { id: a.id, active: false, after: a.after },
      reverse: {
        type: "unarchive-template",
        vals: { id: a.id, active: true },
      },
    });
  }

  j.entries = entries;
  return j;
}

export function orderHealthCheck(plan: DetailedMigratePlan): string[] {
  const notes: string[] = [];
  const ranks = plan.patternBSplits.map((s) => ({
    id: s.universalId,
    name: s.universalName,
    rank: workshopRankFromProductName(s.universalName),
    bom: s.bomAsTemplate,
  }));
  const sorted = [...ranks].sort((a, b) => a.rank - b.rank);
  notes.push(
    `Pattern B order (bottom→top): ${sorted.map((s) => `${s.rank}:${s.name.split("]")[0]}]`).join(" → ")}`,
  );

  // Consumer should not be archived before component splits of lower rank complete
  for (let i = 0; i < sorted.length - 1; i++) {
    if (sorted[i].rank > sorted[i + 1].rank) {
      notes.push(
        `BLOCKER order: ${sorted[i].name} (rank ${sorted[i].rank}) before ${sorted[i + 1].name}`,
      );
    }
  }

  const heavy = sorted.filter((s) => s.bom > 100);
  if (heavy.length) {
    notes.push(
      `Heavy BOM splits (run one-by-one): ${heavy.map((h) => `${h.name} BOM=${h.bom}`).join("; ")}`,
    );
  }

  notes.push(
    "Rename (phase 4) keeps same product.template id → BOM links stay valid (Odoo mrp.bom.product_tmpl_id).",
  );
  notes.push(
    "Archive product.template also archives its BOM (Odoo 19 mrp product.write active). Remap BOM lines that USE the product BEFORE archive.",
  );
  notes.push(
    "Open MO on archive targets must be done/cancel first — dump showed draft/confirmed MOs.",
  );
  return notes;
}
