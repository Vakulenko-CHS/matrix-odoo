import { slugifyHeading } from "./mdSlug.ts";

type ListResponse = {
  path: string;
  parent: string;
  entries: { name: string; kind: "file" | "dir"; path: string }[];
};

let dialog: HTMLDialogElement;
let crumbEl: HTMLElement;
let treeEl: HTMLElement;
let previewEl: HTMLElement;
let titleEl: HTMLElement;
let currentPath = ".";

async function fetchList(path: string): Promise<ListResponse> {
  const q = new URLSearchParams({ path });
  const r = await fetch(`/__repo/list?${q}`);
  if (!r.ok) throw new Error(await r.text());
  return r.json() as Promise<ListResponse>;
}

async function fetchRaw(path: string): Promise<string> {
  const q = new URLSearchParams({ path });
  const r = await fetch(`/__repo/raw?${q}`);
  if (!r.ok) throw new Error(await r.text());
  return r.text();
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function formatInline(line: string): string {
  return escapeHtml(line)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

function scrollToHash(hash: string) {
  if (!hash) return;
  const id = hash.toLowerCase();
  requestAnimationFrame(() => {
    const target = previewEl.querySelector(`#${CSS.escape(id)}`);
    target?.scrollIntoView({ block: "start", behavior: "smooth" });
    target?.classList.add("repo-hash-target");
    setTimeout(() => target?.classList.remove("repo-hash-target"), 2500);
  });
}

function renderPreview(text: string, path: string, hash = "") {
  titleEl.textContent = hash ? `${path}#${hash}` : path;
  if (path.endsWith(".md")) {
    previewEl.innerHTML = simpleMd(text);
    previewEl.classList.add("md");
    scrollToHash(hash);
  } else {
    previewEl.textContent = text;
    previewEl.classList.remove("md");
  }
}

function simpleMd(raw: string): string {
  const used = new Map<string, number>();
  const chunks: string[] = [];
  let para: string[] = [];

  const flushPara = () => {
    if (!para.length) return;
    chunks.push(`<p>${formatInline(para.join(" "))}</p>`);
    para = [];
  };

  for (const line of raw.split("\n")) {
    const hm = line.match(/^(#{1,3})\s+(.+)$/);
    if (hm) {
      flushPara();
      const level = hm[1].length;
      const text = hm[2];
      const id = slugifyHeading(text, used);
      const tag = level === 1 ? "h1" : level === 2 ? "h2" : "h3";
      chunks.push(`<${tag} id="${id}">${escapeHtml(text)}</${tag}>`);
      continue;
    }
    if (line.startsWith("- ")) {
      flushPara();
      chunks.push(`<p class="md-li">• ${formatInline(line.slice(2))}</p>`);
      continue;
    }
    if (line.trim() === "") {
      flushPara();
      continue;
    }
    para.push(line);
  }
  flushPara();
  return chunks.join("") || `<p>${formatInline(raw)}</p>`;
}

async function loadDir(path: string) {
  currentPath = path;
  const data = await fetchList(path);
  crumbEl.replaceChildren();
  const parts = data.path === "." ? [] : data.path.split("/");
  const up = document.createElement("button");
  up.type = "button";
  up.className = "repo-crumb-btn";
  up.textContent = "repo";
  up.addEventListener("click", () => void loadDir("."));
  crumbEl.appendChild(up);
  let acc = "";
  for (const part of parts) {
    acc = acc ? `${acc}/${part}` : part;
    crumbEl.appendChild(document.createTextNode(" / "));
    const b = document.createElement("button");
    b.type = "button";
    b.className = "repo-crumb-btn";
    b.textContent = part;
    const p = acc;
    b.addEventListener("click", () => void loadDir(p));
    crumbEl.appendChild(b);
  }

  treeEl.replaceChildren();
  if (data.parent !== data.path && data.path !== ".") {
    const parent = data.parent === "" ? "." : data.parent;
    const row = document.createElement("button");
    row.type = "button";
    row.className = "repo-entry dir";
    row.textContent = "↑ ..";
    row.addEventListener("click", () => void loadDir(parent));
    treeEl.appendChild(row);
  }
  for (const e of data.entries) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = `repo-entry ${e.kind}`;
    row.textContent = e.kind === "dir" ? `${e.name}/` : e.name;
    row.dataset.path = e.path;
    row.addEventListener("click", () => {
      if (e.kind === "dir") void loadDir(e.path);
      else void openFile(e.path);
    });
    treeEl.appendChild(row);
  }
}

async function openFile(path: string, hash = "") {
  const text = await fetchRaw(path);
  renderPreview(text, path, hash);
  treeEl.querySelectorAll(".repo-entry.on").forEach((n) => n.classList.remove("on"));
  treeEl.querySelector(`.repo-entry[data-path="${CSS.escape(path)}"]`)?.classList.add("on");
}

export function mountRepoBrowser(): void {
  dialog = document.createElement("dialog");
  dialog.className = "repo-dialog";
  dialog.innerHTML = `
    <div class="repo-dialog-head">
      <span class="repo-dialog-label">Файл репо</span>
      <button type="button" class="repo-dialog-close" aria-label="Закрити">×</button>
    </div>
    <div class="repo-dialog-body">
      <aside class="repo-sidebar">
        <nav class="repo-breadcrumb" aria-label="Шлях"></nav>
        <div class="repo-tree"></div>
      </aside>
      <div class="repo-preview-wrap">
        <div class="repo-preview-title"></div>
        <article class="repo-preview"></article>
      </div>
    </div>
  `;
  document.body.appendChild(dialog);
  crumbEl = dialog.querySelector(".repo-breadcrumb")!;
  treeEl = dialog.querySelector(".repo-tree")!;
  previewEl = dialog.querySelector(".repo-preview")!;
  titleEl = dialog.querySelector(".repo-preview-title")!;

  dialog.querySelector(".repo-dialog-close")!.addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (ev) => {
    if (ev.target === dialog) dialog.close();
  });
}

export async function openRepoPath(repoPath: string, hash = ""): Promise<void> {
  if (!dialog) mountRepoBrowser();
  dialog.showModal();
  previewEl.textContent = "Завантаження…";
  titleEl.textContent = "";
  const dir = repoPath.includes("/") ? repoPath.replace(/\/[^/]+$/, "") : ".";
  await loadDir(dir || ".");
  try {
    await openFile(repoPath, hash);
  } catch {
    renderPreview("(не текстовий файл або не знайдено)", repoPath, hash);
  }
}

export function bindRepoLinks(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>("[data-repo-path]").forEach((el) => {
    el.addEventListener("click", () => {
      const p = el.getAttribute("data-repo-path");
      const hash = el.getAttribute("data-repo-hash") ?? "";
      if (p) void openRepoPath(p, hash);
    });
  });
}
