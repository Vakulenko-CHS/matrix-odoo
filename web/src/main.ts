import knownNamesOdooMd from "../../right_names_odoo_base.md?raw";
import knownNamesFurnitureMd from "../../right_names_furniture.md?raw";
import knownNamesCanonMd from "../../right_names.md?raw";
import { applyFix, type QuickFix } from "./lint";
import {
  attributeFlagsSignature,
  attributeListNeedsEmojiFix,
  recheckSpec,
  rewriteSpecAttributes,
  runValidation,
  type SheetStatus,
  type UiIssue,
  type ValidationResult,
} from "./pipeline";
import { scrollChildIntoView } from "./scroll";
import { mountShop } from "./shop-view";
import { SPEC_TEMPLATE } from "./spec-template";
import {
  findHtmlComments,
  toggleHtmlComment,
  type HtmlCommentRange,
} from "../../src/tools/htmlComment";
import "./styles.css";

const knownNamesMd = `${knownNamesOdooMd}\n\n${knownNamesFurnitureMd}\n\n${knownNamesCanonMd}\n`;

const SPLIT_KEY = "matrix-spec-raw-split";
const DOCK_KEY = "matrix-spec-issues-dock";
const HINTS_KEY = "matrix-spec-hints";
const DRAFT_KEY = "matrix-spec-draft";
const SHOP_KEY = "matrix-spec-shop";
const SHOP_H_KEY = "matrix-spec-shop-h";
const CHROME_KEY = "matrix-spec-chrome";
const ISSUES_H_KEY = "matrix-spec-issues-h";
const DEBOUNCE_MS = 480;
const SHOP_MS = 240;
const UNDO_LIMIT = 100;

const BULB_SVG = `
<svg viewBox="0 0 16 16" aria-hidden="true">
  <path class="glass" fill="#e8b400" d="M8 1.15A4.7 4.7 0 0 0 3.9 8.15c.4.7.85 1.25.85 2.05v.5h6.5v-.5c0-.8.45-1.35.85-2.05A4.7 4.7 0 0 0 8 1.15z"/>
  <path fill="none" stroke="#5a4710" stroke-width="0.85" stroke-linecap="round" d="M6.2 8.15c.55.45 1.15.7 1.8.7s1.25-.25 1.8-.7"/>
  <path fill="none" stroke="#5a4710" stroke-width="0.7" stroke-linecap="round" d="M8 3.3v2.35M6.55 4.15 8 5.65l1.45-1.5"/>
  <path fill="#6b6258" d="M6.15 11.05h3.7v.95h-3.7z"/>
  <path fill="none" stroke="#6b6258" stroke-width="0.85" stroke-linecap="round" d="M6.45 12.35h3.1M6.75 13.35h2.5"/>
  <path fill="#6b6258" d="M7.15 13.85h1.7l-.35.7H7.5z"/>
</svg>
`.trim();

const STAMP: Record<SheetStatus, string> = {
  idle: "ЧЕРНЕТКА",
  ready: "ГОТОВО",
  fixed: "ВИПРАВЛЕНО",
  bad: "НЕ ГОТОВО",
};

const STAMP_HINT: Record<SheetStatus, string> = {
  idle: "Ще не перевіряли. Встав сирий текст зліва і натисни «Перевірити».",
  ready: "Помилок немає. Можна зберігати файл і відправляти.",
  fixed: "Дрібниці сторінка виправила сама. Глянь список помилок, тоді зберігай.",
  bad: "Є помилки, які треба виправити руками. Не відправляй, поки штамп не стане зеленим або синім.",
};

const KIND_LABEL: Record<UiIssue["kind"], string> = {
  blocking: "блокує",
  error: "помилка",
  auto: "авто",
  warning: "увага",
};

const SOURCE_LABEL: Record<UiIssue["source"], string> = {
  prep: "оформлення",
  format: "формат",
  check: "перевірка",
  attrs: "атрибути",
  chain: "ланцюг",
  bom: "bom",
  lint: "лінтер",
};

const raw = document.querySelector<HTMLTextAreaElement>("#raw")!;
const editor = document.querySelector<HTMLTextAreaElement>("#editor")!;
const gutter = document.querySelector<HTMLDivElement>("#gutter")!;
const backdrop = document.querySelector<HTMLPreElement>("#backdrop")!;
const specCrop = document.querySelector<HTMLElement>(".spec-crop")!;
const dropZone = document.querySelector<HTMLElement>("#drop-zone")!;
const stamp = document.querySelector<HTMLElement>("#stamp")!;
const stampHint = document.querySelector<HTMLElement>("#stamp-hint")!;
const countsEl = document.querySelector<HTMLElement>("#counts")!;
const issuesEl = document.querySelector<HTMLOListElement>("#issues")!;
const issuesShownEl = document.querySelector<HTMLElement>("#issues-shown")!;
const fileHint = document.querySelector<HTMLElement>("#file-hint")!;
const fileInput = document.querySelector<HTMLInputElement>("#file-input")!;
const btnCheck = document.querySelector<HTMLButtonElement>("#btn-check")!;
const btnRecheckSpec = document.querySelector<HTMLButtonElement>("#btn-recheck-spec")!;
const btnRewriteAttrs = document.querySelector<HTMLButtonElement>("#btn-rewrite-attrs")!;
const btnCopy = document.querySelector<HTMLButtonElement>("#btn-copy")!;
const btnDownload = document.querySelector<HTMLButtonElement>("#btn-download")!;
const saveHint = document.querySelector<HTMLElement>("#save-hint")!;
const workspace = document.querySelector<HTMLElement>("#workspace")!;
const workRow = document.querySelector<HTMLElement>("#work-row")!;
const splitter = document.querySelector<HTMLElement>("#splitter")!;
const shopSplit = document.querySelector<HTMLElement>("#shop-split")!;
const shopBoard = document.querySelector<HTMLElement>("#shop-board")!;
const btnShop = document.querySelector<HTMLButtonElement>("#btn-shop")!;
const btnChrome = document.querySelector<HTMLButtonElement>("#btn-chrome")!;
const fixPop = document.querySelector<HTMLDivElement>("#fix-pop")!;
const issuesSplit = document.querySelector<HTMLElement>("#issues-split")!;
const btnDock = document.querySelector<HTMLButtonElement>("#btn-dock")!;
const btnHints = document.querySelector<HTMLButtonElement>("#btn-hints")!;
const btnTemplate = document.querySelector<HTMLButtonElement>("#btn-template")!;
const paneRaw = document.querySelector<HTMLElement>("#pane-raw")!;
const paneRawTitle = document.querySelector<HTMLElement>("#pane-raw-title")!;
const paneRawLead = document.querySelector<HTMLElement>("#pane-raw-lead")!;
const templateView = document.querySelector<HTMLPreElement>("#template-view")!;
const modal = document.querySelector<HTMLDivElement>("#confirm-modal")!;
const confirmTitle = document.querySelector<HTMLHeadingElement>("#confirm-title")!;
const confirmBody = document.querySelector<HTMLParagraphElement>("#confirm-body")!;
const confirmYes = document.querySelector<HTMLButtonElement>("#confirm-yes")!;
const confirmNo = document.querySelector<HTMLButtonElement>("#confirm-no")!;
const confirmCopy = document.querySelector<HTMLButtonElement>("#confirm-copy")!;
const confirmCopyWarn = document.querySelector<HTMLParagraphElement>("#confirm-copy-warn")!;

