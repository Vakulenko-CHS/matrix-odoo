import {
  buildShopGraph,
  nodeKindOf,
  type ShopBom,
  type ShopGraph,
  type ShopNode,
  type ShopWorkshop,
} from "./shop-graph";
import type { UiIssue } from "./pipeline";
import { scrollChildIntoView } from "./scroll";

export interface ShopHandle {
  render(text: string, issues: UiIssue[]): UiIssue[];
  highlightLine(line: number | null): void;
  destroy(): void;
}

const KIND_MARK: Record<string, string> = {
  blocking: "блок",
  error: "помилка",
  warning: "увага",
  auto: "авто",
};

const COL_FAMILIES = [
  ["1", "2", "3"],
  ["4", "5", "7"],
  ["6", "9-1", "8"],
  ["9", "10"],
];

interface ShopFamily {
  id: string;
  column: number;
  title: string;
  shops: ShopWorkshop[];
}

function parseShopNo(key: string): { major: number; minor: number; token: string } {
  const m = key.match(/№\s*(\d+)(?:-(\d+))?/u);
  if (!m) return { major: 99, minor: 0, token: key };
  const major = Number(m[1]);
  const minor = m[2] ? Number(m[2]) : 0;
  return {
    major,
    minor,
    token: m[2] ? `${major}-${minor}` : String(major),
  };
}

function familyIdOf(shop: ShopWorkshop): string {
  const p = parseShopNo(shop.key);
  if (p.major === 9 && p.minor === 1) return "9-1";
  if (p.major === 99) return p.token;
  return String(p.major);
}

function columnOf(family: string): number {
  for (let i = 0; i < COL_FAMILIES.length; i++) {
    if (COL_FAMILIES[i].includes(family)) return i;
  }
  return 3;
}

function groupFamilies(shops: ShopWorkshop[]): ShopFamily[][] {
  const bags = new Map<string, ShopWorkshop[]>();
  for (const shop of shops) {
    const id = familyIdOf(shop);
    const list = bags.get(id) ?? [];
    list.push(shop);
    bags.set(id, list);
  }

  const cols: ShopFamily[][] = [[], [], [], []];
  const placed = new Set<string>();

  const make = (id: string): ShopFamily => {
    const group = bags.get(id) ?? [];
    placed.add(id);
    const first = group[0];
    return {
      id,
      column: columnOf(id),
      title: id === "9-1" ? (first?.title ?? "Цех №9-1") : `Цех №${id}`,
      shops: group,
    };
  };

  for (let c = 0; c < 4; c++) {
    for (const id of COL_FAMILIES[c]) {
      if (bags.has(id)) cols[c].push(make(id));
    }
  }
  for (const id of bags.keys()) {
    if (placed.has(id)) continue;
    cols[columnOf(id)].push(make(id));
  }
  return cols;
}

function ticketTitle(node: ShopNode): string {
  const bits = [node.label];
  if (node.productId) bits.push(node.productId);
  if (node.qty) bits.push(node.qty);
  if (node.issues[0]) bits.push(node.issues[0].message);
  bits.push(`ряд. ${node.line}`);
  return bits.join(" · ");
}

function issueBadge(issues: UiIssue[]): HTMLElement | null {
  const kind = nodeKindOf(issues);
  if (!kind || kind === "auto") return null;
  const el = document.createElement("span");
  el.className = `shop-badge kind-${kind}`;
  el.textContent = KIND_MARK[kind] ?? kind;
  return el;
}

function portEl(node: ShopNode, side: "in" | "out"): HTMLElement {
  const port = document.createElement("span");
  port.className = `shop-port shop-port-${side}`;
  port.dataset.node = node.id;
  port.dataset.side = side;
  return port;
}

