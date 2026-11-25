// Ctrl+S inserts the formula (Cmd+S on a Mac keyboard), as in Office's own editors.

function isApplyShortcut(event: KeyboardEvent): boolean {
  const saveKey = event.code === "KeyS" || event.key.toLowerCase() === "s";
  const onePrimaryModifier = event.ctrlKey !== event.metaKey;
  return saveKey && onePrimaryModifier && !event.altKey && !event.shiftKey && !event.isComposing;
}

/** Calls `apply` on Ctrl+S anywhere in the window; returns the function that stops listening. */
export function onApplyShortcut(apply: () => void): () => void {
  const listener = (event: KeyboardEvent) => {
    if (!isApplyShortcut(event)) return;
    event.preventDefault();
    event.stopPropagation();
    apply();
  };
  window.addEventListener("keydown", listener, true);
  return () => window.removeEventListener("keydown", listener, true);
}
