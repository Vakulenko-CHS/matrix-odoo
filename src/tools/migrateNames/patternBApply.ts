/**
 * Pattern B apply: create per-model children, remap BOM/lines from universal, archive.
 * Skip archived parents when remapping component lines.
 */
import { create, executeKw, searchRead, unlink, write } from "../../api/odoo";
import type { PatternBSplitDetail } from "./detailedPlan";
import type { JournalEntry } from "./journal";
import { workshopRankFromProductName } from "./journal";
import { sleep, withRetry } from "../odooPaged";

/** Universals: archive-only (no live active furniture; no remap recipes). */
export const ARCHIVE_ONLY_UNIVERSAL_IDS = new Set<number>([
  67, // [Подушка]
  45, // 🧩[Поролон - нарізані компонети] typo twin, no children
]);

type AttrPair = { attr: string; value: string };

type VariantInfo = {
  id: number;
  display_name: string;
  attrs: AttrPair[];
  model: string | null;
};

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

async function w<T>(label: string, fn: () => Promise<T>): Promise<T> {
  return withRetry(label, fn);
}

let _modelAttrId: number | null = null;
async function resolveModelAttrId(): Promise<number> {
  if (_modelAttrId != null) return _modelAttrId;
  const rows = await searchRead<{ id: number; name: string }>(
    "product.attribute",
    [["name", "=", "Модель"]],
    ["id", "name"],
    1,
  );
  if (!rows.length) throw new Error('attribute «Модель» not found');
  _modelAttrId = rows[0].id;
  return _modelAttrId;
}

async function loadVariants(tmplId: number): Promise<VariantInfo[]> {
  const modelAttrId = await resolveModelAttrId();
  const products = await w("variants", () =>
    searchRead<{
      id: number;
      display_name: string;
      product_template_attribute_value_ids: number[];
    }>(
      "product.product",
      [["product_tmpl_id", "=", tmplId]],
      ["id", "display_name", "product_template_attribute_value_ids"],
    ),
  );
  const ptavIds = [...new Set(products.flatMap((p) => p.product_template_attribute_value_ids ?? []))];
  const ptavMap = new Map<number, AttrPair & { attrId: number }>();
  if (ptavIds.length) {
    // chunk
    for (let i = 0; i < ptavIds.length; i += 400) {
      const chunk = ptavIds.slice(i, i + 400);
      const ptavs = await w("ptav", () =>
        searchRead<{
          id: number;
          attribute_id: [number, string];
          product_attribute_value_id: [number, string];
          name: string;
        }>(
          "product.template.attribute.value",
          [["id", "in", chunk]],
          ["id", "attribute_id", "product_attribute_value_id", "name"],
        ),
      );
      for (const p of ptavs) {
        const value = (p.name || "").replace(/^Модель:\s*/i, "").trim()
          || (p.product_attribute_value_id?.[1] ?? "").replace(/^Модель:\s*/i, "").trim();
        ptavMap.set(p.id, {
          attrId: p.attribute_id[0],
          attr: p.attribute_id[1],
          value,
        });
      }
    }
  }

  return products.map((p) => {
    const attrs: AttrPair[] = [];
    let model: string | null = null;
    for (const id of p.product_template_attribute_value_ids ?? []) {
      const a = ptavMap.get(id);
      if (!a) continue;
      attrs.push({ attr: a.attr, value: a.value });
      if (a.attrId === modelAttrId) model = a.value;
    }
    return { id: p.id, display_name: p.display_name, attrs, model };
  });
}

