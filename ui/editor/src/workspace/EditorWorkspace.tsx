import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Code2 } from "lucide-react";
import { MathEditor } from "../editor/MathEditor";
import { FormulaToolbar } from "../toolbar/FormulaToolbar";
import { LatexSourceEditor } from "../source-editor/LatexSourceEditor";
import { formatLatexSourceForEditor } from "../source-editor/latexSourceEditorSupport";
import { useEditorStore } from "../stores/editorStore";
import { formatFormulaLinesUniversal } from "../clipboard/LatexCopyService";
import { parseUniversalLatexSourceDraft } from "../clipboard/latexSourceParse";
import { normalizeChineseLatex } from "../editor/normalizeChineseLatex";
import { storedLatexToUser, userLatexToStored } from "@app/kernel/latex/exam-zh-symbols.ts";
import { reconcileFormulaLines } from "../history/documentHistory";
import { useHistorySnapshot } from "../history/EditorSession";
import type { FormulaAlignment, FormulaLine } from "../types/formula";
import { FormulaFormattingControls, useTypingStyle } from "./FormulaFormattingControls";
import type { EditorWorkspaceProps } from "./workspaceTypes";
import styles from "./EditorWorkspace.module.css";

// The side panel's width, set by dragging the divider beside it; the editor always keeps EDITOR_RESERVE.
const DEFAULT_PANEL_WIDTH = 252;
const MIN_PANEL_WIDTH = 200;
const EDITOR_RESERVE = 300;
const SOURCE_SHORTCUT = "Ctrl+\\";
const SOURCE_SHORTCUT_KEYS = "Control+Backslash";

interface SourceDraftFallback {
  source: string;
  error: string;
  previewLines: FormulaLine[] | null;
}

