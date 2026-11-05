import "../../../web/src/styles.css";
import "./furniture.css";
import inventory from "../../../furniture/inventory.json";
import { diffLines, splitRows } from "./line-diff.ts";

const files = import.meta.glob("../../../furniture/beds/**/*.md", {
  query: "?raw",
  eager: false,
}) as Record<string, () => Promise<{ default: string } | string>>;

type Item = {
  slug: string;
  name: string;
  hackmd: string;
  status: string;
  progress: string;
};

type View = "plain" | "split" | "unified";

const items = inventory as Item[];
const listEl = document.getElementById("list")!;
const metaEl = document.getElementById("meta")!;
const originalEl = document.getElementById("original")!;
const fixedEl = document.getElementById("fixed")!;
const diffMdEl = document.getElementById("diff-md")!;
const diffNoteEl = document.getElementById("diff-note") as HTMLDetailsElement;
const diffNoteSummary = document.getElementById("diff-note-summary")!;
const btnTextDiff = document.getElementById("btn-text-diff") as HTMLButtonElement;
const btnUnified = document.getElementById("btn-unified") as HTMLButtonElement;
const textDiffOut = document.getElementById("text-diff-out")!;
const gitOut = document.getElementById("git-out")!;
const paneOrig = document.getElementById("pane-orig")!;
const paneFix = document.getElementById("pane-fix")!;
const paneGit = document.getElementById("pane-git")!;
const paneUni = document.getElementById("pane-uni")!;
const colHOrig = document.getElementById("col-h-orig")!;
const colHFix = document.getElementById("col-h-fix")!;
const colHUni = document.getElementById("col-h-uni")!;
const splitView = document.getElementById("split-view")!;

let slug = items[0]?.slug ?? "";
let view: View = "plain";

