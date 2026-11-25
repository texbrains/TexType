import type { ReactNode, RefObject } from "react";
import type { MathEditorHandle, MathEditorInsertionTarget } from "../editor/MathEditor";
import type { DocumentSnapshot, ReplaceDocumentEntry } from "../history/historyTypes";

export interface EditorWorkspaceProps {
  /** The Office frame's header controls: before the space (size) and after it (undo, redo, cancel, insert). */
  officeHeaderLeadingControls?: ReactNode;
  officeHeaderTrailingActions?: ReactNode;
  editorRef: RefObject<MathEditorHandle | null>;
  /** Changes when another formula is opened: the rows and the source editor start afresh. */
  editorInstanceKey?: string;
  /** An image pasted into the rows (the entry point for recognizing it). */
  onPasteImage?: (file: File, target: MathEditorInsertionTarget) => void;
  onReplaceDocument: (snapshot: DocumentSnapshot, source: ReplaceDocumentEntry["source"]) => boolean;
}
