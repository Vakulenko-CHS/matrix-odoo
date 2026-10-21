# Документація та BOM-специфікації

## Де що лежить

| Шлях | Призначення |
|------|-------------|
| **[docs_first-fixed/](docs_first-fixed/)** | **Канон.** Готові markdown BOM диванів (редагуємо тут або в HackMD → pull у `temp/batches/` → merge сюди). |
| **[../exports/](../exports/)** | JSON з `npm run export-json` для `import-template-bom`. Ім’я файлу = ім’я `.md` без розширення. |
| **[validated/](validated/)** | Вихід `npm run validate` — не правити вручну без потреби. |
| **[documents_no_valid/](documents_no_valid/)** | Сирі дампи (`npm run to-novalid`) — не канон. |
| **[formats/](formats/)** | Формати накладок, ламінату (див. [BOM_FORMAT.md](BOM_FORMAT.md)). |
| **[archive/](archive/)** | Застарілі папки колеги (`docs_fixed`, client-fix, тести). |

## Пара MD + JSON

```bash
npm run ai-check -- "docs/docs_first-fixed/Диван X.md"
npm run export-json -- "docs/docs_first-fixed/Диван X.md"   # → exports/Диван X.json
npm run import-template-bom -- "exports/Диван X.json"
```

Пакетні імпорти (TSV / HackMD): [sofa-batches.md](sofa-batches.md).

## Стандарт формату

[BOM_FORMAT.md](BOM_FORMAT.md) — еталон `docs/docs_first-fixed/Диван Верадо Механізм.md`.
