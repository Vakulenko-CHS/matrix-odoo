import fs from "node:fs";
import path from "node:path";
import type { Plugin, ViteDevServer } from "vite";

function safeRepoPath(repoRoot: string, rel: string): string | null {
  const stack: string[] = [];
  for (const part of rel.replace(/\\/g, "/").replace(/^\/+/, "").split("/")) {
    if (part === "..") {
      if (!stack.length) return null;
      stack.pop();
    } else if (part !== "." && part !== "") stack.push(part);
  }
  const abs = path.resolve(repoRoot, ...stack);
  if (!abs.startsWith(repoRoot + path.sep) && abs !== repoRoot) return null;
  return abs;
}

function sendJson(res: import("http").ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function handleList(repoRoot: string, rel: string, res: import("http").ServerResponse) {
  const abs = safeRepoPath(repoRoot, rel || ".");
  if (!abs) return sendJson(res, 400, { error: "bad path" });
  let st: fs.Stats;
  try {
    st = fs.statSync(abs);
  } catch {
    return sendJson(res, 404, { error: "not found" });
  }
  if (!st.isDirectory()) return sendJson(res, 400, { error: "not a directory" });
  const parent = path.relative(repoRoot, path.dirname(abs));
  const dirRel = path.relative(repoRoot, abs) || ".";
  const names = fs.readdirSync(abs, { withFileTypes: true });
  const entries = names
    .filter((d) => !d.name.startsWith(".") || d.name === ".ai")
    .map((d) => {
      const childRel = path.join(dirRel === "." ? "" : dirRel, d.name).replace(/\\/g, "/");
      return {
        name: d.name,
        kind: d.isDirectory() ? "dir" : "file",
        path: childRel.startsWith("/") ? childRel.slice(1) : childRel,
      };
    })
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
      return a.name.localeCompare(b.name, "uk");
    });
  sendJson(res, 200, { path: dirRel.replace(/\\/g, "/"), parent: parent.replace(/\\/g, "/") || ".", entries });
}

function handleRaw(repoRoot: string, rel: string, res: import("http").ServerResponse) {
  const abs = safeRepoPath(repoRoot, rel);
  if (!abs) return sendJson(res, 400, { error: "bad path" });
  let st: fs.Stats;
  try {
    st = fs.statSync(abs);
  } catch {
    return sendJson(res, 404, { error: "not found" });
  }
  if (!st.isFile()) return sendJson(res, 400, { error: "not a file" });
  if (st.size > 2_000_000) return sendJson(res, 413, { error: "file too large" });
  const text = fs.readFileSync(abs, "utf8");
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.end(text);
}

export function repoApiPlugin(repoRoot: string): Plugin {
  return {
    name: "matrix-tasks-repo-api",
    configureServer(server: ViteDevServer) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith("/__repo/")) return next();
        const url = new URL(req.url, "http://localhost");
        const rel = url.searchParams.get("path") ?? "";
        if (url.pathname === "/__repo/list") return handleList(repoRoot, rel, res);
        if (url.pathname === "/__repo/raw") return handleRaw(repoRoot, rel, res);
        sendJson(res, 404, { error: "unknown" });
      });
    },
  };
}
