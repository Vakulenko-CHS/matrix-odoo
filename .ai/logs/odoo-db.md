# Odoo DB cheat sheet

## Entries (newest first)

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
