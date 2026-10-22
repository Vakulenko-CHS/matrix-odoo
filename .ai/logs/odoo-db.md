# Odoo DB cheat sheet

## Entries (newest first)

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
