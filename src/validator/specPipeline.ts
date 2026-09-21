import { runAttributeCheck } from "../tools/check-attributes";
import { runBomCheck } from "../tools/check-bom";
import { runChainCheck } from "../tools/check-chain";
import {
  checkDocumentContent,
  parseKnownCatalog,
  type CheckResult,
} from "./checker";
import { formatDocumentContent } from "./formatter";
import { toNoValidContent } from "./toNoValid";

export const BLOCKING_PREFIXES = ["[BREAK]", "[ZERO]", "[EMPTY]", "[NOUNIT]", "[UNKNOWN-ATTR]"];
export const AUTO_PREFIXES = ["[FIX]", "[CASCADE]", "[ATTR-CHAIN]"];

export type SpecToolName = "attrs" | "chain" | "bom";

export interface SpecToolPass {
  source: SpecToolName;
  content: string;
  issues: string[];
  error?: string;
}

export interface PrepareSpecResult {
  content: string;
  fileName: string;
  title: string;
  prepChanges: string[];
  formatChanges: string[];
}

export interface SpecToolsResult {
  content: string;
  attr: SpecToolPass;
  chain: SpecToolPass;
  bom: SpecToolPass;
}

export function isBlockingIssue(message: string): boolean {
  return BLOCKING_PREFIXES.some((p) => message.startsWith(p));
}

export function isAutoIssue(message: string): boolean {
  return AUTO_PREFIXES.some((p) => message.startsWith(p));
}

export function prepareSpecContent(raw: string): PrepareSpecResult {
  const prepared = toNoValidContent(raw);
  const formatted = formatDocumentContent(prepared.content);
  return {
    content: formatted.content,
    fileName: prepared.fileName,
    title: prepared.title,
    prepChanges: prepared.changes,
    formatChanges: formatted.changes,
  };
}

export interface RunSpecToolsOptions {
  applyTodos?: boolean;
  /** When false, each tool sees the original content (live recheck in the web UI). */
  applyContent?: boolean;
}

export function runSpecTools(
  content: string,
  fileName: string,
  applyTodosOrOptions: boolean | RunSpecToolsOptions = true,
): SpecToolsResult {
  const options: Required<RunSpecToolsOptions> =
    typeof applyTodosOrOptions === "boolean"
      ? { applyTodos: applyTodosOrOptions, applyContent: true }
      : {
          applyTodos: applyTodosOrOptions.applyTodos ?? true,
          applyContent: applyTodosOrOptions.applyContent ?? true,
        };

  let attr: SpecToolPass;
  try {
    const result = runAttributeCheck(content, fileName);
    attr = { source: "attrs", content: result.content, issues: result.issues };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    attr = {
      source: "attrs",
      content,
      issues: [],
      error: message,
    };
  }

  const chainInput = options.applyContent ? attr.content : content;
  const chainResult = runChainCheck(chainInput, fileName, options.applyTodos);
  const chain: SpecToolPass = {
    source: "chain",
    content: chainResult.content,
    issues: chainResult.issues,
  };

  const bomInput = options.applyContent ? chain.content : content;
  const bomResult = runBomCheck(bomInput, fileName, options.applyTodos);
  const bom: SpecToolPass = {
    source: "bom",
    content: bomResult.content,
    issues: bomResult.issues,
  };

  return {
    content: options.applyContent ? bom.content : content,
    attr,
    chain,
    bom,
  };
}

export function checkSpecContent(
  content: string,
  knownNamesMd: string,
): CheckResult {
  const catalog = parseKnownCatalog(knownNamesMd);
  return checkDocumentContent(
    content,
    catalog.set,
    catalog.labels,
    catalog.aliases,
    catalog.furnitureCanons,
    catalog.nameCanons,
  );
}
