# Референс від клієнта (Specs)

| Файл | Роль |
|------|------|
| [Specs.csv](./Specs.csv) | Таблиця ліжок і диванів: HackMD, статуси перевірок, коментарі, нові компоненти. **Не правити вручну** без оновлення від клієнта — перегенеруй похідні. |
| [Specs.ods](./Specs.ods) | Те саме в LibreOffice; зручно клієнту. Джерело правди = те, що клієнт надіслав останнім. |
| [divany-obem-vaga.tsv](./divany-obem-vaga.tsv) | T-VOL-01: 84 дивани для заповнення об’єму (m³) і ваги (kg). Реген: `npm run export-sofa-volume-tsv`. |
| [T-VOL-01-povidomlennya-kliyentu.md](./T-VOL-01-povidomlennya-kliyentu.md) | Готовий текст клієнту про цей файл. |

Похідні в репо (генеруються / підтримуються агентом):

- [`../inventory.json`](../inventory.json) — машинний список 40 ліжок для UI `npm run beds`
- [`../inventory.md`](../inventory.md) — людський огляд slug / status / HackMD

Якщо прийшов новий Specs — поклади сюди, потім онови `inventory.*` і `furniture/beds/*/original.md` за потреби.
