# Odoo DB cheat sheet

## Entries (newest first)

### 2026-11-10 — T-QAL-02 SO name on quality.check

- **Summary:** Field **25263** `x_studio_so_order_name` related `production_id.sale_line_id.order_id.name`. Views **3850–3851**. QC in progress sample `S00265`… No Python loc.
- **Files:** `src/commands/studioQal02SoOrder.ts`

### 2026-11-09 — T-DESC related SO line note

- **Summary:** Fields **25253** MO, **25258** WO, **25260** QC `x_studio_so_line_note` related `sale_line_id.name`. Views **3846–3849**. Loc **93/100**. No Python.
- **Files:** `src/commands/studioSoLineNote.ts`

### 2026-11-09 — auto SN copies to QC + lot PDF exists

- **Agent / human:** agent / user «допиши QC + перевір друк»
- **Summary:** Action 1157 now 12 loc (studio **93/100**). QC without `production_id` matched by product + `quality_state=none`. Backfill: QC00117→0000010, QC00118→0000014, QC00119→0000009; QC00116 same as 119. Report **Партійний/серійний номер (PDF)** `stock.report_lot_label` bound to `stock.lot` (`report_action` ok). ZPL also bound. RPC cannot render PDF (private `_render_qweb_pdf`).
- **Files:** `src/commands/studioAutoSerial.ts`

### 2026-11-09 — studio auto SN on MO

- **Agent / human:** agent / user «так, автоматизація, влізти в 100 рядків»
- **Summary:** `base.automation` **7** + `ir.actions.server` **1157**. Python 7 loc. Studio billed loc **81 → 88** (cap 100). Existing computes/actions 1143/831/833/1155 untouched. Filter `product_tracking=serial`; skip if lots exist or MO done/cancel.
- **Files:** `src/commands/studioAutoSerial.ts`, `package.json`
- **Git:** uncommitted

### 2026-11-09 — assign-mo-serials (S00265, S00261)

- **Agent / human:** agent / user «зроби в Odoo + виправ диван клієнта»
- **Summary:** `npm run assign-mo-serials`. S00265 → WH/MO/00699 lot **0000009** ref `S00265 / № 01`; WH/MO/00700 lot **0000010** ref `S00265 / № 02`. S00261 → WH/MO/00633 **0000011**; WH/MO/00648 **0000012–13** (lot 8 ref `S00261 / № 03` manual fix). Command `src/commands/assignMoSerials.ts`.
- **Files:** `src/commands/assignMoSerials.ts`, `package.json`
- **Git:** uncommitted

### 2026-11-09 — T-WC-01 ensure-workcenters

- **Summary:** `canon.ts` +2 (2-4 Ц2дс4, 6-1 Ц6П-1). `npm run ensure-workcenters -- --apply` → created id **35**, **36**.
- **Files:** `src/workcenters/canon.ts`

### 2026-11-05 — T-LAM-01 apply lam-buy

- **Agent / human:** agent / user «так, apply T-LAM-01»
- **Summary:** 68 templates: purchase_ok, VNZ removed, 3197 WH/Stock orderpoints route Придбати. Verified: lam cut 41/41 buy 0 vnz; white sheet id18 routes [].
- **Files:** `src/commands/lamBuyRoutes.ts`, `npm run lam-buy`

### 2026-11-05 — T-SER-01 apply junk (A+B+C partial)

- **Agent / human:** agent / user approve in chat
- **Summary:** `npm run ser-junk -- --apply`. Lot 0000001 quants→0. PAV validate/validate-all/Синтетика (714,713,718) removed from fabric attr lines, `active=false`. Orphan ptav rows may remain (unlink slow/blocked). MO 00545–548 stay done. TEСТ quants purged (20). Location «Тестовый склад» id=168 archived. Restore: `write` pav `active=true` + re-add values to templates or re-import.
- **Files:** `src/commands/ser01ApplyJunk.ts`, `npm run ser-junk`

### 2026-11-05 — T-SER-01 junk audit (read-only)

- **Agent / human:** agent / user (await approve)
- **Summary:** Live scan: test MO WH/MO/00545+546–548 + lot 0000001 only (0000002/3 tied S00254/S00256). Fabric pav validate/validate-all/Синтетика → 611 ptav. 5 archived ТЕСТ products + stray quants. 4130 ptav price_extra=100 = reset not archive. Report `furniture/reference/T-SER-01-junk-audit-2026-11-05.md`, `npm run audit-junk`.
- **Git:** audit script uncommitted

