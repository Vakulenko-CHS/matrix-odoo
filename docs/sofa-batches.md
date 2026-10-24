# Sofa import batches (HackMD → Odoo)

## Джерело правди в git

| Шар | Шлях |
|-----|------|
| **Markdown BOM** | [`docs/docs_first-fixed/<назва>.md`](docs_first-fixed/) |
| **JSON** | [`exports/<назва>.json`](../exports/) |
| **Список URL пакета** | [`docs/batches/links-N.tsv`](batches/) |

HackMD / `temp/batches/` — робоча зона (gitignored); після перевірки копіюємо `.md` у `docs_first-fixed` і комітимо разом з `exports/*.json`.

## Команди

```bash
npm run ai-check -- "docs/docs_first-fixed/Диван X.md"
npm run export-json -- "docs/docs_first-fixed/Диван X.md"
npm run import-template-bom -- "exports/Диван X.json"
```

Повний prep з TSV:

```bash
npm run sofa-batch-prep -- temp/batches/links-4/batch.tsv temp/batches/links-4/docs
# після правок — sync у docs/docs_first-fixed + export-json
```

## links-3

Імпортовано 25/25. Логи: `temp/batches/links-3/reports/` (локально).

## links-4

`docs/batches/links-4.tsv` — Хілтон ×3, Бонд-К. Імпорт **4/4 OK** (2026-10-21); лог: `temp/batches/links-4/reports/import-2026-10-21T12-04-22.log`.

Робоча зона (gitignored):

```text
temp/batches/links-4/
  batch.tsv, links-4.tsv   # копія з docs/batches/links-4.tsv
  docs/                    # sofa-batch-prep; Бонд-К → з docs/docs_first-fixed
  reports/                 # import-*.log, manifest
  run-import.sh
```

Див. також [`docs/README.md`](README.md), [`exports/README.md`](../exports/README.md).
