/**
 * Знімок `upd-1.md` = fixed.md з HEAD (перед наступним upd 2).
 *   npm run bed-snapshot-upd1
 *   npm run bed-snapshot-upd1 -- bali-140x200
 */
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";

const ROOT = path.resolve(__dirname, "../..");
const BEDS = path.join(ROOT, "furniture/beds");
const INVENTORY = path.join(ROOT, "furniture/inventory.json");

type Row = { slug: string; vadim_review?: string };

function run(argv: string[]): void {
  const all = JSON.parse(fs.readFileSync(INVENTORY, "utf-8")) as Row[];
  const pick = new Set(argv.filter((a) => !a.startsWith("-")));
  const rows = all.filter(
    (r) => r.vadim_review === "upd-2" && (pick.size === 0 || pick.has(r.slug)),
  );
  let ok = 0;
  for (const row of rows) {
    const rel = `furniture/beds/${row.slug}/fixed.md`;
    const content = execSync(`git show HEAD:${rel}`, {
      encoding: "utf-8",
      maxBuffer: 12 * 1024 * 1024,
    });
    const out = path.join(BEDS, row.slug, "upd-1.md");
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, content.endsWith("\n") ? content : `${content}\n`);
    ok++;
    console.log(row.slug);
  }
  console.log(`bed-snapshot-upd1: ${ok} файлів`);
}

if (require.main === module) {
  run(process.argv.slice(2));
}

export { run as runBedSnapshotUpd1 };