function normModelKey(s: string): string {
  return s
    .replace(/^Модель:\s*/i, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

function findChildVariant(
  univ: VariantInfo,
  childVars: VariantInfo[],
): number | undefined {
  if (!childVars.length) return undefined;
  if (childVars.length === 1) return childVars[0].id;

  const univMap = new Map(univ.attrs.map((a) => [a.attr, a.value]));
  for (const cv of childVars) {
    let ok = true;
    for (const a of cv.attrs) {
      if (univMap.get(a.attr) !== a.value) {
        ok = false;
        break;
      }
    }
    if (ok) return cv.id;
  }

  // fallback: display color/parens token overlap
  const color = univ.display_name.match(/\(([^)]+)\)\s*$/)?.[1];
  if (color) {
    const hit = childVars.find((v) => v.display_name.includes(`(${color})`));
    if (hit) return hit.id;
  }
  return childVars[0]?.id;
}

async function ensureChildTemplate(
  universal: {
    id: number;
    name: string;
    type: string;
    categ_id: [number, string] | false;
    uom_id: [number, string];
  },
  childName: string,
  model: string,
  allowedAttrs: string[] | null,
  univVariants: VariantInfo[],
): Promise<{ id: number; created: boolean }> {
  const existing = await searchRead<{ id: number; name: string; active: boolean }>(
    "product.template",
    [["name", "=", childName]],
    ["id", "name", "active"],
    3,
  );
  const live = existing.find((t) => t.active !== false);
  if (live) return { id: live.id, created: false };
  if (existing.length) {
    // unarchive
    await write("product.template", [existing[0].id], { active: true });
    return { id: existing[0].id, created: false };
  }

  const vals: Record<string, unknown> = {
    name: childName,
    type: universal.type,
    uom_id: universal.uom_id[0],
    sale_ok: false,
  };
  if (universal.categ_id) vals.categ_id = universal.categ_id[0];

  const id = await w("create-tmpl", () => create("product.template", vals));

  const attrNames =
    allowedAttrs != null
      ? allowedAttrs
      : [
          ...new Set(
            univVariants
              .filter((v) => v.model === model)
              .flatMap((v) => v.attrs.map((a) => a.attr))
              .filter((a) => a !== "Модель"),
          ),
        ];

  // values used by this model on universal (or all values if no model variants)
  const modelVars = univVariants.filter((v) => v.model === model);
  const source = modelVars.length ? modelVars : univVariants;

  for (const attrName of attrNames) {
    const valueNames = [
      ...new Set(
        source.flatMap((v) => v.attrs.filter((a) => a.attr === attrName).map((a) => a.value)),
      ),
    ];
    if (!valueNames.length) continue;

    const attrRows = await searchRead<{ id: number }>(
      "product.attribute",
      [["name", "=", attrName]],
      ["id"],
      1,
    );
    if (!attrRows.length) continue;
    const attrId = attrRows[0].id;

    const valueIds: number[] = [];
    for (const vn of valueNames) {
      const found = await searchRead<{ id: number }>(
        "product.attribute.value",
        [
          ["attribute_id", "=", attrId],
          ["name", "=", vn],
        ],
        ["id"],
        1,
      );
      if (found.length) valueIds.push(found[0].id);
    }
    if (!valueIds.length) continue;

    await w("attr-line", () =>
      create("product.template.attribute.line", {
        product_tmpl_id: id,
        attribute_id: attrId,
        value_ids: valueIds.map((vid) => [4, vid]),
      }),
    );
    await sleep(40);
  }

  return { id, created: true };
}

async function dropBom(bomId: number): Promise<"archived" | "unlinked"> {
  try {
    await w("bom-archive", () => write("mrp.bom", [bomId], { active: false }));
    return "archived";
  } catch {
    await w("bom-unlink", () => unlink("mrp.bom", [bomId]));
    return "unlinked";
  }
}

async function countOwnedBoms(tmplId: number): Promise<number> {
  const boms = await searchRead<{ id: number }>(
    "mrp.bom",
    [["product_tmpl_id", "=", tmplId]],
    ["id"],
  );
  return boms.length;
}

async function activeBomIds(bomIds: number[]): Promise<Set<number>> {
  const active = new Set<number>();
  if (!bomIds.length) return active;
  for (let i = 0; i < bomIds.length; i += 200) {
    const chunk = bomIds.slice(i, i + 200);
    const boms = await searchRead<{
      id: number;
      active: boolean;
      product_tmpl_id: [number, string];
    }>("mrp.bom", [["id", "in", chunk]], ["id", "active", "product_tmpl_id"]);
    const tmplIds = [...new Set(boms.map((b) => b.product_tmpl_id[0]))];
    const tmpls = tmplIds.length
      ? await searchRead<{ id: number; active: boolean }>(
          "product.template",
          [["id", "in", tmplIds]],
          ["id", "active"],
        )
      : [];
    const tmplActive = new Map(tmpls.map((t) => [t.id, t.active !== false]));
    for (const b of boms) {
      if (b.active !== false && tmplActive.get(b.product_tmpl_id[0])) {
        active.add(b.id);
      }
    }
  }
  return active;
}

async function countLiveComponentLines(tmplId: number): Promise<number> {
  const vars = await searchRead<{ id: number }>(
    "product.product",
    [["product_tmpl_id", "=", tmplId]],
    ["id"],
  );
  const ids = vars.map((v) => v.id);
  if (!ids.length) return 0;
  const allLines: Array<{ id: number; bom_id: [number, string] }> = [];
  for (let i = 0; i < ids.length; i += 400) {
    const chunk = ids.slice(i, i + 400);
    const lines = await searchRead<{ id: number; bom_id: [number, string] }>(
      "mrp.bom.line",
      [["product_id", "in", chunk]],
      ["id", "bom_id"],
    );
    allLines.push(...lines);
  }
  if (!allLines.length) return 0;
  const active = await activeBomIds([
    ...new Set(allLines.map((l) => l.bom_id[0])),
  ]);
  return allLines.filter((l) => active.has(l.bom_id[0])).length;
}

export async function applyPatternBSplits(
  splits: PatternBSplitDetail[],
  entries: JournalEntry[],
  say: (s: string) => void,
): Promise<void> {
  const ordered = [...splits].sort(
    (a, b) =>
      workshopRankFromProductName(a.universalName) -
        workshopRankFromProductName(b.universalName) ||
      a.universalId - b.universalId,
  );

  for (const s of ordered) {
    try {
      await applyOnePatternBSplit(s, entries, say);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      say(`  FATAL split ${s.universalId}: ${msg.slice(0, 200)}`);
      pushJournal(entries, {
        phase: 6,
        workshopRank: workshopRankFromProductName(s.universalName),
        workshopLabel: s.universalName,
        type: "remap-bom-product",
        summary: `FATAL ${s.universalId}: ${msg.slice(0, 160)}`,
        forward: { universalId: s.universalId, error: msg.slice(0, 300) },
        reverse: { type: "remap-bom-product", vals: { note: "noop" } },
        status: "failed",
      });
    }
  }
}

async function applyOnePatternBSplit(
  s: PatternBSplitDetail,
  entries: JournalEntry[],
  say: (s: string) => void,
): Promise<void> {
  const rank = workshopRankFromProductName(s.universalName);
  say(`\n[6] Pattern B id=${s.universalId} «${s.universalName}» rank=${rank}`);

    const univRows = await w("tmpl", () =>
      executeKw<
        Array<{
          id: number;
          name: string;
          active: boolean;
          type: string;
          categ_id: [number, string] | false;
          uom_id: [number, string];
        }>
      >(
        "product.template",
        "search_read",
        [[["id", "=", s.universalId]]],
        {
          fields: ["id", "name", "active", "type", "categ_id", "uom_id"],
          limit: 1,
          context: { lang: "uk_UA", active_test: false },
        },
      ),
    );
    if (!univRows.length) {
      say(`  skip missing ${s.universalId}`);
      return;
    }
    const univ = univRows[0];
    if (!univ.active) {
      say(`  skip already archived ${s.universalId}`);
      pushJournal(entries, {
        phase: 6,
        workshopRank: rank,
        workshopLabel: s.universalName,
        type: "archive-template",
        summary: `skip already archived ${s.universalId}`,
        forward: { id: s.universalId, alreadyArchived: true },
        reverse: { type: "unarchive-template", vals: { note: "noop" } },
        status: "skipped",
      });
      return;
    }

    // ── archive-only path (Подушка etc.) ─────────────────────────
    if (ARCHIVE_ONLY_UNIVERSAL_IDS.has(s.universalId)) {
      const live = await countLiveComponentLines(s.universalId);
      if (live > 0) {
        say(`  BLOCK archive-only: still ${live} live component lines`);
        pushJournal(entries, {
          phase: 6,
          workshopRank: rank,
          workshopLabel: s.universalName,
          type: "archive-template",
          summary: `BLOCKED archive ${s.universalId}: liveComp=${live}`,
          forward: { id: s.universalId, liveComp: live },
          reverse: { type: "unarchive-template", vals: { note: "noop" } },
          status: "skipped",
        });
        return;
      }
      try {
        await w("archive", () =>
          write("product.template", [s.universalId], { active: false }),
        );
      } catch (err) {
        // cascade BOM archive may hit cycles — unlink BOMs then retry
        const anyBoms = await executeKw<{ id: number }[]>(
          "mrp.bom",
          "search_read",
          [[["product_tmpl_id", "=", s.universalId]]],
          {
            fields: ["id"],
            context: { lang: "uk_UA", active_test: false },
          },
        );
        for (const b of anyBoms) {
          try {
            await unlink("mrp.bom", [b.id]);
          } catch {
            /* ignore */
          }
        }
        await write("product.template", [s.universalId], { active: false });
        say(`  (unlinked ${anyBoms.length} BOMs before archive)`);
      }
      pushJournal(entries, {
        phase: 6,
        workshopRank: rank,
        workshopLabel: s.universalName,
        type: "archive-template",
        summary: `archive-only ${s.universalId} «${s.universalName}» (no live furniture use; BOMs cascade)`,
        forward: { id: s.universalId, active: false, mode: "archive-only" },
        reverse: {
          type: "unarchive-template",
          vals: { id: s.universalId, active: true },
        },
      });
      say(`  OK archive-only ${s.universalId}`);
      await sleep(80);
      return;
    }

    // ── load variants once ───────────────────────────────────────
    say(`  load variants…`);
    const univVars = await loadVariants(s.universalId);
    say(`  variants=${univVars.length}`);

    const childByModel = new Map<string, number>();
    const rememberChild = (model: string, id: number) => {
      childByModel.set(model, id);
      childByModel.set(normModelKey(model), id);
    };
    for (const c of s.existingChildren) {
      rememberChild(c.model, c.id);
    }

    const resolveChildId = (model: string | null | undefined): number | undefined => {
      if (!model) return undefined;
      return childByModel.get(model) ?? childByModel.get(normModelKey(model));
    };

    // create missing
    for (const child of s.createChildren) {
      const { id, created } = await ensureChildTemplate(
        univ,
        child.name,
        child.model,
        child.allowedAttrs,
        univVars,
      );
      rememberChild(child.model, id);
      pushJournal(entries, {
        phase: 6,
        workshopRank: rank,
        workshopLabel: s.universalName,
        type: "create-template",
        summary: `${created ? "create" : "reuse"} «${child.name}» id=${id}`,
        forward: {
          id,
          name: child.name,
          model: child.model,
          fromUniversalId: s.universalId,
          created,
        },
        reverse: created
          ? {
              type: "archive-template",
              vals: { id, active: false },
            }
          : { type: "create-template", vals: { note: "noop reuse" } },
        status: created ? "done" : "skipped",
      });
      say(`  ${created ? "+" : "="} child ${id} «${child.name}»`);
      await sleep(50);
    }

    // cache child variants
    const childVarsCache = new Map<number, VariantInfo[]>();
    async function childVars(cid: number): Promise<VariantInfo[]> {
      let v = childVarsCache.get(cid);
      if (!v) {
        v = await loadVariants(cid);
        childVarsCache.set(cid, v);
      }
      return v;
    }

    const univVarById = new Map(univVars.map((v) => [v.id, v]));
    let bomRemapped = 0;
    let bomSkipped = 0;
    let lineRemapped = 0;
    let lineSkippedArchived = 0;
    let lineSkippedNoChild = 0;

    // remap owned BOMs
    const ownedBoms = await w("boms", () =>
      searchRead<{
        id: number;
        product_id: [number, string] | false;
        product_tmpl_id: [number, string];
        code: string | false;
      }>(
        "mrp.bom",
        [["product_tmpl_id", "=", s.universalId]],
        ["id", "product_id", "product_tmpl_id", "code"],
      ),
    );
    say(`  owned BOMs=${ownedBoms.length}`);

    for (const bom of ownedBoms) {
      const pid = bom.product_id ? bom.product_id[0] : null;
      const uv = pid ? univVarById.get(pid) : undefined;
      // template-level BOM (no product_id): try parse model from code, else skip/archive later
      let model = uv?.model ?? null;
      if (!model && bom.code) {
        const code = String(bom.code);
        const paren = code.match(/\(([^,)]+)/);
        if (paren) model = paren[1].trim();
        else if (!code.includes("[") && code.length < 40) model = code.trim();
      }
      const childId = resolveChildId(model);
      if (!model || !childId) {
        bomSkipped++;
        continue;
      }

      const childBomCount = await countOwnedBoms(childId);
      if (childBomCount > 0) {
        // child already has recipe — drop duplicate on universal (avoid MRP cycles)
        try {
          const how = await dropBom(bom.id);
          bomRemapped++;
          if (how === "unlinked" && bomRemapped <= 3) {
            say(`    drop bom ${bom.id} via unlink (cycle on archive)`);
          }
        } catch (err) {
          say(`    WARN drop bom ${bom.id}: ${err instanceof Error ? err.message : err}`);
          bomSkipped++;
        }
        await sleep(20);
        continue;
      }

      const cvs = await childVars(childId);
      const newPid = uv ? findChildVariant(uv, cvs) : cvs[0]?.id;
      const writeVals: Record<string, unknown> = { product_tmpl_id: childId };
      if (newPid) writeVals.product_id = newPid;
      try {
        await w("bom-write", () => write("mrp.bom", [bom.id], writeVals));
        bomRemapped++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        say(`    WARN remap bom ${bom.id} → drop: ${msg.slice(0, 100)}`);
        try {
          await dropBom(bom.id);
          bomRemapped++;
        } catch (err2) {
          say(`    FAIL bom ${bom.id}: ${err2 instanceof Error ? err2.message : err2}`);
          bomSkipped++;
        }
      }
      if (bomRemapped % 50 === 0) say(`    … bom resolve ${bomRemapped}`);
      await sleep(25);
    }

    // remap component lines (ACTIVE parents only)
    const univVarIds = univVars.map((v) => v.id);
    const pendingLines: Array<{
      id: number;
      product_id: number;
      bom_id: number;
    }> = [];
    for (let i = 0; i < univVarIds.length; i += 200) {
      const chunk = univVarIds.slice(i, i + 200);
      if (!chunk.length) continue;
      const lines = await w("bom-lines", () =>
        searchRead<{ id: number; product_id: [number, string]; bom_id: [number, string] }>(
          "mrp.bom.line",
          [["product_id", "in", chunk]],
          ["id", "product_id", "bom_id"],
        ),
      );
      for (const line of lines) {
        pendingLines.push({
          id: line.id,
          product_id: line.product_id[0],
          bom_id: line.bom_id[0],
        });
      }
    }
    const activeBoms = await activeBomIds([
      ...new Set(pendingLines.map((l) => l.bom_id)),
    ]);
    for (const line of pendingLines) {
      if (!activeBoms.has(line.bom_id)) {
        lineSkippedArchived++;
        continue;
      }
      const uv = univVarById.get(line.product_id);
      const model = uv?.model;
      const childId = resolveChildId(model);
      if (!model || !uv || !childId) {
        lineSkippedNoChild++;
        continue;
      }
      const cvs = await childVars(childId);
      const newPid = findChildVariant(uv, cvs);
      if (!newPid || newPid === line.product_id) {
        lineSkippedNoChild++;
        continue;
      }
      try {
        await w("line-write", () =>
          write("mrp.bom.line", [line.id], { product_id: newPid }),
        );
        lineRemapped++;
      } catch (err) {
        say(
          `    WARN line ${line.id}: ${err instanceof Error ? err.message.slice(0, 100) : err}`,
        );
        lineSkippedNoChild++;
      }
      await sleep(25);
    }

    // leftover owned BOMs (no model match) — drop so universal can archive
    const leftover = await w("boms-left", () =>
      searchRead<{ id: number }>(
        "mrp.bom",
        [["product_tmpl_id", "=", s.universalId]],
        ["id"],
      ),
    );
    for (const bom of leftover) {
      try {
        await dropBom(bom.id);
        bomRemapped++;
      } catch (err) {
        say(
          `    WARN leftover bom ${bom.id}: ${err instanceof Error ? err.message.slice(0, 100) : err}`,
        );
        bomSkipped++;
      }
      await sleep(20);
    }

    pushJournal(entries, {
      phase: 6,
      workshopRank: rank,
      workshopLabel: s.universalName,
      type: "remap-bom-product",
      summary: `remap ${s.universalId}: bom ${bomRemapped}/${ownedBoms.length} (skip ${bomSkipped}), lines ${lineRemapped} (arch ${lineSkippedArchived}, noChild ${lineSkippedNoChild})`,
      forward: {
        universalId: s.universalId,
        bomRemapped,
        bomSkipped,
        lineRemapped,
        lineSkippedArchived,
        lineSkippedNoChild,
        children: [...new Set([...childByModel.values()])].map((id) => ({ id })),
      },
      reverse: {
        type: "remap-bom-product",
        vals: {
          note: "restore from dump-full / journal maps",
          universalId: s.universalId,
        },
      },
    });
    say(
      `  remap bom=${bomRemapped} skipBom=${bomSkipped} lines=${lineRemapped} skipArch=${lineSkippedArchived} skipNoChild=${lineSkippedNoChild}`,
    );

    // archive if clean
    const leftBom = await countOwnedBoms(s.universalId);
    const leftLive = await countLiveComponentLines(s.universalId);
    if (leftBom === 0 && leftLive === 0) {
      try {
        await w("archive", () =>
          write("product.template", [s.universalId], { active: false }),
        );
        pushJournal(entries, {
          phase: 6,
          workshopRank: rank,
          workshopLabel: s.universalName,
          type: "archive-template",
          summary: `archive universal ${s.universalId} after remap`,
          forward: { id: s.universalId, active: false },
          reverse: {
            type: "unarchive-template",
            vals: { id: s.universalId, active: true },
          },
        });
        say(`  OK archive ${s.universalId}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        say(`  WARN archive ${s.universalId}: ${msg.slice(0, 140)}`);
        // last resort: unlink any BOM still attached (incl. inactive via context)
        const anyBoms = await executeKw<{ id: number }[]>(
          "mrp.bom",
          "search_read",
          [[["product_tmpl_id", "=", s.universalId]]],
          {
            fields: ["id"],
            context: { lang: "uk_UA", active_test: false },
          },
        );
        for (const b of anyBoms) {
          try {
            await unlink("mrp.bom", [b.id]);
          } catch {
            /* ignore */
          }
        }
        try {
          await write("product.template", [s.universalId], { active: false });
          pushJournal(entries, {
            phase: 6,
            workshopRank: rank,
            workshopLabel: s.universalName,
            type: "archive-template",
            summary: `archive universal ${s.universalId} after bom unlink sweep`,
            forward: { id: s.universalId, active: false, sweptBoms: anyBoms.length },
            reverse: {
              type: "unarchive-template",
              vals: { id: s.universalId, active: true },
            },
          });
          say(`  OK archive ${s.universalId} (after unlink sweep ${anyBoms.length})`);
        } catch (err2) {
          pushJournal(entries, {
            phase: 6,
            workshopRank: rank,
            workshopLabel: s.universalName,
            type: "archive-template",
            summary: `SKIP archive ${s.universalId}: ${String(err2).slice(0, 120)}`,
            forward: { id: s.universalId, error: String(err2).slice(0, 200) },
            reverse: { type: "unarchive-template", vals: { note: "noop" } },
            status: "skipped",
          });
          say(`  SKIP archive ${s.universalId} after sweep fail`);
        }
      }
    } else {
      pushJournal(entries, {
        phase: 6,
        workshopRank: rank,
        workshopLabel: s.universalName,
        type: "archive-template",
        summary: `SKIP archive ${s.universalId}: leftBom=${leftBom} leftLiveComp=${leftLive}`,
        forward: { id: s.universalId, leftBom, leftLive },
        reverse: { type: "unarchive-template", vals: { note: "noop" } },
        status: "skipped",
      });
      say(`  SKIP archive ${s.universalId}: bom=${leftBom} liveComp=${leftLive}`);
    }
    await sleep(100);
}

export async function applyPhase7Creates(
  creates: Array<{
    name: string;
    category: string;
    allowedAttrs: string[] | null;
  }>,
  pbCreateNames: Set<string>,
  entries: JournalEntry[],
  say: (s: string) => void,
): Promise<void> {
  say(`\n[7] creates`);
  const cats = await searchRead<{ id: number; complete_name: string; name: string }>(
    "product.category",
    [],
    ["id", "complete_name", "name"],
  );
  const catByComplete = new Map(cats.map((c) => [c.complete_name, c.id]));
  const catByName = new Map(cats.map((c) => [c.name, c.id]));

  let n = 0;
  for (const c of creates) {
    if (pbCreateNames.has(c.name)) continue;
    const exists = await searchRead<{ id: number }>(
      "product.template",
      [["name", "=", c.name], ["active", "=", true]],
      ["id"],
      1,
    );
    if (exists.length) {
      say(`  skip exists «${c.name}»`);
      continue;
    }
    const categId =
      catByComplete.get(c.category) ??
      catByName.get(c.category.split(" / ").pop() ?? "") ??
      false;
    const vals: Record<string, unknown> = {
      name: c.name,
      type: "consu",
      uom_id: 1,
      sale_ok: false,
    };
    if (categId) vals.categ_id = categId;
    const id = await create("product.template", vals);
    // attrs empty for furniture; Накладка already in phase 6
    pushJournal(entries, {
      phase: 7,
      workshopRank: 0,
      workshopLabel: c.category,
      type: "create-template",
      summary: `create «${c.name}» id=${id}`,
      forward: { id, name: c.name, category: c.category },
      reverse: { type: "archive-template", vals: { id, active: false } },
    });
    n++;
    say(`  + ${id} «${c.name}»`);
    await sleep(40);
  }
  say(`  OK created ${n}`);
}

export async function applyPhase8Archives(
  archives: Array<{
    id: number;
    name: string;
    after: string;
    bomAsTemplate: number;
  }>,
  skipIds: Set<number>,
  entries: JournalEntry[],
  say: (s: string) => void,
): Promise<void> {
  say(`\n[8] archives`);
  for (const a of archives) {
    if (skipIds.has(a.id)) continue;
    const rows = await searchRead<{ id: number; active: boolean }>(
      "product.template",
      [["id", "=", a.id]],
      ["id", "active"],
      1,
    );
    if (!rows.length || !rows[0].active) {
      say(`  skip ${a.id} missing/archived`);
      continue;
    }
    const leftBom = await countOwnedBoms(a.id);
    const leftLive = await countLiveComponentLines(a.id);
    if (leftBom > 0 || leftLive > 0) {
      say(`  SKIP ${a.id} «${a.name}»: bom=${leftBom} live=${leftLive}`);
      pushJournal(entries, {
        phase: 8,
        workshopRank: 0,
        workshopLabel: a.name,
        type: "archive-template",
        summary: `SKIP ${a.id}: bom=${leftBom} live=${leftLive}`,
        forward: { id: a.id, leftBom, leftLive },
        reverse: { type: "unarchive-template", vals: { note: "noop" } },
        status: "skipped",
      });
      continue;
    }
    await write("product.template", [a.id], { active: false });
    pushJournal(entries, {
      phase: 8,
      workshopRank: 0,
      workshopLabel: a.name,
      type: "archive-template",
      summary: `archive ${a.id} «${a.name}»`,
      forward: { id: a.id, active: false },
      reverse: { type: "unarchive-template", vals: { id: a.id, active: true } },
    });
    say(`  OK archive ${a.id}`);
    await sleep(50);
  }
}
