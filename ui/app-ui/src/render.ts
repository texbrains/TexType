// The hidden render page's shell: the app opens render.html in a window it never shows (app/src/render.rs); the
// page itself is the kernel's.
import { startRenderPage } from "@app/kernel/render-page";
import "./tauri";

void startRenderPage(window.__TAURI__);
