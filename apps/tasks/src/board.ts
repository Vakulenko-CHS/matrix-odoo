export type ColumnId =
  | "free"
  | "doing"
  | "todo"
  | "waiting"
  | "backlog"
  | "complete"
  | "canceled"
  | "log";

export type Card = {
  id: string;
  prio: string;
  title: string;
  beds: string;
  gate: string;
  blocked: string;
  created: string;
  updated: string;
  note: string;
  column: ColumnId;
  body: string;
};

export type Column = {
  id: ColumnId;
  heading: string;
  emptyNote: string;
  cards: Card[];
};

const COL_ORDER: ColumnId[] = [
  "free",
  "doing",
  "waiting",
  "todo",
  "backlog",
  "complete",
  "canceled",
  "log",
];

/** Kanban зліва направо: черга → взяти → робимо → фідбек → закрито. */
export const PIPELINE_COLS: ColumnId[] = [
  "backlog",
  "todo",
  "doing",
  "waiting",
  "complete",
  "canceled",
  "log",
];

export function isOpenGate(gate: string): boolean {
  const g = gate.toLowerCase();
  return g === "open" || g.startsWith("вільн") || g === "free" || g === "todo";
}

function gateRedundantWithColumn(card: Card): boolean {
  const g = card.gate.trim().toLowerCase();
  if (!g || g === "—") return true;
  switch (card.column) {
    case "waiting":
      return g === "waiting";
    case "todo":
    case "backlog":
      return isOpenGate(card.gate);
    case "complete":
      return g === "complete" || g === "done";
    case "log":
      return g === "log";
  }
  return false;
}

/** Мітки на картці Kanban — без дублювання pipeline-колонки. */
export function cardTags(card: Card): string[] {
  const tags: string[] = [];
  const p = card.prio.trim();
  if (p) tags.push(p);
  const gate = card.gate.trim();
  if (gate && gate !== "—" && !gateRedundantWithColumn(card)) {
    tags.push(isOpenGate(gate) ? "open" : gate);
  }
  if (card.beds === "yes") tags.push("ліжка");
  else if (card.beds === "maybe") tags.push("ліжка?");
  if (card.blocked.trim() && card.blocked !== "—") tags.push("блокер");
  return tags;
}

function stripMd(s: string): string {
  return s.replace(/\*\*/g, "").replace(/`/g, "").trim();
}

function parseTable(block: string): Record<string, string>[] {
  const lines = block.split("\n").filter((l) => l.startsWith("|"));
  if (lines.length < 2) return [];
  const headers = lines[0]
    .split("|")
    .slice(1, -1)
    .map((h) => h.trim().toLowerCase());
  const rows: Record<string, string>[] = [];
  for (const line of lines.slice(2)) {
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    if (!cells[0] || cells[0].startsWith("-")) continue;
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      row[h] = cells[i] ?? "";
    });
    rows.push(row);
  }
  return rows;
}

function colIdFromHeading(h: string): ColumnId | null {
  const t = h.toLowerCase();
  if (t.includes("doing")) return "doing";
  if (t.includes("waiting")) return "waiting";
  if (t.includes("todo") || t.includes("next")) return "todo";
  if (t.includes("backlog") || t.includes("low")) return "backlog";
  if (t.includes("complete") || t.includes("done")) return "complete";
  if (t.includes("cancel")) return "canceled";
  if (t.includes("log")) return "log";
  return null;
}

function rowToCard(row: Record<string, string>, column: ColumnId): Card {
  const blocked = stripMd(row["блокери"] ?? row["blocked"] ?? "");
  const gate = stripMd(row["gate"] ?? row["доступ"] ?? "");
  return {
    id: stripMd(row["id"] ?? ""),
    prio: stripMd(row["p"] ?? ""),
    title: stripMd(row["назва"] ?? ""),
    beds: stripMd(row["beds"] ?? ""),
    gate,
    blocked,
    created: stripMd(row["створено"] ?? row["created"] ?? row["updated"] ?? ""),
    updated: stripMd(row["updated"] ?? ""),
    note: stripMd(row["нотатка"] ?? ""),
    column,
    body: "",
  };
}

export function parseBoard(md: string): { updated: string; columns: Column[] } {
  const updatedMatch = md.match(/Оновлено:\s*\*\*(.+?)\*\*/);
  const updated = updatedMatch?.[1] ?? "";
  const parts = md.split(/^## /m).slice(1);
  const byCol = new Map<ColumnId, Column>();
  const bodies = new Map<string, string>();

  for (const part of parts) {
    const nl = part.indexOf("\n");
    const heading = (nl === -1 ? part : part.slice(0, nl)).trim();
    const rest = nl === -1 ? "" : part.slice(nl + 1);
    if (heading.startsWith("Картки")) {
      for (const cardPart of rest.split(/^### /m).slice(1)) {
        const cnl = cardPart.indexOf("\n");
        const titleLine = (cnl === -1 ? cardPart : cardPart.slice(0, cnl)).trim();
        const id = titleLine.match(/^(T-[A-Z]+-\d+)/)?.[1];
        if (!id) continue;
        bodies.set(id, cardPart.slice(cnl + 1).trim());
      }
      continue;
    }
    const id = colIdFromHeading(heading);
    if (!id) continue;
    const cards = parseTable(rest).map((r) => rowToCard(r, id));
    const emptyNote = cards.length ? "" : rest.replace(/\|[\s\S]*/, "").trim();
    byCol.set(id, { id, heading, emptyNote, cards });
  }

  const all: Card[] = [];
  for (const col of byCol.values()) {
    for (const c of col.cards) {
      c.body = bodies.get(c.id) ?? "";
      all.push(c);
    }
  }
  const freeCards = all.filter(
    (c) => isOpenGate(c.gate) && c.column !== "log" && c.column !== "complete",
  );
  byCol.set("free", {
    id: "free",
    heading: "Колонка: open (тег)",
    emptyNote: "Немає карток з Gate «open» у робочих колонках.",
    cards: freeCards,
  });

  const columns = COL_ORDER.map((id) => {
    return byCol.get(id) ?? { id, heading: id, emptyNote: "", cards: [] };
  });
  return { updated, columns };
}
