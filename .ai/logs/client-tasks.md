# Client tasks / дошка

## Entries (newest first)

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
