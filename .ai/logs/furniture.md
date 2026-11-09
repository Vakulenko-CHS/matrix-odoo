# Furniture / ліжка

## Entries (newest first)

### 2026-11-09 — bed batch format 40/40

- **Agent / human:** agent / user
- **Summary:** `npm run bed-batch-format` на усі 40 slugs; `applyBedPostFormatFixes` (ламінат `{…}`, зняття `+ Бортик` у productId, Блюз qty, `і` перед optional бортик-поролон). `ai-check --as-is`: 40× ready, 0 blocking.
- **Files:** `furniture/beds/**/fixed.md`, `src/tools/bedSpecPrep.ts`, `src/commands/bedBatchFormat.ts`, `furniture/beds/_batch-summary.md`, `apps/tasks/BOARD.md` (T-BED-01)
- **Git:** not committed

### 2026-11-04 — beds UI git split / unified

- **Agent / human:** agent / user
- **Summary:** Right `diff` is GitHub-style split in original|fixed (aligned rows, no 3rd column). `1 вікно` = one overlay unified pane. Top details stays DIFF.md explanation.
- **Files:** `apps/beds/index.html`, `apps/beds/src/{main.ts,furniture.css,line-diff.ts}`
- **Git:** not committed

### 2026-11-04 — client tasks vs beds

- **Agent / human:** agent / user
- **Summary:** Beds import must set serial tracking. T-LAM-01 may remove manufacture of laminate/nakladky. Do not call еталон «золото». Q1 (WC 2-4/6-1) is Ілля-only, not colleague.
- **Files:** `furniture/KNOWLEDGE.md`, `tasks/BOARD.md`
- **Git:** not committed

### 2026-11-04 — beds workspace + knowledge

- **Agent / human:** agent / user
- **Summary:** `furniture/` for 40 beds from Specs.csv. HackMD originals local. Gold = Террі 90×200 газ. Draft-fixed = other Террі газ (clone 2026-10-27). Odoo has 0 Ліжко templates. Colleague Q1–Q9. Skill `furniture-check`. Web `/furniture.html`. No HackMD push.
- **Files:** `furniture/**`, `.cursor/skills/furniture-check/SKILL.md`, `web/furniture.html`
- **Theme push:** no
- **Git:** pending
- **Notes:** 2-4/6-1 WC still open. New attrs only marked on Террі газ in the table.
