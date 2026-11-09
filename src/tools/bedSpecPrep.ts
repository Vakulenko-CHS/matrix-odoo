/**
 * Business-layer prep for furniture/beds/*.md before diagnose batch-format.
 * Rules: furniture/KNOWLEDGE.md (2026-11-09).
 */

export type BedProfile = "terry-gas" | "gas" | "bed";

export function bedProfile(slug: string): BedProfile {
  if (/^terry-.+-gas$/.test(slug)) return "terry-gas";
  if (/-gas$/.test(slug) || slug.includes("-gas-")) return "gas";
  return "bed";
}

const ETALON_ATTR_BLOCK = `# СПИСОК АТРИБУТІВ Готового Дивану:

"Тканина", ✅
"Диван Пружинний Блок", ❌
"Диван Наповнювач Подушек", ❌
"Диван Розмір Бильця", ❌
"Колір Ламінату", ❌
"Дно Каркасу", ✅

"Бортик", ✅
"Посилений ламельний каркас", ✅
"Ізголовье в тканині" ✅

## Інструкції який атрибут впливає на які цехи і специфікації:

1. %Тканина%:
   Значення атрибута: "Рене 4", "Рене 20", "Рене 23", "Рене 26" ... т.д
   Впливає на цехи: (7, 8, 9-1, 9)

2. %Диван Пружинний Блок%: посилений пруж.блок {
   [Поролон] (ST-2233 (2000x1600x40x70)) = в 2 рази більше
   [Войлок] (1.60) = в 2 рази більше
   }
   Значення атрибута: "Посилений", "Звичайний"
   Впливає на цехи: (5, 6, 9)

3. %Диван Наповнювач Подушек%: Холлофайбер - списується як "Крихта ППУ" в такому об'ємі.
   Значення атрибута: "Холлофайбер", "ППУ Крихта"
   Впливає на цехи: (9-1, 9)

4. %Диван Розмір Бильця%: зменшені бил-ця - додати атрибут Розміру билец.
   Значення Атрибута: "Зменшені Бильця", "Звичайні Бильця"
   Впливає на цехи: (1, 2-1, 4-1, 5, 6, 7, 8, 9)

5. %Колір Ламінату%:
   Значення атрибута: "Венге", "Трифе", "Дуб крарт"
   Впливає на цехи: (3-2, 4-2, 6, 9)

6. %Дно Каркасу%:
   Значення атрибута: “ДВП Білий”, “ДВП Черновое”
   Впливає на цехи: (2-2, 4-2, 6, 9)

7. %Бортик%
   Значення атрибута: "Додано", "Немає"
   Впливає на цехи: (9)

8. %Посилений ламельний каркас%
    Значення атрибута: "Додано", "Немає"
    Впливає на цех: (9)

9. %Ізголовье в тканині%:
   Значення атрибута: "Додано", "Немає"
   Впливає на цех:(9)

Цехи:
`;

function bedAttrBlock(slug: string): string {
  const napov = slug === "delta" ? "✅" : "❌";
  const pruzh = "❌";
  return `# СПИСОК АТРИБУТІВ Готового Дивану:

"Тканина", ✅
"Диван Пружинний Блок", ${pruzh}
"Диван Наповнювач Подушек", ${napov}
"Диван Розмір Бильця", ❌
"Колір Ламінату", ❌
"Дно Каркасу", ✅

"Ізголовье в тканині", ✅

## Інструкції який атрибут впливає на які цехи і специфікації:

1. %Тканина%:
   Значення атрибута: "Рене 4", "Рене 20", "Рене 23", "Рене 26" ... т.д
   Впливає на цехи: (7, 8, 9-1, 9)

2. %Диван Пружинний Блок%: на ліжках зазвичай вимкнено (один набір поролону в цеху 5).

3. %Диван Наповнювач Подушек%:
   Впливає на цехи: (9-1, 9) — лише якщо атрибут увімкнено.

4. %Диван Розмір Бильця%: ❌ на ліжках.
5. %Колір Ламінату%: ❌ або (3-2, 4-2, 6, 9) якщо є накладки.
6. %Дно Каркасу%: (2-2, 4-2, 6, 9)

7. %Ізголовье в тканині%:
   Значення атрибута: "Додано", "Немає"
   Впливає на цех: (9)

Цехи:
`;
}

