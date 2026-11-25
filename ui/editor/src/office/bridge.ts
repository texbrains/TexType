// What the editor window needs from the app that hosts it (ui/app-ui wires it to the app's commands and events).

/** The formula the window opens with. */
export interface EditorInput {
  /** The formula's LaTeX, or null for a new formula. */
  latex: string | null;
  display: boolean;
  /** The size of the text the formula goes into, in points. */
  fontSizePt: number;
}

export type EditorOutcome = { kind: "inserted"; latex: string; fontSizePt: number } | { kind: "cancelled" };

export interface EditorBridge {
  /** The formula to show, or null when none is open. */
  input(): Promise<EditorInput | null>;
  /**
   * Ends the formula. An insert the app cannot convert is refused with the reason (a string) and the formula stays
   * open for the user to correct.
   */
  done(outcome: EditorOutcome): Promise<void>;
  /** A new formula was opened in the (already loaded) window. */
  onOpen(handler: () => void): void;
  /** The user closed the window with its title bar. */
  onCloseRequested(handler: () => void): void;
}
