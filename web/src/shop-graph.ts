import type { IssueKind, QuickFix, UiIssue } from "./pipeline";
import { SOFA_START_RE, stripSpecComment } from "../../src/tools/specLine";

export type ShopNodeKind = "output" | "input" | "material";
export type ShopEdgeStatus = "ok" | "break" | "orphan" | "mismatch";

export interface ShopNode {
  id: string;
  kind: ShopNodeKind;
  workshopKey: string;
  line: number;
  raw: string;
  label: string;
  typeKey: string;
  productId: string;
  variantKey: string;
  familyKey: string;
  matchKey: string;
  qty?: string;
  issues: UiIssue[];
}

export interface ShopBom {
  output: ShopNode;
  inputs: ShopNode[];
  materials: ShopNode[];
  lineStart: number;
  lineEnd: number;
}

export interface ShopWorkshop {
  key: string;
  title: string;
  subtitle: string;
  code: string;
  line: number;
  issues: UiIssue[];
  boms: ShopBom[];
}

export interface ShopEdge {
  id: string;
  fromId: string | null;
  toId: string;
  status: ShopEdgeStatus;
  issues: UiIssue[];
}

export interface ShopGraph {
  title: string;
  workshops: ShopWorkshop[];
  edges: ShopEdge[];
  nodes: ShopNode[];
  mismatchIssues: UiIssue[];
}

const HEADER_RE =
  /^(?:#+\s*)?(Цех\s*№[\w-]+)(?:\s+(.+?))?(?:\s+-\s+(\S+)\s+[«»""“”](.+?)[«»""“”])?\s*$/u;
const QTY_RE =
  /-\s*([\d.,]*)\s*(шт\.?|кг|kg|кg|m³|м³|m²|м²|дм²|m3|м3|m2|м2|m|м|г|g)\.?\s*$/iu;
const RAW_UNIT_RE =
  /[-]\s*[\d.,]*\s*(кг|kg|кg|m³|м³|m²|м²|дм²|m3|м3|m2|м2|m|м|г|g)\.?\s*$/iu;
const EMOJI_RE = /^[\u{1F000}-\u{1FFFF}\u{2600}-\u{27FF}🪵🧩🪤🧽]+/u;
const SOFA_RE = SOFA_START_RE;
const SKIP_LINE =
  /^(синтаксис|цехи|або|і|---|#\s*список|##\s*інструкц|ціна|<<)/i;
const FINISHED_RE = /^\[(диван|ліжко|угол)\]$/i;

function stripComment(line: string): string {
  return stripSpecComment(line);
}

function isCommented(line: string): boolean {
  return /^\s*<!--/.test(line);
}

function kindRank(kind: IssueKind): number {
  return { blocking: 0, error: 1, warning: 2, auto: 3 }[kind];
}

function worstKind(issues: UiIssue[]): IssueKind | null {
  let best: IssueKind | null = null;
  for (const issue of issues) {
    if (!best || kindRank(issue.kind) < kindRank(best)) best = issue.kind;
  }
  return best;
}

export function nodeKindOf(issues: UiIssue[]): IssueKind | null {
  return worstKind(issues);
}

function getTypeKey(s: string): string {
  const bracket = s.match(/\[([^\]]+)\]/);
  if (!bracket) {
    const sofa = s.match(SOFA_RE);
    return sofa ? sofa[1] : "";
  }
  const inner = bracket[1]
    .replace(EMOJI_RE, "")
    .replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27FF}🪵🧩🪤🧽]/gu, "")
    .replace(/\s+/g, " ")
    .replace(/\s*-\s*/g, " - ")
    .trim();
  return `[${inner}]`;
}

function getProductId(s: string): string {
  const start = s.indexOf("(");
  if (start < 0) return "";
  let depth = 0;
  let inner = "";
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (ch === "(") {
      depth++;
      if (depth === 1) continue;
    } else if (ch === ")") {
      depth--;
      if (depth === 0) break;
    }
    if (depth >= 1) inner += ch;
  }
  const first = inner.split(",")[0]?.trim() ?? "";
  if (!first || first.startsWith("%")) return "";
  return first;
}

