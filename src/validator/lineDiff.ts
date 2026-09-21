import type { QuickFix } from "./lint";

export type DiffSpan = { kind: "eq" | "del" | "ins"; text: string };

function prefixSuffixDiff(from: string, to: string): DiffSpan[] {
  let start = 0;
  const maxStart = Math.min(from.length, to.length);
  while (start < maxStart && from[start] === to[start]) start++;

  let fromEnd = from.length;
  let toEnd = to.length;
  while (fromEnd > start && toEnd > start && from[fromEnd - 1] === to[toEnd - 1]) {
    fromEnd--;
    toEnd--;
  }

  const spans: DiffSpan[] = [];
  if (start > 0) spans.push({ kind: "eq", text: from.slice(0, start) });
  if (fromEnd > start) spans.push({ kind: "del", text: from.slice(start, fromEnd) });
  if (toEnd > start) spans.push({ kind: "ins", text: to.slice(start, toEnd) });
  if (fromEnd < from.length) spans.push({ kind: "eq", text: from.slice(fromEnd) });
  return spans;
}

function pushSpan(spans: DiffSpan[], kind: DiffSpan["kind"], text: string): void {
  if (!text) return;
  const last = spans[spans.length - 1];
  if (last?.kind === kind) last.text += text;
  else spans.push({ kind, text });
}

/** Character LCS. Fallback to one hunk if the line is huge or the result is noisy. */
export function charDiff(from: string, to: string): DiffSpan[] {
  if (from === to) return from ? [{ kind: "eq", text: from }] : [];
  if (from.length * to.length > 80_000) return prefixSuffixDiff(from, to);

  const n = from.length;
  const m = to.length;
  const dp: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        from[i] === to[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const spans: DiffSpan[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (from[i] === to[j]) {
      pushSpan(spans, "eq", from[i]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      pushSpan(spans, "del", from[i]);
      i++;
    } else {
      pushSpan(spans, "ins", to[j]);
      j++;
    }
  }
  if (i < n) pushSpan(spans, "del", from.slice(i));
  if (j < m) pushSpan(spans, "ins", to.slice(j));

  const hunks = spans.filter((s) => s.kind !== "eq").length;
  if (hunks > 8) return prefixSuffixDiff(from, to);
  return spans;
}

export function formatCharDiff(from: string, to: string): string {
  return charDiff(from, to)
    .map((span) => {
      const text = span.text.replace(/\n/g, "\\n");
      if (span.kind === "eq") return text;
      if (span.kind === "del") return `[-${text}-]`;
      return `{+${text}+}`;
    })
    .join("");
}

export function afterFixOnLine(line: string, fix: QuickFix): string | null {
  if (fix.action === "replace-line" && fix.replacement !== undefined) {
    return fix.replacement;
  }
  if (fix.action === "merge-next" && fix.replacement !== undefined) {
    return fix.replacement;
  }
  if (fix.action === "replace-all" && fix.find && fix.replacement !== undefined) {
    if (!line.includes(fix.find)) return null;
    return line.split(fix.find).join(fix.replacement);
  }
  return null;
}

export interface IssueFixDiff {
  fix: QuickFix;
  before: string;
  after: string;
  spans: DiffSpan[];
}

export function issueFixDiffs(
  content: string,
  issue: { original?: string; line?: number | null; fixes?: QuickFix[] },
): IssueFixDiff[] {
  const lines = content.split("\n");
  const out: IssueFixDiff[] = [];
  for (const fix of issue.fixes ?? []) {
    const n = fix.line || issue.line;
    const before = (n != null ? lines[n - 1] : undefined) ?? issue.original ?? "";
    const after = afterFixOnLine(before, fix);
    if (after == null || after === before) continue;
    out.push({ fix, before, after, spans: charDiff(before, after) });
  }
  return out;
}
