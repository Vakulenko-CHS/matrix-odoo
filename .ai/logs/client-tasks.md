# Client tasks / дошка

## Entries (newest first)

### 2026-11-09 — T-DESC-01 apply related fields

- **Summary:** `x_studio_so_line_note` related on MO/WO/QC. Views 3846–3849. Studio loc still **93/100**. Sample MO shows `sale.order.line.name`. Client how-to in `furniture/reference/T-DESC-01-povidomlennya-kliyentu.md`. BOARD done.
- **Files:** `src/commands/studioSoLineNote.ts`, `package.json`, `apps/tasks/BOARD.md`

### 2026-11-09 — T-DESC related not Python (93/100)

- **Summary:** Do not add Studio Python for SO line note. Live loc ~93/100. Related `sale_line_id.name` on MO/WO/QC. How to open action 1157 documented in NOTES.
- **Files:** `apps/tasks/NOTES.md`

### 2026-11-09 — T-DESC-01 SO line description → MRP/QC

- **Summary:** Client: SO line «Введіть опис» (`sale.order.line.name`) should show on MO / WO / routing print / quality. No Odoo write. Card T-DESC-01 backlog P1; NOTES mapping. Related to T-QAL-02 + `x_studio_x_so_line_uid`.
- **Files:** `apps/tasks/BOARD.md`, `apps/tasks/NOTES.md`
- **Git:** uncommitted

### 2026-11-09 — T-WC done; KNOWLEDGE ops; Terry gas lint headers

- **Summary:** WC 2-4/6-1 Odoo. KNOWLEDGE checklist + import order. 6× Terry gas `fixed.md` цех-коди (Ц3лд1, Ц4С1–4, Ц5Н1). ai-check: lint errors cleared; warnings (Бортик/Ізголовье catalog) — до імпорту.
- **Not done:** T-USR/QAL/PUR (Odoo policy, no blind apply). 34 beds still original-only.
- **Git:** uncommitted

### 2026-11-05 — T-FAB-01 context + tasks UI file browser

- **Summary:** BOARD T-FAB-01: 4/8, multiply, «к»/$, чернетка після T-VOL-01. `#### Файли` на T-FAB/T-VOL. Dev-only `/__repo/list|raw` + modal (chips, links, dir tree) у `npm run tasks`.
- **Files:** `apps/tasks/{BOARD.md,README.md,src/*,vite/*}`, `furniture/reference/T-FAB-01-povidomlennya-kliyentu.md`
- **Git:** uncommitted

### 2026-11-05 — T-LAM-01 apply (lam-buy)

- **Summary:** 68 tmpl purchase_ok, drop VNZ, +3197 Buy orderpoints. Script `lamBuyRoutes.ts`, `npm run lam-buy -- --apply`.
- **Git:** uncommitted

### 2026-11-05 — T-SER-01 → done (UI verified)

- **Summary:** Ілля: Jazz + Атрибути→Тканина — validate/validate-all/Синтетика absent. BOARD column done. Beds `tracking=serial` = note under T-BED-01 import.

### 2026-11-05 — CLIENT-REFERENCES + blocker semantics

- **Summary:** Full client letter in `apps/tasks/CLIENT-REFERENCES.md`; each BOARD card has **Референс (клієнт)**. Blockers = client/colleague only; Odoo apply after chat «так» not a blocker. Removed «частина вільна» from free tab.
- **Files:** `BOARD.md`, `CLIENT-REFERENCES.md`, `README.md`, `board.ts`

### 2026-11-05 — T-VOL-01 waiting on client

- **Summary:** Request sent in chat for Specs columns Об’єм/Вага. Gate `чекає`. Removed separate TSV; message in `T-VOL-01-povidomlennya-kliyentu.md`.
- **Files:** `apps/tasks/BOARD.md`, `furniture/reference/*`
- **Git:** uncommitted cleanup after b182935

### 2026-11-05 — T-PRC-01 → log

- **Summary:** Колега: extra-ціни вже ок, клієнтам презентація. Картка в log. Не писати PTAV в базу під цю скаргу.
- **Files:** `apps/tasks/BOARD.md`, `apps/tasks/NOTES.md`
- **Git:** this commit

### 2026-11-05 — Gate + блокери; що вільно без Q2–Q9

- **Summary:** BOARD: колонки Gate / Блокери. UI вкладка «вільні». Q2–Q9 блокують лише ліжка (T-BED-01), не диванні картки. Вільно: T-FELT-01, T-USR-01, T-QAL-02; частина: T-VOL-01 таблиця назв, T-SER-01 тест-MO, T-LAM-01 зняття ВНЗ (після «так»), T-PUR-01 чорновик, T-QAL-01 read-only users.
- **Files:** `apps/tasks/BOARD.md`, `apps/tasks/src/board.ts`, `apps/tasks/src/main.ts`
- **Git:** not committed

### 2026-11-04 — `apps/beds` + `apps/tasks`

- **Summary:** Local tools under `apps/`. Renamed `beds-ui` → `apps/beds`. Moved `tasks/` → `apps/tasks/`. Board path `apps/tasks/BOARD.md`.
- **Git:** not committed

### 2026-11-04 — tasks UI in `tasks/`, no vite.apps

- **Agent / human:** agent / user
- **Summary:** `tasks-ui/` gone. UI + BOARD in `tasks/`. Vite config standalone (no `web/vite.apps.ts`). `web/` = HEAD validator; index has no furniture/tasks links. Git: nothing staged.
- **Files:** `tasks/vite.config.ts`
- **Git:** not committed

### 2026-11-04 — split UIs; tasks not on Netlify

- **Agent / human:** agent / user
- **Summary:** `npm run web` = validator :5173 / `web:build`. `npm run beds` :5174. `npm run tasks` :5175. No cross-links. Cards: 2-line ellipsis; detail 17px sans.
- **Files:** `web/vite.config.ts`, `web/vite.furniture.ts`, `web/vite.tasks.ts`, `package.json`
- **Git:** not committed

### 2026-11-04 — web board + no Grok Bot as tracker

- **Agent / human:** agent / user
- **Summary:** AppImage Grok Bot removed. Board UI `web/tasks.html`. Rule: every chat updates `tasks/BOARD.md`. Grok Bot is a separate Cursor login app, not this kanban.
- **Files:** `web/tasks.html`, `web/src/tasks-*.ts`, `.cursor/rules/matrix-odoo.mdc`
- **Git:** not committed

### 2026-11-04 — board from colleague list

- **Agent / human:** agent / user
- **Summary:** Source of truth `tasks/BOARD.md`. Slack not wired (no bot token, no MCP). Invoice modal logged as not-a-bug (T-INV-01). Serial on 86 sofas → beds must import serial. Laminate/nakladky buy (T-LAM-01) blocks old 3-1/3-2 manufacture on beds. Extra fabric price per sofa (T-PRC-01). Eight custom fabrics; four names missing (T-FAB-01).
- **Files:** `tasks/README.md`, `tasks/BOARD.md`, `tasks/NOTES.md`, `furniture/KNOWLEDGE.md`, `.cursor/skills/furniture-check/SKILL.md`
- **Theme push:** no
- **Git:** not committed