function normalizeKeyPart(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

function getVariantKey(s: string, typeKey: string): string {
  const base = stripComment(s).replace(QTY_RE, "").replace(/\s+/g, " ").trim();
  return `${normalizeKeyPart(typeKey)}::${normalizeKeyPart(base)}`;
}

function getFamilyKey(typeKey: string, productId: string): string {
  return `${normalizeKeyPart(typeKey)}::${normalizeKeyPart(productId)}`;
}

function shortLabel(raw: string): string {
  const emoji = raw.match(EMOJI_RE)?.[0] ?? "";
  const name = raw.match(/\[([^\]]+)\]/)?.[1]?.replace(/\s+/g, " ").trim();
  if (name) return `${emoji}${emoji ? " " : ""}${name}`.trim();
  const sofa = raw.match(SOFA_RE);
  if (sofa) return sofa[0].slice(0, 48);
  return raw.replace(/\s+/g, " ").slice(0, 48);
}

function isFinished(typeKey: string): boolean {
  const t = typeKey.replace(EMOJI_RE, "").trim();
  if (FINISHED_RE.test(t) || /^(Диван|Ліжко)$/i.test(t)) return true;
  return false;
}

function isHeader(t: string): boolean {
  return /^(?:#+\s*)?Цех\s*№[\w-]+/u.test(t);
}

function isBracketProduct(t: string): boolean {
  return /\[[^\]]+\]/.test(t) || SOFA_RE.test(t);
}

function qtyOf(t: string): string | undefined {
  const m = t.match(QTY_RE);
  if (!m) return undefined;
  const n = m[1] || "0";
  let unit = m[2] ?? "";
  if (/^шт/i.test(unit)) unit = "шт.";
  if (/^kg$|^кg$/i.test(unit)) unit = "кг";
  return `${n} ${unit}`.trim();
}

function parseHeader(t: string): {
  key: string;
  subtitle: string;
  code: string;
} | null {
  const m = t.match(HEADER_RE);
  if (!m) return null;
  const rest = (m[2] ?? "").replace(/\s+-\s+\S+\s+[«»""“”].*$/u, "").trim();
  return {
    key: m[1].replace(/\s+/g, " ").trim(),
    subtitle: rest,
    code: m[3] ?? "",
  };
}

function makeNode(
  id: string,
  kind: ShopNodeKind,
  workshopKey: string,
  line: number,
  raw: string,
  qty?: string,
): ShopNode {
  const typeKey = getTypeKey(raw);
  const productId = getProductId(raw);
  const variantKey = getVariantKey(raw, typeKey);
  const familyKey = getFamilyKey(typeKey, productId);
  return {
    id,
    kind,
    workshopKey,
    line,
    raw,
    label: shortLabel(raw),
    typeKey,
    productId,
    variantKey,
    familyKey,
    matchKey: familyKey,
    qty,
    issues: [],
  };
}

function isPrefixPair(a: string, b: string): boolean {
  if (!a || !b || a === b) return false;
  return a.startsWith(`${b} `) || b.startsWith(`${a} `);
}

function replaceProductId(raw: string, fromId: string, toId: string): string {
  if (!fromId || fromId === toId) return raw;
  const idx = raw.indexOf(fromId);
  if (idx < 0) return raw;
  return raw.slice(0, idx) + toId + raw.slice(idx + fromId.length);
}

