# exports/

Пари до [`docs/docs_first-fixed/<назва>.md`](../docs/docs_first-fixed/): тут `\<назва\>.json`.

Генерація:

```bash
npm run export-json -- "docs/docs_first-fixed/Диван X.md"
```

Імпорт у Odoo: `npm run import-template-bom -- "exports/Диван X.json"`.

Деякі старі JSON мають префікс `-` у імені (історичний артефакт) — відповідний MD у каноні без префікса. Нові файли називайте як `.md` без `-`.

Див. [docs/README.md](../docs/README.md).
