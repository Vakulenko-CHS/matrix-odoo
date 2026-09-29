import type { QuickFix } from "./lint";
import {
  applyAttrsToLine,
  replaceParamsInner,
} from "../tools/check-attributes";
import {
  extractDocProductNames,
  isExactDocProductId,
  renameCorruptsDocProduct,
} from "./docProduct";

function inferChainOutFixes(
  message: string,
  line: number | null,
  content: string,
): QuickFix[] {
  const fixes: QuickFix[] = [];
  const doc = extractDocProductNames(content);

  const outIdMatch = message.match(/\[CHAIN-OUT\][^"]*"([^"]+)"/u);
  const consumedBlock = message.match(/споживається як:\s*(.+)$/u)?.[1];
  if (outIdMatch && consumedBlock) {
    const outId = outIdMatch[1];
    const consumedIds = [...consumedBlock.matchAll(/"([^"]+)"/gu)]
      .map((m) => m[1])
      .filter((id) => id !== outId);
    for (let ci = 0; ci < Math.min(consumedIds.length, 2); ci++) {
      let find = consumedIds[ci];
      let replacement = outId;

      // Prefer rename toward document product name — never strip model id from title.
      if (doc) {
        const findIsDoc = isExactDocProductId(find, doc);
        const replIsDoc = isExactDocProductId(replacement, doc);
        if (findIsDoc && !replIsDoc) {
          find = outId;
          replacement = consumedIds[ci];
        }
        if (renameCorruptsDocProduct(find, replacement, doc)) continue;
      }

      if (find === replacement) continue;

      fixes.push({
        id: `chain-rename-${ci}`,
        label: `Замінити «${find}» → «${replacement}» (скрізь у файлі)`,
        action: "replace-all",
        line: line ?? 1,
        find,
        replacement,
        bulkApply: false,
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

function inferAttrLineFixes(
  message: string,
  line: number | null,
  content: string,
): QuickFix[] {
  if (!line) return [];
  const original = content.split("\n")[line - 1];
  if (!original) return [];

  if (message.startsWith("[ATTR-CHAIN]")) {
    const from = message.match(/ряд\.\s*(\d+)/u);
    const prodLine = from ? Number(from[1]) : 0;
    const producer = prodLine ? content.split("\n")[prodLine - 1] : "";
    const attrs = [...(producer?.match(/%[^%]+❌?%/gu) ?? [])];
    if (!attrs.length) return [];
    const next = applyAttrsToLine(original, attrs);
    if (next === original) return [];
    return [
      {
        id: `attr-chain-${line}`,
        label: `Додати атрибути з ряд. ${prodLine}`,
        action: "replace-line",
        line,
        replacement: next,
      },
    ];
  }

  const arrow = message.match(/→\s*"([^"]+)"/u);
  if (!arrow) return [];
  const next = replaceParamsInner(original, arrow[1]);
  if (next === original) return [];
  const kind = message.startsWith("[FIX]") ? "fix" : "cascade";
  return [
    {
      id: `attr-${kind}-${line}`,
      label: `Замінити на «${arrow[1]}»`,
      action: "replace-line",
      line,
      replacement: next,
    },
  ];
}

export function inferFixes(
  message: string,
  line: number | null,
  content: string,
): QuickFix[] {
  if (message.startsWith("[CHAIN-OUT]")) {
    return inferChainOutFixes(message, line, content);
  }
  if (
    message.startsWith("[ATTR-CHAIN]") ||
    message.startsWith("[FIX]") ||
    message.startsWith("[CASCADE]")
  ) {
    return inferAttrLineFixes(message, line, content);
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
    const doc = extractDocProductNames(content);
    return names
      .filter((n) => {
        if (!doc) return true;
        // Never suggest renaming the document product away to a catalog neighbor.
        if (!isExactDocProductId(product[1], doc)) return true;
        return isExactDocProductId(n, doc);
      })
      .map((n, i) => ({
        id: `known-${line}-${i}`,
        label: `Замінити на «${n}»`,
        action: "replace-all" as const,
        line,
        find: product[1],
        replacement: n,
        bulkApply: false,
      }));
  }
  if (message.startsWith("[EMPTY]")) {
    return [];
  }
  return [];
}
