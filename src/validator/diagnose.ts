import {
  checkSpecContent,
  isAutoIssue,
  isBlockingIssue,
  prepareSpecContent,
  runSpecTools,
  type SpecToolPass,
} from "./specPipeline";
import { inferFixes } from "./inferFixes";
import { lintSpec, type QuickFix } from "./lint";

const AUTO_TODO_LINE =
  /^\s*<!--\s*TODO:\s*(\[(CHAIN-OUT|CHAIN-IN|BREAK|ZERO|EMPTY|NOUNIT)\]|нульова кількість|записати компоненти|відсутн)/i;

export type DiagnoseKind = "blocking" | "auto" | "error" | "warning";
export type DiagnoseSource =
  | "prep"
  | "format"
  | "check"
  | "attrs"
  | "chain"
  | "bom"
  | "lint";
export type DiagnoseMode = "validate" | "as-is";
export type DiagnoseStatus = "ready" | "fixed" | "bad";

export interface DiagnoseIssue {
  kind: DiagnoseKind;
  source: DiagnoseSource;
  line: number | null;
  message: string;
  original?: string;
  fixes?: QuickFix[];
}

export interface DiagnoseResult {
  original: string;
  content: string;
  fileName: string;
  mode: DiagnoseMode;
  status: DiagnoseStatus;
  issues: DiagnoseIssue[];
  counts: {
    blocking: number;
    errors: number;
    auto: number;
    warnings: number;
  };
}

export function stripAutoTodoLines(content: string): string {
  return content
    .split("\n")
    .filter((line) => !AUTO_TODO_LINE.test(line))
    .join("\n");
}

function lineFromText(text: string): number | null {
  const m = text.match(/рядок\s+(\d+)/i);
  return m ? Number(m[1]) : null;
}

function lineFromSnippet(content: string, message: string): number | null {
  const quotes = [...message.matchAll(/"([^"]{6,})"/g)].map((m) => m[1]);
  const lines = content.split("\n");
  const workshop = message.match(/Цех\s*№[\w-]+/i);
  let from = 0;
  if (workshop) {
    const header = lines.findIndex((l) => l.includes(workshop[0]));
    if (header >= 0) from = header;
  }
  for (const q of quotes) {
    const idx = lines.findIndex((l, i) => i >= from && l.includes(q));
    if (idx >= 0) return idx + 1;
  }
  return null;
}

function resolveLine(content: string, message: string): number | null {
  return lineFromText(message) ?? lineFromSnippet(content, message);
}

