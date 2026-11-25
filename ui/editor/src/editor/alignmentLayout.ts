import { useLayoutEffect, type RefObject } from "react";
import type { MathfieldElement } from "@app/kernel/kernel/mathlive.ts";
import type { FormulaAlignment, FormulaLine } from "../types/formula";
import {
  hasKernelAlignmentMarker,
  KERNEL_ALIGNMENT_MARKER_CLASS,
} from "./alignmentMarkers";

function resolveExplicitAlignmentVisualAnchor(marker: HTMLElement) {
  const markerBounds = marker.getBoundingClientRect();
  const parent = marker.parentElement;
  if (!parent) return markerBounds.left;

  for (
    let sibling = marker.nextElementSibling;
    sibling;
    sibling = sibling.nextElementSibling
  ) {
    const candidates: Element[] = sibling.hasAttribute("data-atom-id")
      ? [sibling, ...sibling.querySelectorAll("[data-atom-id]")]
      : [...sibling.querySelectorAll("[data-atom-id]")];
    for (const candidate of candidates) {
      if (!(candidate instanceof HTMLElement)) continue;
      const bounds = candidate.getBoundingClientRect();
      if (bounds.width <= 0.01 || bounds.height <= 0.01) continue;
      return bounds.left;
    }
  }

  return markerBounds.left;
}

/**
 * Lines up the rows' explicit alignment points (&) as TeX's align does: each
 * marker column as wide as its widest row, the group placed by the editor's
 * alignment. Runs when the code format is an align format or a row has markers.
 */