function replaceAttrSection(content: string, block: string): string {
  const m = content.match(/^# СПИСОК АТРИБУТІВ[\s\S]*?(?=^# Цех №1|^# Цех №2|^# Цех №3|^# Цех №4|^# Цех №5|^# Цех №6|^# Цех №7|^# Цех №8|^# Цех №9|^# Цех №10|^# ВТК)/m);
  if (m) {
    return content.replace(m[0], block + "\n\n");
  }
  const cehi = content.indexOf("Цехи:");
  if (cehi !== -1) {
    const rest = content.slice(cehi);
    const end = rest.search(/^# Цех №/m);
    const tail = end === -1 ? rest.slice(rest.indexOf("\n\n") + 2) : rest.slice(end);
    const firstLine = content.split("\n")[0];
    return `${firstLine}\n\n${block}\n\n${tail}`;
  }
  return content;
}

function fixIzgolovyeBody(content: string): string {
  let out = content;

  out = out.replace(
    /^(\s*\[Ізголовье в тканині\]\s*-\s*1\.1\s*m\s*)$/gim,
    "",
  );

  if (
    !/🧩\[Ізголовье в тканині - нарізані матеріали\]/u.test(out) &&
    /# Цех №7/u.test(out)
  ) {
    out = out.replace(
      /(# Цех №8 Швейка[^\n]*\n)/u,
      `і\n\n🧩[Ізголовье в тканині - нарізані матеріали] (%Тканина%)\n[Тканина] (%Тканина%) - 1.1 m\n\nЦіна 0 грн\n\n$1`,
    );
  }

  out = out.replace(
    /^\s*І може бути \[Ізголовье в тканині\]\s*$/gim,
    "",
  );
  if (
    /# Цех №9 Оббивки/u.test(out) &&
    !/\/\/ Ізголовье в тканині/u.test(out) &&
    /🧩\[Ізголовье в тканині - нарізані матеріали\]/u.test(out)
  ) {
    out = out.replace(
      /(# Цех №9 Оббивки[^\n]*\n\n[^\n]+\n)/u,
      `$1\n// Ізголовье в тканині\n🧩[Ізголовье в тканині - нарізані матеріали] (%Тканина%) - 1 шт. // @Ізголовье в тканині=Додано\n`,
    );
  }

  return out.replace(/\n{4,}/g, "\n\n\n");
}

function sizeFromSlug(slug: string): string {
  const m = slug.match(/(\d+)x(\d+)/);
  return m ? `${m[1]}x${m[2]}` : "";
}

/** Laminate productId: shared `{Ліжко Скай NxM}` on cut vs assembly (etalon Террі газ). */
function fixLaminateChain(content: string, slug: string): string {
  const size = sizeFromSlug(slug);
  if (!size || !/🧩\[Ламінат - нарізані деталі\]/u.test(content)) return content;
  if (!/Під\.Механізм/u.test(content)) return content;
  if (/^terry-.+-gas$/u.test(slug)) return content;

  const brandKey = slug.split("-")[0];
  const brandUa: Record<string, string> = {
    sky: "Скай",
    hugo: "Хьюго",
    leya: "Лея",
    terry: "Террі",
  };
  const laminateId = slug.startsWith("hugo")
    ? `Ліжко Скай ${size}`
    : `Ліжко ${brandUa[brandKey] ?? brandKey} ${size}`;
  const braced = `{${laminateId}}`;

  const produceRe = new RegExp(
    `(# Цех №3-1[^\\n]*\\n\\n?🧩\\[Ламінат - нарізані деталі\\] )(?:\\{)?[^\\n{]+(?:\\})?(\\(%[^\\n]*\\))?(\\n🧩\\[Ламінат - лист\\])`,
    "u",
  );
  let out = content.replace(produceRe, `$1${braced}$2$3`);

  out = out.replace(
    /🧩\[Ламінат - нарізані деталі\][^\n]* - [\d.,]+[^\n]*/gu,
    (line) => {
      if (line.includes(braced)) return line;
      const attrs = line.match(/(\(%[^)]+\))/u);
      const attrPart = attrs ? ` ${attrs[1]}` : "";
      return `🧩[Ламінат - нарізані деталі] ${braced}${attrPart} - 1 шт.`;
    },
  );
  return out;
}

/** KNOWLEDGE: бортик — окремий товар; не `+ Бортик` у productId (клієнтський legacy). */
function fixBortikProductSuffix(content: string): string {
  if (!/\+ Бортик/u.test(content)) return content;
  return content.replace(/ \+ Бортик/gu, "");
}

function fixFoamSizeTypo(content: string, slug: string): string {
  const size = sizeFromSlug(slug);
  if (!size || !/Ліжко Скай 0x200/u.test(content)) return content;
  return content.replace(/Ліжко Скай 0x200/gu, `Ліжко Скай ${size}`);
}

/** Collapse optional пруж.блок foam pairs when header marks block disabled. */
function collapseOptionalFoam(content: string): string {
  if (!/"Диван Пружинний Блок",\s*❌/.test(content)) return content;
  if (!/або\s*\n\n🧩\[Поролон/m.test(content)) return content;
  return content.replace(
    /(🧩\[Поролон - нарізані компоненти\][^\n]+\n(?:\[[^\n]+\n)+Ціна \d+ грн\n)\s*або\s*\n\n🧩\[Поролон - нарізані компоненти\][\s\S]*?(?=\n# Цех №|\nЦіна \d+ грн\n# Цех №)/g,
    "$1",
  );
}

export function applyBedSpecPrep(
  content: string,
  slug: string,
  displayName: string,
): string {
  let out = content.trimStart();
  const lines = out.split("\n");
  if (lines[0] && displayName && !lines[0].includes(displayName.slice(0, 12))) {
    lines[0] = displayName;
    out = lines.join("\n");
  }

  const profile = bedProfile(slug);
  if (profile === "terry-gas" && slug !== "terry-90x200-gas") {
    out = replaceAttrSection(out, ETALON_ATTR_BLOCK);
  } else if (profile === "terry-gas") {
    // etalon file — only body fixes if needed
  } else {
    out = replaceAttrSection(out, bedAttrBlock(slug));
  }

  out = fixIzgolovyeBody(out);
  out = collapseOptionalFoam(out);

  out = out.replace(/Сбивка/g, "Сбивка");

  return out;
}

/** Chain fixes after batch-format (🧩 lines); original.md is still legacy `(…)` syntax. */
function fixKnownClientTypos(content: string): string {
  return content.replace(/^Блюз 58 з пруж - шт\.$/gmu, "Блюз 58 з пруж - 1 шт.");
}

function fixOptionalBortikFoamPrefix(content: string): string {
  return content.replace(
    /(Ціна \d+ грн\n\n)(🧩\[Поролон - нарізані компоненти\] Бортик)/gu,
    "$1і\n\n$2",
  );
}

export function applyBedPostFormatFixes(content: string, slug: string): string {
  let out = content;
  out = fixLaminateChain(out, slug);
  out = fixBortikProductSuffix(out);
  out = fixFoamSizeTypo(out, slug);
  out = fixKnownClientTypos(out);
  out = fixOptionalBortikFoamPrefix(out);
  return out;
}