function ticketEl(node: ShopNode, onJump: (line: number) => void): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = `shop-ticket shop-${node.kind}`;
  btn.dataset.node = node.id;
  btn.dataset.line = String(node.line);
  const kind = nodeKindOf(node.issues);
  if (kind) btn.dataset.kind = kind;
  btn.title = ticketTitle(node);
  btn.setAttribute(
    "aria-label",
    `${node.kind === "output" ? "З’явився" : node.kind === "input" ? "Прийшов" : "Сировина"}: ${node.label}, рядок ${node.line}`,
  );

  if (node.kind === "input") btn.append(portEl(node, "in"));

  const name = document.createElement("span");
  name.className = "shop-ticket-name";
  name.textContent = node.label;
  btn.append(name);

  if (node.productId || node.qty) {
    const meta = document.createElement("span");
    meta.className = "shop-ticket-meta";
    meta.textContent = [node.productId, node.qty].filter(Boolean).join(" · ");
    btn.append(meta);
  }

  const badge = issueBadge(node.issues);
  if (badge) btn.append(badge);

  if (node.kind === "output") btn.append(portEl(node, "out"));

  btn.addEventListener("click", (event) => {
    event.stopPropagation();
    onJump(node.line);
  });
  return btn;
}

function bomBlock(bom: ShopBom, onJump: (line: number) => void): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "shop-bom";
  wrap.dataset.line = String(bom.output.line);
  const kind = nodeKindOf(bom.output.issues);
  if (kind) wrap.dataset.kind = kind;

  wrap.append(ticketEl(bom.output, onJump));

  const children: HTMLElement[] = [];
  for (const input of bom.inputs) children.push(ticketEl(input, onJump));
  const mats = bom.materials.slice(0, 6);
  for (const mat of mats) children.push(ticketEl(mat, onJump));
  if (bom.materials.length > 6) {
    const more = document.createElement("span");
    more.className = "shop-more";
    more.textContent = `+${bom.materials.length - 6}`;
    children.push(more);
  }

  children.forEach((el, i) => {
    el.classList.add("shop-bom-child");
    if (i === children.length - 1) el.classList.add("shop-bom-last");
    wrap.append(el);
  });

  return wrap;
}

function sectionEl(shop: ShopWorkshop, onJump: (line: number) => void): HTMLElement {
  const sec = document.createElement("div");
  sec.className = "shop-sec";
  sec.dataset.workshop = shop.key;
  sec.dataset.line = String(shop.line);
  const kind = nodeKindOf(shop.issues);
  if (kind) sec.dataset.kind = kind;

  const head = document.createElement("button");
  head.type = "button";
  head.className = "shop-sec-head";
  const no = shop.title.replace(/^Цех\s*/u, "");
  const bits = [no];
  if (shop.subtitle) bits.push(shop.subtitle);
  if (shop.code) bits.push(shop.code);
  head.textContent = bits.join(" · ");
  head.title = `${shop.title} ${shop.subtitle} · ряд. ${shop.line}`;
  head.addEventListener("click", () => onJump(shop.line));
  const badge = issueBadge(shop.issues);
  if (badge) head.append(badge);
  sec.append(head);

  if (shop.boms.length === 0) {
    const empty = document.createElement("p");
    empty.className = "shop-station-empty";
    empty.textContent = "Немає виробу";
    sec.append(empty);
  } else {
    for (const bom of shop.boms) sec.append(bomBlock(bom, onJump));
  }
  return sec;
}

function familyEl(family: ShopFamily, onJump: (line: number) => void): HTMLElement {
  const node = document.createElement("section");
  node.className = "shop-node";
  node.dataset.family = family.id;
  const kinds = family.shops.flatMap((s) => s.issues);
  const kind = nodeKindOf(kinds);
  if (kind) node.dataset.kind = kind;

  const head = document.createElement("h3");
  head.className = "shop-node-head";
  head.textContent = family.title;
  node.append(head);
  for (const shop of family.shops) node.append(sectionEl(shop, onJump));
  return node;
}

function emptyState(): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "shop-empty";
  wrap.innerHTML =
    "<p>Немає цехів у тексті справа.</p><p>Встав сирий зліва і натисни «Перевірити» — тут стане лінія цехів.</p>";
  return wrap;
}

