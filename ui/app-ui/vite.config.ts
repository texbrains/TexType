import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// Built into dist/, which app/tauri.conf.json embeds into the program: the main window (index.html), the editor
// window (editor.html) and the hidden render page (render.html).
export default defineConfig({
  base: "./",
  plugins: [react()],
  resolve: {
    // the catalogues the editor hands to the kernel (resources/symbols)
    alias: { "@resources": fileURLToPath(new URL("../../resources", import.meta.url)) },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: { input: { main: "index.html", editor: "editor.html", render: "render.html" } },
  },
});
