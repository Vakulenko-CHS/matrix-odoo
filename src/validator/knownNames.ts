import * as fs from "fs";
import * as path from "path";
import { FURNITURE_NAMES_FILE, ODOO_NAMES_FILE } from "./namesFiles";

export { FURNITURE_NAMES_FILE, ODOO_NAMES_FILE };

export function mergeKnownNamesMd(odooMd: string, furnitureMd: string): string {
  return `${odooMd.replace(/\s+$/, "")}\n\n${furnitureMd.replace(/^\s+/, "")}\n`;
}

export function readKnownNamesMd(cwd = process.cwd()): string {
  const odooPath = path.resolve(cwd, ODOO_NAMES_FILE);
  const furniturePath = path.resolve(cwd, FURNITURE_NAMES_FILE);
  const odoo = fs.readFileSync(odooPath, "utf-8");
  const furniture = fs.existsSync(furniturePath)
    ? fs.readFileSync(furniturePath, "utf-8")
    : "";
  return furniture ? mergeKnownNamesMd(odoo, furniture) : odoo;
}