const CONFIRM_DEFAULT_TITLE = "Перезаписати специфікацію?";
const CONFIRM_DEFAULT_BODY =
  "Сирий текст зліва замінить те, що зараз справа. Правки в специфікації пропадуть. Ctrl+Z поверне, якщо передумаєш.";

/** False after spec edits until Copy / Ctrl+C. */
let copiedAfterEdit = true;

function markSpecEdited(): void {
  copiedAfterEdit = false;
}

function markSpecCopied(): void {
  copiedAfterEdit = true;
}

const shopDock = document.querySelector<HTMLElement>("#shop-dock")!;
const legendItems = [...document.querySelectorAll<HTMLElement>(".shop-key li[data-legend]")];

let activeLegendEl: HTMLElement | null = null;
const setActiveLegend = (key: string | null) => {
  activeLegendEl?.classList.remove("is-legend-active");
  activeLegendEl = key ? (legendItems.find((li) => li.dataset.legend === key) ?? null) : null;
  activeLegendEl?.classList.add("is-legend-active");
};

const shop = mountShop(shopBoard, {
  onJump: (line) => jumpToLine(line),
  onClearFocus: () => highlightIssuesForLine(null),
  onActiveLegend: setActiveLegend,
});

for (const li of legendItems) {
  li.addEventListener("mouseenter", () => { shopDock.dataset.legend = li.dataset.legend!; });
  li.addEventListener("mouseleave", () => { delete shopDock.dataset.legend; });
}

let last: ValidationResult | null = null;
let fileName = "специфікація.md";
/** Attr ✅/❌ fingerprint last applied to workshop lines. */
let appliedAttrFlags: string | null = null;
/** Last seen list fingerprint (detect edit even when applied baseline is null). */
let prevAttrFlags: string | null = null;
let lineKinds = new Map<number, UiIssue["kind"]>();
let lineFixes = new Map<number, QuickFix[]>();
let activeLine: number | null = null;
let debounceTimer = 0;
let shopTimer = 0;
let persistTimer = 0;
let popLine: number | null = null;
let undoStack: string[] = [];
let redoStack: string[] = [];
let applyingHistory = false;
let typingBurst = false;
let shownKinds = new Set<UiIssue["kind"]>(["blocking", "error", "warning"]);

const CHIP_KIND: Record<string, UiIssue["kind"]> = {
  blocking: "blocking",
  errors: "error",
  auto: "auto",
  warnings: "warning",
};

function kindRank(kind: UiIssue["kind"]): number {
  return { blocking: 0, error: 1, warning: 2, auto: 3 }[kind];
}

function lineKindMap(issues: UiIssue[]): Map<number, UiIssue["kind"]> {
  const map = new Map<number, UiIssue["kind"]>();
  for (const issue of issues) {
    if (!issue.line || !shownKinds.has(issue.kind)) continue;
    const prev = map.get(issue.line);
    if (!prev || kindRank(issue.kind) < kindRank(prev)) {
      map.set(issue.line, issue.kind);
    }
  }
  return map;
}

function lineFixMap(issues: UiIssue[]): Map<number, QuickFix[]> {
  const map = new Map<number, QuickFix[]>();
  for (const issue of issues) {
    if (!issue.line || !issue.fixes?.length || !shownKinds.has(issue.kind)) continue;
    const cur = map.get(issue.line) ?? [];
    for (const fix of issue.fixes) {
      if (!cur.some((f) => f.id === fix.id && f.label === fix.label)) {
        cur.push(fix);
      }
    }
    map.set(issue.line, cur);
  }
  return map;
}

function applySpecMarks(issues: UiIssue[]): void {
  lineKinds = lineKindMap(issues);
  lineFixes = lineFixMap(issues);
  renderDecorations(editor.value);
}

function pushUndo(value: string): void {
  if (applyingHistory) return;
  if (undoStack[undoStack.length - 1] === value) return;
  undoStack.push(value);
  if (undoStack.length > UNDO_LIMIT) undoStack.shift();
  redoStack = [];
}

function persistDraft(): void {
  window.clearTimeout(persistTimer);
  persistTimer = window.setTimeout(() => {
    try {
      localStorage.setItem(
        DRAFT_KEY,
        JSON.stringify({
          spec: editor.value,
          raw: raw.value,
          fileName,
          status: last?.status ?? stamp.dataset.status ?? "idle",
          issues: last?.issues ?? [],
          counts: last?.counts ?? { blocking: 0, errors: 0, auto: 0, warnings: 0 },
          appliedAttrFlags,
        }),
      );
    } catch {
      /* quota */
    }
  }, 280);
}

function recount(result: ValidationResult, issues: UiIssue[]): ValidationResult {
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
  return { ...result, issues, counts, status };
}

function keepAutos(fresh: ValidationResult): ValidationResult {
  const autos = last?.issues.filter((i) => i.kind === "auto") ?? [];
  if (autos.length === 0) return fresh;
  return recount(fresh, [...autos, ...fresh.issues.filter((i) => i.kind !== "auto")]);
}

function restoreDraft(): boolean {
  const blob = localStorage.getItem(DRAFT_KEY);
  if (!blob) return false;
  try {
    const draft = JSON.parse(blob) as {
      spec?: string;
      raw?: string;
      fileName?: string;
      status?: SheetStatus;
      issues?: UiIssue[];
      counts?: ValidationResult["counts"];
      appliedAttrFlags?: string | null;
    };
    if (draft.raw) raw.value = draft.raw;
    if (draft.spec) editor.value = draft.spec;
    if (draft.fileName) fileName = draft.fileName;
    if (!draft.spec?.trim() && !draft.raw?.trim()) return false;
    fileHint.textContent = `Відновлено: ${fileName}`;
    appliedAttrFlags =
      draft.appliedAttrFlags ?? attributeFlagsSignature(editor.value);
    enableExport();
    if (draft.issues?.length) {
      last = {
        original: draft.raw ?? "",
        content: draft.spec ?? editor.value,
        fileName,
        status: draft.status ?? "idle",
        issues: draft.issues,
        counts: draft.counts ?? {
          blocking: 0,
          errors: 0,
          auto: 0,
          warnings: 0,
        },
      };
    }
    if (draft.status && draft.status !== "idle") setStamp(draft.status);
    renderDecorations(editor.value);
    if (editor.value.trim()) runLintNow();
    syncAttrButton();
    return true;
  } catch {
    return false;
  }
}

