import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const root = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(root, "..");
const ports = JSON.parse(
  readFileSync(path.join(repoRoot, "dev/ports.json"), "utf8"),
) as { spec: number };

export default defineConfig({
  root,
  base: "./",
  resolve: {
    alias: {
      fs: path.resolve(root, "src/shims/fs.ts"),
      path: path.resolve(root, "src/shims/path.ts"),
    },
  },
  server: {
    port: ports.spec,
    strictPort: true,
    fs: { allow: [repoRoot] },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2022",
    rollupOptions: {
      output: {
        manualChunks: undefined,
      },
    },
  },
  optimizeDeps: {
    include: ["fuzzball"],
  },
});
