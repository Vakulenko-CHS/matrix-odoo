import { diffLines, numberDiffLines, splitRows, type SplitRow } from "./line-diff.ts";
import { bindLinedPaneScrollSync, createLinedPane, type LinedPane } from "./lined-doc.ts";

function rowClass(kind: string): string {
  if (kind === "del") return "lined-row--del";
  if (kind === "add") return "lined-row--add";
  if (kind === "same") return "lined-row--muted";
  if (kind === "empty") return "lined-row--empty";
  return "";
}

function splitKind(
  kind: SplitRow["leftKind"] | SplitRow["rightKind"],
): string {
  return kind === "empty" ? "empty" : kind;
}

function uniGutterRow(line: ReturnType<typeof numberDiffLines>[number]): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "lined-gutter-row lined-gutter-row--uni";
  const old = document.createElement("span");
  old.className = "lined-ln";
  old.textContent = line.oldLine != null ? String(line.oldLine) : "";
  const neu = document.createElement("span");
  neu.className = "lined-ln";
  neu.textContent = line.newLine != null ? String(line.newLine) : "";
  const sign = document.createElement("span");
  sign.className = "lined-sign";
  sign.textContent = line.kind === "del" ? "−" : line.kind === "add" ? "+" : " ";
  wrap.append(old, neu, sign);
  return wrap;
}

export type SplitDiffViews = {
  left: LinedPane;
  right: LinedPane;
  render: (orig: string | null, fix: string | null) => void;
};

export type UnifiedDiffView = {
  pane: LinedPane;
  render: (orig: string | null, fix: string | null) => void;
};

const NO_DIFF_MSG = "Потрібні обидва файли для текстового diff.";

export function mountSplitDiff(leftHost: HTMLElement, rightHost: HTMLElement): SplitDiffViews {
  const left = createLinedPane(leftHost, "diff-left");
  const right = createLinedPane(rightHost, "diff-right");
  bindLinedPaneScrollSync(left, right);

  const render = (orig: string | null, fix: string | null) => {
    if (!orig || !fix) {
      left.setMessage(NO_DIFF_MSG);
      right.setMessage(NO_DIFF_MSG);
      return;
    }
    const rows = splitRows(diffLines(orig, fix));
    left.setRows(
      rows.map((r) => ({
        text: r.left,
        lineNo: r.leftLine ?? undefined,
        rowClass: rowClass(splitKind(r.leftKind)),
      })),
    );
    right.setRows(
      rows.map((r) => ({
        text: r.right,
        lineNo: r.rightLine ?? undefined,
        rowClass: rowClass(splitKind(r.rightKind)),
      })),
    );
  };

  return { left, right, render };
}

export function mountUnifiedDiff(host: HTMLElement): UnifiedDiffView {
  const pane = createLinedPane(host, "diff-uni");
  host.classList.add("lined-host--uni");

  const render = (orig: string | null, fix: string | null) => {
    if (!orig || !fix) {
      pane.setMessage(NO_DIFF_MSG);
      return;
    }
    const lines = numberDiffLines(diffLines(orig, fix));
    pane.setRows(
      lines.map((line) => ({
        text: line.text,
        lineNo: line.oldLine ?? line.newLine ?? undefined,
        rowClass: rowClass(line.kind),
        gutterHtml: uniGutterRow(line),
      })),
    );
  };

  return { pane, render };
}