function anchorPort(
  root: HTMLElement,
  nodeId: string,
  side: "in" | "out",
): { x: number; y: number } | null {
  const port =
    root.querySelector(`.shop-port-${side}[data-node="${CSS.escape(nodeId)}"]`) ??
    root.querySelector(`[data-node="${CSS.escape(nodeId)}"]`);
  if (!port) return null;
  const rr = root.getBoundingClientRect();
  const nr = port.getBoundingClientRect();
  return {
    x: nr.left + nr.width / 2 - rr.left,
    y: nr.top + nr.height / 2 - rr.top,
  };
}

function curvePath(
  a: { x: number; y: number },
  b: { x: number; y: number },
  rank: number,
  count: number,
  forcedLaneX?: number,
): string {
  const dx = b.x - a.x;
  const ax = a.x.toFixed(1);
  const ay = a.y.toFixed(1);
  const bx = b.x.toFixed(1);
  const by = b.y.toFixed(1);
  if (dx < 24) {
    const k = 28 + rank * 8;
    return `M ${ax} ${ay} C ${(a.x + k).toFixed(1)} ${ay}, ${(b.x - k).toFixed(1)} ${by}, ${bx} ${by}`;
  }
  const n = Math.max(count, 1);
  const h = Math.min(32, Math.max(16, dx * 0.12));
  const left = a.x + h;
  const right = b.x - h;
  const laneX =
    forcedLaneX !== undefined
      ? Math.max(left, Math.min(right, forcedLaneX))
      : left + Math.max(right - left, 1) * ((rank + 1) / (n + 1));
  const midY = (a.y + b.y) / 2;
  return (
    `M ${ax} ${ay} ` +
    `C ${(a.x + h).toFixed(1)} ${ay}, ${laneX.toFixed(1)} ${ay}, ${laneX.toFixed(1)} ${midY.toFixed(1)} ` +
    `S ${(b.x - h).toFixed(1)} ${by}, ${bx} ${by}`
  );
}

