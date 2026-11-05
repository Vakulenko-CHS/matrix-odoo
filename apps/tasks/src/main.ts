import "../../../web/src/styles.css";
import "./tasks.css";
import boardMd from "../BOARD.md?raw";
import ports from "../../../dev/ports.json";
import { parseBoard, type Card, type Column, type ColumnId } from "./board.ts";

const { updated, columns } = parseBoard(boardMd);

const tabsEl = document.getElementById("tabs")!;
const listEl = document.getElementById("list")!;
const metaEl = document.getElementById("meta")!;
const bodyEl = document.getElementById("body")!;
const titleEl = document.getElementById("card-title")!;
const cardMetaEl = document.getElementById("card-meta")!;

metaEl.textContent = `apps/tasks/BOARD.md · ${updated} · npm run tasks · :${ports.tasks} · не Netlify`;

let colId: ColumnId =
  columns.find((c) => c.id === "free" && c.cards.length)?.id ??
  columns.find((c) => c.id === "next" && c.cards.length)?.id ??
  columns.find((c) => c.cards.length)?.id ??
  "free";
let selected: string | null = null;

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
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
      return `<p>${inline(lines.join("<br>"))}</p>`;
    })
    .join("");
}

function inline(s: string): string {
  return escapeHtml(s)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

const COL_LABEL: Record<ColumnId, string> = {
  free: "Вільні",
  doing: "В роботі",
  next: "Далі",
  backlog: "Черга",
  low: "Низький пріоритет",
  log: "Журнал",
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

function show(card: Card | null) {
  selected = card?.id ?? null;
  listEl.querySelectorAll(".task-card.on").forEach((n) => n.classList.remove("on"));
  if (!card) {
    titleEl.textContent = "Картка";
    cardMetaEl.replaceChildren();
    bodyEl.textContent = "Обери рядок зліва.";
    return;
  }
  document.querySelector(`[data-id="${card.id}"]`)?.classList.add("on");
  titleEl.textContent = card.title;
  renderProps(card);
  bodyEl.innerHTML = renderMd(card.body || card.title);
}

function paintList() {
  const c = col();
  listEl.replaceChildren();
  if (!c.cards.length) {
    const p = document.createElement("p");
    p.className = "task-empty";
    p.textContent = c.emptyNote || "Порожня колонка.";
    listEl.appendChild(p);
    show(null);
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
  show(c.cards.find((x) => x.id === selected) ?? c.cards[0]);
}

function paintTabs() {
  tabsEl.replaceChildren();
  for (const c of columns) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = colLabel(c);
    b.title = c.heading;
    b.className = c.id === colId ? "on" : "";
    b.addEventListener("click", () => {
      colId = c.id;
      paintTabs();
      paintList();
    });
    tabsEl.appendChild(b);
  }
}

paintTabs();
paintList();
