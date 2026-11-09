import "../../../web/src/styles.css";
import "./tasks.css";
import boardMd from "../BOARD.md?raw";
import ports from "../../../dev/ports.json";
import {
  parseBoard,
  PIPELINE_COLS,
  cardTags,
  type Card,
  type ColumnId,
} from "./board.ts";
import { extractRepoLinks, hrefToRepoPath, splitRepoHref } from "./repoPaths.ts";
import { bindRepoLinks, mountRepoBrowser, openRepoPath } from "./repoBrowser.ts";

const { updated, columns } = parseBoard(boardMd);

const kanbanEl = document.getElementById("kanban")!;
const metaEl = document.getElementById("meta")!;
const bodyEl = document.getElementById("body")!;
const titleEl = document.getElementById("card-title")!;
const cardMetaEl = document.getElementById("card-meta")!;
const filesEl = document.getElementById("card-files")!;

mountRepoBrowser();

metaEl.textContent = `apps/tasks/BOARD.md · ${updated} · npm run tasks · :${ports.tasks} · Kanban pipeline · OUTBOUND у BOARD`;

const LS_TASK = "matrix-tasks-selected-id";

const COL_LABEL: Record<ColumnId, string> = {
  free: "Вільні (тег)",
  doing: "В роботі",
  next: "Далі",
  backlog: "Черга",
  low: "Низький",
  log: "Журнал",
  done: "Готово",
};

function findCardById(taskId: string): Card | undefined {
  for (const id of PIPELINE_COLS) {
    const col = columns.find((c) => c.id === id);
    const hit = col?.cards.find((x) => x.id === taskId);
    if (hit) return hit;
  }
  return undefined;
}

function restoreSession(): { selected: string | null; hadSaved: boolean } {
  const savedId = localStorage.getItem(LS_TASK)?.trim();
  if (!savedId) return { selected: null, hadSaved: false };
  if (!findCardById(savedId)) {
    localStorage.removeItem(LS_TASK);
    return { selected: null, hadSaved: true };
  }
  return { selected: savedId, hadSaved: true };
}

const restored = restoreSession();
let selected: string | null = restored.selected;
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
  const rows: [string, string][] = [["id", card.id]];
  if (card.prio.trim()) rows.push(["пріоритет", card.prio]);
  rows.push(["pipeline", COL_LABEL[card.column] ?? card.column]);
  if (card.gate.trim()) rows.push(["доступ", card.gate]);
  if (card.beds.trim()) rows.push(["ліжка", bedsLabel(card.beds)]);
  if (card.created.trim()) rows.push(["створено", card.created]);
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
  if (selected) localStorage.setItem(LS_TASK, selected);
  else localStorage.removeItem(LS_TASK);
}

function show(card: Card | null) {
  selected = card?.id ?? null;
  kanbanEl.querySelectorAll(".task-card.on").forEach((n) => n.classList.remove("on"));
  if (!card) {
    titleEl.textContent = "Картка";
    cardMetaEl.replaceChildren();
    filesEl.replaceChildren();
    filesEl.hidden = true;
    bodyEl.textContent = "Обери картку на дошці.";
    persistSelection();
    return;
  }
  document.querySelector(`[data-id="${card.id}"]`)?.classList.add("on");
  titleEl.textContent = card.title;
  renderProps(card);
  renderFiles(card);
  bodyEl.innerHTML = renderMd(card.body || card.title);
  bindRepoLinks(bodyEl);
  persistSelection();
}

function makeCardButton(card: Card): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "task-card";
  b.dataset.id = card.id;
  b.title = card.title;

  const head = document.createElement("div");
  head.className = "task-card-head";
  const id = document.createElement("span");
  id.className = "tid";
  id.textContent = card.id;
  head.appendChild(id);

  const tagsEl = document.createElement("div");
  tagsEl.className = "task-tags";
  for (const t of cardTags(card)) {
    const sp = document.createElement("span");
    sp.className = `task-tag task-tag--${t.replace(/[^a-zа-яіїєґ0-9?]/gi, "")}`;
    sp.textContent = t;
    tagsEl.appendChild(sp);
  }

  const tt = document.createElement("span");
  tt.className = "tt";
  tt.textContent = card.title;

  const dates = document.createElement("span");
  dates.className = "task-dates";
  const parts: string[] = [];
  if (card.created && card.created !== card.updated) parts.push(`з ${card.created}`);
  if (card.updated) parts.push(`↻ ${card.updated}`);
  dates.textContent = parts.join(" · ");

  b.append(head, tagsEl, tt, dates);
  b.addEventListener("click", () => show(card));
  return b;
}

function paintKanban(opts?: { pickFirst?: boolean }) {
  const pickFirst = opts?.pickFirst ?? false;
  const keepOpen = selected ? findCardById(selected) : undefined;
  kanbanEl.replaceChildren();

  for (const colId of PIPELINE_COLS) {
    const col = columns.find((c) => c.id === colId);
    if (!col) continue;
    const colWrap = document.createElement("div");
    colWrap.className = "task-kanban-col";
    colWrap.dataset.col = colId;

    const head = document.createElement("header");
    head.className = "task-kanban-head";
    head.textContent = `${COL_LABEL[colId] ?? colId} · ${col.cards.length}`;
    colWrap.appendChild(head);

    const list = document.createElement("div");
    list.className = "task-kanban-list";
    if (!col.cards.length) {
      const p = document.createElement("p");
      p.className = "task-empty";
      p.textContent = col.emptyNote || "—";
      list.appendChild(p);
    } else {
      for (const card of col.cards) {
        list.appendChild(makeCardButton(card));
      }
    }
    colWrap.appendChild(list);
    kanbanEl.appendChild(colWrap);
  }

  if (keepOpen) {
    show(keepOpen);
    return;
  }
  if (pickFirst) {
    const first =
      PIPELINE_COLS.map((id) => columns.find((c) => c.id === id)?.cards[0]).find(Boolean) ??
      null;
    show(first ?? null);
    return;
  }
  show(null);
}

paintKanban({ pickFirst: initialPickFirst });
initialPickFirst = true;
