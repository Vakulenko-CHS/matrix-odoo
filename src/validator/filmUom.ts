/** Плівка: спек кг, Odoo g. */
export function convertFilmQty(
  productName: string,
  qty: number,
  uom: string,
): { qty: number; uom: string } {
  const n = productName.replace(/[\[\]]/g, "");
  if (!/плівка/i.test(n)) return { qty, uom };
  const u = uom.toLowerCase().replace(/\.$/, "").replace(/кg/i, "кг");
  if (u === "кг" || u === "kg") return { qty: qty * 1000, uom: "г" };
  return { qty, uom };
}
