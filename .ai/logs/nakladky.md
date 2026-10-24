# Накладки / кольоровий ламінат

## Entries (newest first)

### 2026-10-23 — merge size-in-name colored sheets

- **Agent / human:** agent
- **Summary:** 23 split `🧩[Ламінат кольоровий - лист] {size}` tmpls remapped into tmpl **214** variants (size×color), then archived. BOM lines + explode colorless tmpl-BOM by overlay color PTAV. `purchase_ok=false` on 214. Import keyword: skip 🧩🪤🪵 as Сировина; Упаковка → `Сировина / Упаковка`.
- **Files:** `src/commands/mergeColoredSheetSplits.ts`, `src/tools/importJson/template-bom/importer.ts`
- **Git:** not committed

### 2026-10-02 — sync-nakladky apply

- **Agent / human:** agent
- **Summary:** Created `Ширина Кромки`; reshaped tmpl 214; 72 sheet BOMs; fixed 19 overlays; archived leftovers; sofa tmpl lines→Венге temp.
- **Files:** `src/tools/sync-nakladky.ts`, `temp/nakladky-fix-list.md`, `docs/formats/nakladky-laminat.md`
- **Git:** not committed
- **Notes:**
  - Phases 1–6 applied. Check: sheet 72/0, overlays 76 ok.
  - Mapping table → `temp/nakladky-fix-list.md`
  - Canon format → `docs/formats/nakladky-laminat.md`
  - Open: variant-level sofa color remap; TSV models without overlay yet
