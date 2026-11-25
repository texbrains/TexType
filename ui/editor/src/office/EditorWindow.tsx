// The editor window an add-in opens for one formula: the editor inside Office's frame (size, undo and redo, cancel,
// insert). It talks to the app only through its bridge: it reads the formula when the app opens one and answers
// with the inserted LaTeX or a cancel.
import { useEffect, useRef, useState } from "react";
import { Redo2, Undo2 } from "lucide-react";
import { EditorWorkspace } from "../workspace/EditorWorkspace";
import type { MathEditorHandle } from "../editor/MathEditor";
import { useDocumentSession, useHistoryManager, useHistorySnapshot } from "../history/EditorSession";
import { useEditorStore } from "../stores/editorStore";
import type { FormulaLine } from "../types/formula";
import { CHINESE_FONT_SIZES, pointSizes, wordFontSize } from "./fontSizes";
import { onApplyShortcut } from "./applyShortcut";
import { insertFailure } from "./messages";
import type { EditorBridge, EditorInput } from "./bridge";
import { Button } from "../controls/Button";
import styles from "./EditorWindow.module.css";

const TOAST_MS = 4000;

/** The rows as the LaTeX the app converts: one non-empty row per line. */
function latexOf(lines: readonly FormulaLine[]): string {
  return lines
    .map((line) => line.latex.trim())
    .filter(Boolean)
    .join("\n");
}

export function EditorWindow({ bridge }: { bridge: EditorBridge }) {
  const editorRef = useRef<MathEditorHandle>(null);
  const history = useHistoryManager();
  const historyState = useHistorySnapshot();
  const { replaceDocumentWithHistory } = useDocumentSession(editorRef);
  const isEn = useEditorStore((state) => state.language) === "en";
  const [input, setInput] = useState<EditorInput | null>(null);
  const [formulaNumber, setFormulaNumber] = useState(0);
  const [fontSizePt, setFontSizePt] = useState(12);
  const [toast, setToast] = useState("");
  // what the formula was when opened, to tell whether the user changed it
  const opened = useRef("");
  const finishing = useRef(false);

  const open = async () => {
    const next = await bridge.input();
    if (!next) return;
    const lines = [{ id: crypto.randomUUID(), latex: next.latex ?? "" }];
    const store = useEditorStore.getState();
    store.replaceDocumentState({
      title: "",
      lines,
      activeLineId: lines[0].id,
      formulaAlignment: store.formulaAlignment,
      selectionByLineId: {},
    });
    history.clear();
    const size = wordFontSize(next.fontSizePt);
    opened.current = `${size}\n${latexOf(lines)}`;
    finishing.current = false;
    setFontSizePt(size);
    setInput(next);
    setFormulaNumber((number) => number + 1);
  };

  const insert = async () => {
    if (finishing.current || !input) return;
    history.commitPendingTransaction();
    const latex = latexOf(useEditorStore.getState().lines);
    if (!latex) {
      setToast(isEn ? "Enter a formula before inserting" : "请输入公式后再插入");
      return;
    }
    finishing.current = true;
    try {
      await bridge.done({ kind: "inserted", latex, fontSizePt });
    } catch (reason) {
      // the app could not convert it: the formula stays for the user to correct
      finishing.current = false;
      setToast(insertFailure(String(reason), isEn));
    }
  };

  const cancel = async () => {
    if (finishing.current) return;
    finishing.current = true;
    await bridge.done({ kind: "cancelled" });
  };

  /** The title bar's close: a changed formula is inserted, anything else is cancelled. */
  const close = () => {
    const latex = latexOf(useEditorStore.getState().lines);
    void (latex && `${fontSizePt}\n${latex}` !== opened.current ? insert() : cancel());
  };

  // the bridge's handlers are registered once; they call the latest render's functions
  const latest = useRef({ open, insert, close });
  latest.current = { open, insert, close };
  useEffect(() => {
    bridge.onOpen(() => void latest.current.open());
    bridge.onCloseRequested(() => latest.current.close());
    void latest.current.open();
  }, [bridge]);
  useEffect(() => onApplyShortcut(() => void latest.current.insert()), []);
  // each opened formula starts with the caret at its end; its rows mount in this render
  useEffect(() => {
    if (!formulaNumber) return;
    const frame = window.requestAnimationFrame(() => editorRef.current?.focus({ moveToEnd: true }));
    return () => window.cancelAnimationFrame(frame);
  }, [formulaNumber]);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const sizeControl = (
    <label className={styles.size} title={isEn ? "Formula font size" : "公式字号"}>
      <span>{isEn ? "Size" : "字号"}</span>
      <select
        className={styles.sizeSelect}
        value={fontSizePt}
        aria-label={isEn ? "Formula font size" : "公式字号"}
        onChange={(event) => setFontSizePt(wordFontSize(Number(event.target.value)))}
      >
        <optgroup label={isEn ? "Chinese sizes" : "中文字号"}>
          {CHINESE_FONT_SIZES.map((size) => (
            <option key={size.name} value={size.pt}>
              {isEn ? `${size.name} (${size.pt} pt)` : `${size.name}（${size.pt} 磅）`}
            </option>
          ))}
        </optgroup>
        <optgroup label={isEn ? "Point sizes" : "磅值"}>
          {pointSizes(fontSizePt).map((pt) => (
            <option key={pt} value={pt}>
              {isEn ? `${pt} pt` : `${pt} 磅`}
            </option>
          ))}
        </optgroup>
      </select>
    </label>
  );

  const actions = (
    <>
      <Button
        kind="framed"
        aria-label={isEn ? "Undo" : "撤销"}
        title={isEn ? "Undo (Ctrl+Z)" : "撤销（Ctrl+Z）"}
        onClick={() => history.requestUndo()}
        disabled={!historyState.canUndo || historyState.isReplaying}
      >
        <Undo2 size={16} strokeWidth={2} />
      </Button>
      <Button
        kind="framed"
        aria-label={isEn ? "Redo" : "重做"}
        title={isEn ? "Redo (Ctrl+Y)" : "重做（Ctrl+Y）"}
        onClick={() => history.requestRedo()}
        disabled={!historyState.canRedo || historyState.isReplaying}
      >
        <Redo2 size={16} strokeWidth={2} />
      </Button>
      <span className={styles.divider} aria-hidden="true" />
      <Button kind="secondary" onClick={() => void cancel()}>
        {isEn ? "Cancel" : "取消"}
      </Button>
      <Button
        kind="primary"
        onClick={() => void insert()}
        aria-keyshortcuts="Control+S"
        title={isEn ? "Insert and close (Ctrl+S)" : "插入并关闭（Ctrl+S）"}
      >
        {input?.latex ? (isEn ? "Update" : "更新公式") : isEn ? "Insert" : "完成并插入"}
      </Button>
    </>
  );

  return (
    <>
      <EditorWorkspace
        officeHeaderLeadingControls={sizeControl}
        officeHeaderTrailingActions={actions}
        editorRef={editorRef}
        editorInstanceKey={String(formulaNumber)}
        onReplaceDocument={replaceDocumentWithHistory}
      />
      {toast && (
        <div className={styles.toast} role="status">
          {toast}
        </div>
      )}
    </>
  );
}