function slugFromKey(key: string): string | null {
  const m = key.replace(/\\/g, "/").match(/\/furniture\/beds\/([^/]+)\//);
  return m?.[1] ?? null;
}

const slugsWithFixed = new Set<string>();
const slugsWithDiffMd = new Set<string>();
for (const key of Object.keys(files)) {
  const s = slugFromKey(key);
  if (!s) continue;
  if (key.endsWith("/fixed.md")) slugsWithFixed.add(s);
  if (key.endsWith("/DIFF.md")) slugsWithDiffMd.add(s);
}

function fileKey(s: string, name: string): string | undefined {
  const end = `/furniture/beds/${s}/${name}.md`;
  return Object.keys(files).find((k) => k.replace(/\\/g, "/").endsWith(end));
}

async function readFile(key: string | undefined): Promise<string | null> {
  if (!key || !files[key]) return null;
  const mod = await files[key]();
  return typeof mod === "string" ? mod : mod.default;
}

function statusLabel(status: string): string {
  if (status === "etalon") return "еталон";
  if (status === "draft-fixed") return "є fixed";
  return "лише original";
}

function renderList() {
  listEl.replaceChildren();
  for (const it of items) {
    const b = document.createElement("button");
    b.type = "button";
    const hasFix = slugsWithFixed.has(it.slug);
    b.className = [
      it.slug === slug ? "on" : "",
      hasFix ? "has-fixed" : "",
      `st-${it.status.replace(/[^a-z-]/g, "")}`,
    ]
      .filter(Boolean)
      .join(" ");

    const row = document.createElement("span");
    row.className = "furn-card-top";
    const name = document.createElement("span");
    name.className = "furn-name";
    name.textContent = it.name;
    const badge = document.createElement("span");
    badge.className = `furn-badge furn-badge--${it.status}`;
    badge.textContent = statusLabel(it.status);
    row.append(name, badge);

    const st = document.createElement("span");
    st.className = "st";
    st.textContent = it.slug;

    b.append(row, st);
    b.addEventListener("click", () => {
      slug = it.slug;
      renderList();
      void load();
    });
    listEl.appendChild(b);
  }
}

function cell(text: string, kind: string): HTMLDivElement {
  const el = document.createElement("div");
  el.className = `git-cell git-cell--${kind} ${
    kind === "del" ? "diff-line--del" : kind === "add" ? "diff-line--add" : kind === "same" ? "diff-line--same" : ""
  }`.trim();
  el.textContent = text.length ? text : "\u00a0";
  return el;
}

function fillDiffs(orig: string | null, fix: string | null) {
  gitOut.replaceChildren();
  textDiffOut.replaceChildren();
  if (!orig || !fix) {
    const msg = "Потрібні обидва файли для текстового diff.";
    gitOut.textContent = msg;
    textDiffOut.textContent = msg;
    return;
  }
  const lines = diffLines(orig, fix);
  for (const row of splitRows(lines)) {
    const wrap = document.createElement("div");
    wrap.className = "git-row";
    wrap.append(cell(row.left, row.leftKind), cell(row.right, row.rightKind));
    gitOut.appendChild(wrap);
  }
  for (const line of lines) {
    const row = document.createElement("div");
    row.className = `diff-line diff-line--${line.kind}`;
    row.textContent =
      (line.kind === "del" ? "− " : line.kind === "add" ? "+ " : "  ") + line.text;
    textDiffOut.appendChild(row);
  }
}

function setDiffNoteEnabled(on: boolean) {
  diffNoteEl.classList.toggle("is-off", !on);
  diffNoteEl.toggleAttribute("aria-disabled", !on);
  diffNoteEl.inert = !on;
  if (!on) diffNoteEl.open = false;
  diffNoteSummary.tabIndex = on ? 0 : -1;
}

function setDiffButtonsEnabled(on: boolean) {
  btnTextDiff.disabled = !on;
  btnUnified.disabled = !on;
  btnTextDiff.title = on ? "" : "немає fixed.md";
  btnUnified.title = on ? "" : "немає fixed.md";
  if (!on && view !== "plain") {
    view = "plain";
  }
}

function applyView() {
  const split = view === "split";
  const uni = view === "unified";
  paneOrig.hidden = split || uni;
  paneFix.hidden = split || uni;
  colHOrig.hidden = uni;
  colHFix.hidden = uni;
  paneGit.hidden = !split;
  paneUni.hidden = !uni;
  colHUni.hidden = !uni;
  splitView.classList.toggle("furn-grid--unified", uni);
  const diffOn = view !== "plain";
  btnTextDiff.classList.toggle("on", diffOn);
  btnUnified.classList.toggle("on", uni);
  btnTextDiff.setAttribute("aria-pressed", diffOn ? "true" : "false");
  btnUnified.setAttribute("aria-pressed", uni ? "true" : "false");
}

async function load() {
  const it = items.find((x) => x.slug === slug);
  if (!it) {
    originalEl.textContent = "немає";
    fixedEl.textContent = "";
    fillDiffs(null, null);
    setDiffNoteEnabled(false);
    setDiffButtonsEnabled(false);
    applyView();
    return;
  }
  metaEl.innerHTML = `${it.name} · <a href="${it.hackmd}" target="_blank" rel="noreferrer">HackMD</a> · <code>furniture/beds/${it.slug}/</code>`;

  const [orig, fix, diffMd] = await Promise.all([
    readFile(fileKey(slug, "original")),
    readFile(fileKey(slug, "fixed")),
    readFile(fileKey(slug, "DIFF")),
  ]);

  originalEl.textContent = orig ?? "немає original.md";
  fixedEl.textContent = fix ?? "— (fixed.md ще немає)";

  const hasDiffMd = Boolean(diffMd?.trim());
  diffMdEl.textContent = hasDiffMd ? diffMd! : "немає DIFF.md";
  setDiffNoteEnabled(hasDiffMd);
  setDiffButtonsEnabled(Boolean(orig && fix));

  fillDiffs(orig, fix);
  applyView();
}

diffNoteEl.addEventListener("toggle", () => {
  if (diffNoteEl.classList.contains("is-off")) diffNoteEl.open = false;
});

btnTextDiff.addEventListener("click", () => {
  if (btnTextDiff.disabled) return;
  view = view === "plain" ? "split" : "plain";
  applyView();
});

btnUnified.addEventListener("click", () => {
  if (btnUnified.disabled) return;
  view = view === "unified" ? "split" : "unified";
  applyView();
});

applyView();
renderList();
void load();
