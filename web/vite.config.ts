import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const root = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(root, "..");

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
