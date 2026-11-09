# Matrix Odoo — agent context (living document)

Session notes → [logs/](logs/). Keep this file slim.  
Start: [.ai/INDEX.md](./INDEX.md) → **this file**. Open logs only when **Log index** matches.

Last updated: **2026-11-09** (T-DESC-01 related apply)

---

## Project snapshot

| Item | Value |
|------|--------|
| Project | Matrix Odoo — BOM/specs ↔ Odoo 19 MRP |
| Repo | `/home/user/Work/ChallangeSoft/Matrix/matrix-odoo` |
| Main | `src/` (API, tools, validator, web) |
| Formats | [`docs/formats/`](../docs/formats/README.md) |

---

## Odoo — critical templates

| id | name | Notes |
|----|------|--------|
| 18 | `🧩[Ламінат - лист]` | Білий; size attr; TSV `temp/shared/Ламінат.tsv` |
| 214 | `🧩[Ламінат кольоровий - лист]` | size × color; TSV `temp/shared/Накладки.tsv` |
| 209 | `[Ламінат]` | raw, color only |
| 210 | `[Кромка]` | color × **Ширина Кромки** |
| 1247–1265 | `🪤[Накладка] …` | точковий фікс диванів — `temp/nakladky-fix-list.md` |

---

## Odoo — attributes

| id | name | Typical values |
|----|------|----------------|
| 5 | `Колір Ламінату` | Венге, Трифе, Дуб крарт, Білий, ❌ |
| 10 | `Ламінат Розмір` | `1006x198`, … (latin `x`) |
| 38 | `Ширина Кромки` | `20мм`, `40мм` |
| 2 | `Тканина` | sofa covers |
| 26–29 | Диван * | Бильця, Пружинний Блок, Наповнювач, Дно |

---

## Odoo — workcenters

Canon (formatter/import): [`src/workcenters/canon.ts`](../src/workcenters/canon.ts). Align live DB: `npm run ensure-workcenters -- --apply`.

| id | code | name | Use |
|----|------|------|-----|
| 30 | Ц3лд0 | `Цех №3-0 ЛДСП (Нарізка Ламінату)` | BOM листа |
| 23 | Ц3лд1 | `Цех №3-1 ЛДСП (Нарізка Ламінату)` | sofa cut |
| 24 | Ц3лд2 | `Цех №3-2 ЛДСП (Нарізка Накладок)` | накладки |
| 25–27 | Ц4С1–3 | `Цех №4-* Збірка …` | Бильце / Каркас / Планка |
| 34 | Ц4С4 | `Цех №4-4 Збірка Бортик` | ліжка |

Piece rate field on `mrp.routing.workcenter`: **`x_studio_piece_rate_2`**.  
BOM line consume-in-op: **`operation_id`**.

UOM: `m²` id=10, `m` id=8.

---

## What is done (recent)

- Облік запасів (`is_storable`) on all goods templates (`npm run enable-storable`).
- Name-canon migration phases 1–6 (+ pillow archive).
- White laminate sheet BOM sync (`sync-laminate-sheet-boms`).
- Nakladky + colored sheet reshape/sync (`sync-nakladky`) 2026-10-02.
- Format docs under `docs/formats/`.

---

## Known constraints

- No Odoo write without `--apply` / explicit user OK.
- `.env` often empty on purpose; live keys in `.env.local` (dotenvx).
- Ignore **archived** parents in usage/remap checks.
- Archive unused tmpls — **не** hard-delete.
- Size format: latin `x`; `БК` без зайвого простору; не чіпати `Механізм`/`хром`/тканини при size cleanup.
- TSV «Трюфель/Дк Крафт» ≠ Odoo `Трифе`/`Дуб крарт` — не авто-rename.
- `npm run ai-check` = read-only spec diagnose; `validate` **пише** `docs/validated/`.
- `display_name` domain unreliable — resolve by `product_tmpl_id` then filter.

---

## Open / next

Клієнтські картки: [`apps/tasks/BOARD.md`](../apps/tasks/BOARD.md).

| ID | Task | Notes |
|----|------|-------|
| T-SER-01 | Serial на готовій продукції; тест MO/тканини прибрати | Ліжка імпортувати з `tracking=serial` |
| T-LAM-01 | Ламінат/накладки = купівля як Боннель, без ВНЗ | Ламає цех 3-1/3-2 на ліжках якщо ігнорувати |
| T-PRC-01 | Extra тканини per sofa | log 2026-11-05: колега закрив презентацією |
| T-FAB-01 | 8 замовних тканин (4 назви ще немає) | |
| T-DESC-01 | Опис рядка SO на MO/WO/якість | related apply 2026-11-09; loc 93/100 |
| N1 | Variant-level remap диванних BOM (Леон-Люкс etc.) | 33 lines temp→Венге |
| N2 | Створити накладки з TSV без матчу | Берлін, Барселона, … |
| N3 | Смужки як окремі моделі/споживання | rows без A в TSV |

---

## Log index (read on demand — do not load all logs)

| ID | File | Topics | Read when | Updated |
|----|------|--------|-----------|---------|
| L-tasks | [logs/client-tasks.md](logs/client-tasks.md) | tasks, slack, kanban, замовна тканина, якість, войлок, серійний, опис рядка | клієнтські задачі / `apps/tasks/BOARD.md` | 2026-11-09 |
| L-furn | [logs/furniture.md](logs/furniture.md) | furniture, ліжко, ліжка, beds, knowledge, beds UI, git diff | перевірка ліжок / furniture/ / `apps/beds` | 2026-11-09 |
| L-1027 | [logs/2026-10-27-terry-beds.md](logs/2026-10-27-terry-beds.md) | террі, terry, ліжко, hackmd, size variants | Террі beds / HackMD size specs | 2026-10-27 |
| L-odoo | [logs/odoo-db.md](logs/odoo-db.md) | odoo, ids, attr, workcenter, uom, api, is_storable, orderpoint, buy, loc, studio, serial, invoice | будь-яка робота з живою базою / IDs | 2026-11-09 |
| L-nakladky | [logs/nakladky.md](logs/nakladky.md) | накладки, nakladky, ламінат кольоровий, кромка, ширина кромки | sync/fix overlays & colored sheets | 2026-10-23 |
| L-formats | [logs/formats.md](logs/formats.md) | формат, format, BOM_FORMAT, docs/formats | юзер каже «файл з форматом» / reuse format | 2026-10-02 |
| L-1021 | [logs/2026-10-21-links-3-import.md](logs/2026-10-21-links-3-import.md) | links-3, import, PTAL, temp batches, sofa-batch-prep | пакетні імпорти диванів / temp/batches | 2026-10-21 |
| L-1021b | [logs/2026-10-21-no-category-canon.md](logs/2026-10-21-no-category-canon.md) | no-category, categ_id, right_names, Липучка, МДФ | товари без категорії / rename в Odoo | 2026-10-21 |

**Session end:** prepend matching log; update row here.
