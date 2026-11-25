// The editor window's shell: the app opens editor.html for the add-ins' formulas (app/src/editor_window.rs); this
// mounts ui/editor's window, hands the kernel the command catalogue (resources/symbols) and connects the window to
// the app's commands and events.
import { createRoot } from "react-dom/client";
import { EditorSessionProvider, EditorWindow, type EditorBridge, type EditorInput, type EditorOutcome } from "@app/editor";
import { provideCatalogue, type KernelCompletionRecord } from "@app/kernel/kernel/host.ts";
import records from "@resources/symbols/command-catalogue.json";
import frequency from "@resources/symbols/command-frequency.json";
import previews from "@resources/symbols/completion-previews.json";
import "./tauri";

// JSON reads every category as a string; the catalogue's are the toolbar's tabs
provideCatalogue({ records: records as KernelCompletionRecord[], frequency, previews });

const tauri = window.__TAURI__;
const bridge: EditorBridge = {
  input: () => tauri.core.invoke("editor_input") as Promise<EditorInput | null>,
  done: async (outcome: EditorOutcome) => {
    await tauri.core.invoke("editor_done", { outcome });
  },
  onOpen: (handler) => void tauri.event.listen("editor-open", handler),
  onCloseRequested: (handler) => void tauri.event.listen("editor-close-requested", handler),
};

const root = document.getElementById("editor");
if (!root) throw new Error("editor.html has no #editor element");
createRoot(root).render(
  <EditorSessionProvider>
    <EditorWindow bridge={bridge} />
  </EditorSessionProvider>,
);
