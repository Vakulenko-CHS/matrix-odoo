import "../../../web/src/styles.css";
import "./tasks.css";
import boardMd from "../BOARD.md?raw";
import ports from "../../../dev/ports.json";
import { parseBoard, type Card, type Column, type ColumnId } from "./board.ts";
import { extractRepoLinks, hrefToRepoPath, splitRepoHref } from "./repoPaths.ts";
import { bindRepoLinks, mountRepoBrowser, openRepoPath } from "./repoBrowser.ts";

const { updated, columns } = parseBoard(boardMd);

const tabsEl = document.getElementById("tabs")!;
const listEl = document.getElementById("list")!;
const metaEl = document.getElementById("meta")!;
const bodyEl = document.getElementById("body")!;
const titleEl = document.getElementById("card-title")!;
const cardMetaEl = document.getElementById("card-meta")!;
const filesEl = document.getElementById("card-files")!;

mountRepoBrowser();

metaEl.textContent = `apps/tasks/BOARD.md · ${updated} · npm run tasks · :${ports.tasks} · не Netlify · клік по файлу → модалка`;

const LS_TASK = "matrix-tasks-selected-id";
const LS_COL = "matrix-tasks-selected-col";

function defaultColId(): ColumnId {
  return (
    columns.find((c) => c.id === "free" && c.cards.length)?.id ??
    columns.find((c) => c.id === "next" && c.cards.length)?.id ??
    columns.find((c) => c.cards.length)?.id ??
    "free"
  );
}

function findCardById(taskId: string): Card | undefined {
  for (const c of columns) {
    const hit = c.cards.find((x) => x.id === taskId);
    if (hit) return hit;
  }
  return undefined;
}

function tabHasCard(tabId: ColumnId, taskId: string): boolean {
  return columns.find((c) => c.id === tabId)?.cards.some((x) => x.id === taskId) ?? false;
}

function restoreSession(): { colId: ColumnId; selected: string | null; hadSaved: boolean } {
  const savedId = localStorage.getItem(LS_TASK)?.trim();
  if (!savedId) {
    return { colId: defaultColId(), selected: null, hadSaved: false };
  }
  const card = findCardById(savedId);
  if (!card) {
    localStorage.removeItem(LS_TASK);
    localStorage.removeItem(LS_COL);
    return { colId: "free", selected: null, hadSaved: true };
  }
  const savedCol = localStorage.getItem(LS_COL) as ColumnId | null;
  const colId =
    savedCol && tabHasCard(savedCol, savedId)
      ? savedCol
      : tabHasCard("free", savedId)
        ? "free"
        : card.column;
  return { colId, selected: savedId, hadSaved: true };
}

const restored = restoreSession();
let colId: ColumnId = restored.colId;
let selected: string | null = restored.selected;
/** Після reload: не чіпати першу картку, якщо нічого не відновили (новий візит або зникла id). */
let initialPickFirst = restored.hadSaved ? restored.selected !== null : true;

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function cleanLinkLabel(raw: string): string {
  return raw.replace(/`/g, "").replace(/\*\*/g, "").trim();
}

function linkToHtml(rawLabel: string, href: string): string {
  const label = cleanLinkLabel(rawLabel);
  const { hash } = splitRepoHref(href);
  const repoPath = hrefToRepoPath(href);
  if (repoPath) {
    const hashAttr = hash ? ` data-repo-hash="${escapeHtml(hash)}"` : "";
    return `<button type="button" class="repo-link" data-repo-path="${escapeHtml(repoPath)}"${hashAttr}>${escapeHtml(label)}</button>`;
  }
  const { hrefPath } = splitRepoHref(href);
  if (/^https?:\/\//.test(hrefPath)) {
    return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`;
  }
  return escapeHtml(`[${label}](${href})`);
}

function inline(s: string): string {
  const re = /\[([^\]]+)\]\(([^)]+)\)/g;
  let out = "";
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    out += escapeHtml(s.slice(last, m.index));
    out += linkToHtml(m[1], m[2]);
    last = m.index + m[0].length;
  }
  out += escapeHtml(s.slice(last));
  out = out.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/`([^`]+)`/g, "<code>$1</code>");
  return out;
}

function renderMd(raw: string): string {
  const blocks = raw.trim().split(/\n\n+/);
  return blocks
    .map((block) => {
      const lines = block.split("\n");
      if (lines.every((l) => l.startsWith("- "))) {
        const items = lines.map((l) => `<li>${inline(l.slice(2))}</li>`).join("");
        return `<ul>${items}</ul>`;
      }
      if (lines[0]?.startsWith("#### ")) {
        const head = lines[0].slice(5);
        const rest = lines.slice(1).join("\n");
        if (head === "Файли") return "";
        return `<h4>${escapeHtml(head)}</h4>${rest ? renderMd(rest) : ""}`;
      }
      return `<p>${inline(lines.join("<br>"))}</p>`;
    })
    .join("");
}

const COL_LABEL: Record<ColumnId, string> = {
  free: "Вільні",
  doing: "В роботі",
  next: "Далі",
  backlog: "Черга",
  low: "Низький пріоритет",
  log: "Журнал",
  done: "Готово",
};

function colLabel(col: Column): string {
  return `${COL_LABEL[col.id] ?? col.id} ${col.cards.length}`;
}

function col(): Column {
  return columns.find((c) => c.id === colId) ?? columns[0];
}

function bedsLabel(beds: string): string {
  if (beds === "yes") return "так";
  if (beds === "maybe") return "можливо";
  if (beds === "no") return "ні";
  return beds.trim() || "—";
}

function renderFiles(card: Card): void {
  const links = extractRepoLinks(card.body);
  filesEl.replaceChildren();
  if (!links.length) {
    filesEl.hidden = true;
    return;
  }
  filesEl.hidden = false;
  const label = document.createElement("span");
  label.className = "task-files-label";
  label.textContent = "Файли";
  const list = document.createElement("div");
  list.className = "task-files-list";
  for (const { label: text, path, hash } of links) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "task-file-chip";
    b.title = hash ? `${path}#${hash}` : path;
    b.textContent = text;
    b.addEventListener("click", () => void openRepoPath(path, hash));
    list.appendChild(b);
  }
  filesEl.append(label, list);
}

