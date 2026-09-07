export interface ToNoValidResult {
  content: string;
  title: string;
  fileName: string;
  changes: string[];
}

const ATTR_CATALOG: Array<{
  name: string;
  detect: RegExp;
  defaultActive?: boolean;
}> = [
  {
    name: "Тканина",
    detect: /тканин/i,
    defaultActive: true,
  },
  {
    name: "Диван Пружинний Блок",
    detect: /пруж|посилен/i,
  },
  {
    name: "Диван Наповнювач Подушек",
    detect: /Холлофайбер|холофайдер|крошк|крихт|наповнювач/i,
  },
  {
    name: "Диван Розмір Бильця",
    detect: /бил-ц|билец|бильц/i,
  },
  {
    name: "Колір Ламінату",
    detect: /колір\s*ламінат|%колір ламінат%/i,
  },
  {
    name: "Дно Каркасу",
    detect: /дно\s*каркас|чернов/i,
  },
];

const INSTRUCTIONS_BLOCK = `## Інструкції який атрибут впливає на які цехи і специфікації:

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
   Впливає на цехи: (2-2, 4-2, 6, 9)`;

function normalizeLine(line: string): string {
  return line
    .replace(/\t/g, " ")
    .replace(/[ \u00a0]{2,}/g, " ")
    .trimEnd();
}

function squeezeBlanks(lines: string[]): string[] {
  const out: string[] = [];
  let blank = 0;
  for (const line of lines) {
    if (!line.trim()) {
      blank++;
      if (blank === 1) out.push("");
      continue;
    }
    blank = 0;
    out.push(line);
  }
  while (out.length && !out[0].trim()) out.shift();
  while (out.length && !out[out.length - 1].trim()) out.pop();
  return out;
}

function stripSyntaxPreamble(content: string): {
  text: string;
  stripped: boolean;
} {
  const match = content.match(/^\s*Синтаксис\s*:/im);
  if (!match || match.index === undefined)
    return { text: content, stripped: false };

  const fromSyntax = content.slice(match.index);
  const dash = fromSyntax.search(/\n[ \t]*---[ \t]*\n/);
  if (dash >= 0) {
    return {
      text: fromSyntax.slice(dash).replace(/^\s*---\s*/, ""),
      stripped: true,
    };
  }

  const product = fromSyntax.search(/\n[ \t]*(Диван\b|Ліжко\b)/);
  if (product >= 0) {
    return { text: fromSyntax.slice(product), stripped: true };
  }

  return { text: content, stripped: false };
}

