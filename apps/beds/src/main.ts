import "../../../web/src/styles.css";
import "./lined-doc.css";
import "./furniture.css";
import inventory from "../../../furniture/inventory.json";
import {
  bedVersionFile,
  bedVersions,
  latestBedVersion,
  type BedVersionId,
  type BedVersionOpt,
} from "./bed-versions.ts";
import { createLinedPane } from "./lined-doc.ts";
import { mountSplitDiff, mountUnifiedDiff } from "./diff-view.ts";

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
  vadim_review?: string;
  vadim_approved?: boolean;
};

type View = "plain" | "split" | "unified";

const items = inventory as Item[];
const listEl = document.getElementById("list")!;
const metaEl = document.getElementById("meta")!;
const paneOrig = document.getElementById("pane-orig")!;
const paneFix = document.getElementById("pane-fix")!;
const diffMdHost = document.getElementById("diff-md-host")!;
const diffNoteEl = document.getElementById("diff-note") as HTMLDetailsElement;
const diffNoteSummary = document.getElementById("diff-note-summary")!;
const btnTextDiff = document.getElementById("btn-text-diff") as HTMLButtonElement;
const btnUnified = document.getElementById("btn-unified") as HTMLButtonElement;
const gitOutLeft = document.getElementById("git-out-left")!;
const gitOutRight = document.getElementById("git-out-right")!;
const uniOut = document.getElementById("uni-out")!;
const paneGit = document.getElementById("pane-git")!;
const paneUni = document.getElementById("pane-uni")!;
const colHOrig = document.getElementById("col-h-orig")!;
const colHFix = document.getElementById("col-h-fix")!;
const colHUni = document.getElementById("col-h-uni")!;
const splitView = document.getElementById("split-view")!;
const selLeft = document.getElementById("sel-left") as HTMLSelectElement;
const selRight = document.getElementById("sel-right") as HTMLSelectElement;

const leftView = createLinedPane(paneOrig, "original");
const rightView = createLinedPane(paneFix, "fixed");
const diffMdView = createLinedPane(diffMdHost, "diff-md");
diffMdHost.classList.add("lined-host--compact");
const splitDiff = mountSplitDiff(gitOutLeft, gitOutRight);
const unifiedDiff = mountUnifiedDiff(uniOut);

let slug = items[0]?.slug ?? "";
let view: View = "plain";
let leftId: BedVersionId = "original";
let rightId: BedVersionId = "upd-1";
let versionOpts: BedVersionOpt[] = [];