function setSpec(next: string, fromHistory = false): void {
  if (next === editor.value) return;
  if (!fromHistory) pushUndo(editor.value);
  applyingHistory = true;
  editor.focus();
  editor.setSelectionRange(0, editor.value.length);
  let ok = false;
  try {
    ok = document.execCommand("insertText", false, next);
  } catch {
    ok = false;
  }
  if (!ok || editor.value !== next) {
    editor.value = next;
  }
  // insertText leaves caret at end — pin to first line
  editor.setSelectionRange(0, 0);
  editor.scrollTop = 0;
  syncScroll();
  applyingHistory = false;
  if (last) last = { ...last, content: next };
  markSpecEdited();
  persistDraft();
}

function undoSpec(): void {
  if (document.activeElement === raw) return;
  if (undoStack.length === 0) return;
  applyingHistory = true;
  redoStack.push(editor.value);
  const prev = undoStack.pop()!;
  editor.value = prev;
  if (last) last = { ...last, content: prev };
  applyingHistory = false;
  typingBurst = false;
  markSpecEdited();
  enableExport();
  renderDecorations(prev);
  scheduleLint();
  scheduleShop();
  persistDraft();
}

function redoSpec(): void {
  if (document.activeElement === raw) return;
  if (redoStack.length === 0) return;
  applyingHistory = true;
  undoStack.push(editor.value);
  const next = redoStack.pop()!;
  editor.value = next;
  if (last) last = { ...last, content: next };
  applyingHistory = false;
  typingBurst = false;
  markSpecEdited();
  enableExport();
  renderDecorations(next);
  scheduleLint();
  scheduleShop();
  persistDraft();
}

function setStamp(status: SheetStatus, customHint?: string): void {
  stamp.dataset.status = status;
  stamp.textContent = STAMP[status];
  stampHint.textContent = customHint ?? STAMP_HINT[status];
}

function setCounts(result: ValidationResult | null): void {
  const c = result?.counts ?? { blocking: 0, errors: 0, auto: 0, warnings: 0 };
  countsEl.querySelector('[data-k="blocking"]')!.textContent = `${c.blocking} блокують`;
  countsEl.querySelector('[data-k="errors"]')!.textContent = `${c.errors} помилок`;
  countsEl.querySelector('[data-k="auto"]')!.textContent = `${c.auto} авто`;
  countsEl.querySelector('[data-k="warnings"]')!.textContent = `${c.warnings} увага`;
  for (const el of countsEl.querySelectorAll("[data-k]")) {
    const kind = CHIP_KIND[el.getAttribute("data-k") ?? ""];
    el.setAttribute("aria-pressed", kind && shownKinds.has(kind) ? "true" : "false");
  }
}

function bindCounts(): void {
  countsEl.addEventListener("click", (event) => {
    const el = (event.target as HTMLElement).closest("[data-k]");
    if (!(el instanceof HTMLElement)) return;
    const kind = CHIP_KIND[el.getAttribute("data-k") ?? ""];
    if (!kind) return;
    if (shownKinds.has(kind)) shownKinds.delete(kind);
    else shownKinds.add(kind);
    if (last) {
      setCounts(last);
      renderIssues(last);
      applySpecMarks(last.issues);
    } else {
      setCounts(null);
    }
  });
  countsEl.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const el = event.target;
    if (!(el instanceof HTMLElement) || !el.hasAttribute("data-k")) return;
    event.preventDefault();
    el.click();
  });
}

function appendPlain(el: HTMLElement, text: string): void {
  const re = /%[^%\n]+%/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) el.append(text.slice(last, m.index));
    const span = document.createElement("span");
    span.className = "arg";
    span.textContent = m[0];
    el.append(span);
    last = m.index + m[0].length;
  }
  if (last < text.length) el.append(text.slice(last));
}

function appendLineText(
  el: HTMLElement,
  line: string,
  lineStart: number,
  comments: HtmlCommentRange[],
): void {
  let i = 0;
  while (i < line.length) {
    const abs = lineStart + i;
    const hit = comments.find((c) => abs >= c.start && abs < c.end);
    if (hit) {
      const take = Math.min(line.length, hit.end - lineStart) - i;
      const span = document.createElement("span");
      span.className = hit.todo ? "cmt-todo" : "cmt";
      span.textContent = line.slice(i, i + take);
      el.append(span);
      i += take;
      continue;
    }
    let next = lineStart + line.length;
    for (const c of comments) {
      if (c.start > abs && c.start < next) next = c.start;
    }
    const take = next - abs;
    appendPlain(el, line.slice(i, i + take));
    i += take;
  }
  if (!line) el.append(" ");
}

function lineFromCaret(): number {
  const pos = editor.selectionStart ?? 0;
  return editor.value.slice(0, pos).split("\n").length;
}

function syncGutterHeights(): void {
  const ticks = gutter.children;
  const marks = backdrop.children;
  const n = Math.min(ticks.length, marks.length);
  if (!n) return;
  const top0 = (marks[0] as HTMLElement).getBoundingClientRect().top;
  let prev = top0;
  for (let i = 0; i < n; i++) {
    const bottom = (marks[i] as HTMLElement).getBoundingClientRect().bottom;
    (ticks[i] as HTMLElement).style.height = `${bottom - prev}px`;
    prev = bottom;
  }
}

const hlRo = new ResizeObserver(() => scheduleGutterSync());
let gutterSyncQueued = false;

function scheduleGutterSync(): void {
  if (gutterSyncQueued) return;
  gutterSyncQueued = true;
  requestAnimationFrame(() => {
    syncGutterHeights();
    requestAnimationFrame(() => {
      syncGutterHeights();
      gutterSyncQueued = false;
    });
  });
}

function observeLineMarks(): void {
  hlRo.disconnect();
  for (const mark of backdrop.children) hlRo.observe(mark);
}