### 2026-11-05 — T-FELT-01 apply: [Войлок] 1.40 → 1.45

- **Agent / human:** agent / user
- **Summary:** 46 mrp.bom.line remapped 43142→329. pav 636 removed; ptav 5102 unlinked; variant 43142 archived. tmpl [Войлок] attrs 1.45+1.60 only. Corrected spring-block felt lines after bad merge. Quants on 43142 kept (no quant unlink ACL).
- **Files:** `src/commands/feltMerge140To145.ts`, `npm run felt-merge`
- **Git:** not committed

### 2026-11-04 — serial sofas; invoice modal not a bug

- **Agent / human:** colleague / user (logged by agent)
- **Summary:** 86 sofa templates `tracking=serial`; Короб Реал `none`. Open MO Елегант БН 00606/00633/00648 need lot. Test WH/MO/00545 + fabric values validate/validate-all/Синтетика still to delete. Invoice modal on already-invoiced SO (S00254 draft). list_price 1 ₴, fabric extras test 100 ₴. Per-sofa extras wanted, not global default extra.
- **Files:** live Odoo (colleague); notes `tasks/NOTES.md`
- **Git:** not committed

### 2026-10-30 — fix `next()` in SO line uid compute

- **Agent / human:** agent
- **Summary:** Studio `safe_eval` has no `next`. Compact `x_studio_x_so_line_uid` crashed sale.order.line onchange. Restored for-loop. Field **25210**. S00248 line still `S00248 / № 01`.
- **Git:** not committed

### 2026-10-29 — compact Studio Python (LoC)

- **Agent / human:** agent / user
- **Summary:** Same 4 Studio behaviors, denser compute. Live `cloc`-style AST **73** (was ~153 → billed 200). Expect next Extra Modules **1×100 = 12€** not 24. Hide view 3843 untouched. Script `src/commands/compressStudioLoc.ts --apply`. Snapshot S00248 + WH/OUT/00054–55 values unchanged after recompute.
- **Files:** `src/commands/compressStudioLoc.ts`
- **Git:** not committed

### 2026-10-27 — live WC check; created 4-4

- **Agent / human:** agent / user
- **Summary:** Live 19 WC, no `Сборка`. 4-1/2/3 already `Збірка` (ids 25–27). Created **id=34** `Цех №4-4 Збірка Бортик` / Ц4С4. Snapshot Oct 21 still had Сборка + dup 31–33; those gone.
- **Files:** live Odoo
- **Theme push:** no
- **Git:** not committed

### 2026-10-27 — hardcode Odoo workcenter names + Цех №4-4

- **Agent / human:** agent / user
- **Summary:** Spec `# Цех` headers rewrite to Odoo name+code (`Ц4С1`, `Ц3лд1` not client `Ц4С`/`Ц3лд0`). Import reuses WC by №. New shop **Цех №4-4 Збірка Бортик** / `Ц4С4` in canon.
- **Files:** `src/workcenters/canon.ts`, `src/validator/formatter.ts`, `src/validator/lint.ts`, `src/bom/product.ts`, `src/commands/ensureWorkcenters.ts`
- **Theme push:** no
- **Git:** not committed
- **Notes:** 2-4 / 6-1 not in canon.

### 2026-10-23 — sale/buy by category + Елегант БН import

- **Agent / human:** agent
- **Summary:** Rule: Сировина (+Упаковка) buy; Готова продукція sale; Цех mfg-only. Flags now **0** mismatches. Reverted tmpl **18** categ after import keyword false-positive. Imported HackMD `JPv5D217QGOL4Q49dGqbbA` → Диван Елегант БН (BOMs existed, types/cats applied). Leftover `…Д.Елегант БН/ПБ` каркас tmpls still in 4-2, flags mfg-only.
- **Files:** live Odoo + `mergeColoredSheetSplits.ts`
- **Git:** committed with merge command + import fixes

### 2026-10-23 — import is_storable + raw Buy (UNTESTED)

