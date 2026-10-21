# Sofa import batches (HackMD → Odoo)

## Джерело правди

| Шар | Де | Роль |
|-----|-----|------|
| **Markdown BOM** | HackMD + локальна копія `temp/batches/links-N/docs/*.md` | Єдиний формат, який редагуємо |
| **JSON** | `exports/<назва>.json` | Артефакт `npm run export-json` для `import-template-bom` |
| **Odoo** | template BOM `tmpl::<назва>` | Продакшен після імпорту |

**Не комітити лише JSON** без відповідного `.md` у пакеті — з репо не відновити спеку. Історичні файли в `exports/` у git залишаються як знімки старих імпортів; нові після batch краще не додавати (генеруються з `docs/`).

## Локальна структура `temp/` (gitignored)

```
temp/
  README.md
  batches/
    links-2/          # TSV, docs/, звіти, push-manifest
    links-3/          # docs/, reports/, run-import.sh
    links-4/          # batch.tsv — наступна пачка
  shared/             # Ламінат.tsv, Накладки.tsv, nakladky-fix-list.md
  archive/            # старі hackmd-дампи, логи, migrate
```

## Новий пакет (links-4)

```bash
# 1) TSV: назва + URL HackMD → temp/batches/links-4/batch.tsv
npm run sofa-batch-prep -- temp/batches/links-4/batch.tsv temp/batches/links-4/docs

# 2) ai-check / правки в docs/
npm run ai-check -- temp/batches/links-4/docs/*.md

# 3) оцінка часу
npm run estimate-import -- temp/batches/links-4/docs

# 4) імпорт (один процес, не паралельно кілька скриптів)
npm run snapshot -- pre-links-4
# по одному дивану або свій run-import.sh за зразком links-3
```

## Імпорт links-3

Див. `temp/batches/links-3/README-import.md`. Після pre-seed у коді зливаються дублікати PTAL (не запускати кілька імпортів одночасно).

## Корисні npm

- `pull-hackmd` / `push-hackmd` — синх з HackMD
- `sofa-batch-prep` — pull + format + ai-check JSON + estimate
- `estimate-import` — час dry-run імпорту
- `import-template-bom` — запис у Odoo (потрібні `.env` / `.env.local`)
