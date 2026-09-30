import { defineConfig } from "vite";
import { fileURLToPath, URL } from "node:url";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const appHtml = fileURLToPath(new URL("./index.html", import.meta.url));
const outDir = fileURLToPath(new URL("../../dist/lab", import.meta.url));

export default defineConfig({
  root: repoRoot,
  publicDir: false,
  server: {
    port: 5173,
    strictPort: true,
    fs: { allow: [repoRoot] },
  },
  build: {
    outDir,
    emptyOutDir: true,
    rollupOptions: { input: appHtml },
  },
});