/** The Office window's editor: header slot, formula rows, side panel, bottom bar and the LaTeX source dock. */
export function EditorWorkspace({
  officeHeaderLeadingControls,
  officeHeaderTrailingActions,
  editorRef,
  editorInstanceKey,
  onPasteImage,
  onReplaceDocument,
}: EditorWorkspaceProps) {
  const workspaceRef = useRef<HTMLElement>(null);
  const resizeCleanupRef = useRef<(() => void) | null>(null);
  const resizeFrameRef = useRef<number | null>(null);
  const [panelWidth, setPanelWidth] = useState(DEFAULT_PANEL_WIDTH);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [sourceDraftFallback, setSourceDraftFallback] = useState<SourceDraftFallback | null>(null);
  const [sourceFocused, setSourceFocused] = useState(false);
  const sourceFocusedRef = useRef(false);
  const typing = useTypingStyle();
  const title = useEditorStore((state) => state.title);
  const lines = useEditorStore((state) => state.lines);
  const activeLineId = useEditorStore((state) => state.activeLineId);
  const isEn = useEditorStore((state) => state.language) === "en";
  const zoom = useEditorStore((state) => state.zoom);
  const formulaAlignment = useEditorStore((state) => state.formulaAlignment);
  const setFormulaAlignment = useEditorStore((state) => state.setFormulaAlignment);
  const latexFormatProfile = useEditorStore((state) => state.latexFormatProfile);
  // the source is written in the user's spelling of the congruence and similarity signs
  const examZhSymbols = useEditorStore((state) => state.examZhSymbols);
  const historyReplayActive = useHistorySnapshot().isReplaying;
  const sourceLatex = useMemo(
    () => storedLatexToUser(formatLatexSourceForEditor(formatFormulaLinesUniversal(lines, latexFormatProfile))),
    // examZhSymbols: storedLatexToUser reads the setting
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lines, latexFormatProfile, examZhSymbols],
  );

  const handleSourceFocusChange = (focused: boolean) => {
    sourceFocusedRef.current = focused;
    setSourceFocused(focused);
  };

  useLayoutEffect(() => {
    setSourceDraftFallback(null);
    handleSourceFocusChange(false);
  }, [editorInstanceKey]);

  useLayoutEffect(() => {
    if (!historyReplayActive) return;
    setSourceDraftFallback(null);
    handleSourceFocusChange(false);
  }, [historyReplayActive]);

  useEffect(() => {
    if (!sourceOpen) setSourceDraftFallback(null);
  }, [sourceOpen]);

  // Ctrl+\ moves focus between the formula and the LaTeX source, opening the source when needed.
  useEffect(() => {
    const toggleFormulaSourceFocus = (event: KeyboardEvent) => {
      if (
        event.isComposing ||
        !event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.shiftKey ||
        event.code !== "Backslash"
      ) {
        return;
      }
      const workspace = workspaceRef.current;
      if (!workspace || !event.composedPath().includes(workspace)) return;
      event.preventDefault();
      event.stopImmediatePropagation();

      if (sourceFocusedRef.current) {
        handleSourceFocusChange(false);
        window.requestAnimationFrame(() => editorRef.current?.focus());
        return;
      }
      setSourceOpen(true);
      // the source editor mounts after the next render
      const focusSource = () => {
        const content = workspaceRef.current?.querySelector<HTMLElement>("[data-source-editor] .cm-content");
        content?.focus({ preventScroll: true });
        return Boolean(content);
      };
      window.requestAnimationFrame(() => {
        if (!focusSource()) window.requestAnimationFrame(focusSource);
      });
    };
    document.addEventListener("keydown", toggleFormulaSourceFocus, true);
    return () => document.removeEventListener("keydown", toggleFormulaSourceFocus, true);
  }, [editorRef]);

  useEffect(
    () => () => {
      resizeCleanupRef.current?.();
      if (resizeFrameRef.current !== null) window.cancelAnimationFrame(resizeFrameRef.current);
    },
    [],
  );

  const panelWidthLimit = () => {
    const workspaceWidth = workspaceRef.current?.getBoundingClientRect().width ?? 1200;
    return Math.max(MIN_PANEL_WIDTH, workspaceWidth - EDITOR_RESERVE);
  };

  const commitPanelWidth = (value: number) => {
    const next = Math.min(panelWidthLimit(), Math.max(MIN_PANEL_WIDTH, value));
    setPanelWidth(next);
  };

  // The panel is on the right, so its width is measured from the workspace's right edge.
  const startPanelResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    resizeCleanupRef.current?.();

    const handle = event.currentTarget;
    const pointerId = event.pointerId;
    let latestValue = panelWidth;
    let finished = false;

    const move = (pointerEvent: PointerEvent) => {
      if (pointerEvent.pointerId !== pointerId) return;
      const bounds = workspaceRef.current?.getBoundingClientRect();
      if (!bounds) return;
      latestValue = bounds.right - pointerEvent.clientX;
      if (resizeFrameRef.current === null) {
        resizeFrameRef.current = window.requestAnimationFrame(() => {
          resizeFrameRef.current = null;
          commitPanelWidth(latestValue);
        });
      }
      pointerEvent.preventDefault();
    };
    const finish = () => {
      if (finished) return;
      finished = true;
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", finish);
      document.removeEventListener("pointercancel", finish);
      window.removeEventListener("blur", finish);
      if (resizeFrameRef.current !== null) {
        window.cancelAnimationFrame(resizeFrameRef.current);
        resizeFrameRef.current = null;
      }
      commitPanelWidth(latestValue);
      if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
      if (resizeCleanupRef.current === finish) resizeCleanupRef.current = null;
    };

    handle.setPointerCapture(pointerId);
    document.addEventListener("pointermove", move, { passive: false });
    document.addEventListener("pointerup", finish);
    document.addEventListener("pointercancel", finish);
    window.addEventListener("blur", finish);
    resizeCleanupRef.current = finish;
  };

  const applyFormulaAlignment = (alignment: FormulaAlignment) => {
    setFormulaAlignment(alignment);
    editorRef.current?.focus();
  };

  // A source edit replaces the rows as it is typed; an incomplete one only previews.
  const applySource = (source: string) => {
    const parsed = parseUniversalLatexSourceDraft(source, latexFormatProfile);
    if (!parsed.valid) {
      const previewValues = (parsed.previewValues ?? parsed.values).map((value) =>
        normalizeChineseLatex(userLatexToStored(value)),
      );
      setSourceDraftFallback({
        source,
        error: parsed.error ?? "invalid-latex",
        previewLines: previewValues.length
          ? reconcileFormulaLines(previewValues, lines, parsed.modes, parsed.displayStyles)
          : null,
      });
      return parsed;
    }

    setSourceDraftFallback(null);
    const values = parsed.values.map((value) => normalizeChineseLatex(userLatexToStored(value)));
    const nextLines = reconcileFormulaLines(values, lines, parsed.modes, parsed.displayStyles);
    onReplaceDocument(
      {
        title,
        lines: nextLines,
        activeLineId: nextLines.some((line) => line.id === activeLineId) ? activeLineId : nextLines[0]?.id ?? null,
        formulaAlignment,
        selectionByLineId: sourceFocusedRef.current ? {} : editorRef.current?.getSelectionMap() ?? {},
      },
      "source-apply",
    );
    return parsed;
  };

  const renderVisualEditor = () => {
    const previewLines = sourceDraftFallback?.previewLines;
    if (sourceDraftFallback && !previewLines) {
      return (
        <section
          className={styles.draft}
          data-source-draft-error={sourceDraftFallback.error}
          aria-live="polite"
          aria-label={isEn ? "Unclosed LaTeX" : "LaTeX 未闭合"}
        >
          <div className={styles.draftHeading}>
            <Code2 size={16} />
            <span>{isEn ? "Incomplete LaTeX environment" : "LaTeX 环境未闭合"}</span>
          </div>
          <pre className={styles.draftCode}>{sourceDraftFallback.source || " "}</pre>
        </section>
      );
    }

    const visualLines = previewLines ?? lines;
    return (
      <MathEditor
        key={editorInstanceKey}
        ref={editorRef}
        lines={visualLines}
        activeLineId={
          visualLines.some((line) => line.id === activeLineId) ? activeLineId : visualLines[0]?.id ?? null
        }
        formulaAlignment={formulaAlignment}
        zoom={zoom}
        persistentTypingStyle={typing.style}
        previewOnly={sourceFocused || Boolean(sourceDraftFallback)}
        onPreviewActivate={sourceDraftFallback ? undefined : () => handleSourceFocusChange(false)}
        draftError={sourceDraftFallback?.error}
        onPasteImage={previewLines ? undefined : onPasteImage}
      />
    );
  };

  const sourceToggleLabel = sourceOpen
    ? isEn ? "Hide LaTeX source" : "收起 LaTeX 源码"
    : isEn ? "Show LaTeX source" : "展开 LaTeX 源码";

  return (
    <main
      ref={workspaceRef}
      className={styles.workspace}
      style={{ "--local-panel-width": `${panelWidth}px` } as CSSProperties}
    >
      <header className={styles.header}>
        <div className={styles.headerGroup}>{officeHeaderLeadingControls}</div>
        <div className={styles.headerGroup}>{officeHeaderTrailingActions}</div>
      </header>

      <section className={styles.pane}>
        <div className={styles.rows}>{renderVisualEditor()}</div>
        <section className={styles.dock} aria-label={isEn ? "Formatting and LaTeX source" : "公式格式与 LaTeX 源码"}>
          <nav className={styles.bar} aria-label={isEn ? "Source bar" : "源码栏"}>
            <div className={styles.controls}>
              <FormulaFormattingControls
                editorRef={editorRef}
                isEn={isEn}
                formulaAlignment={formulaAlignment}
                onAlignment={applyFormulaAlignment}
                typing={typing}
              />
            </div>
            <button
              type="button"
              className={styles.sourceToggle}
              aria-pressed={sourceOpen}
              aria-keyshortcuts={SOURCE_SHORTCUT_KEYS}
              title={`${sourceToggleLabel}${isEn ? ` (${SOURCE_SHORTCUT})` : `（${SOURCE_SHORTCUT}）`}`}
              onClick={() => setSourceOpen(!sourceOpen)}
            >
              <Code2 size={14} />
              <span>{isEn ? "LaTeX source" : "LaTeX 源码"}</span>
            </button>
          </nav>
          {sourceOpen && (
            <div className={styles.source}>
              <LatexSourceEditor
                key={editorInstanceKey}
                latex={sourceLatex}
                onLiveChange={applySource}
                onFocusChange={handleSourceFocusChange}
                forceExternalSync={historyReplayActive}
              />
            </div>
          )}
        </section>
      </section>

      <div
        className={styles.resizer}
        role="separator"
        tabIndex={0}
        aria-orientation="vertical"
        aria-valuemin={MIN_PANEL_WIDTH}
        aria-valuemax={Math.round(panelWidthLimit())}
        aria-valuenow={Math.round(panelWidth)}
        aria-label={isEn ? "Resize formula tools" : "调整公式工具区宽度"}
        title={isEn ? "Resize" : "调整宽度"}
        onPointerDown={startPanelResize}
        onDoubleClick={() => commitPanelWidth(DEFAULT_PANEL_WIDTH)}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") {
            event.preventDefault();
            commitPanelWidth(panelWidth + 16);
          } else if (event.key === "ArrowRight") {
            event.preventDefault();
            commitPanelWidth(panelWidth - 16);
          }
        }}
      />
      <FormulaToolbar onInsert={(command) => editorRef.current?.insertCommand(command)} />
    </main>
  );
}