export function buildShopGraph(text: string, issues: UiIssue[] = []): ShopGraph {
  const lines = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").split("\n");
  const workshops: ShopWorkshop[] = [];
  const nodes: ShopNode[] = [];
  const mismatchIssues: UiIssue[] = [];
  let title = "";

  let current: ShopWorkshop | null = null;
  let bom: ShopBom | null = null;
  let seq = 0;

  const flushBom = () => {
    if (!current || !bom) return;
    current.boms.push(bom);
    bom = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const t = stripComment(rawLine);
    const n = i + 1;
    if (!t) continue;
    if (isCommented(rawLine)) continue;
    if (/^---+$/.test(t)) {
      title = "";
      continue;
    }
    if (SKIP_LINE.test(t) && !isHeader(t)) {
      if (
        !title &&
        /диван|ліжко|угол/i.test(t) &&
        !t.startsWith("[") &&
        !t.startsWith("<<") &&
        !t.startsWith("//")
      ) {
        title = t.slice(0, 80);
      }
      continue;
    }

    if (isHeader(t)) {
      flushBom();
      const parsed = parseHeader(t);
      if (!parsed) continue;
      current = {
        key: parsed.key,
        title: parsed.key,
        subtitle: parsed.subtitle,
        code: parsed.code,
        line: n,
        issues: [],
        boms: [],
      };
      workshops.push(current);
      continue;
    }

    if (!current) {
      if (
        !title &&
        t.length > 2 &&
        t.length < 80 &&
        !t.startsWith("[") &&
        !t.startsWith('"') &&
        !t.startsWith("<<") &&
        !t.startsWith("//") &&
        !t.startsWith("(") &&
        !/^(наприклад|атрибут|назва продукту|йде |\[\])/i.test(t)
      ) {
        title = t.slice(0, 80);
      }
      continue;
    }

    if (isBracketProduct(t) && !qtyOf(t)) {
      flushBom();
      const output = makeNode(`n${seq++}`, "output", current.key, n, t);
      nodes.push(output);
      bom = {
        output,
        inputs: [],
        materials: [],
        lineStart: n,
        lineEnd: n,
      };
      continue;
    }

    const qty = qtyOf(t);
    if (!qty || !current) continue;

    if (!bom) {
      const output = makeNode(
        `n${seq++}`,
        "output",
        current.key,
        current.line,
        current.subtitle || current.key,
      );
      nodes.push(output);
      bom = {
        output,
        inputs: [],
        materials: [],
        lineStart: n,
        lineEnd: n,
      };
    }

    const kind: ShopNodeKind =
      isBracketProduct(t) && !RAW_UNIT_RE.test(t) ? "input" : "material";
    const node = makeNode(`n${seq++}`, kind, current.key, n, t, qty);
    if (kind === "input") bom.inputs.push(node);
    else bom.materials.push(node);
    nodes.push(node);
    bom.lineEnd = n;
  }
  flushBom();

  const produced = nodes.filter((n) => n.kind === "output" && n.typeKey);
  const producedTypes = new Set(produced.map((n) => n.typeKey.toLowerCase()));
  for (const shop of workshops) {
    for (const block of shop.boms) {
      const stay: ShopNode[] = [];
      for (const input of block.inputs) {
        if (producedTypes.has(input.typeKey.toLowerCase())) {
          stay.push(input);
        } else {
          input.kind = "material";
          block.materials.push(input);
        }
      }
      block.inputs = stay;
    }
  }

  const earlierOnly = (list: ShopNode[], input: ShopNode): ShopNode[] => {
    const earlier = list.filter((p) => p.line < input.line);
    return earlier.length ? earlier : list;
  };

  const findProducers = (input: ShopNode): ShopNode[] => {
    const exact = produced.filter((p) => p.variantKey === input.variantKey);
    if (exact.length > 0) return earlierOnly(exact, input);
    const family = produced.filter((p) => p.familyKey === input.familyKey);
    if (family.length > 0) return earlierOnly(family, input);
    const sameType = produced.filter(
      (p) => p.typeKey.toLowerCase() === input.typeKey.toLowerCase(),
    );
    const prefix = sameType.filter((p) =>
      isPrefixPair(p.productId, input.productId),
    );
    return earlierOnly(prefix, input);
  };

  const edges: ShopEdge[] = [];
  const usedOutputs = new Set<string>();

  for (const input of nodes.filter((n) => n.kind === "input")) {
    const typeKnown = producedTypes.has(input.typeKey.toLowerCase());
    if (!typeKnown) continue;
    const fromList = findProducers(input);
    if (fromList.length > 0) {
      for (const from of fromList) {
        usedOutputs.add(from.id);
        const mismatch =
          from.productId !== input.productId &&
          isPrefixPair(from.productId, input.productId);
        edges.push({
          id: `${from.id}->${input.id}`,
          fromId: from.id,
          toId: input.id,
          status: mismatch ? "mismatch" : "ok",
          issues: [],
        });
        if (mismatch) {
          const fromBase = from.raw.replace(QTY_RE, "").trim();
          const qtyPart = input.qty ? ` - ${input.qty}` : "";
          const consumerLine = `${fromBase}${qtyPart}`;
          const producerLine = replaceProductId(
            from.raw,
            from.productId,
            input.productId,
          );
          const fixes: QuickFix[] = [
            {
              id: `fix-mismatch-in-${input.line}-${from.line}`,
              label: `Споживач → «${from.productId}»`,
              action: "replace-line",
              line: input.line,
              replacement: consumerLine,
            },
            {
              id: `fix-mismatch-out-${input.line}-${from.line}`,
              label: `Виробник → «${input.productId}»`,
              action: "replace-line",
              line: from.line,
              replacement: producerLine,
            },
            {
              id: `goto-mismatch-${input.line}-${from.line}`,
              label: `→ ${from.workshopKey}, ряд. ${from.line}`,
              action: "goto-line",
              line: from.line,
            },
          ];
          mismatchIssues.push({
            id: `graph-mismatch-${mismatchIssues.length}`,
            kind: "error",
            source: "chain",
            line: input.line,
            message: `[MISMATCH] Назва не збігається з виробником (${from.workshopKey}): «${input.productId}» замість «${from.productId}». Виробник має повнішу назву.`,
            fixes,
          });
        }
      }
    } else {
      edges.push({
        id: `miss->${input.id}`,
        fromId: null,
        toId: input.id,
        status: "break",
        issues: [],
      });
    }
  }

  for (const out of produced) {
    if (usedOutputs.has(out.id)) continue;
    if (isFinished(out.typeKey)) continue;
    edges.push({
      id: `${out.id}->orphan`,
      fromId: out.id,
      toId: "",
      status: "orphan",
      issues: [],
    });
  }

  attachIssues(workshops, nodes, edges, issues);

  return { title, workshops, edges, nodes, mismatchIssues };
}

