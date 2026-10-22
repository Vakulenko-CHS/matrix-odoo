# Odoo DB cheat sheet

## Entries (newest first)

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
