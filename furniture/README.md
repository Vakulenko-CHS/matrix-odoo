# Ліжка — робочий простір

Локальна перевірка BOM ліжок. **HackMD не пушити.**

| Файл | Навіщо | Коли читати |
|------|--------|-------------|
| [KNOWLEDGE.md](./KNOWLEDGE.md) | Бізнес-логіка цехів / атрибутів. Датований changelog. | Завжди перед правкою. Додавай у чат. |
| [reference/Specs.csv](./reference/Specs.csv) | Таблиця від клієнта (slug, HackMD, статуси) | Новий Specs від клієнта |
| [reference/README.md](./reference/README.md) | Як оновлювати Specs → inventory | |
| [inventory.md](./inventory.md) | 40 ліжок — огляд | Старт пакета |
| [colleague-questions.md](./colleague-questions.md) | Повні питання виробництву (без жаргону) + HackMD | Неясна логіка |
| [beds/](./beds/) | `original.md` / `fixed.md` / `DIFF.md` на модель | Правка однієї моделі |
| [../.cursor/skills/furniture-check/SKILL.md](../.cursor/skills/furniture-check/SKILL.md) | Скіл агента | Будь-яка перевірка меблів |
| [../apps/tasks/BOARD.md](../apps/tasks/BOARD.md) | Клієнтські задачі | Перед імпортом ліжок |

Дивани-канон (не копіювати сюди): `docs/docs_first-fixed/`. Формат рядків: `docs/BOM_FORMAT.md`. Цехи Odoo: `src/workcenters/canon.ts`.

Веб-огляд: `npm run beds` → [http://localhost:5191/](http://localhost:5191/). Код у [`apps/beds/`](../apps/beds/).

Пріоритети: **коректність > токени > швидкість**.
