import * as fs from "fs";
import * as path from "path";
import {
  diagnoseSpec,
  formatDiagnoseReport,
  type DiagnoseMode,
} from "../validator/diagnose";

const REFERENCE_PATH = path.resolve(process.cwd(), "right_names_odoo_base.md");

function usage(): never {
  console.error(
    'Використання: npm run ai-check -- <файл.md> [файл.md...]\n' +
      "  --as-is   перевірити текст як є (без prep/format у пам'яті)\n" +
      "Диск не змінює. Той самий пайплайн, що web.",
  );
  process.exit(2);
}

function diagnoseQuiet(
  raw: string,
  fileName: string,
  knownNamesMd: string,
  mode: DiagnoseMode,
) {
  const log = console.log;
  const warn = console.warn;
  console.log = () => {};
  console.warn = () => {};
  try {
    return diagnoseSpec(raw, fileName, knownNamesMd, mode);
  } finally {
    console.log = log;
    console.warn = warn;
  }
}

export function runAiCheck(argv: string[]): void {
  const mode: DiagnoseMode = argv.includes("--as-is") ? "as-is" : "validate";
  const files = argv.filter((a) => a !== "--as-is");
  if (files.length === 0) usage();

  if (!fs.existsSync(REFERENCE_PATH)) {
    console.error(`Не знайдено каталог назв: ${REFERENCE_PATH}`);
    process.exit(2);
  }
  const knownNamesMd = fs.readFileSync(REFERENCE_PATH, "utf-8");

  let failed = false;
  for (const filePath of files) {
    const abs = path.resolve(process.cwd(), filePath);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
      console.error(`Файл не знайдено: ${abs}`);
      process.exit(2);
    }
    const raw = fs.readFileSync(abs, "utf-8");
    const result = diagnoseQuiet(raw, path.basename(abs), knownNamesMd, mode);
    console.log(formatDiagnoseReport(result, path.relative(process.cwd(), abs)));
    if (files.length > 1) console.log("");
    if (result.counts.blocking > 0 || result.counts.errors > 0) failed = true;
  }

  process.exit(failed ? 1 : 0);
}