function highlightIssuesForLine(n: number | null, focusId?: string): void {
  activeLine = n;
  for (const el of backdrop.querySelectorAll(".hl.active")) el.classList.remove("active");
  for (const el of gutter.querySelectorAll(".gutter-line.active")) el.classList.remove("active");
  if (n) {
    document.getElementById(`HL${n}`)?.classList.add("active");
    gutter.querySelector(`[data-line="${n}"]`)?.classList.add("active");
  }
  for (const el of issuesEl.querySelectorAll("li.active")) el.classList.remove("active");
  shop.highlightLine(n);
  if (!n || !last) return;
  const matches = last.issues.filter(
    (i) => i.line === n && shownKinds.has(i.kind),
  );
  let best: HTMLElement | null = null;
  let bestRank = 99;
  let focus: HTMLElement | null = null;
  for (const issue of matches) {
    const li = issuesEl.querySelector(`[data-id="${CSS.escape(issue.id)}"]`);
    if (!(li instanceof HTMLElement)) continue;
    li.classList.add("active");
    const rank = kindRank(issue.kind);
    if (rank < bestRank) {
      best = li;
      bestRank = rank;
    }
    if (focusId && issue.id === focusId) focus = li;
  }
  const target = focus ?? best;
  if (target) scrollChildIntoView(issuesEl, target, "nearest");
}

function renderDecorations(text: string): void {
  const lines = text.split("\n");
  const comments = findHtmlComments(text);
  gutter.replaceChildren();
  backdrop.replaceChildren();
  let offset = 0;
  lines.forEach((line, i) => {
    const n = i + 1;
    const kind = lineKinds.get(n);
    const fixes = lineFixes.get(n) ?? [];

    const tick = document.createElement("div");
    tick.className = "gutter-line";
    tick.dataset.line = String(n);
    if (kind) tick.dataset.kind = kind;
    const num = document.createElement("span");
    num.className = "gutter-num";
    num.textContent = String(n);
    tick.append(num);
    if (fixes.length) {
      tick.classList.add("has-fix");
      const bulb = document.createElement("button");
      bulb.type = "button";
      bulb.className = "bulb";
      bulb.title = "Варіанти виправлення";
      bulb.setAttribute("aria-label", `Виправлення для рядка ${n}`);
      bulb.innerHTML = BULB_SVG;
      bulb.addEventListener("click", (event) => {
        event.stopPropagation();
        openFixes(n, bulb, fixes);
      });
      tick.append(bulb);
    }
    if (activeLine === n) tick.classList.add("active");
    gutter.append(tick);

    const hl = document.createElement("div");
    hl.className = "hl";
    hl.id = `HL${n}`;
    appendLineText(hl, line, offset, comments);
    if (kind) hl.dataset.kind = kind;
    if (activeLine === n) hl.classList.add("active");
    backdrop.append(hl);
    offset += line.length + 1;
  });
  syncScroll();
  observeLineMarks();
  scheduleGutterSync();
}

function syncScroll(): void {
  backdrop.scrollTop = editor.scrollTop;
  backdrop.scrollLeft = editor.scrollLeft;
  gutter.style.transform = `translateY(${-editor.scrollTop}px)`;
}

function closeFixes(): void {
  popLine = null;
  fixPop.hidden = true;
  fixPop.replaceChildren();
  for (const el of gutter.querySelectorAll('.bulb[aria-expanded="true"]')) {
    el.removeAttribute("aria-expanded");
  }
}

function openFixes(line: number, anchor: HTMLElement, fixes: QuickFix[]): void {
  if (popLine === line && !fixPop.hidden) {
    closeFixes();
    return;
  }
  popLine = line;
  for (const el of gutter.querySelectorAll('.bulb[aria-expanded="true"]')) {
    el.removeAttribute("aria-expanded");
  }
  anchor.setAttribute("aria-expanded", "true");
  fixPop.replaceChildren();
  const title = document.createElement("p");
  title.className = "fix-pop-title";
  title.textContent = `Рядок ${line}`;
  fixPop.append(title);
  for (const fix of fixes) {
    fixPop.append(makeFixButton(fix, () => closeFixes()));
  }
  fixPop.hidden = false;
  const rect = anchor.getBoundingClientRect();
  const left = Math.min(rect.right + 8, window.innerWidth - 336);
  let top = rect.top;
  requestAnimationFrame(() => {
    const h = fixPop.offsetHeight;
    if (top + h > window.innerHeight - 8) top = Math.max(8, window.innerHeight - h - 8);
    fixPop.style.left = `${Math.max(8, left)}px`;
    fixPop.style.top = `${top}px`;
  });
}

function setIssuesShown(result: ValidationResult, visible: number): void {
  const total = result.issues.length;
  const hidden = total - visible;
  if (total === 0) {
    issuesShownEl.textContent = "";
    return;
  }
  issuesShownEl.textContent =
    hidden > 0
      ? `у списку ${visible} · ще ${hidden} сховано (клік по лічильнику)`
      : visible > 1
        ? `у списку ${visible} · гортай`
        : `у списку ${visible}`;
}

function renderIssues(result: ValidationResult): void {
  issuesEl.replaceChildren();
  const visible = result.issues.filter((i) => shownKinds.has(i.kind));
  setIssuesShown(result, visible.length);

  if (result.issues.length === 0) {
    const li = document.createElement("li");
    li.className = "issues-empty";
    li.textContent = "Помилок немає. Можна зберігати файл і відправляти.";
    issuesEl.append(li);
    return;
  }

  if (visible.length === 0) {
    const li = document.createElement("li");
    li.className = "issues-empty";
    li.textContent = "Ці типи вимкнені в лічильниках. Увімкни потрібні — або «авто», якщо хочеш журнал правок.";
    issuesEl.append(li);
    return;
  }

  const sorted = [...visible].sort((a, b) => {
    const k = kindRank(a.kind) - kindRank(b.kind);
    if (k !== 0) return k;
    return (a.line ?? 99999) - (b.line ?? 99999);
  });

  for (const issue of sorted) {
    const li = document.createElement("li");
    li.dataset.id = issue.id;
    li.title = issue.line
      ? `Натисни, щоб перейти до рядка ${issue.line}`
      : "Стосується всього документа";
    const meta = document.createElement("div");
    meta.className = "issue-meta";
    meta.innerHTML = `
      <span class="kind-${issue.kind}">${KIND_LABEL[issue.kind]}</span>
      <span>${SOURCE_LABEL[issue.source]}</span>
      <span>${issue.line ? `ряд. ${issue.line}` : "документ"}</span>
    `;
    const msg = document.createElement("div");
    msg.className = "issue-msg";
    msg.textContent = issue.message;
    li.append(meta, msg);
    if (issue.original) {
      const orig = document.createElement("p");
      orig.className = "issue-orig";
      orig.textContent = issue.original;
      li.append(orig);
    }
    if (issue.fixes?.length) {
      const row = document.createElement("div");
      row.className = "issue-fixes";
      for (const fix of issue.fixes) {
        row.append(makeFixButton(fix, (event) => event.stopPropagation()));
      }
      li.append(row);
    }
    li.addEventListener("click", () => jumpTo(issue, undefined, issue.id));
    issuesEl.append(li);
  }
}