function suggestFileName(content: string, fallback: string): string {
  if (fallback && fallback !== "специфікація.md") return fallback;
  for (const line of content.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    if (
      t.startsWith("#") ||
      t.startsWith("//") ||
      t.startsWith("<<") ||
      t.startsWith("[") ||
      t.startsWith("Цех") ||
      t.startsWith("Синтаксис")
    ) {
      continue;
    }
    const cleaned = t.replace(/[\\/:*?"<>|]/g, "").slice(0, 80).trim();
    if (cleaned.length > 2) return `${cleaned}.md`;
  }
  return "специфікація.md";
}

function pushIssue(
  issues: DiagnoseIssue[],
  kind: DiagnoseKind,
  source: DiagnoseSource,
  message: string,
  content: string,
  original?: string,
  line?: number | null,
  fixes?: QuickFix[],
): void {
  issues.push({
    kind,
    source,
    line: line ?? resolveLine(content, message),
    message,
    original,
    fixes,
  });
}

export function collectToolIssues(
  issues: DiagnoseIssue[],
  pass: SpecToolPass,
  content: string,
  applyAutos: boolean,
): void {
  if (pass.error) {
    pushIssue(issues, "blocking", pass.source, pass.error, content);
    return;
  }
  for (const msg of pass.issues) {
    if (isBlockingIssue(msg)) {
      pushIssue(issues, "blocking", pass.source, msg, content);
    } else if (isAutoIssue(msg)) {
      if (applyAutos) pushIssue(issues, "auto", pass.source, msg, content);
    } else {
      pushIssue(issues, "warning", pass.source, msg, content);
    }
  }
}

function collectCatalogIssues(
  issues: DiagnoseIssue[],
  content: string,
  knownNamesMd: string,
): void {
  const checked = checkSpecContent(content, knownNamesMd);
  for (const e of checked.errors) {
    pushIssue(issues, "error", "check", e.message, content, e.original, e.line || null);
  }
  for (const w of checked.warnings) {
    pushIssue(issues, "warning", "check", w.message, content, w.original, w.line || null);
  }
}

export function appendLint(issues: DiagnoseIssue[], content: string): void {
  const hits = lintSpec(content);
  const zeroLines = new Set(
    issues
      .filter((i) => i.line && (i.message.startsWith("[ZERO]") || /нульов/i.test(i.message)))
      .map((i) => i.line),
  );

  for (const hit of hits) {
    if (/Нульова кількість/.test(hit.message) && zeroLines.has(hit.line)) {
      const existing = issues.find(
        (i) => i.line === hit.line && (i.message.startsWith("[ZERO]") || /нульов/i.test(i.message)),
      );
      if (existing && (!existing.fixes || existing.fixes.length === 0)) {
        existing.fixes = hit.fixes;
      }
      continue;
    }
    pushIssue(
      issues,
      hit.kind,
      "lint",
      hit.message,
      content,
      hit.original,
      hit.line,
      hit.fixes,
    );
  }
}

function attachInferredFixes(issues: DiagnoseIssue[], content: string): void {
  for (const issue of issues) {
    if (issue.fixes?.length) continue;
    const inferred = inferFixes(issue.message, issue.line, content);
    if (inferred.length) issue.fixes = inferred;
  }
}

function finish(
  original: string,
  content: string,
  fileName: string,
  mode: DiagnoseMode,
  issues: DiagnoseIssue[],
): DiagnoseResult {
  attachInferredFixes(issues, content);
  const counts = {
    blocking: issues.filter((i) => i.kind === "blocking").length,
    errors: issues.filter((i) => i.kind === "error").length,
    auto: issues.filter((i) => i.kind === "auto").length,
    warnings: issues.filter((i) => i.kind === "warning").length,
  };
  const status: DiagnoseStatus =
    counts.blocking > 0 || counts.errors > 0
      ? "bad"
      : counts.auto > 0
        ? "fixed"
        : "ready";
  return { original, content, fileName, mode, status, issues, counts };
}

export function diagnoseSpec(
  raw: string,
  fileName: string,
  knownNamesMd: string,
  mode: DiagnoseMode = "validate",
): DiagnoseResult {
  const original = raw.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  const issues: DiagnoseIssue[] = [];

  if (mode === "as-is") {
    const working = stripAutoTodoLines(original);
    const tools = runSpecTools(working, fileName, {
      applyTodos: false,
      applyContent: false,
    });
    collectToolIssues(issues, tools.attr, working, false);
    collectToolIssues(issues, tools.chain, working, false);
    collectToolIssues(issues, tools.bom, working, false);
    collectCatalogIssues(issues, working, knownNamesMd);
    appendLint(issues, working);
    return finish(working, working, fileName, mode, issues);
  }

  const prepared = prepareSpecContent(original);
  for (const change of prepared.prepChanges) {
    pushIssue(issues, "auto", "prep", change, prepared.content);
  }
  for (const change of prepared.formatChanges) {
    pushIssue(issues, "auto", "format", change, prepared.content);
  }

  const tools = runSpecTools(stripAutoTodoLines(prepared.content), prepared.fileName, {
    applyTodos: false,
    applyContent: true,
  });
  const working = stripAutoTodoLines(tools.content);
  collectToolIssues(issues, tools.attr, working, true);
  collectToolIssues(issues, tools.chain, working, true);
  collectToolIssues(issues, tools.bom, working, true);
  collectCatalogIssues(issues, working, knownNamesMd);
  appendLint(issues, working);

  const outName =
    prepared.fileName !== "специфікація.md"
      ? prepared.fileName
      : suggestFileName(working, fileName);
  return finish(original, working, outName, mode, issues);
}

const KIND_ORDER: DiagnoseKind[] = ["blocking", "error", "auto", "warning"];

export function formatDiagnoseReport(
  result: DiagnoseResult,
  filePath: string,
): string {
  const lines: string[] = [];
  lines.push(`FILE ${filePath}`);
  lines.push(`NAME ${result.fileName}`);
  lines.push(`MODE ${result.mode}`);
  lines.push(`STATUS ${result.status}`);
  lines.push(
    `COUNTS blocking=${result.counts.blocking} errors=${result.counts.errors} auto=${result.counts.auto} warnings=${result.counts.warnings}`,
  );
  lines.push("DISK unchanged");
  lines.push("");

  if (result.issues.length === 0) {
    lines.push("NO ISSUES");
    return lines.join("\n");
  }

  for (const kind of KIND_ORDER) {
    const group = result.issues.filter((i) => i.kind === kind);
    if (group.length === 0) continue;
    lines.push(`# ${kind} (${group.length})`);
    for (const issue of group) {
      const loc = issue.line == null ? "L?" : `L${issue.line}`;
      lines.push(`${loc} [${issue.source}] ${issue.message}`);
      if (issue.original) lines.push(`  | ${issue.original}`);
      for (const fix of issue.fixes ?? []) {
        if (fix.label) lines.push(`  [btn] ${fix.label}`);
      }
    }
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}