function renderProps(card: Card): void {
  const rows: [string, string][] = [
    ["id", card.id],
    ["колонка", COL_LABEL[card.column] ?? card.column],
  ];
  if (card.prio.trim()) rows.push(["пріоритет", card.prio]);
  if (card.gate.trim()) rows.push(["доступ", card.gate]);
  if (card.beds.trim()) rows.push(["ліжка", bedsLabel(card.beds)]);
  if (card.updated.trim()) rows.push(["оновлено", card.updated]);
  const blocked = card.blocked.trim();
  if (blocked) rows.push(["блокери", blocked === "—" ? "—" : blocked]);
  if (card.note.trim()) rows.push(["нотатка", card.note]);

  cardMetaEl.replaceChildren();
  const table = document.createElement("table");
  table.className = "task-props";
  const tbody = document.createElement("tbody");
  for (const [key, value] of rows) {
    const tr = document.createElement("tr");
    const th = document.createElement("th");
    th.scope = "row";
    th.textContent = key;
    const td = document.createElement("td");
    td.textContent = value;
    tr.append(th, td);
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  cardMetaEl.appendChild(table);
}

function persistSelection(): void {
  if (selected) {
    localStorage.setItem(LS_TASK, selected);
    localStorage.setItem(LS_COL, colId);
  } else {
    localStorage.removeItem(LS_TASK);
    localStorage.removeItem(LS_COL);
  }
}

function show(card: Card | null) {
  selected = card?.id ?? null;
  listEl.querySelectorAll(".task-card.on").forEach((n) => n.classList.remove("on"));
  if (!card) {
    titleEl.textContent = "Картка";
    cardMetaEl.replaceChildren();
    filesEl.replaceChildren();
    filesEl.hidden = true;
    bodyEl.textContent = "Обери рядок зліва.";
    persistSelection();
    paintTabs();
    return;
  }
  document.querySelector(`[data-id="${card.id}"]`)?.classList.add("on");
  titleEl.textContent = card.title;
  renderProps(card);
  renderFiles(card);
  bodyEl.innerHTML = renderMd(card.body || card.title);
  bindRepoLinks(bodyEl);
  persistSelection();
  paintTabs();
}

function paintList(opts?: { pickFirst?: boolean }) {
  const pickFirst = opts?.pickFirst ?? false;
  const c = col();
  const keepOpen = selected ? findCardById(selected) : undefined;
  listEl.replaceChildren();
  if (!c.cards.length) {
    const p = document.createElement("p");
    p.className = "task-empty";
    p.textContent = c.emptyNote || "Порожня колонка.";
    listEl.appendChild(p);
    show(keepOpen ?? null);
    return;
  }
  for (const card of c.cards) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "task-card";
    b.dataset.id = card.id;
    b.title = card.title;
    const id = document.createElement("span");
    id.className = "tid";
    id.textContent = card.id;
    const prio = document.createElement("span");
    prio.className = "tp";
    prio.textContent = card.prio;
    const beds = document.createElement("span");
    beds.className = "tb";
    beds.textContent = card.beds === "yes" ? "ліжка" : card.beds === "maybe" ? "ліжка?" : "";
    const tt = document.createElement("span");
    tt.className = "tt";
    tt.textContent = card.title;
    b.append(id, prio, beds, tt);
    b.addEventListener("click", () => show(card));
    listEl.appendChild(b);
  }
  if (keepOpen) {
    show(keepOpen);
    return;
  }
  show(pickFirst && c.cards[0] ? c.cards[0] : null);
}

function paintTabs() {
  tabsEl.replaceChildren();
  for (const c of columns) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = colLabel(c);
    const openHere = selected ? tabHasCard(c.id, selected) : false;
    b.title = openHere ? `${c.heading} · тут відкрита ${selected}` : c.heading;
    const cls: string[] = [];
    if (c.id === colId) cls.push("on");
    if (openHere) cls.push("has-open");
    b.className = cls.join(" ");
    b.addEventListener("click", () => {
      colId = c.id;
      paintTabs();
      paintList();
      if (selected) persistSelection();
    });
    tabsEl.appendChild(b);
  }
}

paintTabs();
paintList({ pickFirst: initialPickFirst });
initialPickFirst = true;