function jumpToLine(line: number): void {
  jumpTo({
    id: "shop-jump",
    kind: "warning",
    source: "chain",
    line,
    message: "",
  });
}

function jumpTo(issue: UiIssue, range?: { from: number; to: number }, focusId?: string): void {
  highlightIssuesForLine(issue.line, focusId);
  if (!issue.line) return;

  const lines = editor.value.split("\n");
  let start = 0;
  for (let i = 0; i < issue.line - 1; i++) start += lines[i].length + 1;
  const lineText = lines[issue.line - 1] ?? "";
  const from = range ? start + Math.max(0, range.from) : start;
  const to = range ? start + Math.min(lineText.length, range.to) : start + lineText.length;
  editor.focus();
  editor.setSelectionRange(from, to);

  const hl = document.getElementById(`HL${issue.line}`);
  if (hl instanceof HTMLElement) {
    scrollChildIntoView(backdrop, hl, "center");
    editor.scrollTop = backdrop.scrollTop;
  }
  syncScroll();
}

function enableExport(): void {
  const has = Boolean(editor.value.trim());
  btnRecheckSpec.disabled = !has;
  btnCopy.disabled = !has;
  btnDownload.disabled = !has;
  saveHint.textContent =
    last?.status === "bad" ? "Є помилки — все одно можна зберегти" : "Завантажити собі";
  syncAttrButton();
}

function syncAttrButton(): void {
  const current = attributeFlagsSignature(editor.value);
  if (!current) {
    btnRewriteAttrs.disabled = true;
    btnRewriteAttrs.classList.remove("is-pending");
    btnRewriteAttrs.setAttribute("aria-pressed", "false");
    prevAttrFlags = null;
    return;
  }

  // Flags changed before any rewrite baseline existed → previous list is baseline.
  if (appliedAttrFlags === null && prevAttrFlags !== null && current !== prevAttrFlags) {
    appliedAttrFlags = prevAttrFlags;
  }

  const pending =
    attributeListNeedsEmojiFix(editor.value) ||
    (appliedAttrFlags !== null && current !== appliedAttrFlags);
  prevAttrFlags = current;
  btnRewriteAttrs.disabled = !pending;
  btnRewriteAttrs.classList.toggle("is-pending", pending);
  btnRewriteAttrs.setAttribute("aria-pressed", pending ? "true" : "false");
}

function markAttrsApplied(content: string): void {
  appliedAttrFlags = attributeFlagsSignature(content);
  prevAttrFlags = appliedAttrFlags;
  syncAttrButton();
}

function paintResult(result: ValidationResult, writeEditor: boolean): void {
  closeFixes();
  if (writeEditor) {
    activeLine = null;
    setSpec(result.content);
    markAttrsApplied(result.content);
  }
  fileName = result.fileName;
  fileHint.textContent = `Файл: ${result.fileName}. Зліва сирий, справа специфікація.`;

  const graphIssues = renderShopNow();
  const rest = result.issues.filter(
    (i) => !String(i.id).startsWith("graph-mismatch-"),
  );
  last = recount(result, [...rest, ...graphIssues]);

  setStamp(last.status);
  setCounts(last);
  applySpecMarks(last.issues);
  renderIssues(last);
  if (activeLine) highlightIssuesForLine(activeLine);
  enableExport();
  persistDraft();
}

function askOverwrite(opts?: {
  skipIfEmpty?: boolean;
  title?: string;
  body?: string;
}): Promise<boolean> {
  const skipIfEmpty = opts?.skipIfEmpty ?? true;
  if (skipIfEmpty && (!editor.value.trim() || !raw.value.trim())) {
    return Promise.resolve(true);
  }
  const needCopyWarn = !copiedAfterEdit;
  return new Promise((resolve) => {
    confirmTitle.textContent = opts?.title ?? CONFIRM_DEFAULT_TITLE;
    confirmBody.textContent = opts?.body ?? CONFIRM_DEFAULT_BODY;
    confirmCopyWarn.hidden = !needCopyWarn;
    confirmCopy.hidden = !needCopyWarn;
    confirmYes.textContent = needCopyWarn ? "Все одно перезаписати" : "Перезаписати";
    modal.hidden = false;
    (needCopyWarn ? confirmCopy : confirmYes).focus();
    const finish = (ok: boolean) => {
      modal.hidden = true;
      confirmCopyWarn.hidden = true;
      confirmCopy.hidden = true;
      confirmTitle.textContent = CONFIRM_DEFAULT_TITLE;
      confirmBody.textContent = CONFIRM_DEFAULT_BODY;
      confirmYes.textContent = "Перезаписати";
      modal.removeEventListener("click", onBackdrop);
      confirmYes.removeEventListener("click", onYes);
      confirmNo.removeEventListener("click", onNo);
      confirmCopy.removeEventListener("click", onCopy);
      document.removeEventListener("keydown", onKey);
      resolve(ok);
    };
    const onYes = () => finish(true);
    const onNo = () => finish(false);
    const onCopy = () => void copyText();
    const onBackdrop = (event: MouseEvent) => {
      if (event.target === modal) finish(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        finish(false);
      }
      if (event.key === "Enter" && document.activeElement !== confirmNo && document.activeElement !== confirmCopy) {
        event.preventDefault();
        finish(true);
      }
    };
    confirmYes.addEventListener("click", onYes);
    confirmNo.addEventListener("click", onNo);
    confirmCopy.addEventListener("click", onCopy);
    modal.addEventListener("click", onBackdrop);
    document.addEventListener("keydown", onKey);
  });
}

async function runFull(): Promise<void> {
  const source = raw.value.trim() ? raw.value : editor.value;
  if (!source.trim()) {
    fileHint.textContent = "Спочатку встав сирий текст зліва або відкрий файл.";
    return;
  }
  if (raw.value.trim()) {
    const ok = await askOverwrite();
    if (!ok) return;
    paintResult(runValidation(raw.value, fileName, knownNamesMd), true);
  } else {
    paintResult(recheckSpec(editor.value, fileName, knownNamesMd), false);
  }
}

async function runFromSpec(): Promise<void> {
  if (!editor.value.trim()) {
    fileHint.textContent = "Спочатку заповни специфікацію справа.";
    return;
  }
  // One click: always copy editor → raw, then full check. No confirm —
  // after «Перевірити» raw ≠ formatted editor, so a modal blocked the
  // main path (and copy-warn focused «Скопіювати» after setSpec).
  raw.value = editor.value;
  paintResult(runValidation(raw.value, fileName, knownNamesMd), true);
}

