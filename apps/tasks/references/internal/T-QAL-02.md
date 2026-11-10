# T-QAL-02 — накладна S00… у перевірках якості

Канон вимоги: [§5 Вадим](../vadim/stosovno-zmin-u-bazi.md#5-відображення-номера-накладної-в-модулі-якість).

## Рішення (Odoo)

| Що | Деталі |
|----|--------|
| Модель | `quality.check` |
| Поле | `x_studio_so_order_name` (підпис **«Накладна»**), id **25263** |
| Related | `production_id.sale_line_id.order_id.name` → `S00254`… |
| Studio loc | **0** (related, без Python) |
| Скрипт | `npm run studio-qal02-so` / `npm run studio-qal02-so -- --apply` |
| List view | **3850** `matrix: QC list SO order`, inherit `quality.check.view.list` (2843) |
| Form view | **3851** `matrix: QC form SO order`, inherit form (2841) |

Ланцюг: QC → MO → рядок продажу → замовлення `sale.order.name`.

**Залежність від T-DESC:** колонка «Опис замовлення» (`x_studio_so_line_note`, view **3849**) — окреме поле; «Накладна» стоїть **перед** нею в списку.

## Інцидент 2026-11-10 — колонки не було в UI

**Симптом:** Admin бачить «Опис замовлення», але **немає «Накладна»** у шестерні колонок (перший apply).

**Причина:** list inherit з xpath `//field[@name='product_id'][@optional='show']` position `before` не потрапив у злитий arch на екрані «Перевірки якості» (порядок/priority з T-DESC).

**Фікс:** view **3850** — xpath **перед** `x_studio_so_line_note`; **priority 32** (після 3849). Коміт `53b7302`. Повторний `studio-qal02-so --apply`.

## Перевірка (пруфи)

### UI (достатньо для клієнта)

1. **Якість → Загальний огляд якості → Перевірки якості** (фільтр **В процесі**, команда Main Quality Team).
2. `Ctrl+Shift+R` після deploy view.
3. Шестерня колонок → **Накладна** (optional) — увімкнути.
4. Очікування: `S00265`, `S00271`… поруч із «Товар» / перед «Опис замовлення».
5. Форма QC: read-only **Накладна**; звірка з **Продажі → S00…**.

**Admin достатній** — окремий логін Тані для T-QAL-02 не обов’язковий (доступ Тані — T-QAL-01).

### CLI (репо, `.env.local`)

```bash
npm run studio-qal02-so          # має: ok quality.check.x_studio_so_order_name
npm run studio-qal02-so -- --apply # idempotent update views
```

### Git

- `6348d52` — перший apply + BOARD
- `53b7302` — fix list column xpath

## Обмеження

- QC без `production_id` / MO без рядка SO → **порожньо**.
- Це **номер замовлення** (`S00…`), не опис рядка (T-DESC) і не `S00254 / № 01` (`x_studio_x_so_line_uid` на рядку SO).

## Що сказати агенту в наступному чаті

«Перечитай [T-QAL-02 apply + перевірка](./T-QAL-02.md) — накладна в Якості.»
