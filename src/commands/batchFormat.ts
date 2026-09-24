/**
 * Mass-format specs with the same diagnose pipeline as the web UI.
 * Applies issues that have exactly one content fix. Multi-choice → report.
 *
 *   npm run batch-format -- temp/hackmd
 */
import * as fs from "fs";
import * as path from "path";
import {
  diagnoseSpec,
  type DiagnoseIssue,
  type DiagnoseResult,
} from "../validator/diagnose";
import { readKnownNamesMd } from "../validator/knownNames";
import { applyFix, type QuickFix } from "../validator/lint";
import { writeOds } from "../tools/writeOds";

const MAX_PASSES = 80;

export interface AppliedFix {
  line: number | null;
  message: string;
  label: string;
}

export interface FileFormatResult {
  fileName: string;
  relPath: string;
  status: DiagnoseResult["status"];
  applied: AppliedFix[];
  multi: DiagnoseIssue[];
  leftover: DiagnoseIssue[];
  counts: DiagnoseResult["counts"];
}

function usage(): never {
  console.error(
    "Використання: npm run batch-format -- <папка|.md>\n" +
      "Пише відформатовані .md на диск. Multi-choice → _unresolved.md + .ods",
  );
  process.exit(2);
}

function withMutedLogs<T>(fn: () => T): T {
  const log = console.log;
  const warn = console.warn;
  console.log = () => {};
  console.warn = () => {};
  try {
    return fn();
  } finally {
    console.log = log;
    console.warn = warn;
  }
}

function listMd(target: string): string[] {
  const abs = path.resolve(process.cwd(), target);
  if (!fs.existsSync(abs)) {
    console.error(`Не знайдено: ${abs}`);
    process.exit(2);
  }
  if (fs.statSync(abs).isFile()) {
    if (!abs.endsWith(".md")) usage();
    return [abs];
  }
  return fs
    .readdirSync(abs)
    .filter((f) => f.endsWith(".md") && !f.startsWith("_"))
    .sort((a, b) => a.localeCompare(b, "uk"))
    .map((f) => path.join(abs, f));
}

export function actionableFixes(fixes?: QuickFix[]): QuickFix[] {
  return (fixes ?? []).filter(
    (f) => f.action !== "goto-line" && f.action !== "copy",
  );
}

/** replace-all is never auto: find can be a prefix of replacement, or a catalog alias that strips «-3»/«-Т». */
function isSafeAutoFix(fix: QuickFix): boolean {
  if (fix.action === "goto-line" || fix.action === "copy") return false;
  if (fix.action === "replace-all") return false;
  return true;
}

function autoFixes(issue: DiagnoseIssue): QuickFix[] {
  return actionableFixes(issue.fixes).filter(isSafeAutoFix);
}

function diagnoseQuiet(
  raw: string,
  fileName: string,
  knownNamesMd: string,
): DiagnoseResult {
  return withMutedLogs(() => diagnoseSpec(raw, fileName, knownNamesMd, "validate"));
}

function formatIssue(issue: DiagnoseIssue): string {
  const loc = issue.line == null ? "L?" : `L${issue.line}`;
  const btns = actionableFixes(issue.fixes)
    .map((f) => `    [btn] ${f.label}`)
    .join("\n");
  const orig = issue.original ? `\n    | ${issue.original}` : "";
  return `${loc} [${issue.source}] ${issue.message}${orig}${btns ? `\n${btns}` : ""}`;
}

function formatOne(
  raw: string,
  fileName: string,
  knownNamesMd: string,
): { content: string; fileName: string; applied: AppliedFix[]; last: DiagnoseResult } {
  const applied: AppliedFix[] = [];
  let content = raw;
  let name = fileName;
  const stuck = new Set<string>();

  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const last = diagnoseQuiet(content, name, knownNamesMd);
    content = last.content;
    name = last.fileName || name;
    const singles = last.issues
      .map((issue) => ({ issue, fixes: autoFixes(issue) }))
      .filter(({ issue, fixes }) => {
        if (fixes.length !== 1) return false;
        return !stuck.has(`${issue.line}:${fixes[0].id}`);
      });
    if (!singles.length) {
      return { content: last.content, fileName: name, applied, last };
    }
    singles.sort((a, b) => (b.issue.line ?? 0) - (a.issue.line ?? 0));
    let changed = false;
    const touched = new Set<number>();
    for (const { issue, fixes } of singles) {
      const fix = fixes[0];
      if (fix.action !== "replace-all" && issue.line != null && touched.has(issue.line)) {
        continue;
      }
      const next = applyFix(content, fix);
      if (next === content) {
        stuck.add(`${issue.line}:${fix.id}`);
        continue;
      }
      applied.push({
        line: issue.line,
        message: issue.message,
        label: fix.label,
      });
      content = next;
      changed = true;
      if (issue.line != null) touched.add(issue.line);
      if (fix.action === "replace-all") break;
    }
    if (!changed) break;
  }

  const last = diagnoseQuiet(content, name, knownNamesMd);
  return { content: last.content, fileName: last.fileName || name, applied, last };
}