function refreshExplicitAlignmentLayout(
  fields: Map<string, MathfieldElement>,
  lines: readonly FormulaLine[],
  alignEnvironment: boolean,
  formulaAlignment: FormulaAlignment,
) {
  const registered = Array.from(fields.values());
  for (const field of registered) {
    const host = field.closest<HTMLElement>("[data-field-host]");
    host?.removeAttribute("data-explicit-align");
    field.style.removeProperty("margin-left");
    const previousMarkerCount = Number.parseInt(
      field.dataset.kernelAlignmentMarkerCount ?? "0",
      10,
    );
    if (Number.isFinite(previousMarkerCount)) {
      for (
        let markerIndex = 0;
        markerIndex < previousMarkerCount;
        markerIndex += 1
      ) {
        field.style.removeProperty(`--kernel-align-marker-${markerIndex}-left`);
        field.style.removeProperty(
          `--kernel-align-marker-${markerIndex}-right`,
        );
      }
    }
    delete field.dataset.kernelAlignmentMarkerCount;
  }
  const hasAlignmentMarkers = lines.some((line) =>
    hasKernelAlignmentMarker(line.latex),
  );
  if (!alignEnvironment && !hasAlignmentMarkers) return;

  const marked = lines.flatMap((line) => {
    const field = fields.get(line.id);
    if (!field?.isConnected) return [];
    const host = field.closest<HTMLElement>("[data-field-host]");
    const markers = Array.from(
      field.shadowRoot?.querySelectorAll<HTMLElement>(
        `.${KERNEL_ALIGNMENT_MARKER_CLASS}`,
      ) ?? [],
    );
    if (!host || !markers.length) return [];
    const fieldBounds = field.getBoundingClientRect();
    const markerOffsets = markers.map(
      (marker) =>
        resolveExplicitAlignmentVisualAnchor(marker) - fieldBounds.left,
    );
    const segmentWidths = markerOffsets.map((offset, index) =>
      Math.max(0, offset - (index === 0 ? 0 : markerOffsets[index - 1])),
    );
    segmentWidths.push(
      Math.max(0, fieldBounds.right - fieldBounds.left - markerOffsets.at(-1)!),
    );
    return [{ field, host, markers, segmentWidths }];
  });
  if (!marked.length) return;

  const maxMarkerCount = Math.max(
    ...marked.map((entry) => entry.markers.length),
  );
  const columnWidths = Array.from({ length: maxMarkerCount + 1 }, (_, column) =>
    Math.max(0, ...marked.map((entry) => entry.segmentWidths[column] ?? 0)),
  );
  // TeX align/aligned groups columns in right/left pairs. There is no gap
  // inside a pair, while consecutive pairs are separated by 2em. A single
  // marker therefore keeps the exact historical TexType layout; extra
  // markers add only the inter-pair spacing needed by `&&`, `&&&`, ... .
  const fontSizePx = Number.parseFloat(
    getComputedStyle(marked[0].field).fontSize,
  );
  const pairGap = Number.isFinite(fontSizePx) ? fontSizePx * 2 : 0;
  const pairGapCount = Math.floor(maxMarkerCount / 2);
  const alignedWidth =
    columnWidths.reduce((total, width) => total + width, 0) +
    pairGap * pairGapCount;

  // The layout engine moves everything after marker N (and the marker itself) by the space the CSS variables
  // --kernel-align-marker-N-left/right give the markers up to it (tex-layout alignShift); margins on the
  // marker elements would move the markers a second time.
  for (const entry of marked) {
    const hostWidth = entry.host.getBoundingClientRect().width;
    const groupStart =
      formulaAlignment === "left"
        ? 0
        : formulaAlignment === "right"
          ? Math.max(0, hostWidth - alignedWidth)
          : Math.max(0, (hostWidth - alignedWidth) / 2);
    const fieldOffset = Math.max(
      0,
      groupStart + columnWidths[0] - entry.segmentWidths[0],
    );
    entry.host.setAttribute("data-explicit-align", "");
    entry.field.style.marginLeft = `${fieldOffset}px`;

    entry.field.dataset.kernelAlignmentMarkerCount = String(
      entry.markers.length,
    );
    entry.markers.forEach((_marker, markerIndex) => {
      let left = 0;
      // Apply each column's compensation immediately before its own marker.
      // Putting the next-column fill on the preceding marker's right margin
      // leaves one MathLive marker-atom width behind for consecutive `&&`
      // markers in WebView2/Chromium, which visibly shifts later anchors.
      if (markerIndex > 0) {
        left = Math.max(
          0,
          columnWidths[markerIndex] - (entry.segmentWidths[markerIndex] ?? 0),
        );
        if (markerIndex % 2 !== 0) left += pairGap;
      }
      entry.field.style.setProperty(
        `--kernel-align-marker-${markerIndex}-left`,
        `${left}px`,
      );
      entry.field.style.setProperty(
        `--kernel-align-marker-${markerIndex}-right`,
        "0px",
      );
    });
  }

  // MathLive's zero-width class atom can report a different inline box
  // origin when two markers are consecutive (`&&`). Reconcile the rendered
  // marker positions from left to right after the analytical column pass;
  // each non-negative correction also advances every later column.
  for (let markerIndex = 1; markerIndex < maxMarkerCount; markerIndex += 1) {
    const positioned = marked.flatMap((entry) => {
      const marker = entry.markers[markerIndex];
      return marker
        ? [{ entry, marker, left: marker.getBoundingClientRect().left }]
        : [];
    });
    if (!positioned.length) continue;
    const targetLeft = Math.max(...positioned.map((item) => item.left));
    for (const item of positioned) {
      const correction = Math.max(0, targetLeft - item.left);
      if (correction <= 0.01) continue;
      const property = `--kernel-align-marker-${markerIndex}-left`;
      const current = Number.parseFloat(
        item.entry.field.style.getPropertyValue(property) || "0",
      );
      item.entry.field.style.setProperty(
        property,
        `${(Number.isFinite(current) ? current : 0) + correction}px`,
      );
    }
  }
}

/** Lays out the alignment points after each render that can move them, and on window resizes. */
export function useAlignmentLayout(
  fieldRefs: RefObject<Map<string, MathfieldElement>>,
  linesRef: RefObject<FormulaLine[]>,
  alignEnvironment: boolean,
  formulaAlignment: FormulaAlignment,
  layoutInputs: readonly unknown[],
) {
  useLayoutEffect(() => {
    const refresh = () =>
      refreshExplicitAlignmentLayout(
        fieldRefs.current,
        linesRef.current,
        alignEnvironment,
        formulaAlignment,
      );
    let firstFrame = 0;
    let secondFrame = 0;
    const schedule = () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
      firstFrame = window.requestAnimationFrame(() => {
        refresh();
        secondFrame = window.requestAnimationFrame(refresh);
      });
    };
    schedule();
    window.addEventListener("resize", schedule);
    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
      window.removeEventListener("resize", schedule);
    };
  }, [alignEnvironment, formulaAlignment, ...layoutInputs]);
}
