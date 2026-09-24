import { matchUnbraced } from "../parser/nameBrace";

/** Finished sofa/corner/bed line, no leading emoji. */
export const SOFA_START_RE = /^(Диван|Ліжко|Угол)\s+/u;

const QTY_TAIL_RE =
  /-\s*[\d.,]+\s*(шт\.?|кг|m³|m²|м³|м²|дм²|m|г)\s*$/iu;

/**
 * Strip `<!-- -->` and `//` notes, but keep `- N шт.` if it sits after `// @Attr=…`.
 * Otherwise `// @Дно Каркасу=ДВП Білий - 1 шт.` loses qty and the line is parsed as a new BOM output.
 */
export function stripSpecComment(line: string): string {
  let s = line.replace(/<!--[\s\S]*?-->/g, "");
  const slash = s.indexOf("//");
  if (slash < 0) return s.trim();
  const head = s.slice(0, slash).trim();
  const after = s.slice(slash);
  const qty = matchUnbraced(after, QTY_TAIL_RE);
  return qty ? `${head} ${qty[0]}`.trim() : head;
}
