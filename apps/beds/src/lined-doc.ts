/** Lined read-only pane: full-height gutter column + scrolling body (beds + diff). */

export type LinedRow = {
  text: string;
  lineNo?: number | null;
  rowClass?: string;
  gutterHtml?: HTMLElement;
};

export type LinedPane = {
  setText: (text: string) => void;
  setRows: (rows: LinedRow[]) => void;
  setMessage: (message: string) => void;
  body: HTMLElement;
};

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

function linedLn(n: number | null | undefined): HTMLSpanElement {
  const span = el("span", "lined-ln");
  span.textContent = n != null ? String(n) : "";
  return span;
}

function bindGutterHeights(gutterTrack: HTMLElement, bodyInset: HTMLElement): {
  schedule: () => void;
  observe: () => void;
  watchCrop: (el: HTMLElement) => void;
} {
  let queued = false;
  const sync = () => {
    const ticks = gutterTrack.children;
    const marks = bodyInset.children;
    const n = Math.min(ticks.length, marks.length);
    if (!n) return;
    let prev = (marks[0] as HTMLElement).getBoundingClientRect().top;
    for (let i = 0; i < n; i++) {
      const bottom = (marks[i] as HTMLElement).getBoundingClientRect().bottom;
      (ticks[i] as HTMLElement).style.height = `${bottom - prev}px`;
      prev = bottom;
    }
  };
  const schedule = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      sync();
      requestAnimationFrame(() => {
        sync();
        queued = false;
      });
    });
  };
  const ro = new ResizeObserver(schedule);
  const observe = () => {
    ro.disconnect();
    for (const mark of bodyInset.children) ro.observe(mark);
  };
  const watchCrop = (el: HTMLElement) => ro.observe(el);
  return { schedule, observe, watchCrop };
}

export function createLinedPane(host: HTMLElement, docId: string): LinedPane {
  host.replaceChildren();
  host.classList.add("lined-host");

  const crop = el("div", "lined-crop");
  const gutter = el("div", "lined-gutter");
  gutter.setAttribute("aria-hidden", "true");
  const gutterTrack = el("div", "lined-gutter-track");
  const body = el("div", "lined-body");
  const bodyInset = el("div", "lined-inset");
  body.dataset.docId = docId;
  gutter.append(gutterTrack);
  body.append(bodyInset);
  crop.append(gutter, body);
  host.append(crop);

  let activeLine: number | null = null;
  const { schedule, observe, watchCrop } = bindGutterHeights(gutterTrack, bodyInset);

  body.addEventListener(
    "scroll",
    () => {
      gutterTrack.style.transform = `translateY(${-body.scrollTop}px)`;
    },
    { passive: true },
  );

  const setActiveLine = (n: number | null) => {
    activeLine = n;
    for (const tick of gutterTrack.querySelectorAll(".lined-gutter-row.active")) tick.classList.remove("active");
    for (const row of bodyInset.querySelectorAll(".lined-row.active")) row.classList.remove("active");
    if (n == null) return;
    gutterTrack.querySelector(`[data-line="${n}"]`)?.classList.add("active");
    bodyInset.querySelector(`#${CSS.escape(`${docId}-L${n}`)}`)?.classList.add("active");
  };

  const renderRows = (rows: LinedRow[]) => {
    gutterTrack.replaceChildren();
  bodyInset.replaceChildren();
    rows.forEach((row, i) => {
      const idN = i + 1;
      if (row.gutterHtml) {
        row.gutterHtml.dataset.line = String(idN);
        if (activeLine === idN) row.gutterHtml.classList.add("active");
        gutterTrack.append(row.gutterHtml);
      } else {
        const gRow = el("div", "lined-gutter-row");
        gRow.dataset.line = String(idN);
        if (activeLine === idN) gRow.classList.add("active");
        gRow.append(linedLn(row.lineNo ?? null));
        gutterTrack.append(gRow);
      }

      const bRow = el("div", "lined-row");
      bRow.id = `${docId}-L${idN}`;
      if (row.rowClass) bRow.classList.add(row.rowClass);
      if (activeLine === idN) bRow.classList.add("active");
      bRow.textContent = row.text.length ? row.text : "\u00a0";
      bodyInset.append(bRow);
    });
    observe();
    watchCrop(crop);
    gutterTrack.style.transform = `translateY(${-body.scrollTop}px)`;
    schedule();
  };

  bodyInset.addEventListener("click", (event) => {
    const row = (event.target as HTMLElement).closest(".lined-row");
    if (!(row instanceof HTMLElement) || !bodyInset.contains(row)) return;
    const m = /^(.+)-L(\d+)$/.exec(row.id);
    const n = m ? Number(m[2]) : null;
    setActiveLine(n === activeLine ? null : n);
  });

  void document.fonts.ready.then(schedule);
  document.fonts.addEventListener("loadingdone", schedule);

  return {
    body,
    setText(text: string) {
      const rows = text.split("\n").map((line, i) => ({
        text: line,
        lineNo: i + 1,
      }));
      renderRows(rows);
    },
    setRows(rows: LinedRow[]) {
      renderRows(rows);
    },
    setMessage(message: string) {
      gutterTrack.replaceChildren();
      bodyInset.replaceChildren();
      const p = el("p", "lined-message");
      p.textContent = message;
      bodyInset.append(p);
    },
  };
}

export function bindLinedPaneScrollSync(a: LinedPane, b: LinedPane): void {
  let lock = false;
  const pair = (from: HTMLElement, to: HTMLElement) => {
    if (lock) return;
    lock = true;
    to.scrollTop = from.scrollTop;
    to.scrollLeft = from.scrollLeft;
    lock = false;
  };
  a.body.addEventListener("scroll", () => pair(a.body, b.body), { passive: true });
  b.body.addEventListener("scroll", () => pair(b.body, a.body), { passive: true });
}