function slugFromKey(key: string): string | null {
  const m = key.replace(/\\/g, "/").match(/\/furniture\/beds\/([^/]+)\//);
  return m?.[1] ?? null;
}

const slugsWithFixed = new Set<string>();
const slugsWithUpd1 = new Set<string>();
const slugsWithDiffMd = new Set<string>();
for (const key of Object.keys(files)) {
  const s = slugFromKey(key);
  if (!s) continue;
  if (key.endsWith("/fixed.md")) slugsWithFixed.add(s);
  if (key.endsWith("/upd-1.md")) slugsWithUpd1.add(s);
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

function hasOriginal(s: string): boolean {
  return Boolean(fileKey(s, "original"));
}

function versionListFor(it: Item): BedVersionOpt[] {
  return bedVersions(it.vadim_review, {
    original: hasOriginal(it.slug),
    upd1Snap: slugsWithUpd1.has(it.slug),
    fixed: slugsWithFixed.has(it.slug),
  });
}

function fillSelect(el: HTMLSelectElement, opts: BedVersionOpt[], value: BedVersionId) {
  el.replaceChildren();
  for (const o of opts) {
    const opt = document.createElement("option");
    opt.value = o.id;
    opt.textContent = o.label;
    el.appendChild(opt);
  }
  el.disabled = opts.length === 0;
  if (opts.some((o) => o.id === value)) el.value = value;
  else if (opts[0]) el.value = opts[0].id;
}

function statusLabel(status: string): string {
  if (status === "etalon") return "еталон";
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

    const card = document.createElement("span");
    card.className = "furn-card";
    const name = document.createElement("span");
    name.className = "furn-name";
    name.textContent = it.name;
    const st = document.createElement("span");
    st.className = "st";
    st.textContent = it.slug;
    const slotUpd = document.createElement("span");
    slotUpd.className = "furn-badge-slot furn-badge-slot--upd";
    const slotExtra = document.createElement("span");
    slotExtra.className = "furn-badge-slot furn-badge-slot--extra";
    if (it.status === "etalon") {
      const badge = document.createElement("span");
      badge.className = "furn-badge furn-badge--etalon";
      badge.textContent = statusLabel(it.status);
      slotExtra.append(badge);
    }
    if (it.vadim_approved) {
      const ap = document.createElement("span");
      ap.className = "furn-badge furn-badge--approved";
      ap.textContent = "апрув";
      slotExtra.append(ap);
    }
    if (it.vadim_review === "upd-1" || it.vadim_review === "upd-2") {
      const rv = document.createElement("span");
      rv.className = `furn-badge furn-badge--${it.vadim_review}`;
      rv.textContent = it.vadim_review === "upd-2" ? "upd 2" : "upd 1";
      slotUpd.append(rv);
    } else if (it.status !== "draft-fixed" && it.status !== "etalon") {
      const badge = document.createElement("span");
      badge.className = `furn-badge furn-badge--${it.status}`;
      badge.textContent = statusLabel(it.status);
      slotExtra.append(badge);
    }
    card.append(name, slotUpd, st, slotExtra);
    b.append(card);
    b.addEventListener("click", () => {
      slug = it.slug;
      leftId = "original";
      rightId = latestBedVersion(versionListFor(it));
      renderList();
      void load();
    });
    listEl.appendChild(b);
  }
}

function setDiffNoteEnabled(on: boolean) {
  diffNoteEl.classList.toggle("is-off", !on);
  diffNoteEl.toggleAttribute("aria-disabled", !on);
  diffNoteEl.inert = !on;
  if (!on) diffNoteEl.open = false;
  else diffNoteEl.open = true;
  diffNoteSummary.tabIndex = on ? 0 : -1;
}

function setDiffButtonsEnabled(on: boolean) {
  btnTextDiff.disabled = !on;
  btnUnified.disabled = !on;
  btnTextDiff.title = on ? "" : "потрібні дві різні версії";
  btnUnified.title = on ? "" : "потрібні дві різні версії";
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

async function readVersion(s: string, opts: BedVersionOpt[], id: BedVersionId): Promise<string | null> {
  const base = bedVersionFile(opts, id);
  if (!base) return null;
  return readFile(fileKey(s, base));
}

async function load() {
  const it = items.find((x) => x.slug === slug);
  if (!it) {
    versionOpts = [];
    leftView.setText("немає");
    rightView.setText("");
    splitDiff.render(null, null);
    unifiedDiff.render(null, null);
    setDiffNoteEnabled(false);
    setDiffButtonsEnabled(false);
    fillSelect(selLeft, [], leftId);
    fillSelect(selRight, [], rightId);
    applyView();
    return;
  }

  versionOpts = versionListFor(it);
  if (!versionOpts.some((o) => o.id === leftId)) leftId = "original";
  if (!versionOpts.some((o) => o.id === rightId)) {
    rightId = latestBedVersion(versionOpts);
  }
  fillSelect(selLeft, versionOpts, leftId);
  fillSelect(selRight, versionOpts, rightId);
  leftId = selLeft.value as BedVersionId;
  rightId = selRight.value as BedVersionId;

  metaEl.innerHTML = `${it.name} · <a href="${it.hackmd}" target="_blank" rel="noreferrer">HackMD</a> · <code>furniture/beds/${it.slug}/</code>`;

  const [leftText, rightText, diffMd] = await Promise.all([
    readVersion(slug, versionOpts, leftId),
    readVersion(slug, versionOpts, rightId),
    readFile(fileKey(slug, "DIFF")),
  ]);

  const miss = (id: BedVersionId) => `— (немає файлу для ${id})`;
  leftView.setText(leftText ?? miss(leftId));
  rightView.setText(rightText ?? miss(rightId));

  const hasDiffMd = Boolean(diffMd?.trim());
  diffMdView.setText(hasDiffMd ? diffMd! : "немає DIFF.md");
  setDiffNoteEnabled(hasDiffMd);

  const canDiff = Boolean(leftText && rightText && versionOpts.length >= 2);
  setDiffButtonsEnabled(canDiff);

  splitDiff.render(leftText, rightText);
  unifiedDiff.render(leftText, rightText);
  applyView();
}

function onVersionPick() {
  leftId = selLeft.value as BedVersionId;
  rightId = selRight.value as BedVersionId;
  void load();
}

selLeft.addEventListener("change", onVersionPick);
selRight.addEventListener("change", onVersionPick);

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

{
  const first = items.find((x) => x.slug === slug) ?? items[0];
  if (first) {
    slug = first.slug;
    leftId = "original";
    rightId = latestBedVersion(versionListFor(first));
  }
}

applyView();
renderList();
void load();