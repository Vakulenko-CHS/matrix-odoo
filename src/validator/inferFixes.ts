import type { QuickFix } from "./lint";

function inferChainOutFixes(
  message: string,
  line: number | null,
  content: string,
): QuickFix[] {
  const fixes: QuickFix[] = [];
  const docLines = content.split("\n");

  const docTitle =
    docLines.find((l) => {
      const t = l.trim();
      return (
        t &&
        !t.startsWith("#") &&
        !t.startsWith("//") &&
        !t.startsWith("<!--") &&
        !t.startsWith("<<")
      );
    })?.trim() ?? "";

  const SOFA_ANY = /^(диван|ліжко|угол)\s+/iu;
  for (let i = 0; i < docLines.length; i++) {
    const t = docLines[i].trim();
    if (!SOFA_ANY.test(t)) continue;
    const parenIdx = t.indexOf("(");
    const namePart = (parenIdx >= 0 ? t.slice(0, parenIdx) : t).trim();
    const attrsPart = parenIdx >= 0 ? t.slice(parenIdx) : "";
    if (!docTitle || namePart === docTitle) continue;
    const fixedLine = attrsPart ? `${docTitle} ${attrsPart}` : docTitle;
    fixes.push({
      id: `chain-title-${i}`,
      label: `Замінити «${namePart}» → «${docTitle}»`,
      action: "replace-line",
      line: i + 1,
      replacement: fixedLine,
    });
  }

  const outIdMatch = message.match(/\[CHAIN-OUT\][^"]*"([^"]+)"/u);
  const consumedBlock = message.match(/споживається як:\s*(.+)$/u)?.[1];
  if (outIdMatch && consumedBlock) {
    const outId = outIdMatch[1];
    const consumedIds = [...consumedBlock.matchAll(/"([^"]+)"/gu)]
      .map((m) => m[1])
      .filter((id) => id !== outId);
    for (let ci = 0; ci < Math.min(consumedIds.length, 2); ci++) {
      const wrongId = consumedIds[ci];
      fixes.push({
        id: `chain-rename-${ci}`,
        label: `Замінити «${wrongId}» → «${outId}» (скрізь у файлі)`,
        action: "replace-all",
        line: line ?? 1,
        find: wrongId,
        replacement: outId,
      });
    }
  }

  return fixes;
}

function lastWorkshopBodyLine(content: string, headerLine: number): number {
  const docLines = content.split("\n");
  const start = Math.max(0, headerLine - 1);
  let last = start;
  for (let i = start + 1; i < docLines.length; i++) {
    const t = docLines[i].trim();
    if (t.startsWith("#") && t.includes("№")) break;
    if (t) last = i;
  }
  return last + 1;
}

export function inferFixes(
  message: string,
  line: number | null,
  content: string,
): QuickFix[] {
  if (message.startsWith("[CHAIN-OUT]")) {
    return inferChainOutFixes(message, line, content);
  }
  if (!line) return [];
  if (message.startsWith("[ZERO]") || /нульов/i.test(message)) {
    return [
      {
        id: `zero-${line}`,
        label: "Видалити рядок",
        action: "delete-line",
        line,
      },
    ];
  }
  if (/не має рядка "Ціна"/.test(message)) {
    const insertAt = lastWorkshopBodyLine(content, line);
    if (insertAt > line) {
      const inserted = "\nЦіна 0 грн".split("\n");
      const rel = inserted.findIndex((l) => /^Ціна\s/i.test(l));
      return [
        {
          id: `add-price-${line}`,
          label: "Додати ціну 0 грн",
          action: "insert-after",
          line: insertAt,
          replacement: "\nЦіна 0 грн",
          focusLine: insertAt + 1 + rel,
          selectText: "0",
        },
      ];
    }
  }
  if (/Ціна = 0/.test(message) || /не підтверджена/.test(message)) {
    const original = content.split("\n")[line - 1] ?? "";
    if (/<!--\s*\?\s*-->/.test(original)) {
      return [
        {
          id: `price-ok-${line}`,
          label: "Підтвердити ціну 0",
          action: "replace-line",
          line,
          replacement: original.replace(/\s*<!--\s*\?\s*-->/, ""),
        },
      ];
    }
  }
  if (/відсутній варіант/.test(message) && /Цех №5/.test(message)) {
    const missingM = message.match(/відсутній варіант "([^"]+)"/);
    const suggStart = message.indexOf("\nабо\n\n");
    if (missingM && suggStart >= 0) {
      const missingVariant = missingM[1];
      const suggestion = message.slice(suggStart + "\nабо\n\n".length);
      const docLines = content.split("\n");
      let cenaIdx = docLines.length;
      for (let i = line; i < docLines.length; i++) {
        const t = docLines[i].trim();
        if (/^Ціна\s/i.test(t) || (t.startsWith("#") && t.includes("№"))) {
          cenaIdx = i;
          break;
        }
      }
      return [
        {
          id: `foam-insert-${line}`,
          label: `Додати варіант "${missingVariant}"`,
          action: "insert-after",
          line: cenaIdx,
          replacement: `або\n\n${suggestion}\n`,
        },
      ];
    }
  }
  const similar = message.match(/Схожі:\s*(.+)$/);
  const product = message.match(/Товар "([^"]+)"/);
  if (similar && product && line) {
    const names = [...similar[1].matchAll(/«([^»]+)»/g)].map((m) => m[1]);
    return names.map((n, i) => ({
      id: `known-${line}-${i}`,
      label: `Замінити на «${n}»`,
      action: "replace-all" as const,
      line,
      find: product[1],
      replacement: n,
    }));
  }
  if (message.startsWith("[EMPTY]")) {
    return [];
  }
  return [];
}
