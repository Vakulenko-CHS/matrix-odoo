/** Line-oriented unified diff for display (not patch format). */
export type DiffLine = { kind: "same" | "del" | "add"; text: string };

export function diffLines(a: string, b: string): DiffLine[] {
  const A = a.split("\n");
  const B = b.split("\n");
  const n = A.length;
  const m = B.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        A[i] === B[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) {
      out.push({ kind: "same", text: A[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ kind: "del", text: A[i] });
      i++;
    } else {
      out.push({ kind: "add", text: B[j] });
      j++;
    }
  }
  while (i < n) {
    out.push({ kind: "del", text: A[i++] });
  }
  while (j < m) {
    out.push({ kind: "add", text: B[j++] });
  }
  return out;
}

export function formatDiffText(lines: DiffLine[]): string {
  return lines
    .map((l) => {
      if (l.kind === "same") return `  ${l.text}`;
      if (l.kind === "del") return `- ${l.text}`;
      return `+ ${l.text}`;
    })
    .join("\n");
}

export type SplitRow = {
  left: string;
  right: string;
  leftKind: "same" | "del" | "empty";
  rightKind: "same" | "add" | "empty";
  leftLine: number | null;
  rightLine: number | null;
};

export type NumberedDiffLine = DiffLine & {
  oldLine: number | null;
  newLine: number | null;
};

export function numberDiffLines(lines: DiffLine[]): NumberedDiffLine[] {
  let oldLine = 1;
  let newLine = 1;
  return lines.map((line) => {
    if (line.kind === "same") {
      return { ...line, oldLine: oldLine++, newLine: newLine++ };
    }
    if (line.kind === "del") {
      return { ...line, oldLine: oldLine++, newLine: null };
    }
    return { ...line, oldLine: null, newLine: newLine++ };
  });
}

/** Pair unified lines into GitHub-style split rows (del+add on one row). */
export function splitRows(lines: DiffLine[]): SplitRow[] {
  const numbered = numberDiffLines(lines);
  const out: SplitRow[] = [];
  for (let i = 0; i < numbered.length; i++) {
    const line = numbered[i];
    if (line.kind === "same") {
      out.push({
        left: line.text,
        right: line.text,
        leftKind: "same",
        rightKind: "same",
        leftLine: line.oldLine,
        rightLine: line.newLine,
      });
      continue;
    }
    if (line.kind === "del") {
      const next = numbered[i + 1];
      if (next?.kind === "add") {
        out.push({
          left: line.text,
          right: next.text,
          leftKind: "del",
          rightKind: "add",
          leftLine: line.oldLine,
          rightLine: next.newLine,
        });
        i++;
      } else {
        out.push({
          left: line.text,
          right: "",
          leftKind: "del",
          rightKind: "empty",
          leftLine: line.oldLine,
          rightLine: null,
        });
      }
      continue;
    }
    out.push({
      left: "",
      right: line.text,
      leftKind: "empty",
      rightKind: "add",
      leftLine: null,
      rightLine: line.newLine,
    });
  }
  return out;
}