function attachIssues(
  workshops: ShopWorkshop[],
  nodes: ShopNode[],
  edges: ShopEdge[],
  issues: UiIssue[],
): void {
  if (issues.length === 0) return;

  const byLine = new Map<number, ShopNode[]>();
  for (const node of nodes) {
    const list = byLine.get(node.line) ?? [];
    list.push(node);
    byLine.set(node.line, list);
  }

  const bomOf = new Map<string, ShopBom>();
  for (const shop of workshops) {
    for (const bom of shop.boms) {
      bomOf.set(bom.output.id, bom);
      for (const n of [...bom.inputs, ...bom.materials]) bomOf.set(n.id, bom);
    }
  }

  for (const issue of issues) {
    if (issue.line) {
      const hits = byLine.get(issue.line);
      if (hits?.length) {
        for (const node of hits) node.issues.push(issue);
        continue;
      }
      for (const shop of workshops) {
        if (shop.line === issue.line) {
          shop.issues.push(issue);
          break;
        }
        const bom = shop.boms.find(
          (b) => issue.line! >= b.lineStart && issue.line! <= b.lineEnd,
        );
        if (bom) {
          bom.output.issues.push(issue);
          break;
        }
      }
    }

    const workshopHit = issue.message.match(/Цех\s*№[\w-]+/u);
    if (workshopHit && !issue.line) {
      const shop = workshops.find((w) => w.key === workshopHit[0]);
      shop?.issues.push(issue);
    }
  }

  for (const edge of edges) {
    const to = nodes.find((n) => n.id === edge.toId);
    const from = nodes.find((n) => n.id === edge.fromId);
    const pack = [...(to?.issues ?? []), ...(from?.issues ?? [])];
    const chain = pack.filter((i) =>
      /\[(CHAIN-IN|CHAIN-OUT|BREAK|ZERO)\]/i.test(i.message),
    );
    if (edge.status === "ok" && chain.some((i) => /\[BREAK\]/i.test(i.message))) {
      edge.status = "mismatch";
    }
    if (edge.status === "break" || edge.status === "orphan") {
      edge.issues = chain.length ? chain : pack;
    } else {
      edge.issues = chain;
    }
  }
}

export function issuesForLine(graph: ShopGraph, line: number | null): string[] {
  if (!line) return [];
  return graph.nodes.filter((n) => n.line === line).map((n) => n.id);
}
