/**
 * Rename leftover templates + set categories (no-category Hilton/Prestige batch).
 *
 *   npx ts-node --transpile-only src/tools/apply-uncategorized-canon.ts
 *   npx ts-node --transpile-only src/tools/apply-uncategorized-canon.ts --apply
 */
import { authenticate, searchRead, write } from "../api/odoo";

const APPLY = process.argv.includes("--apply");

type Tmpl = {
  id: number;
  name: string;
  categ_id: [number, string] | false;
  active: boolean;
};

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

async function allTmplsByName(names: string[]): Promise<Map<string, Tmpl>> {
  const rows = await searchRead<Tmpl>(
    "product.template",
    [["name", "in", names]],
    ["id", "name", "categ_id", "active"],
  );
  return new Map(rows.map((t) => [t.name, t]));
}

function catIdByToken(
  categories: Array<{ id: number; complete_name: string }>,
  complete: string,
): number {
  const hit = categories.find((c) => c.complete_name === complete);
  if (hit) return hit.id;
  const token = complete.match(/№\s*(\d+(?:-\d+)?)/)?.[1];
  if (token) {
    const ceh = categories.find((c) => {
      if (!c.complete_name.startsWith("Цех")) return false;
      return c.complete_name.match(/№\s*(\d+(?:-\d+)?)/)?.[1] === token;
    });
    if (ceh) return ceh.id;
  }
  const exact = categories.find((c) => c.complete_name === complete);
  if (!exact) throw new Error(`Категорію не знайдено: ${complete}`);
  return exact.id;
}

async function variantsOf(tmplId: number) {
  return searchRead<{ id: number; display_name: string }>(
    "product.product",
    [["product_tmpl_id", "=", tmplId]],
    ["id", "display_name"],
  );
}

async function remapBomLines(
  fromTmplId: number,
  toTmplId: number,
  pickTo: (fromDisplay: string, toVs: Array<{ id: number; display_name: string }>) => number,
): Promise<number> {
  const fromVs = await variantsOf(fromTmplId);
  const toVs = await variantsOf(toTmplId);
  if (!toVs.length) throw new Error(`немає варіантів на tmpl ${toTmplId}`);
  const map: Record<number, number> = {};
  for (const fv of fromVs) map[fv.id] = pickTo(fv.display_name, toVs);
  const fromIds = fromVs.map((v) => v.id);
  if (!fromIds.length) return 0;
  const lines = await searchRead<{ id: number; product_id: [number, string] }>(
    "mrp.bom.line",
    [["product_id", "in", fromIds]],
    ["id", "product_id"],
  );
  let n = 0;
  for (const line of lines) {
    const neu = map[line.product_id[0]];
    if (neu && neu !== line.product_id[0]) {
      if (APPLY) await write("mrp.bom.line", [line.id], { product_id: neu });
      n++;
      await sleep(20);
    }
  }
  const boms = await searchRead<{ id: number }>(
    "mrp.bom",
    [["product_tmpl_id", "=", fromTmplId]],
    ["id"],
  );
  for (const bom of boms) {
    if (APPLY) await write("mrp.bom", [bom.id], { product_tmpl_id: toTmplId });
    await sleep(20);
  }
  return n;
}

async function setCat(t: Tmpl, catId: number, catName: string): Promise<void> {
  const cur = t.categ_id ? t.categ_id[0] : 0;
  if (cur === catId) {
    console.log(`  [=] cat ${t.id} «${t.name}» already ${catName}`);
    return;
  }
  console.log(`  [cat] ${t.id} «${t.name}» → ${catName}`);
  if (APPLY) await write("product.template", [t.id], { categ_id: catId });
}

async function rename(t: Tmpl, to: string): Promise<Tmpl> {
  if (t.name === to) return t;
  console.log(`  [rename] ${t.id} «${t.name}» → «${to}»`);
  if (APPLY) await write("product.template", [t.id], { name: to });
  return { ...t, name: to };
}

async function archive(t: Tmpl, why: string): Promise<void> {
  console.log(`  [archive] ${t.id} «${t.name}» (${why})`);
  if (APPLY) await write("product.template", [t.id], { active: false });
}

