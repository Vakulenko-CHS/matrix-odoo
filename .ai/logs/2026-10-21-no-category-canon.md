# 2026-10-21 — no-category leftovers → canon names + cats

- **Why:** importer `RAW_MATERIAL_CATEGORY` was case-sensitive and missed Hilton/furniture SKUs; leftover Pattern A universals never reclassified.
- **Odoo apply:** `src/tools/apply-uncategorized-canon.ts --apply` — rename/merge/archive + `categ_id`.
- **Canon:** `right_names.md` + `right_names_furniture.md` (МДФ `x`, Липучка, Пас, Сабля aliases).
- **Specs:** `docs/docs_first-fixed` Prestige/Hilton `×`/`фанера`/`двп біле`/`липучка`.
