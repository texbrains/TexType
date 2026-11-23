import { defineConfig } from "vite";

// Built into dist/, which app/tauri.conf.json embeds into the program.
export default defineConfig({
  base: "./",
  build: { outDir: "dist", emptyOutDir: true },
});