function writeUnresolved(dir: string, results: FileFormatResult[]): string | null {
  const blocks = results.filter((r) => r.multi.length || r.leftover.length);
  if (!blocks.length) return null;
  const lines: string[] = [
    "# Multi-choice / leftover",
    "",
    "Одна кнопка вже виконана. Тут лише кілька варіантів або помилка без фіксу.",
    "",
  ];
  for (const r of blocks) {
    lines.push(`## ${r.fileName}`);
    lines.push(`\`${r.relPath}\``);
    lines.push("");
    if (r.multi.length) {
      lines.push("### кілька рішень");
      for (const issue of r.multi) lines.push(formatIssue(issue), "");
    }
    if (r.leftover.length) {
      lines.push("### без однозначного фіксу / skipped replace-all");
      for (const issue of r.leftover) lines.push(formatIssue(issue), "");
    }
    lines.push("");
  }
  const out = path.join(dir, "_unresolved.md");
  fs.writeFileSync(out, `${lines.join("\n").trim()}\n`, "utf-8");
  return out;
}

interface OdsBody {
  origName: string;
  destName: string;
  content: string;
}

/** One cell per spec, same order as pull-hackmd `_manifest.json` / urls.txt. */
function odsColumnInUrlOrder(outDir: string, bodies: OdsBody[]): string[] {
  const manifestPath = path.join(outDir, "_manifest.json");
  if (!fs.existsSync(manifestPath)) {
    return bodies.map((b) => b.content);
  }
  const notes = JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as Array<{
    fileName?: string;
  }>;
  const byOrig = new Map(bodies.map((b) => [b.origName, b.content]));
  const byDest = new Map(bodies.map((b) => [b.destName, b.content]));
  return notes.map((n) => {
    const name = n.fileName ?? "";
    return byOrig.get(name) ?? byDest.get(name) ?? "";
  });
}

export async function runBatchFormat(argv: string[]): Promise<void> {
  const target = argv[0];
  if (!target) usage();
  if (!fs.existsSync(path.resolve(process.cwd(), "right_names_odoo_base.md"))) {
    console.error("Не знайдено каталог назв: right_names_odoo_base.md");
    process.exit(2);
  }

  const files = listMd(target);
  if (!files.length) {
    console.error("Немає .md файлів.");
    process.exit(2);
  }
  const knownNamesMd = readKnownNamesMd();
  const outDir = fs.statSync(path.resolve(process.cwd(), target)).isFile()
    ? path.dirname(path.resolve(process.cwd(), target))
    : path.resolve(process.cwd(), target);

  const results: FileFormatResult[] = [];
  const odsBodies: OdsBody[] = [];

  for (let i = 0; i < files.length; i++) {
    const abs = files[i];
    const base = path.basename(abs);
    console.log(`[${i + 1}/${files.length}] ${base}`);
    const raw = fs.readFileSync(abs, "utf-8");
    const done = formatOne(raw, base, knownNamesMd);
    const dest = path.join(outDir, done.fileName);
    if (path.resolve(dest) !== path.resolve(abs) && fs.existsSync(abs)) {
      fs.unlinkSync(abs);
    }
    fs.writeFileSync(dest, done.content.endsWith("\n") ? done.content : `${done.content}\n`, "utf-8");

    const multi = done.last.issues.filter(
      (issue) => actionableFixes(issue.fixes).length > 1,
    );
    const leftover = done.last.issues.filter((issue) => {
      if (issue.kind !== "blocking" && issue.kind !== "error") return false;
      return autoFixes(issue).length !== 1;
    });

    results.push({
      fileName: done.fileName,
      relPath: path.relative(process.cwd(), dest),
      status: done.last.status,
      applied: done.applied,
      multi,
      leftover,
      counts: done.last.counts,
    });
    odsBodies.push({
      origName: base,
      destName: done.fileName,
      content: done.content.replace(/\n+$/, ""),
    });
    console.log(
      `  ${done.last.status} applied=${done.applied.length} multi=${multi.length} leftover=${leftover.length}`,
    );
  }

  const unresolved = writeUnresolved(outDir, results);
  const summaryPath = path.join(outDir, "_summary.md");
  const summary = [
    `# batch-format ${new Date().toISOString().slice(0, 10)}`,
    "",
    `| file | status | applied | multi | leftover | blocking | errors | auto | warn |`,
    `|---|---|---:|---:|---:|---:|---:|---:|---:|`,
    ...results.map(
      (r) =>
        `| ${r.fileName} | ${r.status} | ${r.applied.length} | ${r.multi.length} | ${r.leftover.length} | ${r.counts.blocking} | ${r.counts.errors} | ${r.counts.auto} | ${r.counts.warnings} |`,
    ),
    "",
  ];
  fs.writeFileSync(summaryPath, `${summary.join("\n")}\n`, "utf-8");

  const odsPath = path.join(outDir, "_specs.ods");
  writeOds(odsPath, [{ name: "specs", rows: odsColumnInUrlOrder(outDir, odsBodies) }]);

  console.log(`\nsummary   ${path.relative(process.cwd(), summaryPath)}`);
  if (unresolved) {
    console.log(`unresolved ${path.relative(process.cwd(), unresolved)}`);
  } else {
    console.log("unresolved none");
  }
  console.log(`ods       ${path.relative(process.cwd(), odsPath)}`);
}
