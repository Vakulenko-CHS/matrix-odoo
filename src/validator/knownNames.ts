import * as fs from "fs";
import * as path from "path";
import {
  CANON_NAMES_FILE,
  FURNITURE_NAMES_FILE,
  ODOO_NAMES_FILE,
} from "./namesFiles";

export { CANON_NAMES_FILE, FURNITURE_NAMES_FILE, ODOO_NAMES_FILE };

export function mergeKnownNamesMd(
  odooMd: string,
  furnitureMd: string,
  canonMd = "",
): string {
  const parts = [odooMd.replace(/\s+$/, ""), furnitureMd.replace(/^\s+/, "")];
  if (canonMd.trim()) parts.push(canonMd.replace(/^\s+/, ""));
  return `${parts.join("\n\n")}\n`;
}

export function readKnownNamesMd(cwd = process.cwd()): string {
  const odoo = fs.readFileSync(path.resolve(cwd, ODOO_NAMES_FILE), "utf-8");
  const furniturePath = path.resolve(cwd, FURNITURE_NAMES_FILE);
  const canonPath = path.resolve(cwd, CANON_NAMES_FILE);
  const furniture = fs.existsSync(furniturePath)
    ? fs.readFileSync(furniturePath, "utf-8")
    : "";
  const canon = fs.existsSync(canonPath)
    ? fs.readFileSync(canonPath, "utf-8")
    : "";
  return mergeKnownNamesMd(odoo, furniture, canon);
}
