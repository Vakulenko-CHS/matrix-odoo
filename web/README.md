# Перевірка специфікації (web)

Сторінка для технолога всередині `Matrix-Import-Odoo`: вставив текст → побачив помилки → скачав `.md`.

Це **не** імпорт в Odoo. Пайплайн той самий, що CLI:

сирий дамп → `to-novalid` → `validate` → `check-all` (`attrs` / `chain` / `bom`).

Код перевірок живе в `src/validator` і `src/tools`. UI лише показує результат.

Порти локально: [`dev/README.md`](../dev/README.md) — валідатор **5190** (`web/`), ліжка **5191** (`apps/beds/`), задачі **5192** (`apps/tasks/`).

## Розробка

З кореня репозиторію:

```bash
npm install
npm run web
```

## Зібрати папку для Netlify

```bash
npm run web:build
```

З’явиться `web/dist/`. Її й драгаєш.

## Залити на Netlify (без Git, без CLI)

1. https://app.netlify.com → **Add new site** → **Deploy manually**
2. Драг **вміст** `web/dist/` (або саму папку `dist`)
3. **Site configuration → Site details → Change site name** → `matrix-spec-check`
4. URL: `https://matrix-spec-check.netlify.app`
5. Оновлення: **Deploys → Drag and drop a folder** → знову `web/dist/`

Не конектити Git. Build command порожній — Drop вже віддає готові файли.

## Налаштування

| Поле | Значення |
|---|---|
| Site name | `matrix-spec-check` |
| Git | ні |
| Build command | порожньо |
| Functions | ні |
| Password | Pro: Access & security. Інакше — не світити URL |

`netlify.toml` і `_headers` вже всередині `web/dist/`.
