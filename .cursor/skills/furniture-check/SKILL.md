---
name: furniture-check
description: >
  Check and locally fix Matrix furniture BOM markdown (ліжка, дивани): workshops,
  attributes, business logic the validator misses. Use when user mentions ліжко,
  ліжка, диван spec review, furniture/beds, colleague questions, or HackMD sofa/bed
  notes. Never upload HackMD.
---

# Furniture BOM check

## Priority

1. Correctness
2. Token cost (read few files)
3. Speed (20 min / model OK)

## Read (this order, stop early)

1. `furniture/KNOWLEDGE.md` — always.
2. `furniture/inventory.md` — row for this model only.
3. `furniture/beds/<slug>/` — `original.md`; `fixed.md` / `DIFF.md` if exist.
4. Same Террі-газ family: `beds/terry-90x200-gas/fixed.md` (еталон «Ліжко Террі 90х200 Газовий Під.механізм»). Never call it «золото» in files the colleague will read.
5. Sofa format doubt → `docs/BOM_FORMAT.md` one section, not whole `docs_first-fixed/`.
6. Workshop header spelling → `src/workcenters/canon.ts`.

Do **not** glob all beds or all sofas.

## Always

```bash
npm run ai-check -- "furniture/beds/<slug>/fixed.md"
```

Quote STATUS. Do not invent extra issues. Autos (`STATUS fixed`) stay on disk only if user asked to write.

## Layout per model

```
furniture/beds/<slug>/
  original.md   # HackMD download, never overwrite after first pull unless user says re-pull
  fixed.md      # local correction
  DIFF.md       # why each change (business + format). Dated notes OK
```

HackMD **local only**. No push.

## Business vs validator

`ai-check` misses: Скай/Террі mix, optional attrs stuffed into parent BOM, size qty not scaled, hardware of another size, «і може бути» vs `// @Attr=`, copying sofa foam-two-variants onto a bed with пруж.блок ❌.

Unknown production rule → append `furniture/colleague-questions.md` in **full Ukrainian sentences** (the colleague is not in caveman mode): product full name, HackMD URL, what the client wrote, what we think, 2–3 options. No internal nicknames.

New Odoo workcenter: ask **Ілля** in chat first (beds may get new shops; need a reason + explicit OK). Do not put that in the colleague file.

Client board `apps/tasks/BOARD.md`: finished bed templates get `tracking=serial`. After T-LAM-01, laminate cut parts / sheets / накладки are purchased like Bonnell — do not invent manufacturing MO for them. Do not add the 8 custom fabrics to beds unless the colleague said beds use that matrix.

Do not guess into `fixed.md`.

## Edit KNOWLEDGE

New fact: prepend `### YYYY-MM-DD` under Changelog. Do not delete old bullets; mark superseded.

## Web

Optional: `npm run beds` → http://localhost:5191/ (port in `dev/ports.json`). Not `npm run web`.
