/**
 * T-VOL-01: build divany-obem-vaga.tsv from furniture/reference/Specs.csv
 * (sofa rows only; skips Відміна / (%Тканina% junk rows).
 */
import * as fs from "node:fs";
import * as path from "node:path";

const SPECS = path.join(process.cwd(), "furniture/reference/Specs.csv");
const OUT = path.join(process.cwd(), "furniture/reference/divany-obem-vaga.tsv");

const cancel = /відмін|отмен|скасован/i;

function main() {
  const lines = fs.readFileSync(SPECS, "utf8").split(/\r?\n/);
  const names = new Set<string>();
  for (const line of lines) {
    const m = line.match(/^Диван [^,\n]+,/);
    if (!m) continue;
    const name = m[0].slice(0, -1).trim();
    if (name.includes("(%Тканина")) continue;
    const progress = line.split(",")[1] ?? "";
    if (cancel.test(progress) || cancel.test(line.split(",")[8] ?? "")) continue;
    names.add(name.replace(/\s+$/, ""));
  }
  const sorted = [...names].sort((a, b) => a.localeCompare(b, "uk"));
  const rows = ["назва_дивана\tоб'єм_m3\tвага_kg", ...sorted.map((n) => `${n}\t\t`)];
  fs.writeFileSync(OUT, rows.join("\n") + "\n", "utf8");
  console.log(`Wrote ${OUT} (${sorted.length} sofas)`);
}

main();
