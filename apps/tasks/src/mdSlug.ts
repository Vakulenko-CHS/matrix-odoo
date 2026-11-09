/** GitHub-like heading id (Unicode letters kept). Duplicate titles get -1, -2, … */
export function slugifyHeading(text: string, used: Map<string, number>): string {
  let base = text
    .trim()
    .toLowerCase()
    .replace(/[''\u2019"]/g, "")
    .replace(/[.…:,]/g, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  if (!base) base = "section";
  const n = used.get(base) ?? 0;
  used.set(base, n + 1);
  return n === 0 ? base : `${base}-${n}`;
}