function gutterKey(a: { x: number }, b: { x: number }): string {
  return `${Math.round(a.x / 72)}>${Math.round(b.x / 72)}`;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function hitClone(src: SVGPathElement): SVGPathElement {
  const hit = src.cloneNode(true) as SVGPathElement;
  hit.setAttribute("class", "shop-route-hit");
  hit.removeAttribute("aria-label");
  return hit;
}

function drawRoutes(
  svg: SVGSVGElement,
  overlay: SVGSVGElement,
  graph: ShopGraph,
  canvas: HTMLElement,
): void {
  svg.replaceChildren();
  overlay.replaceChildren();
  const w = Math.max(canvas.scrollWidth, canvas.clientWidth);
  const h = Math.max(canvas.scrollHeight, canvas.clientHeight);
  for (const layer of [svg, overlay]) {
    layer.setAttribute("viewBox", `0 0 ${w} ${h}`);
    layer.setAttribute("width", String(w));
    layer.setAttribute("height", String(h));
    layer.style.width = `${w}px`;
    layer.style.height = `${h}px`;
  }

  const ns = "http://www.w3.org/2000/svg";
  const planned: Array<{
    edge: (typeof graph.edges)[number];
    from: { x: number; y: number };
    to: { x: number; y: number };
  }> = [];
  const appendPath = (
    edge: (typeof graph.edges)[number],
    from: { x: number; y: number },
    to: { x: number; y: number },
    rank: number,
    count: number,
    forcedLaneX?: number,
  ): void => {
    const pathDef = curvePath(from, to, rank, count, forcedLaneX);
    const makePath = (...extraClasses: string[]): SVGPathElement => {
      const path = document.createElementNS(ns, "path");
      path.dataset.edge = edge.id;
      if (edge.fromId) path.dataset.from = edge.fromId;
      if (edge.toId) path.dataset.to = edge.toId;
      path.classList.add("shop-route", `is-${edge.status}`, ...extraClasses);
      if (edge.issues.length) path.classList.add("has-issue");
      if (edge.status === "orphan" || edge.status === "break") {
        path.classList.add("shop-nub");
      }
      path.setAttribute("d", pathDef);
      if (edge.issues[0]) path.setAttribute("aria-label", edge.issues[0].message);
      return path;
    };
    const vis = makePath();
    svg.append(vis);
    svg.append(hitClone(vis));
    overlay.append(makePath("shop-route-ghost"));
  };

  for (const edge of graph.edges) {
    const from = edge.fromId ? anchorPort(canvas, edge.fromId, "out") : null;
    const to = edge.toId ? anchorPort(canvas, edge.toId, "in") : null;
    if (edge.status === "orphan" && from) {
      planned.push({ edge, from, to: { x: from.x + 36, y: from.y } });
    } else if (edge.status === "break" && to) {
      planned.push({ edge, from: { x: to.x - 36, y: to.y }, to });
    } else if (from && to) {
      planned.push({ edge, from, to });
    }
  }

  const groups = new Map<string, typeof planned>();
  for (const item of planned) {
    const key = gutterKey(item.from, item.to);
    const list = groups.get(key) ?? [];
    list.push(item);
    groups.set(key, list);
  }
  for (const list of groups.values()) {
    list.sort((a, b) => a.from.y + a.to.y - (b.from.y + b.to.y) || a.from.y - b.from.y);
  }

  for (const list of groups.values()) {
    const byTarget = new Map<string, typeof list>();
    for (const item of list) {
      const key =
        item.edge.status === "ok" && item.edge.toId
          ? item.edge.toId
          : `solo:${item.edge.id}`;
      const pack = byTarget.get(key) ?? [];
      pack.push(item);
      byTarget.set(key, pack);
    }
    const packs = [...byTarget.values()].sort(
      (a, b) =>
        a[0].to.y - b[0].to.y ||
        a.reduce((sum, item) => sum + item.from.y, 0) / a.length -
          b.reduce((sum, item) => sum + item.from.y, 0) / b.length,
    );
    const leftEdge = Math.min(...list.map((item) => item.from.x)) + 22;
    const rightEdge = Math.max(...list.map((item) => item.to.x)) - 22;
    const laneSpan = Math.max(rightEdge - leftEdge, 1);
    for (const [packIndex, pack] of packs.entries()) {
      const laneX = leftEdge + laneSpan * ((packIndex + 1) / (packs.length + 1));
      if (pack.length < 2 || !pack[0].edge.toId) {
        pack.forEach((item, rank) =>
          appendPath(item.edge, item.from, item.to, rank, pack.length, laneX),
        );
        continue;
      }
      const target = pack[0].to;
      const sourceX = Math.max(...pack.map((item) => item.from.x));
      const mergePoint = {
        x: clamp(laneX, sourceX + 18, target.x - 28),
        y: pack.reduce((sum, item) => sum + item.from.y, 0) / pack.length,
      };
      pack.forEach((item, rank) =>
        appendPath(item.edge, item.from, mergePoint, rank, pack.length, laneX),
      );

      const trunkPath = curvePath(mergePoint, target, 0, 1, laneX);
      for (const [layer, extraClass] of [
        [svg, ""],
        [overlay, "shop-route-ghost"],
      ] as const) {
        const trunk = document.createElementNS(ns, "path");
        trunk.dataset.edge = `trunk:${pack[0].edge.toId}`;
        trunk.dataset.to = pack[0].edge.toId;
        trunk.classList.add("shop-route", `is-${pack[0].edge.status}`, "shop-route-trunk");
        if (extraClass) trunk.classList.add(extraClass);
        trunk.setAttribute("d", trunkPath);
        layer.append(trunk);
        if (layer === svg) layer.append(hitClone(trunk));
      }

      const dot = document.createElementNS(ns, "circle");
      dot.classList.add("shop-route-join", `is-${pack[0].edge.status}`);
      dot.setAttribute("cx", mergePoint.x.toFixed(1));
      dot.setAttribute("cy", mergePoint.y.toFixed(1));
      dot.setAttribute("r", "3");
      svg.append(dot);
    }
  }
}

export function mountShop(
  board: HTMLElement,
  opts: { onJump: (line: number) => void; onClearFocus?: () => void; onActiveLegend?: (key: string | null) => void },
): ShopHandle {
  let graph: ShopGraph | null = null;
  let activeLine: number | null = null;
  let activeEdgeKey: string | null = null;
  let keepEdge = false;
  let drawTimer = 0;

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.classList.add("shop-routes");
  svg.setAttribute("aria-hidden", "true");
  const overlay = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  overlay.classList.add("shop-routes", "shop-routes-overlay");
  overlay.setAttribute("aria-hidden", "true");
  const lanes = document.createElement("div");
  lanes.className = "shop-lanes";
  const canvas = document.createElement("div");
  canvas.className = "shop-canvas";
  canvas.append(svg, lanes, overlay);
  board.replaceChildren(canvas);

  const scheduleDraw = () => {
    window.clearTimeout(drawTimer);
    drawTimer = window.setTimeout(() => {
      if (graph) {
        drawRoutes(svg, overlay, graph, canvas);
        applyActive();
      }
    }, 16);
  };

  const applyActive = () => {
    for (const el of board.querySelectorAll(
      ".shop-ticket.active, .shop-sec-head.active, .shop-route.active",
    )) {
      el.classList.remove("active");
    }
    if (!graph) return;
    let focus: HTMLElement | null = null;

    const activateTicket = (nodeId: string) => {
      const el = board.querySelector(`.shop-ticket[data-node="${CSS.escape(nodeId)}"]`);
      if (el instanceof HTMLElement) {
        el.classList.add("active");
        focus ??= el;
      }
    };

    if (activeEdgeKey) {
      for (const route of board.querySelectorAll(activeEdgeKey)) {
        route.classList.add("active");
        if (!(route instanceof SVGPathElement)) continue;
        if (route.dataset.from) activateTicket(route.dataset.from);
        if (route.dataset.to) {
          activateTicket(route.dataset.to);
          if (!route.classList.contains("shop-route-trunk")) {
            for (const trunk of board.querySelectorAll(
              `.shop-route-trunk[data-to="${CSS.escape(route.dataset.to)}"]`,
            )) {
              trunk.classList.add("active");
            }
          }
        }
      }
    }

    if (activeLine) {
      for (const node of graph.nodes) {
        if (node.line !== activeLine) continue;
        activateTicket(node.id);
        if (!activeEdgeKey) {
          for (const edge of graph.edges) {
            if (edge.fromId === node.id || edge.toId === node.id) {
              for (const route of board.querySelectorAll(
                `[data-edge="${CSS.escape(edge.id)}"]`,
              )) {
                route.classList.add("active");
              }
            }
          }
        }
      }
      const shop = graph.workshops.find((w) => w.line === activeLine);
      if (shop) {
        const head = board.querySelector(
          `[data-workshop="${CSS.escape(shop.key)}"] .shop-sec-head`,
        );
        if (head instanceof HTMLElement) {
          head.classList.add("active");
          focus ??= head;
        }
      }
    }

    if ((activeLine || activeEdgeKey) && focus) {
      scrollChildIntoView(board, focus, "nearest");
    }

    if (opts.onActiveLegend) {
      let legendKey: string | null = null;
      if (activeEdgeKey) {
        const route = board.querySelector<SVGPathElement>(
          `${activeEdgeKey}.shop-route:not(.shop-route-ghost)`,
        );
        if (route) {
          for (const cls of route.classList) {
            if (/^is-(ok|mismatch|break|orphan)$/.test(cls)) { legendKey = cls.slice(3); break; }
          }
        }
      } else if (activeLine) {
        const ticket = board.querySelector<HTMLElement>(".shop-ticket.active");
        if (ticket) {
          if (ticket.classList.contains("shop-output")) legendKey = "out";
          else if (ticket.classList.contains("shop-input")) legendKey = "in";
          else if (ticket.classList.contains("shop-material")) legendKey = "material";
        }
      }
      opts.onActiveLegend(legendKey);
    }
  };

  const syncRouteState = (klass: "hot" | "active", nodeId: string, on: boolean) => {
    for (const el of board.querySelectorAll(
      `.shop-route[data-from="${CSS.escape(nodeId)}"], .shop-route[data-to="${CSS.escape(nodeId)}"]`,
    )) {
      el.classList.toggle(klass, on);
    }
  };

  const markRouteFamily = (path: SVGPathElement, klass: "hot" | "active", on: boolean) => {
    const edgeId = path.dataset.edge;
    const toId = path.dataset.to;
    const sel = edgeId
      ? `.shop-route[data-edge="${CSS.escape(edgeId)}"]`
      : toId
        ? `.shop-route[data-to="${CSS.escape(toId)}"]`
        : "";
    if (!sel) return;
    for (const el of board.querySelectorAll(sel)) el.classList.toggle(klass, on);
    if (edgeId && toId && !edgeId.startsWith("trunk:")) {
      for (const el of board.querySelectorAll(
        `.shop-route-trunk[data-to="${CSS.escape(toId)}"]`,
      )) {
        el.classList.toggle(klass, on);
      }
    }
  };

  const clearHot = () => {
    for (const el of board.querySelectorAll(".shop-route.hot")) el.classList.remove("hot");
  };

  const routeKeyOf = (path: SVGPathElement): string | null => {
    if (path.dataset.edge) return `.shop-route[data-edge="${CSS.escape(path.dataset.edge)}"]`;
    if (path.dataset.to) return `.shop-route[data-to="${CSS.escape(path.dataset.to)}"]`;
    return null;
  };

  const selectRoute = (path: SVGPathElement) => {
    activeEdgeKey = routeKeyOf(path);
    const nodeId = path.dataset.to || path.dataset.from;
    const node = nodeId && graph ? graph.nodes.find((n) => n.id === nodeId) : undefined;
    if (node) {
      keepEdge = true;
      opts.onJump(node.line);
      keepEdge = false;
      return;
    }
    applyActive();
  };

  lanes.addEventListener("mouseover", (event) => {
    const t = (event.target as HTMLElement).closest("[data-node]");
    if (!(t instanceof HTMLElement) || !t.dataset.node) return;
    clearHot();
    syncRouteState("hot", t.dataset.node, true);
  });
  lanes.addEventListener("mouseleave", () => {
    clearHot();
  });

  const clearFocus = () => {
    activeLine = null;
    activeEdgeKey = null;
    clearHot();
    applyActive();
    opts.onClearFocus?.();
  };

  const routeFromEvent = (target: EventTarget | null): SVGPathElement | null => {
    if (!(target instanceof SVGPathElement)) return null;
    if (target.classList.contains("shop-route-ghost")) return null;
    if (
      !target.classList.contains("shop-route-hit") &&
      !target.classList.contains("shop-route")
    ) {
      return null;
    }
    return target;
  };

  canvas.addEventListener("mouseover", (event) => {
    const t = routeFromEvent(event.target);
    if (!t) return;
    clearHot();
    markRouteFamily(t, "hot", true);
  });
  canvas.addEventListener("mouseout", (event) => {
    const t = routeFromEvent(event.target);
    if (!t) return;
    if (routeFromEvent(event.relatedTarget)) return;
    clearHot();
  });

  board.addEventListener("click", (event) => {
    const route = routeFromEvent(event.target);
    if (route) {
      selectRoute(route);
      return;
    }
    if (!(event.target instanceof Element)) return;
    if (event.target.closest(".shop-ticket, .shop-sec-head")) return;
    clearFocus();
  });

  const ro = new ResizeObserver(scheduleDraw);
  ro.observe(board);
  ro.observe(canvas);

  return {
    render(text: string, issues: UiIssue[]): UiIssue[] {
      graph = buildShopGraph(text, issues);
      lanes.replaceChildren();
      if (graph.workshops.length === 0) {
        svg.replaceChildren();
        overlay.replaceChildren();
        lanes.append(emptyState());
        return graph.mismatchIssues;
      }
      const cols = groupFamilies(graph.workshops);
      for (const families of cols) {
        const col = document.createElement("div");
        col.className = "shop-col";
        for (const family of families) col.append(familyEl(family, opts.onJump));
        lanes.append(col);
      }
      requestAnimationFrame(() => {
        drawRoutes(svg, overlay, graph!, canvas);
        applyActive();
      });
      return graph.mismatchIssues;
    },
    highlightLine(line: number | null) {
      activeLine = line;
      if (!keepEdge) activeEdgeKey = null;
      applyActive();
    },
    destroy() {
      window.clearTimeout(drawTimer);
      ro.disconnect();
    },
  };
}