- **Agent / human:** agent
- **Summary:** Import sets `is_storable` on goods create/post-pass. After types+categories, Сировина + `purchase_ok` get WH/Stock orderpoint route Придбати, min/max 0/0. Marked TEST/UNTESTED — verify on first sofa import.
- **Files:** `src/tools/importJson/stockAndBuy.ts`, resolver, template-bom/batch/old importers, `ensureRawBuyOrderpoints.ts`
- **Git:** this commit

### 2026-10-23 — Сировина Buy orderpoints

- **Agent / human:** agent
- **Summary:** Сировина storable **341** (232 active + 109 archived) WH/Stock orderpoint min/max **0/0**, trigger auto, route **Придбати** (54). `purchase_ok` on `[Поролон]` + `Опора ролик Н32`. Dropped MTO from `[ДВП]`, `[ДСП]`, `[ДВП дно]`, `[Поролон]` (Buy rule is MTS; MTO could not match). Left Тканина Рене 20 at 50/50.
- **Files:** `src/commands/ensureRawBuyOrderpoints.ts`, `package.json` `ensure-raw-buy`
- **Git:** not committed

### 2026-10-23 — merge lowercase Цех №4-* збірка workcenters

- **Agent / human:** agent
- **Summary:** Import `getOrCreateWorkcenter` exact-matched names. Formatter/lint `/сборка/gi` → lowercase `збірка`, so specs created WC **32/31/33** (`збірка`) beside canonical **25/26/27** (`Збірка`, codes Ц4С1–3). Remapped routing ops 12+29+9 onto 25/26/27; unlinked 32/31/33. Case-insensitive WC reuse + `canonWorkcenterName`; formatter/lint keep `Збірка` on `# Цех` headers.
- **Files:** `src/bom/product.ts`, `src/validator/formatter.ts`, `src/validator/lint.ts`, `src/tools/docToJson/enricher.ts`
- **Git:** this commit

### 2026-10-22 — drop `[ДВП] (Біле)` 570237

- **Agent / human:** agent
- **Summary:** Extra archived variant of tmpl **14** `[ДВП]` (attr value **Біле** pav 749 / ptav 55560). Only use: BOM line **307801** on bom **29555** `tmpl::🧩[Каркас - нарізані деталі] Угол Хілтон-П` (qty 2.1 m²). Remapped line + stock.move **2950** + move.line **1161** to product **325** `[ДВП] (Білий)`. SQL-deleted quant **505**. Unlinked product **570237**, ptav **55560**, pav **749**. Left duplicate/typo Звичайний / Звичайни.
- **Files:** live Odoo write (no new script)
- **Git:** not committed

### 2026-10-22 — raw inventory 10000 on WH/Stock

- **Agent / human:** agent
- **Summary:** Applied inventory **10000** (product UOM) on WH/Stock for **236** Сировина variants. Absolute set (e.g. ДСП 20028→10000).
- **Files:** `src/commands/setRawInventory.ts --apply`
- **Git:** this commit

### 2026-10-22 — hide Сировина on MO product picker

- **Agent / human:** agent
- **Summary:** ir.ui.view **3843** inherit mrp.production form: `product_id` domain excludes categ **5** Сировина (+ children). Components unchanged.
- **Files:** `src/commands/hideRawOnMoPicker.ts --apply`
- **Git:** this commit

### 2026-10-22 — delete empty WH/С* WH/П* locations

- **Agent / human:** agent
- **Summary:** Removed custom shop locations. Empty П* unlinked. С* + П6П had move history — retargeted to WH/Stock then SQL-deleted (`stock.location.unlink` only archives). Kept Stock/Input/QC/Output/Packing (+ archived Pre/Post-Production).
- **Files:** `src/commands/deleteEmptyShopLocations.ts --apply`
- **Git:** this commit

### 2026-10-22 — consolidate shop WH qty into WH/Stock

- **Agent / human:** agent
- **Summary:** Internal pickings WH/INT/00002–00008 moved 32 quants from П6П/С1–С6 into **WH/Stock**. Left **Output** and **Packing Zone**. Shop locs leftover nonzero = 0.
- **Files:** `src/commands/moveShopStockToWhStock.ts --apply`
- **Git:** this commit

### 2026-10-22 — delete archived warehouses

