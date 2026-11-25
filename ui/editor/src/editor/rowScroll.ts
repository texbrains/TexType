// Keeps the rows pane's scroll position across a structural change (a row added, split, merged, removed):
// the anchor row stays where it was on screen.

import { scrollContainer } from "./fieldHelpers";

export interface EditorScrollSnapshot {
  scroller: HTMLElement;
  anchorLineId: string | null;
  anchorOffset: number;
  scrollTop: number;
}

export function captureEditorScrollSnapshot(
  surface: HTMLElement | null,
  preferredLineId?: string | null,
): EditorScrollSnapshot | null {
  const scroller = scrollContainer(surface);
  if (!scroller) return null;
  const scrollerRect = scroller.getBoundingClientRect();
  const rows = Array.from(
    surface?.querySelectorAll<HTMLElement>("[data-line-id]") ?? [],
  );
  const preferredRow = preferredLineId
    ? (rows.find((row) => row.dataset.lineId === preferredLineId) ?? null)
    : null;
  const visibleRow = rows.find((row) => {
    const rect = row.getBoundingClientRect();
    return rect.bottom > scrollerRect.top && rect.top < scrollerRect.bottom;
  });
  const anchorRow = preferredRow ?? visibleRow ?? null;
  return {
    scroller,
    anchorLineId: anchorRow?.dataset.lineId ?? null,
    anchorOffset: anchorRow
      ? anchorRow.getBoundingClientRect().top - scrollerRect.top
      : 0,
    scrollTop: scroller.scrollTop,
  };
}

function applyEditorScrollSnapshot(
  surface: HTMLElement | null,
  snapshot: EditorScrollSnapshot | null,
) {
  if (!snapshot?.scroller.isConnected) return;
  const { scroller } = snapshot;
  const scrollerRect = scroller.getBoundingClientRect();
  const anchorRow = snapshot.anchorLineId
    ? (surface?.querySelector<HTMLElement>(
        `[data-line-id="${snapshot.anchorLineId}"]`,
      ) ?? null)
    : null;
  if (anchorRow?.isConnected) {
    const currentOffset =
      anchorRow.getBoundingClientRect().top - scrollerRect.top;
    const offsetDelta = currentOffset - snapshot.anchorOffset;
    if (Math.abs(offsetDelta) > 0.5) {
      scroller.scrollTop += offsetDelta;
    }
  } else if (Math.abs(scroller.scrollTop - snapshot.scrollTop) > 0.5) {
    scroller.scrollTop = snapshot.scrollTop;
  }
}

/** Applies the snapshot now and again after React's commit and the next frame (the rows lay out late). */
export function stabilizeEditorScroll(
  surface: HTMLElement | null,
  snapshot: EditorScrollSnapshot | null,
) {
  const apply = () => applyEditorScrollSnapshot(surface, snapshot);
  apply();
  queueMicrotask(apply);
  window.requestAnimationFrame(apply);
}
