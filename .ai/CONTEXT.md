# Matrix Odoo — agent context (living document)

Session notes → [logs/](logs/). Keep this file slim.  
Start: [.ai/INDEX.md](./INDEX.md) → **this file**. Open logs only when **Log index** matches.

Last updated: **2026-10-02**

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
| 18 | `🧩[Ламінат - лист]` | Білий; size attr; TSV `temp/Ламінат.tsv` |
| 214 | `🧩[Ламінат кольоровий - лист]` | size × color; TSV `temp/Накладки.tsv` |
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

## Odoo — workcenters (ламінат/накладки)

| id | name | Use |
|----|------|-----|
| 30 | `Цех №3-0 ЛДСП (Нарізка Ламінату)` | BOM листа: Порізка / Поклейка / Присадка |
| 24 | `Цех №3-2 ЛДСП (Нарізка Накладок)` | BOM накладки |
| 23 | `Цех №3-1 ЛДСП (Нарізка Ламінату)` | alternate cut |

Piece rate field on `mrp.routing.workcenter`: **`x_studio_piece_rate_2`**.  
BOM line consume-in-op: **`operation_id`**.

UOM: `m²` id=10, `m` id=8.

---

## What is done (recent)

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

| ID | Task | Notes |
|----|------|-------|
| N1 | Variant-level remap диванних BOM (Леон-Люкс etc.) | 33 lines temp→Венге |
| N2 | Створити накладки з TSV без матчу | Берлін, Барселона, … |
| N3 | Смужки як окремі моделі/споживання | rows без A в TSV |

---

## Log index (read on demand — do not load all logs)

| ID | File | Topics | Read when | Updated |
|----|------|--------|-----------|---------|
| L-odoo | [logs/odoo-db.md](logs/odoo-db.md) | odoo, ids, attr, workcenter, uom, api | будь-яка робота з живою базою / IDs | 2026-10-02 |
| L-nakladky | [logs/nakladky.md](logs/nakladky.md) | накладки, nakladky, ламінат кольоровий, кромка, ширина кромки | sync/fix overlays & colored sheets | 2026-10-02 |
| L-formats | [logs/formats.md](logs/formats.md) | формат, format, BOM_FORMAT, docs/formats | юзер каже «файл з форматом» / reuse format | 2026-10-02 |

**Session end:** prepend matching log; update row here.
