// The formula editor (ui/editor/README.md). Today: the window an add-in opens for one formula.
import "./styles/tokens.css";
import "./styles/base.css";
export { EditorWindow } from "./office/EditorWindow";
export type { EditorBridge, EditorInput, EditorOutcome } from "./office/bridge";
export { EditorSessionProvider } from "./history/EditorSession";
export { KernelErrorBoundary as EditorErrorBoundary } from "./runtime/kernelErrorBoundary";
