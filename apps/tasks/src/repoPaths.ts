/** Resolve markdown href from apps/tasks/BOARD.md to repo-relative posix path. */
export function splitRepoHref(href: string): { hrefPath: string; hash: string } {
  const h = href.trim();
  const i = h.indexOf("#");
  if (i === -1) return { hrefPath: h, hash: "" };
  return { hrefPath: h.slice(0, i), hash: decodeURIComponent(h.slice(i + 1)).toLowerCase() };
}

export function hrefToRepoPath(href: string): string | null {
  const { hrefPath } = splitRepoHref(href);
  const h = hrefPath.trim();
  if (!h || h.startsWith("http://") || h.startsWith("https://") || h.startsWith("#")) return null;
  if (h.startsWith("./")) return normalizeRepoPath(`apps/tasks/${h.slice(2)}`);
  if (h.startsWith("../")) return normalizeRepoPath(pathJoinPosix("apps/tasks", h));
  return normalizeRepoPath(h.replace(/^\.\//, ""));
}

function pathJoinPosix(base: string, rel: string): string {
  const stack = base.split("/").filter(Boolean);
  for (const part of rel.split("/")) {
    if (part === "..") stack.pop();
    else if (part !== "." && part !== "") stack.push(part);
  }
  return stack.join("/");
}

function normalizeRepoPath(p: string): string {
  const stack: string[] = [];
  for (const part of p.replace(/\\/g, "/").split("/")) {
    if (part === "..") stack.pop();
    else if (part !== "." && part !== "") stack.push(part);
  }
  return stack.join("/");
}

export type RepoLink = { label: string; path: string; hash: string };

const MD_LINK = /\[([^\]]+)\]\(([^)]+)\)/g;

function cleanLinkLabel(raw: string): string {
  return raw.replace(/`/g, "").replace(/\*\*/g, "").trim();
}

function linksFromText(text: string, seen: Set<string>): RepoLink[] {
  const out: RepoLink[] = [];
  MD_LINK.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = MD_LINK.exec(text))) {
    const { hash } = splitRepoHref(m[2]);
    const path = hrefToRepoPath(m[2]);
    if (!path) continue;
    const key = hash ? `${path}#${hash}` : path;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ label: cleanLinkLabel(m[1]), path, hash });
  }
  return out;
}

/** Prefer `#### Файли` block; otherwise all repo links in the card body. */
export function extractRepoLinks(markdown: string): RepoLink[] {
  const seen = new Set<string>();
  const filesSec = markdown.match(/^#### Файли\s*\n([\s\S]*?)(?=^#### |$)/m);
  if (filesSec) return linksFromText(filesSec[1], seen);
  return linksFromText(markdown, seen);
}
