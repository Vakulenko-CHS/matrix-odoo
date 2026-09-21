/**
 * Move `parent.scrollTop/Left` so `child` is visible.
 * Do not use Element.scrollIntoView — it also pan-scrolls sibling
 * overflow panes (issues list, editor, shop).
 */
export function scrollChildIntoView(
  parent: HTMLElement,
  child: HTMLElement,
  block: "nearest" | "center" = "nearest",
): void {
  const pr = parent.getBoundingClientRect();
  const cr = child.getBoundingClientRect();

  let dy = 0;
  if (block === "center") {
    dy = cr.top - pr.top - (pr.height - cr.height) / 2;
  } else if (cr.height > pr.height || cr.top < pr.top) {
    dy = cr.top - pr.top;
  } else if (cr.bottom > pr.bottom) {
    dy = cr.bottom - pr.bottom;
  }

  let dx = 0;
  if (cr.width > pr.width || cr.left < pr.left) dx = cr.left - pr.left;
  else if (cr.right > pr.right) dx = cr.right - pr.right;

  if (dy) parent.scrollTop += dy;
  if (dx) parent.scrollLeft += dx;
}
