export type HtmlCommentRange = {
  start: number;
  end: number;
  todo: boolean;
};

export type CommentToggleResult = {
  text: string;
  start: number;
  end: number;
};

const LINE_COMMENT_RE = /^\s*<!--(?:(?!-->).)*-->\s*$/;

export function findHtmlComments(text: string): HtmlCommentRange[] {
  const ranges: HtmlCommentRange[] = [];
  let i = 0;
  while (i < text.length) {
    const start = text.indexOf("<!--", i);
    if (start < 0) break;
    const close = text.indexOf("-->", start + 4);
    const end = close < 0 ? text.length : close + 3;
    ranges.push({
      start,
      end,
      todo: /^<!--\s*TODO/i.test(text.slice(start, end)),
    });
    i = Math.max(end, start + 4);
  }
  return ranges;
}

/** True when the line's trimmed content sits wholly inside one `<!-- … -->`. */
export function lineHtmlCommentFlags(text: string): boolean[] {
  const ranges = findHtmlComments(text);
  const lines = text.split("\n");
  const flags: boolean[] = [];
  let offset = 0;
  for (const line of lines) {
    const lineStart = offset;
    const lineEnd = offset + line.length;
    const lead = line.length - line.trimStart().length;
    const trail = line.length - line.trimEnd().length;
    const tStart = lineStart + lead;
    const tEnd = lineEnd - trail;
    if (tStart >= tEnd) {
      flags.push(ranges.some((r) => r.start <= lineStart && r.end >= lineEnd));
    } else {
      flags.push(ranges.some((r) => r.start <= tStart && r.end >= tEnd));
    }
    offset = lineEnd + 1;
  }
  return flags;
}

export function expandToLineRange(
  text: string,
  from: number,
  to: number,
): { start: number; end: number } {
  const lo = Math.max(0, Math.min(from, to));
  const hi = Math.max(from, to);
  const start = text.lastIndexOf("\n", Math.max(0, lo - 1)) + 1;
  let end = hi;
  if (lo !== hi && hi > 0 && text[hi - 1] === "\n") {
    end = hi - 1;
  } else {
    const nl = text.indexOf("\n", hi);
    end = nl < 0 ? text.length : nl;
  }
  if (end < start) end = start;
  return { start, end };
}

function unwrapLineComment(line: string): string {
  const m = line.match(/^(\s*)<!--\s?(.*?)\s?-->\s*$/);
  if (!m) return line;
  return m[1] + m[2];
}

function unwrapBlockComment(slice: string): string | null {
  const m = slice.match(/^(\s*)<!--[ \t]*\r?\n?([\s\S]*?)\r?\n?[ \t]*-->[ \t]*$/);
  if (!m) return null;
  return m[1] + m[2];
}

function minIndent(lines: string[]): string {
  let ind: string | null = null;
  for (const line of lines) {
    if (!line.trim()) continue;
    const lead = line.match(/^\s*/)?.[0] ?? "";
    if (ind === null || lead.length < ind.length) ind = lead;
  }
  return ind ?? "";
}

export function toggleHtmlComment(
  text: string,
  from: number,
  to: number,
): CommentToggleResult {
  const { start, end } = expandToLineRange(text, from, to);
  const slice = text.slice(start, end);
  const lines = slice.split("\n");
  const live = lines.filter((l) => l.trim());

  let nextSlice: string;
  if (live.length > 0 && live.every((l) => LINE_COMMENT_RE.test(l))) {
    nextSlice = lines.map(unwrapLineComment).join("\n");
  } else {
    const unwrapped = unwrapBlockComment(slice);
    if (unwrapped !== null) {
      nextSlice = unwrapped;
    } else if (lines.length <= 1) {
      const line = lines[0] ?? "";
      const indent = line.match(/^\s*/)?.[0] ?? "";
      nextSlice = `${indent}<!-- ${line.trim()} -->`;
    } else {
      const indent = minIndent(lines);
      nextSlice = `${indent}<!--\n${slice}\n${indent}-->`;
    }
  }

  return {
    text: text.slice(0, start) + nextSlice + text.slice(end),
    start,
    end: start + nextSlice.length,
  };
}
