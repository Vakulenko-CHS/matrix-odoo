/**
 * Odoo mrp.workcenter names/codes. Spec `# Цех` headers rewrite to these.
 * Match by workshop number (`Цех №4-1`), not the client-typed title.
 */

export interface CanonWorkcenter {
  /** Token after №. VTK uses "ВТК". */
  num: string;
  /** Exact Odoo `mrp.workcenter.name`. */
  name: string;
  /** Exact Odoo `mrp.workcenter.code`. */
  code: string;
}

const Q_LEFT = "\u201C";
const Q_RIGHT = "\u201D";

export const ODOO_WORKCENTERS: readonly CanonWorkcenter[] = [
  { num: "1", code: "Ц1дрв", name: "Цех №1 Дерева (Нарізка)" },
  { num: "2-1", code: "Ц2дс1", name: "Цех №2-1 ДСП (Нарізка Бильце)" },
  { num: "2-2", code: "Ц2дс2", name: "Цех №2-2 ДСП (Нарізка Каркас)" },
  { num: "2-3", code: "Ц2дс3", name: "Цех №2-3 ДСП (Нарізка Планка)" },
  { num: "2-4", code: "Ц2дс4", name: "Цех №2-4 ДСП (Нарізка Бортик)" },
  { num: "3-0", code: "Ц3лд0", name: "Цех №3-0 ЛДСП (Нарізка Ламінату)" },
  { num: "3-1", code: "Ц3лд1", name: "Цех №3-1 ЛДСП (Нарізка Ламінату)" },
  { num: "3-2", code: "Ц3лд2", name: "Цех №3-2 ЛДСП (Нарізка Накладок)" },
  { num: "4-1", code: "Ц4С1", name: "Цех №4-1 Збірка Бильце" },
  { num: "4-2", code: "Ц4С2", name: "Цех №4-2 Збірка Каркас" },
  { num: "4-3", code: "Ц4С3", name: "Цех №4-3 Збірка Планка" },
  { num: "4-4", code: "Ц4С4", name: "Цех №4-4 Збірка Бортик" },
  { num: "5", code: "Ц5ПП", name: "Цех №5 Порезка Поролон" },
  { num: "5-1", code: "Ц5Н1", name: "Цех №5-1 Наволочка" },
  { num: "6", code: "Ц6П", name: "Цех №6 Поклейки Поролона + Сбивка" },
  { num: "6-1", code: "Ц6П-1", name: "Цех №6-1 Поклейки Поролона + Сбивка Бортика" },
  { num: "7", code: "Ц7зкр", name: "Цех №7 Закройка Тканини" },
  { num: "8", code: "Ц8Ш", name: "Цех №8 Швейка" },
  { num: "9", code: "Ц9обв", name: "Цех №9 Оббивки" },
  { num: "9-1", code: "Ц9НП", name: "Цех №9-1 Набивки Подушек" },
  { num: "10", code: "Ц10Упк", name: "Цех №10 Упаковки" },
  { num: "ВТК", code: "ВТК", name: "ВТК" },
];

const BY_NUM = new Map(ODOO_WORKCENTERS.map((w) => [w.num, w]));

export function extractWorkshopNum(text: string): string | null {
  const t = text.trim();
  if (/^#*\s*ВТК\b/i.test(t) || /^ВТК$/i.test(t) || /відділ\s+технічного/i.test(t)) {
    return "ВТК";
  }
  const m = t.match(/Цех\s*№\s*([\w-]+)/i);
  return m ? m[1] : null;
}

export function findCanonWorkcenter(text: string): CanonWorkcenter | undefined {
  const num = extractWorkshopNum(text);
  if (num) return BY_NUM.get(num);
  return undefined;
}

export function operationPrefix(wc: CanonWorkcenter): string {
  if (wc.num === "ВТК") return "ВТК";
  return `Операція (Цех №${wc.num})`;
}

export function workshopHeaderLine(wc: CanonWorkcenter): string {
  if (wc.num === "ВТК") return "# ВТК";
  return `# ${wc.name} - ${wc.code} ${Q_LEFT}${operationPrefix(wc)}${Q_RIGHT}`;
}

/** Rewrite a spec header to the Odoo workshop line. Null if not a workshop line. */
export function canonWorkshopHeader(line: string): string | null {
  const indent = line.match(/^\s*/)?.[0] ?? "";
  const t = line.trim();
  if (!t) return null;
  const vtk = /^#*\s*ВТК\b/i.test(t) || /^ВТК$/i.test(t);
  const ceh = /^#*\s*Цех\s*№/i.test(t) || /^Цех\s*№/i.test(t);
  if (!vtk && !ceh) return null;
  const wc = findCanonWorkcenter(t);
  if (!wc) return null;
  return indent + workshopHeaderLine(wc);
}

/**
 * Workcenter name for import / getOrCreate.
 * Known № → Odoo name. Else Сборка→Збірка on Цех headers.
 */
export function canonWorkcenterName(name: string): string {
  const known = findCanonWorkcenter(name);
  if (known) return known.name;
  const preserve = (match: string, uk: string) =>
    match[0] !== match[0].toLocaleLowerCase("uk")
      ? uk.charAt(0).toLocaleUpperCase("uk") + uk.slice(1)
      : uk;
  let n = name.trim().replace(/\s+/g, " ");
  n = n.replace(/сборка/gi, (m) => preserve(m, "збірка"));
  if (/^Цех\s+№/i.test(n)) n = n.replace(/збірка/gi, "Збірка");
  return n;
}