function runRewriteAttrs(): void {
  if (!editor.value.trim()) return;
  paintResult(rewriteSpecAttributes(editor.value, fileName, knownNamesMd), true);
}

function runLintNow(): void {
  if (!editor.value.trim()) return;
  paintResult(keepAutos(recheckSpec(editor.value, fileName, knownNamesMd)), false);
}

function scheduleLint(): void {
  window.clearTimeout(debounceTimer);
  debounceTimer = window.setTimeout(runLintNow, DEBOUNCE_MS);
}

function renderShopNow(): UiIssue[] {
  const mismatches = shop.render(editor.value, last?.issues ?? []);
  if (activeLine) shop.highlightLine(activeLine);
  return mismatches;
}

function scheduleShop(): void {
  window.clearTimeout(shopTimer);
  shopTimer = window.setTimeout(renderShopNow, SHOP_MS);
}

function applySpecPatch(next: string, selStart: number, selEnd: number): void {
  if (next === editor.value) return;
  pushUndo(editor.value);
  applyingHistory = true;
  const scroll = editor.scrollTop;
  editor.value = next;
  editor.setSelectionRange(selStart, selEnd);
  editor.scrollTop = scroll;
  applyingHistory = false;
  typingBurst = false;
  closeFixes();
  markSpecEdited();
  if (last) last = { ...last, content: next };
  enableExport();
  renderDecorations(next);
  highlightIssuesForLine(lineFromCaret());
  scheduleLint();
  scheduleShop();
  persistDraft();
}

function toggleEditorComment(): void {
  const from = editor.selectionStart ?? 0;
  const to = editor.selectionEnd ?? from;
  const next = toggleHtmlComment(editor.value, from, to);
  applySpecPatch(next.text, next.start, next.end);
}

function onSpecInput(): void {
  if (applyingHistory) return;
  closeFixes();
  markSpecEdited();
  if (last) last = { ...last, content: editor.value };
  enableExport();
  renderDecorations(editor.value);
  highlightIssuesForLine(lineFromCaret());
  scheduleLint();
  scheduleShop();
  persistDraft();
}

function makeFixButton(
  fix: QuickFix,
  onClick?: (event: MouseEvent) => void,
): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = fix.label;
  if (fix.action === "goto-line") btn.classList.add("is-goto");
  if (fix.action === "copy") btn.classList.add("is-copy");
  btn.addEventListener("click", (event) => {
    onClick?.(event);
    void runFix(fix, btn);
  });
  return btn;
}

async function copyPlain(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.append(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
}

async function runFix(fix: QuickFix, btn?: HTMLButtonElement): Promise<void> {
  if (fix.action === "goto-line") {
    jumpToLine(fix.line);
    return;
  }
  if (fix.action === "copy") {
    await copyPlain(fix.replacement ?? "");
    if (btn) {
      const prev = btn.textContent ?? "";
      btn.textContent = "Скопійовано";
      setTimeout(() => {
        btn.textContent = prev;
      }, 1200);
    }
    return;
  }
  const prev = editor.value;
  const next = applyFix(prev, fix);
  if (next === prev) return;
  setSpec(next);
  enableExport();
  runLintNow();
  const focusLine = fix.focusLine ?? fix.line;
  if (!focusLine) return;
  const lines = next.split("\n");
  const lineNo = Math.min(focusLine, lines.length);
  const lineText = lines[lineNo - 1] ?? "";
  let range: { from: number; to: number } | undefined;
  if (fix.selectText) {
    const i = lineText.indexOf(fix.selectText);
    if (i >= 0) range = { from: i, to: i + fix.selectText.length };
  }
  jumpTo(
    {
      id: "after-fix",
      kind: "warning",
      source: "lint",
      line: lineNo,
      message: "",
    },
    range,
  );
}

async function readFile(file: File): Promise<void> {
  const text = await file.text();
  fileName = file.name.replace(/\.txt$/i, ".md");
  last = null;
  raw.value = text;
  setTemplateMode(false);
  fileHint.textContent = `Відкрито: ${fileName}`;
  setStamp("idle");
  await runFull();
}

function download(): void {
  const content = editor.value;
  if (!content.trim()) return;
  const name = (last?.fileName ?? fileName).endsWith(".md")
    ? (last?.fileName ?? fileName)
    : `${last?.fileName ?? fileName}.md`;
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

async function copyText(): Promise<void> {
  if (!editor.value.trim()) return;
  await navigator.clipboard.writeText(editor.value);
  markSpecCopied();
  const flash = (btn: HTMLButtonElement, prev: string) => {
    btn.textContent = "Скопійовано";
    setTimeout(() => {
      btn.textContent = prev;
    }, 1200);
  };
  flash(btnCopy, "Скопіювати");
  if (!modal.hidden && !confirmCopy.hidden) {
    confirmCopyWarn.hidden = true;
    confirmYes.textContent = "Перезаписати";
    flash(confirmCopy, "Скопіювати");
  }
}

function renderTemplateView(): void {
  templateView.replaceChildren();
  const comments = findHtmlComments(SPEC_TEMPLATE);
  let offset = 0;
  for (const line of SPEC_TEMPLATE.split("\n")) {
    const hl = document.createElement("div");
    hl.className = "hl";
    appendLineText(hl, line, offset, comments);
    templateView.append(hl);
    offset += line.length + 1;
  }
}

function setTemplateMode(on: boolean): void {
  paneRaw.dataset.mode = on ? "template" : "raw";
  templateView.hidden = !on;
  raw.hidden = on;
  paneRawTitle.textContent = on ? "Шаблон" : "Сирий текст";
  paneRawLead.textContent = on
    ? "Каркас з 73 диванів. %модель% / кількість — підстав свої. Порожній цех без виробу не лишай живим заголовком."
    : "Вставка з OneDrive. Стисни майже в нуль, трохи відкрий коли треба звірити як було. «Шаблон» — порівняти каркас зі специфікацією.";
  btnTemplate.textContent = on ? "Сирий текст" : "Шаблон";
  btnTemplate.setAttribute("aria-pressed", on ? "true" : "false");
  btnTemplate.title = on
    ? "Повернути сирий текст зліва. Специфікація справа не зміниться."
    : "Показати шаблон зліва, поруч зі специфікацією. Ширина колонки та специфікація не змінюються.";
  fileHint.textContent = on
    ? "Зліва шаблон, справа специфікація. Сирий текст схований, не стертий."
    : `Файл: ${fileName}. Зліва сирий, справа специфікація.`;
}

function applySplit(percent: number, persist = true): void {
  const clamped = Math.min(50, Math.max(8, percent));
  workspace.style.setProperty("--split", `${clamped}%`);
  if (persist) localStorage.setItem(SPLIT_KEY, String(clamped));
  scheduleGutterSync();
}

function splitFromEvent(event: PointerEvent): void {
  const rect = workRow.getBoundingClientRect();
  const vertical = window.matchMedia("(max-width: 720px)").matches;
  const ratio = vertical
    ? (event.clientY - rect.top) / rect.height
    : (event.clientX - rect.left) / rect.width;
  applySplit(ratio * 100);
}

function bindSplitter(): void {
  const saved = Number(localStorage.getItem(SPLIT_KEY));
  if (saved >= 8 && saved <= 50) applySplit(saved);
  else applySplit(18);

  splitter.addEventListener("pointerdown", (event) => {
    splitter.setPointerCapture(event.pointerId);
    workspace.classList.add("is-resizing");
    splitFromEvent(event);
  });
  splitter.addEventListener("pointermove", (event) => {
    if (!splitter.hasPointerCapture(event.pointerId)) return;
    splitFromEvent(event);
  });
  const stop = (event: PointerEvent) => {
    if (splitter.hasPointerCapture(event.pointerId)) {
      splitter.releasePointerCapture(event.pointerId);
    }
    workspace.classList.remove("is-resizing");
  };
  splitter.addEventListener("pointerup", stop);
  splitter.addEventListener("pointercancel", stop);

  splitter.addEventListener("keydown", (event) => {
    const now =
      Number(getComputedStyle(workspace).getPropertyValue("--split").replace("%", "")) || 18;
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      applySplit(now - 3);
    }
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      applySplit(now + 3);
    }
  });
}

