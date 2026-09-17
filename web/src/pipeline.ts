import { runAttributeCheck } from "../../src/tools/check-attributes";
import {
  diagnoseSpec,
  type DiagnoseIssue,
  type DiagnoseResult,
} from "../../src/validator/diagnose";
import {
  checkSpecContent,
  isAutoIssue,
  isBlockingIssue,
  runSpecTools,
  type SpecToolPass,
} from "../../src/validator/specPipeline";
import { inferFixes } from "../../src/validator/inferFixes";
import { lintSpec, type QuickFix } from "./lint";
import { parseKnownCatalog } from "../../src/validator/checker";

export { attributeFlagsSignature, attributeListNeedsEmojiFix } from "../../src/tools/check-attributes";
export type { QuickFix };

const AUTO_TODO_LINE =
  /^\s*<!--\s*TODO:\s*(\[(CHAIN-OUT|CHAIN-IN|BREAK|ZERO|EMPTY|NOUNIT)\]|нульова кількість|записати компоненти|відсутн)/i;

export type IssueKind = "blocking" | "auto" | "error" | "warning";
export type IssueSource =
  | "prep"
  | "format"
  | "check"
  | "attrs"
  | "chain"
  | "bom"
  | "lint";
export type SheetStatus = "idle" | "ready" | "fixed" | "bad";

export interface UiIssue {
  id: string;
  kind: IssueKind;
  source: IssueSource;
  line: number | null;
  message: string;
  original?: string;
  fixes?: QuickFix[];
}

export interface ValidationResult {
  original: string;
  content: string;
  fileName: string;
  status: SheetStatus;
  issues: UiIssue[];
  counts: {
    blocking: number;
    errors: number;
    auto: number;
    warnings: number;
  };
}

function stripAutoTodoLines(content: string): string {
  const lines = content.split("\n");
  const out: string[] = [];
  for (const line of lines) {
    if (AUTO_TODO_LINE.test(line)) continue;
    out.push(line);
  }
  return out.join("\n");
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

function pushIssue(
  issues: UiIssue[],
  kind: IssueKind,
  source: IssueSource,
  message: string,
  content: string,
  original?: string,
  line?: number | null,
  fixes?: QuickFix[],
): void {
  const resolved = line ?? resolveLine(content, message);
  issues.push({
    id: `${source}-${issues.length}`,
    kind,
    source,
    line: resolved,
    message,
    original,
    fixes: fixes?.length ? fixes : inferFixes(message, resolved, content),
  });
}

function collectToolIssues(
  issues: UiIssue[],
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

function appendLint(
  issues: UiIssue[],
  content: string,
  aliases: Map<string, string> = new Map(),
  furnitureCanons: string[] = [],
  nameCanons: string[] = [],
): void {
  const hits = lintSpec(content, aliases, furnitureCanons, nameCanons);
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

function finish(
  original: string,
  content: string,
  fileName: string,
  issues: UiIssue[],
): ValidationResult {
  const counts = {
    blocking: issues.filter((i) => i.kind === "blocking").length,
    errors: issues.filter((i) => i.kind === "error").length,
    auto: issues.filter((i) => i.kind === "auto").length,
    warnings: issues.filter((i) => i.kind === "warning").length,
  };

  const status: SheetStatus =
    counts.blocking > 0 || counts.errors > 0
      ? "bad"
      : counts.auto > 0
        ? "fixed"
        : "ready";

  return { original, content, fileName, status, issues, counts };
}

function collectCatalogIssues(
  issues: UiIssue[],
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

function toUiResult(d: DiagnoseResult): ValidationResult {
  const issues: UiIssue[] = d.issues.map((issue: DiagnoseIssue, i) => {
    const line = issue.line;
    const inferred = inferFixes(issue.message, line, d.content);
    return {
      id: `${issue.source}-${i}`,
      kind: issue.kind,
      source: issue.source,
      line,
      message: issue.message,
      original: issue.original,
      fixes: issue.fixes?.length ? issue.fixes : inferred,
    };
  });
  return finish(d.original, d.content, d.fileName, issues);
}

export function runValidation(
  raw: string,
  fileName: string,
  knownNamesMd: string,
): ValidationResult {
  return toUiResult(diagnoseSpec(raw, fileName, knownNamesMd, "validate"));
}

export function recheckSpec(
  spec: string,
  fileName: string,
  knownNamesMd: string,
): ValidationResult {
  return toUiResult(diagnoseSpec(spec, fileName, knownNamesMd, "as-is"));
}

/** Rewrite %Attr% / %Attr❌% from current ✅/❌ list, then recheck (no further rewrites). */
export function rewriteSpecAttributes(
  spec: string,
  fileName: string,
  knownNamesMd: string,
): ValidationResult {
  const original = spec.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  const issues: UiIssue[] = [];
  let working = stripAutoTodoLines(original);

  let attr: SpecToolPass;
  try {
    const result = runAttributeCheck(working, fileName);
    working = stripAutoTodoLines(result.content);
    attr = { source: "attrs", content: working, issues: result.issues };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    attr = { source: "attrs", content: working, issues: [], error: message };
  }
  collectToolIssues(issues, attr, working, true);

  const tools = runSpecTools(working, fileName, {
    applyTodos: false,
    applyContent: false,
  });
  collectToolIssues(issues, tools.attr, working, false);
  collectToolIssues(issues, tools.chain, working, false);
  collectToolIssues(issues, tools.bom, working, false);
  collectCatalogIssues(issues, working, knownNamesMd);
  {
    const cat = parseKnownCatalog(knownNamesMd);
    appendLint(issues, working, cat.aliases, cat.furnitureCanons, cat.nameCanons);
  }

  return finish(original, working, fileName, issues);
}
