import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { repoApiPlugin } from "./vite/repoApiPlugin.ts";

const root = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(root, "../..");
const ports = JSON.parse(
  readFileSync(path.join(repoRoot, "dev/ports.json"), "utf8"),
) as { tasks: number };

export default defineConfig({
  root,
  base: "./",
  plugins: [repoApiPlugin(repoRoot)],
  server: {
    port: ports.tasks,
    strictPort: true,
    fs: { allow: [repoRoot] },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2022",
  },
});