async function main(): Promise<void> {
  console.log(APPLY ? "MODE apply" : "MODE dry-run (pass --apply to write)");
  await authenticate();

  const categories = await searchRead<{ id: number; complete_name: string }>(
    "product.category",
    [],
    ["id", "complete_name"],
  );
  const wood = catIdByToken(categories, "Сировина / Дерево");
  const furn = catIdByToken(categories, "Сировина / Фурнітура");
  const fabric = catIdByToken(categories, "Сировина / Тканина");
  const c21 = catIdByToken(categories, "Цех / №2-1 [Бильце нарізка деталей]");
  const c32 = catIdByToken(categories, "Цех / №3-2 [Накладка нарізка деталей]");
  const c42 = catIdByToken(categories, "Цех / №4-2 [Каркас збірка напівфабрикат]");
  const c43 = catIdByToken(categories, "Цех / №4-3 [Планка збірка напівфабрикат]");

  const names = [
    "[Колесо]",
    "Липучка",
    "липучка",
    "Пас 100% Польша",
    "пас 100% Польша",
    "МДФ Венге 165×1000",
    "МДФ Венге 165x1000",
    "МДФ Венге 250×1000",
    "МДФ Венге 250x1000",
    "Механізм Сабля Балюта",
    "Механізм Сабля (Балюта)",
    "Механізм Сабля",
    "Направляющая Телескопическая",
    "Направляюча телескопічна Н=43 Л=400",
    "Стопор",
    "Опора стопор для єврокнижки 416",
    "двп біле",
    "[ДВП]",
    "фанера",
    "Фанера",
    "🧩[Бильце - нарізані деталі] Ніши 100",
    "🪤[Каркас - напівфабрикат] Д.Елегант БН",
    "🪤[Каркас - напівфабрикат] Д.Елегант ПБ",
    "🪤[Накладка] Престиж МДФ",
    "🪤[Планка - напівфабрикат]",
  ];
  const byName = await allTmplsByName(names);

  const onlyCat: Array<[string, number, string]> = [
    ["[Колесо]", furn, "Сировина / Фурнітура"],
    ["🧩[Бильце - нарізані деталі] Ніши 100", c21, "Цех / №2-1"],
    ["🪤[Каркас - напівфабрикат] Д.Елегант БН", c42, "Цех / №4-2"],
    ["🪤[Каркас - напівфабрикат] Д.Елегант ПБ", c42, "Цех / №4-2"],
    ["🪤[Накладка] Престиж МДФ", c32, "Цех / №3-2"],
  ];
  for (const [name, catId, label] of onlyCat) {
    const t = byName.get(name);
    if (!t) {
      console.log(`  [miss] «${name}»`);
      continue;
    }
    await setCat(t, catId, label);
  }

  async function renameOrMerge(
    from: string,
    to: string,
    catId: number,
    catLabel: string,
    pickTo?: (
      fromDisplay: string,
      toVs: Array<{ id: number; display_name: string }>,
    ) => number,
  ): Promise<void> {
    const src = byName.get(from);
    const dst = from === to ? src : byName.get(to);
    if (!src && !dst) {
      console.log(`  [miss] «${from}» / «${to}»`);
      return;
    }
    if (src && dst && src.id !== dst.id) {
      console.log(`  [merge] «${from}» #${src.id} → «${to}» #${dst.id}`);
      const pick =
        pickTo ??
        ((_d, vs) => vs[0].id);
      await remapBomLines(src.id, dst.id, pick);
      await setCat(dst, catId, catLabel);
      await archive(src, `merged into ${dst.id}`);
      return;
    }
    const t = src ?? dst!;
    const renamed = await rename(t, to);
    await setCat(renamed, catId, catLabel);
    byName.set(to, renamed);
  }

  await renameOrMerge("липучка", "Липучка", fabric, "Сировина / Тканина");
  const lip = byName.get("Липучка");
  if (lip) await setCat(lip, fabric, "Сировина / Тканина");

  await renameOrMerge("пас 100% Польша", "Пас 100% Польша", fabric, "Сировина / Тканина");
  const pas = byName.get("Пас 100% Польша");
  if (pas) await setCat(pas, fabric, "Сировина / Тканина");

  await renameOrMerge("МДФ Венге 165×1000", "МДФ Венге 165x1000", wood, "Сировина / Дерево");
  await renameOrMerge("МДФ Венге 250×1000", "МДФ Венге 250x1000", wood, "Сировина / Дерево");

  await renameOrMerge(
    "Механізм Сабля Балюта",
    "Механізм Сабля (Балюта)",
    furn,
    "Сировина / Фурнітура",
  );
  const sab = byName.get("Механізм Сабля (Балюта)");
  if (sab) await setCat(sab, furn, "Сировина / Фурнітура");

  await renameOrMerge(
    "Направляющая Телескопическая",
    "Направляюча телескопічна Н=43 Л=400",
    furn,
    "Сировина / Фурнітура",
  );

  await renameOrMerge(
    "Стопор",
    "Опора стопор для єврокнижки 416",
    furn,
    "Сировина / Фурнітура",
  );

  await renameOrMerge("фанера", "Фанера", wood, "Сировина / Дерево");
  const fan = byName.get("Фанера");
  if (fan) await setCat(fan, wood, "Сировина / Дерево");

  const dvpRaw = byName.get("двп біле");
  const dvp = byName.get("[ДВП]");
  if (dvpRaw && dvp) {
    console.log(`  [merge] «двп біле» #${dvpRaw.id} → [ДВП] #${dvp.id} (Білий)`);
    await remapBomLines(dvpRaw.id, dvp.id, (_d, vs) => {
      const w = vs.find((v) => /біл|бел/i.test(v.display_name));
      return (w ?? vs[0]).id;
    });
    await setCat(dvp, wood, "Сировина / Дерево");
    await archive(dvpRaw, "merged into [ДВП]");
  } else if (dvpRaw) {
    console.log("  [warn] [ДВП] не знайдено — лише категорія на двп біле");
    await setCat(dvpRaw, wood, "Сировина / Дерево");
  }

  const plank = byName.get("🪤[Планка - напівфабрикат]");
  if (plank) {
    await setCat(plank, c43, "Цех / №4-3");
    await archive(plank, "Pattern A universal");
  }

  console.log(APPLY ? "DONE apply" : "DONE dry-run");
}

main().catch((e: Error) => {
  console.error("[FATAL]", e.message);
  process.exit(1);
});