- **Agent / human:** agent
- **Summary:** Hard-deleted 10 archived WH: С1Дрв, С2Нпв, С3Прж, С4Ткн, С5Фрт, С6Упк, П4С, СЛамн, КОМ, П8Ш. Reassigned leftover MO/PO/MPS to MATRIX. КОМ done picking `КОМ/IN/00001` retargeted to WH/Stock then WH unlinked. Live DB now only warehouse **MATRIX**.
- **Files:** `src/commands/deleteArchivedWarehouses.ts --apply`
- **Git:** not committed

### 2026-10-22 — purge quants on archived locations

- **Agent / human:** agent
- **Summary:** Unlinked **61** qty=0 quants on archived `С4Ткн/Запаси` (loc 160). Other archived WH had 0. Left **12** live `WH/С4Ткн` (loc 290, qty sum 518).
- **Files:** `src/commands/ensureWhStockQuants.ts --purge-archived --apply`
- **Git:** not committed

### 2026-10-22 — apply WH/Stock zeros for all non-sofas

- **Agent / human:** agent
- **Summary:** Created **35351** missing `WH/Stock` qty=0 quants. Skip sofas. ~2.5 min. Non-sofa variants 41764; WH/Stock rows 41786 (extra = lots/dupes). Sofa WH/Stock still 1 (qty≠0).
- **Files:** `src/commands/ensureWhStockQuants.ts --apply`
- **Git:** not committed

### 2026-10-22 — skip sofas on WH/Stock seed; purge sofa zeros

- **Agent / human:** agent
- **Summary:** Abort after ~68k/218k creates. Skip categ **1** `Готова продукція / Дивани` (177014 variants). Unlinked **62503** sofa WH/Stock qty=0. 1 sofa quant with qty≠0 kept. Remaining ~35k non-sofa ≈ **~2.5 min** at ~255 rows/s.
- **Files:** `src/commands/ensureWhStockQuants.ts` (`--apply`, `--purge-sofas`)
- **Git:** not committed

### 2026-10-22 — zero stock.quant probe on [Кромка]

- **Agent / human:** agent
- **Summary:** Same as UI New+Save on Locations: `stock.quant` **534** — product **353989** `[Кромка] (Венге, 20мм)`, location **5** `WH/Stock`, qty 0. Template 210 had no quants; Липучка 1722 already had quant 533.
- **Git:** not committed
- **Notes:** Wait for user check before seeding all goods. Кромка has 8 variants; this is one row only.

### 2026-10-22 — enable Облік запасів (is_storable)

- **Agent / human:** agent
- **Summary:** Turned on `is_storable` for all goods (`type=consu`) templates. 904 off → on; 24 already on. Left 3 services off.
- **Files:** `src/commands/enableStorable.ts`, `package.json` (`npm run enable-storable`)
- **Git:** not committed
- **Notes:** Dry-run default; `--apply` writes in batches of 80.

### 2026-10-12 — furniture + Lili BOM lamels

- **Summary:** Created tmpl **1307** Куток великий чорний, **1308** Ламель 585, **1309** Ламель 735 (cat Сировина / Фурнітура). Added 8×735 + 8×585 to `tmpl::Диван Лілі Механізм` BOM (Ц9). Snapshot `pre-furniture-kutok-lameli-2026-10-12`.
- **Tools:** `src/tools/ensure-furniture-products.ts`, `add-lili-lamel-bom-lines.ts`, `sync-template-bom-missing-lines.ts` (slow; prefer targeted).
- **Note:** `Диван Угол Реал-2 Т` still no root tmpl in Odoo — Куток only in specs until import.

### 2026-10-02 — initial DB snapshot

- **Agent / human:** agent
- **Summary:** Key tmpl/attr/WC IDs after nakladky sync. Live via `.env.local`.
- **Files:** `.ai/CONTEXT.md`, `docs/formats/nakladky-laminat.md`
- **Git:** not committed
- **Notes:**
  - Templates: white sheet **18**, colored sheet **214**, `[Ламінат]` **209**, `[Кромка]` **210**
  - Attrs: color **5**, size **10**, edge width **38** (`20мм`/`40мм`)
  - WC: cut sheet **30** (3-0), overlays **24** (3-2)
  - Overlay fix range tmpl **1247–1265**
  - Colored sheet: 18 sizes × 4 colors = 72 variants + 72 BOMs
  - Кромка variants: 4 colors × 2 widths = 8; display `(колір, ширина)`
  - Archived size-in-name: 1025, 1011, 943
  - Credentials: never commit; empty `.env` disables client until dotenvx injects `.env.local`