function setDock(side: "bottom" | "right"): void {
  workspace.dataset.issues = side;
  localStorage.setItem(DOCK_KEY, side);
  btnDock.textContent = side === "right" ? "Вниз" : "Вправо";
  btnDock.title =
    side === "right"
      ? "Повернути панель помилок під специфікацію"
      : "Перенести панель помилок вправо від специфікації";
}

function bindDock(): void {
  const saved = localStorage.getItem(DOCK_KEY);
  setDock(saved === "bottom" ? "bottom" : "right");
  btnDock.addEventListener("click", () => {
    setDock(workspace.dataset.issues === "right" ? "bottom" : "right");
    const now =
      Number(getComputedStyle(workspace).getPropertyValue("--shop").replace("px", "")) || 280;
    applyShopHeight(now);
    scheduleGutterSync();
  });
}

function isIssuesRight(): boolean {
  return workspace.dataset.issues === "right";
}

function applyIssuesSize(px: number): void {
  const paneMain = issuesSplit.parentElement!;
  const rect = paneMain.getBoundingClientRect();
  const right = isIssuesRight();
  const total = right ? rect.width : rect.height;
  const min = 60;
  const max = Math.max(min, Math.round(total * 0.85));
  const clamped = Math.min(Math.max(Math.round(px), min), max);
  const prop = right ? "--issues" : "--issues-h";
  workspace.style.setProperty(prop, `${clamped}px`);
  localStorage.setItem(ISSUES_H_KEY, String(clamped));
  scheduleGutterSync();
}

function issuesSizeFromEvent(event: PointerEvent): void {
  const paneMain = issuesSplit.parentElement!;
  const rect = paneMain.getBoundingClientRect();
  if (isIssuesRight()) {
    applyIssuesSize(rect.right - event.clientX);
  } else {
    applyIssuesSize(rect.bottom - event.clientY);
  }
}

function bindIssuesSplit(): void {
  const saved = Number(localStorage.getItem(ISSUES_H_KEY));
  if (Number.isFinite(saved) && saved >= 60) {
    const prop = isIssuesRight() ? "--issues" : "--issues-h";
    workspace.style.setProperty(prop, `${saved}px`);
  }

  issuesSplit.addEventListener("pointerdown", (event) => {
    issuesSplit.setPointerCapture(event.pointerId);
    workspace.classList.add("is-issues-resizing");
    issuesSizeFromEvent(event);
  });
  issuesSplit.addEventListener("pointermove", (event) => {
    if (!issuesSplit.hasPointerCapture(event.pointerId)) return;
    issuesSizeFromEvent(event);
  });
  const stop = (event: PointerEvent) => {
    if (issuesSplit.hasPointerCapture(event.pointerId)) {
      issuesSplit.releasePointerCapture(event.pointerId);
    }
    workspace.classList.remove("is-issues-resizing");
  };
  issuesSplit.addEventListener("pointerup", stop);
  issuesSplit.addEventListener("pointercancel", stop);
  issuesSplit.addEventListener("keydown", (event) => {
    const prop = isIssuesRight() ? "--issues" : "--issues-h";
    const cur = parseInt(getComputedStyle(workspace).getPropertyValue(prop)) || 200;
    const grow = isIssuesRight() ? "ArrowRight" : "ArrowUp";
    const shrink = isIssuesRight() ? "ArrowLeft" : "ArrowDown";
    if (event.key === grow) {
      event.preventDefault();
      applyIssuesSize(cur + 24);
    }
    if (event.key === shrink) {
      event.preventDefault();
      applyIssuesSize(cur - 24);
    }
  });
}

function applyShopHeight(px: number): void {
  const rect = workspace.getBoundingClientRect();
  const splitH = shopSplit.offsetHeight || 14;
  const chromeOff = document.body.dataset.chrome === "off";
  const reserve = chromeOff
    ? workspace.dataset.issues === "bottom"
      ? 200
      : 120
    : 200;
  const max = Math.max(80, Math.round(rect.height - splitH - reserve));
  const clamped = Math.min(Math.max(Math.round(px), 80), max);
  workspace.style.setProperty("--shop", `${clamped}px`);
  localStorage.setItem(SHOP_H_KEY, String(clamped));
}

function setShop(open: boolean): void {
  workspace.dataset.shop = open ? "open" : "closed";
  btnShop.textContent = open ? "Згорнути" : "Цех";
  btnShop.title = open ? "Згорнути лінію цехів" : "Показати лінію цехів";
  localStorage.setItem(SHOP_KEY, open ? "open" : "closed");
  if (open) requestAnimationFrame(renderShopNow);
}

function setChrome(on: boolean): void {
  document.body.dataset.chrome = on ? "on" : "off";
  btnChrome.textContent = on ? "Компактно" : "Панелі";
  btnChrome.setAttribute("aria-pressed", on ? "false" : "true");
  btnChrome.title = on
    ? "Сховати хедер, панель дій і сирий текст. Помилки лишаться стисло."
    : "Показати хедер, панель дій і сирий текст.";
  localStorage.setItem(CHROME_KEY, on ? "on" : "off");
  requestAnimationFrame(() => {
    const now =
      Number(getComputedStyle(workspace).getPropertyValue("--shop").replace("px", "")) || 280;
    applyShopHeight(now);
    scheduleGutterSync();
    renderShopNow();
  });
}