function titleCaseProduct(raw: string): string {
  return raw
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map((word) => {
      if (!word) return word;
      if (/[А-ЯҐЄІЇA-Z]/.test(word.slice(1))) return word;
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
}

function safeFileName(title: string): string {
  const cleaned = title.replace(/[\\/:*?"<>|]/g, "").trim();
  return `${cleaned || "специфікація"}.md`;
}

const CATALOG_NAMES = new Set(ATTR_CATALOG.map((a) => a.name));
const QUOTED_FLAG_RE = /"([^"]+)",?\s*(✅|❌)/gu;
const QUOTED_FLAG_LINE_RE = /^\s*"[^"]+",?\s*(?:✅|❌)/u;

function parseQuotedFlags(content: string): Record<string, boolean> | null {
  const flags: Record<string, boolean> = {};
  const re = new RegExp(QUOTED_FLAG_RE.source, "gu");
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    if (!CATALOG_NAMES.has(m[1])) continue;
    flags[m[1]] = m[2] === "✅";
  }
  return Object.keys(flags).length ? flags : null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripInstructionBlock(content: string): string {
  return content.replace(
    /^##\s*Інструкції[^\n]*\n[\s\S]*?(?=^Цехи\s*:|^(?:#+\s*)?Цех\s*№)/mu,
    "",
  );
}

/** %Name% → active, %Name❌% → inactive. Params only — not «Інструкції» `%Name%:`. */
function parseFlagsFromArgs(content: string): Record<string, boolean> | null {
  const hay = stripInstructionBlock(content);
  const flags: Record<string, boolean> = {};
  let found = false;
  for (const attr of ATTR_CATALOG) {
    const escaped = escapeRegExp(attr.name);
    const hasInactive = new RegExp(`%${escaped}❌%`, "u").test(hay);
    const hasActive = new RegExp(`%${escaped}%(?!❌)(?!:)`, "u").test(hay);
    if (!hasActive && !hasInactive) continue;
    found = true;
    flags[attr.name] = hasActive;
  }
  return found ? flags : null;
}

function inferFlags(notes: string, body: string): Record<string, boolean> {
  const hay = `${notes}\n${body}`;
  const flags: Record<string, boolean> = {};
  for (const attr of ATTR_CATALOG) {
    flags[attr.name] = attr.defaultActive === true || attr.detect.test(hay);
  }
  if (/\b[Аа]бо\b/.test(body) && /поролон/i.test(body)) {
    flags["Диван Пружинний Блок"] = true;
  }
  if (/\b[Аа]бо\b/.test(body) && /подушк|Холлофайбер|крошк|крихт/i.test(body)) {
    flags["Диван Наповнювач Подушек"] = true;
  }
  return flags;
}

function renderAttrList(flags: Record<string, boolean>): string {
  const lines = ATTR_CATALOG.map((attr, i) => {
    const mark = flags[attr.name] ? "✅" : "❌";
    const comma = i === ATTR_CATALOG.length - 1 ? "" : ",";
    return `"${attr.name}"${comma} ${mark}`;
  });
  return `# СПИСОК АТРИБУТІВ Готового Дивану:\n\n${lines.join("\n")}`;
}

function splitHeadBody(content: string): { head: string; body: string } {
  const cehy = content.search(/^\s*Цехи\s*:/m);
  if (cehy >= 0) {
    return { head: content.slice(0, cehy), body: content.slice(cehy) };
  }
  const workshop = content.search(/^\s*(?:#\s*)?Цех\s*№/m);
  if (workshop >= 0) {
    return {
      head: content.slice(0, workshop),
      body: `Цехи:\n\n${content.slice(workshop)}`,
    };
  }
  return { head: content, body: "Цехи:" };
}

function extractTitle(head: string): string {
  for (const line of head.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    if (/^атрибут/i.test(t)) continue;
    if (/^#/.test(t)) continue;
    if (/^цехи/i.test(t)) continue;
    if (/^синтаксис/i.test(t)) continue;
    if (t.startsWith("[") || t.startsWith("<<") || t.startsWith("//")) continue;
    if (t.startsWith('"') && /✅|❌/.test(t)) continue;
    return titleCaseProduct(t.replace(/\s*\([^)]*%[^)]*\)\s*$/, "").trim());
  }
  return "Без назви";
}

function extractNotes(head: string): string {
  const beforeInstr = head.split(/^##\s*Інструкції/imu)[0] ?? head;
  return beforeInstr
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      if (!t) return false;
      if (/^диван\b|^ліжко\b/i.test(t)) return false;
      if (/^#/.test(t)) return false;
      if (QUOTED_FLAG_LINE_RE.test(t)) return false;
      const quoted = /^"([^"]+)"/.exec(t)?.[1];
      if (quoted && CATALOG_NAMES.has(quoted)) return false;
      return true;
    })
    .join("\n");
}

function tidyBody(body: string): string {
  const lines = squeezeBlanks(
    body.split("\n").map((l) => normalizeLine(l).trimStart()),
  );
  return lines.join("\n");
}

export function toNoValidContent(raw: string): ToNoValidResult {
  const changes: string[] = [];
  let text = raw.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");

  const syntax = stripSyntaxPreamble(text);
  if (syntax.stripped) {
    text = syntax.text;
    changes.push("прибрано шаблон «Синтаксис:»");
  }

  const quotedFlags = parseQuotedFlags(text);
  const argFlags = quotedFlags ? null : parseFlagsFromArgs(text);
  const hasInstructions = /##\s*Інструкції/u.test(text);
  const { head, body } = splitHeadBody(text);
  const title = extractTitle(head);
  const notes = extractNotes(head);
  const flags = quotedFlags ?? argFlags ?? inferFlags(notes, body);

  if (!quotedFlags && argFlags) {
    changes.push("згенеровано «# СПИСОК АТРИБУТІВ» з %аргументів% специфікації");
  } else if (!quotedFlags) {
    changes.push("згенеровано «# СПИСОК АТРИБУТІВ» з нотаток технолога");
  }
  if (!hasInstructions) changes.push("додано шаблон «## Інструкції»");

  const header = [
    title,
    "",
    renderAttrList(flags),
    "",
    INSTRUCTIONS_BLOCK,
    "",
    tidyBody(body),
  ]
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (header !== text.trim()) {
    if (!changes.some((c) => c.includes("відступ"))) {
      changes.push("прибрано зайві порожні рядки і таби");
    }
  }

  if (changes.length === 0)
    changes.push("вже схоже на no_valid — змін майже немає");

  return {
    content: `${header}\n`,
    title,
    fileName: safeFileName(title),
    changes,
  };
}
