# Локальні dev-порти Matrix

Один файл — усі Vite-конфіги читають [`ports.json`](./ports.json). `strictPort: true`: якщо порт зайнятий, сервер падає, а не стрибає на 5173.

| Порт | Команда | UI |
|------|---------|-----|
| **5190** | `npm run web` | валідатор специфікації (`web/`, Netlify build) |
| **5191** | `npm run beds` | ліжка ([`apps/beds/`](../apps/beds/)) |
| **5192** | `npm run tasks` | дошка ([`apps/tasks/`](../apps/tasks/)) |

URL: `http://localhost:5190/` (не `127.0.0.1` — див. правило localhost-dev).

Не 5173–5175: стандарт Vite часто зайнятий іншими проєктами.
