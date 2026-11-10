const LS_DETAIL_W = "matrix-tasks-detail-w";
const LS_DETAIL_H = "matrix-tasks-detail-h";

const SPLITTER_PX = 14;

const DETAIL_W = { min: 260, max: 720, default: 416, minKanban: 300 };
const DETAIL_H = { min: 28, max: 72, default: 45 };

function isNarrow(): boolean {
  return window.matchMedia("(max-width: 900px)").matches;
}

function readNum(key: string, lo: number, hi: number, fallback: number): number {
  const n = Number(localStorage.getItem(key));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
}

export function mountTaskResize(layout: HTMLElement, splitter: HTMLElement): void {
  const maxDetailPx = () => {
    const w = layout.getBoundingClientRect().width;
    return Math.max(DETAIL_W.min, Math.min(DETAIL_W.max, w - DETAIL_W.minKanban - SPLITTER_PX));
  };

  const applyDetailWidth = (px: number, persist = true) => {
    const clamped = Math.min(maxDetailPx(), Math.max(DETAIL_W.min, px));
    layout.style.setProperty("--task-detail-w", `${Math.round(clamped)}px`);
    if (persist) localStorage.setItem(LS_DETAIL_W, String(Math.round(clamped)));
  };

  const applyDetailHeight = (pct: number, persist = true) => {
    const clamped = Math.min(DETAIL_H.max, Math.max(DETAIL_H.min, pct));
    layout.style.setProperty("--task-detail-h", `${clamped}%`);
    if (persist) localStorage.setItem(LS_DETAIL_H, String(clamped));
  };

  const getDetailWidth = () =>
    Number(layout.style.getPropertyValue("--task-detail-w").replace("px", "")) ||
    readNum(LS_DETAIL_W, DETAIL_W.min, DETAIL_W.max, DETAIL_W.default);

  const getDetailHeight = () =>
    Number(layout.style.getPropertyValue("--task-detail-h").replace("%", "")) ||
    readNum(LS_DETAIL_H, DETAIL_H.min, DETAIL_H.max, DETAIL_H.default);

  localStorage.removeItem("matrix-tasks-col-w");

  applyDetailWidth(readNum(LS_DETAIL_W, DETAIL_W.min, DETAIL_W.max, DETAIL_W.default), false);
  applyDetailHeight(readNum(LS_DETAIL_H, DETAIL_H.min, DETAIL_H.max, DETAIL_H.default), false);

  const detailFromPointer = (clientX: number, clientY: number) => {
    const rect = layout.getBoundingClientRect();
    if (isNarrow()) {
      const h = ((rect.bottom - clientY - SPLITTER_PX / 2) / rect.height) * 100;
      applyDetailHeight(h);
      return;
    }
    const w = rect.right - clientX - SPLITTER_PX / 2;
    applyDetailWidth(w);
  };

  splitter.tabIndex = 0;
  splitter.addEventListener("pointerdown", (event) => {
    splitter.setPointerCapture(event.pointerId);
    layout.classList.add("is-task-resizing");
    detailFromPointer(event.clientX, event.clientY);
  });
  splitter.addEventListener("pointermove", (event) => {
    if (!splitter.hasPointerCapture(event.pointerId)) return;
    detailFromPointer(event.clientX, event.clientY);
  });
  const stopSplit = (event: PointerEvent) => {
    if (splitter.hasPointerCapture(event.pointerId)) splitter.releasePointerCapture(event.pointerId);
    layout.classList.remove("is-task-resizing");
  };
  splitter.addEventListener("pointerup", stopSplit);
  splitter.addEventListener("pointercancel", stopSplit);

  splitter.addEventListener("keydown", (event) => {
    if (isNarrow()) {
      const now = getDetailHeight();
      if (event.key === "ArrowUp") {
        event.preventDefault();
        applyDetailHeight(now - 3);
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        applyDetailHeight(now + 3);
      }
      return;
    }
    const now = getDetailWidth();
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      applyDetailWidth(now + 16);
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      applyDetailWidth(now - 16);
    }
  });

  splitter.addEventListener("dblclick", () => {
    if (isNarrow()) applyDetailHeight(DETAIL_H.default);
    else applyDetailWidth(DETAIL_W.default);
  });

  const onLayoutResize = () => {
    if (!isNarrow()) applyDetailWidth(getDetailWidth(), false);
  };
  window.addEventListener("resize", onLayoutResize);
}