function bindShop(): void {
  const savedH = Number(localStorage.getItem(SHOP_H_KEY));
  if (Number.isFinite(savedH) && savedH >= 80) applyShopHeight(savedH);
  setShop(localStorage.getItem(SHOP_KEY) !== "closed");
  setChrome(localStorage.getItem(CHROME_KEY) !== "off");

  btnShop.addEventListener("click", () => {
    setShop(workspace.dataset.shop !== "open");
  });
  btnChrome.addEventListener("click", () => {
    setChrome(document.body.dataset.chrome !== "on");
  });

  shopSplit.addEventListener("pointerdown", (event) => {
    shopSplit.setPointerCapture(event.pointerId);
    workspace.classList.add("is-shop-resizing");
    applyShopHeight(workspace.getBoundingClientRect().bottom - event.clientY);
  });
  shopSplit.addEventListener("pointermove", (event) => {
    if (!shopSplit.hasPointerCapture(event.pointerId)) return;
    applyShopHeight(workspace.getBoundingClientRect().bottom - event.clientY);
  });
  const stop = (event: PointerEvent) => {
    if (shopSplit.hasPointerCapture(event.pointerId)) {
      shopSplit.releasePointerCapture(event.pointerId);
    }
    workspace.classList.remove("is-shop-resizing");
    requestAnimationFrame(renderShopNow);
  };
  shopSplit.addEventListener("pointerup", stop);
  shopSplit.addEventListener("pointercancel", stop);
  shopSplit.addEventListener("keydown", (event) => {
    const now = Number(getComputedStyle(workspace).getPropertyValue("--shop").replace("px", "")) || 280;
    if (event.key === "ArrowUp") {
      event.preventDefault();
      applyShopHeight(now + 24);
      requestAnimationFrame(renderShopNow);
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      applyShopHeight(now - 24);
      requestAnimationFrame(renderShopNow);
    }
  });
}

function setHints(on: boolean): void {
  document.body.dataset.hints = on ? "on" : "off";
  btnHints.setAttribute("aria-pressed", on ? "true" : "false");
  btnHints.title = on ? "Сховати підказки" : "Показати підказки";
  localStorage.setItem(HINTS_KEY, on ? "on" : "off");
}

function bindHints(): void {
  setHints(localStorage.getItem(HINTS_KEY) === "on");
  btnHints.addEventListener("click", () => {
    setHints(document.body.dataset.hints !== "on");
  });
}

btnTemplate.addEventListener("click", () => {
  setTemplateMode(paneRaw.dataset.mode !== "template");
});
btnCheck.addEventListener("click", () => void runFull());
btnRecheckSpec.addEventListener("click", () => void runFromSpec());
btnRewriteAttrs.addEventListener("click", () => runRewriteAttrs());
btnCopy.addEventListener("click", () => void copyText());
btnDownload.addEventListener("click", download);
editor.addEventListener("copy", () => markSpecCopied());
document.addEventListener("keydown", (e) => {
  if (!(e.ctrlKey || e.metaKey)) return;
  if (e.code !== "KeyC" && e.key.toLowerCase() !== "c" && e.key !== "с" && e.key !== "С") return;
  if (document.activeElement !== editor) return;
  markSpecCopied();
});
fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (file) void readFile(file);
  fileInput.value = "";
});

editor.addEventListener("scroll", syncScroll);
editor.addEventListener("click", () => highlightIssuesForLine(lineFromCaret()));
editor.addEventListener("keyup", () => highlightIssuesForLine(lineFromCaret()));
editor.addEventListener("beforeinput", () => {
  if (applyingHistory || typingBurst) return;
  pushUndo(editor.value);
  typingBurst = true;
  window.setTimeout(() => {
    typingBurst = false;
  }, 500);
});
editor.addEventListener("input", onSpecInput);

function bindDrop(el: HTMLElement): void {
  ["dragenter", "dragover"].forEach((ev) => {
    el.addEventListener(ev, (e) => {
      e.preventDefault();
      dropZone.classList.add("drop-active");
    });
  });
  ["dragleave", "drop"].forEach((ev) => {
    el.addEventListener(ev, (e) => {
      e.preventDefault();
      dropZone.classList.remove("drop-active");
    });
  });
  el.addEventListener("drop", (e) => {
    const file = e.dataTransfer?.files[0];
    if (file) void readFile(file);
  });
}

bindDrop(dropZone);
bindDrop(workspace);

document.addEventListener(
  "keydown",
  (e) => {
    if (!modal.hidden) return;
    const mod = e.ctrlKey || e.metaKey;
    if (!mod) {
      if (e.key === "Escape") {
        closeFixes();
        if (document.body.dataset.chrome === "off") setChrome(true);
      }
      return;
    }
    const code = e.code;
    if (code === "Slash" || e.key === "/") {
      if (document.activeElement !== editor) return;
      e.preventDefault();
      toggleEditorComment();
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      void runFull();
      return;
    }
    const undoKey = code === "KeyZ" || e.key.toLowerCase() === "z" || e.key === "я" || e.key === "Я";
    const redoKey = code === "KeyY" || e.key.toLowerCase() === "y" || (undoKey && e.shiftKey);
    if (redoKey && (code === "KeyY" || e.shiftKey)) {
      if (document.activeElement === raw) return;
      e.preventDefault();
      redoSpec();
      return;
    }
    if (undoKey) {
      if (document.activeElement === raw) return;
      e.preventDefault();
      undoSpec();
    }
  },
  true,
);
document.addEventListener("pointerdown", (e) => {
  if (fixPop.hidden) return;
  const t = e.target;
  if (t instanceof Node && (fixPop.contains(t) || (t instanceof Element && t.closest(".bulb")))) {
    return;
  }
  closeFixes();
});

bindSplitter();
bindDock();
bindIssuesSplit();
bindShop();
bindHints();
bindCounts();
setCounts(null);
window.addEventListener("resize", () => {
  const now =
    Number(getComputedStyle(workspace).getPropertyValue("--shop").replace("px", "")) || 280;
  applyShopHeight(now);
  scheduleGutterSync();
});
const paneRo = new ResizeObserver(() => scheduleGutterSync());
paneRo.observe(specCrop);
paneRo.observe(editor);
void document.fonts.ready.then(scheduleGutterSync);
document.fonts.addEventListener("loadingdone", scheduleGutterSync);
raw.addEventListener("input", persistDraft);
renderTemplateView();
if (!restoreDraft()) {
  renderDecorations(editor.value);
  renderShopNow();
} else {
  renderShopNow();
}
