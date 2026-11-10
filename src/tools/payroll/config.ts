/**
 * Piece-rate payroll (Worker Pay) config: one salary rule and one default
 * worker per workshop from src/workcenters/canon.ts.
 */

export const WORKER_PAY_STRUCT = "Worker Pay";
export const WORKER_STRUCT_TYPE = "Worker";
export const CONTRACT_START = "2026-01-01";

/** Skipped in worker-contracts (name contains "(Цех"). ВТК staff — T-QAL-01 via `qal01-vtk`. */
export const EXCLUDED_EMPLOYEES = ["Адмін Daniil"];

export interface PayrollShop {
  /** Workshop number, as `num` in canon.ts. */
  num: string;
  /** hr.salary.rule code inside Worker Pay. */
  ruleCode: string;
  /** Rule name used only when the rule is created. */
  ruleName: string;
  /** hr.employee name auto-assigned to new workorders; null = nobody. */
  defaultEmployee: string | null;
}

export const PAYROLL_SHOPS: readonly PayrollShop[] = [
  { num: "1", ruleCode: "п-ц1", ruleName: "(Цех №1) [Нарізака деровини]", defaultEmployee: "Анатолий (Цех 1)" },
  { num: "2-1", ruleCode: "п-ц2-1", ruleName: "(Цех №2-1) [Бильце - нарізані деталі]", defaultEmployee: "Бакалец Володимир (Цех 2, 3)" },
  { num: "2-2", ruleCode: "п-ц2-2", ruleName: "(Цех №2-2) [Карказ - нарізані деталі]", defaultEmployee: "Бакалец Володимир (Цех 2, 3)" },
  { num: "2-3", ruleCode: "п-ц2-3", ruleName: "(Цех №2-3) [Планка - нарізані деталі]", defaultEmployee: "Бакалец Володимир (Цех 2, 3)" },
  { num: "3-0", ruleCode: "п-ц3-0", ruleName: "(Цех №3-0) [Ламінат - лист]", defaultEmployee: "Бакалец Володимир (Цех 2, 3)" },
  { num: "3-1", ruleCode: "п-ц3-1", ruleName: "(Цех №3-1) [Ламінат - нарізані деталі]", defaultEmployee: "Бакалец Володимир (Цех 2, 3)" },
  { num: "3-2", ruleCode: "п-ц3-2", ruleName: "(Цех №3-2) [Накладка]", defaultEmployee: "Бакалец Володимир (Цех 2, 3)" },
  { num: "4-1", ruleCode: "п-ц4-1", ruleName: "(Цех №4-1) [Бильце - напівфабрикат]", defaultEmployee: "Валентин Николаевич (Цех 4)" },
  { num: "4-2", ruleCode: "п-ц4-2", ruleName: "(Цех №4-2) [Карказ - напівфабрикат]", defaultEmployee: "Валентин Николаевич (Цех 4)" },
  { num: "4-3", ruleCode: "п-ц4-3", ruleName: "(Цех №4-3) [Планка - напівфабрикат]", defaultEmployee: "Валентин Николаевич (Цех 4)" },
  { num: "4-4", ruleCode: "п-ц4-4", ruleName: "(Цех №4-4) [Бортик - напівфабрикат]", defaultEmployee: "Валентин Николаевич (Цех 4)" },
  { num: "5", ruleCode: "п-ц5", ruleName: "(Цех №5) [Поролон - нарізані компонети]", defaultEmployee: "Володько Сережа (Цех 5)" },
  { num: "5-1", ruleCode: "п-ц5-1", ruleName: "(Цех №5-1) [Наволочка]", defaultEmployee: "Володько Сережа (Цех 5)" },
  { num: "6", ruleCode: "п-ц6", ruleName: "(Цех №6) [Карказ + Поролон - напівфабрикат 2]", defaultEmployee: "Валера Резник (Цех 6)" },
  { num: "7", ruleCode: "п-ц7", ruleName: "(Цех №7) [Чохол - нарізані матеріали]", defaultEmployee: "Рац Света (Цех 7)" },
  { num: "8", ruleCode: "п-ц8", ruleName: "(Цех №8) [Чохол - напівфабрикат]", defaultEmployee: "Марина (Цех 8)" },
  { num: "9", ruleCode: "п-ц9", ruleName: "(Цех №9) [Диван] Сборка", defaultEmployee: "Володько Серёжа (Цех 9)" },
  { num: "9-1", ruleCode: "п-ц9-1", ruleName: "(Цех №9-1) [Подушка]", defaultEmployee: "Володько Серёжа (Цех 9)" },
  { num: "10", ruleCode: "п-ц10", ruleName: "(Цех №10) Упаковка", defaultEmployee: "Володько Серёжа (Цех 9)" },
  { num: "ВТК", ruleCode: "п-втк", ruleName: "(Цех ВТК) Перевірка якості", defaultEmployee: "Мочалова Тетяна" },
];

/** Employee names in Odoo sometimes carry double spaces. */
export function normName(name: string): string {
  return name.replace(/\s+/g, " ").trim();
}
