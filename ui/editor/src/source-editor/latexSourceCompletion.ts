import {
  acceptCompletion,
  autocompletion,
  completionStatus,
  currentCompletions,
  insertCompletionText,
  pickedCompletion,
  selectedCompletionIndex,
  setSelectedCompletion,
  snippet,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import { Prec, type EditorState, type Extension } from "@codemirror/state";
import { EditorView, ViewPlugin, keymap, type KeyBinding } from "@codemirror/view";
import { kernelLatexCommandSignatures } from "@app/kernel/kernel/mathlive.ts";
import {
  kernelCommandFrequencyData as COMMAND_FREQUENCY,
  kernelCompletionCatalogData,
  kernelNativePreviewsData,
} from "@app/kernel/kernel/host.ts";
import { convertKernelLatexToMarkup } from "@app/kernel/latex/expand.ts";
import { inspectMathLiveSourceSafety } from "../editor/mathLiveSourceSafety";
import { environmentNameCompletionEnd } from "./latexSourceEditorSupport";
import { userLatexToStored } from "@app/kernel/latex/exam-zh-symbols.ts";

// Source-code completion for the LaTeX panel. Same commands and ranking as
// the visual editor's candidate panel (Overleaf's approach: CodeMirror's
// fuzzy match tier, then corpus frequency as boost), but inserted as
// CodeMirror snippets: every argument is an empty {} field the caret visits
// with Tab, so \frac gives \frac{|}{} instead of a bare command.

interface SourceCompletion extends Completion {
  preview: string;
}

const COMMAND_PATTERN = /\\(?:begin\{[A-Za-z*]*|[A-Za-z]*)$/;
const VALID_FOR = /^\\(?:begin\{[A-Za-z*]*|[A-Za-z]*)$/;

// Environments the catalog does not provide as templates.
const EXTRA_ENVIRONMENTS: Record<string, string> = {
  aligned: "\\begin{aligned}#{} & #{}\\\\ #{} & #{}\\end{aligned}",
  gathered: "\\begin{gathered}#{}\\\\ #{}\\end{gathered}",
  array: "\\begin{array}{#{cc}}#{} & #{}\\end{array}",
  smallmatrix: "\\begin{smallmatrix}#{} & #{}\\\\ #{} & #{}\\end{smallmatrix}",
};

/**
 * TexType template -> CodeMirror snippet. \placeholder{} becomes a field;
 * LaTeX's own \{ and \} keep their backslash through the snippet parser,
 * which unescapes \{ to {.
 */
function snippetTemplate(template: string) {
  return template
    .replace(/\\placeholder\{\}/g, "\u0000")
    .replace(/\\([{}])/g, "\\\\$1")
    .replace(/\u0000/g, "#{}");
}

// An environment completes over the name typed so far and the closing brace the editor paired with \begin{
// (\begin{matr|}), which the template's own \begin{...} replaces; the list itself is filtered by the name alone.
function environmentApply(template: string) {
  const insertSnippet = template.includes("#{") ? snippet(template) : null;
  return (view: EditorView, completion: Completion, from: number, to: number) => {
    const end = environmentNameCompletionEnd(view.state, from, to);
    if (insertSnippet) {
      insertSnippet(view, completion, from, end);
      return;
    }
    view.dispatch({
      ...insertCompletionText(view.state, template, from, end),
      annotations: pickedCompletion.of(completion),
    });
  };
}

function nativeTemplate(name: string, required: number) {
  return name + "{#{}}".repeat(required);
}

function nativePreview(name: string, required: number) {
  const registered = kernelNativePreviewsData[name];
  if (registered) return registered;
  const samples = ["a", "b", "c", "d"];
  return name + samples.slice(0, required).map((sample) => `{${sample}}`).join("");
}

let cachedOptions: SourceCompletion[] | null = null;

function completionOptions(): SourceCompletion[] {
  if (cachedOptions) return cachedOptions;
  const options: SourceCompletion[] = [];
  const seen = new Set<string>();
  const frequency = (command: string) => COMMAND_FREQUENCY[command] ?? 0;
  const push = (
    label: string,
    template: string,
    preview: string,
    boost: number,
  ) => {
    const key = label + "\u0001" + template;
    if (seen.has(key)) return;
    seen.add(key);
    options.push({
      label,
      type: "latex",
      boost,
      preview,
      apply: label.startsWith("\\begin{")
        ? environmentApply(template)
        : template.includes("#{")
          ? snippet(template)
          : template,
    });
  };

  // Commands with a TexType template keep only that editable form, except
  // big operators, which are meaningful bare as well (same as the visual
  // editor).
  const templated = new Set<string>();
  for (const command of kernelCompletionCatalogData) {
    const name = command.command.trim();
    if (!/^\\(?:begin\{[A-Za-z*]+\}|[A-Za-z]+)$/.test(name)) continue;
    if (command.latex.includes("\\placeholder{}")) templated.add(name);
    // a shared variant ranks after its command's primary entry
    const tieBreak = command.exact ? 0.002 : -0.002;
    push(
      name,
      snippetTemplate(command.latex),
      command.preview,
      frequency(name) + tieBreak + command.priority * 1e-6,
    );
  }

  const bareOperators = new Set(["\\int", "\\iint", "\\iiint", "\\oint", "\\oiint", "\\oiiint", "\\sum", "\\prod", "\\lim"]);
  for (const [name, required] of kernelLatexCommandSignatures()) {
    if (!/^\\[A-Za-z]+$/.test(name)) continue;
    if (templated.has(name) && !bareOperators.has(name)) continue;
    push(name, nativeTemplate(name, required), nativePreview(name, required), frequency(name));
  }

  for (const [environment, template] of Object.entries(EXTRA_ENVIRONMENTS)) {
    const label = `\\begin{${environment}}`;
    push(label, template, template.replace(/#\{([^}]*)\}/g, (_, text) => text || "x"), frequency(label));
  }

  cachedOptions = options;
  return options;
}

// The command name before the caret, unless its backslash is the second one of a row break (\\).
function commandBefore(state: EditorState, pos: number) {
  const line = state.doc.lineAt(pos);
  const match = COMMAND_PATTERN.exec(state.sliceDoc(line.from, pos));
  if (!match) return null;
  const from = line.from + match.index;
  let slashes = 0;
  for (let at = from - 1; at >= 0 && state.sliceDoc(at, at + 1) === "\\"; at--) slashes++;
  return slashes % 2 === 1 ? null : { from, text: match[0] };
}

function latexSourceCompletions(context: CompletionContext): CompletionResult | null {
  const word = commandBefore(context.state, context.pos);
  if (!word) return null;
  if (word.text.length < 2 && !context.explicit) return null;
  return { from: word.from, options: completionOptions(), validFor: VALID_FOR };
}

// A command name is being typed: the caret is right after it and its completion list is open or being looked up.
export function isTypingCommandName(state: EditorState) {
  if (completionStatus(state) === null || !state.selection.main.empty) return false;
  const word = commandBefore(state, state.selection.main.head);
  return Boolean(word && word.text.length >= 2);
}

const previewMarkup = new Map<string, string>();

function renderPreview(completion: Completion) {
  const element = document.createElement("span");
  element.className = "cm-latex-completion-preview";
  const preview = (completion as SourceCompletion).preview;
  if (!preview) return element;
  // the source is written in the user's spelling: exam-zh's \cong is ≌
  const latex = userLatexToStored(preview);
  let markup = previewMarkup.get(latex);
  if (markup === undefined) {
    markup = "";
    if (!inspectMathLiveSourceSafety(latex)) {
      try {
        // Text style keeps limits and fractions inside one fixed-height row.
        markup = convertKernelLatexToMarkup(`{\\textstyle ${latex}}`, { defaultMode: "math" });
      } catch {
        markup = "";
      }
    }
    previewMarkup.set(latex, markup);
  }
  element.innerHTML = markup;
  return element;
}

// Input-method style selection, as in the visual editor's candidate panel:
// the candidates are paged by nine and the page holding the current
// candidate is numbered 1-9.
const CANDIDATE_PAGE_SIZE = 9;

function candidatePageStart(state: EditorState) {
  const selected = Math.max(0, selectedCompletionIndex(state) ?? 0);
  return selected - (selected % CANDIDATE_PAGE_SIZE);
}

function renderNumber() {
  const element = document.createElement("span");
  element.className = "cm-latex-completion-index";
  element.setAttribute("aria-hidden", "true");
  return element;
}

// CodeMirror renders a row once and only moves aria-selected afterwards, so
// the numbers are written after every update, once the list DOM is current.
const candidateNumbers = ViewPlugin.fromClass(
  class {
    constructor(readonly view: EditorView) {}

    update() {
      if (completionStatus(this.view.state) !== "active") return;
      this.view.requestMeasure({ key: this, read: () => null, write: () => this.renumber() });
    }

    renumber() {
      const id = this.view.contentDOM.getAttribute("aria-controls");
      const list = id ? this.view.dom.ownerDocument.getElementById(id) : null;
      if (!list) return;
      const start = candidatePageStart(this.view.state);
      for (const row of list.querySelectorAll<HTMLElement>(":scope > li[id]")) {
        const index = Number(/-(\d+)$/.exec(row.id)?.[1] ?? -1);
        const number =
          index >= start && index < start + CANDIDATE_PAGE_SIZE ? String(index - start + 1) : "";
        const label = row.querySelector(".cm-latex-completion-index");
        if (label && label.textContent !== number) label.textContent = number;
      }
    }
  },
);

// A digit commits that row of the current page exactly like Enter. A digit
// with no row on the page is swallowed; with the list closed digits type.
function pickCandidate(digit: number) {
  return (view: EditorView) => {
    if (completionStatus(view.state) !== "active") return false;
    const options = currentCompletions(view.state);
    if (!options.length) return false;
    const index = candidatePageStart(view.state) + digit - 1;
    if (index >= options.length) return true;
    const previous = selectedCompletionIndex(view.state);
    view.dispatch({ effects: setSelectedCompletion(index) });
    if (acceptCompletion(view)) return true;
    // Within CodeMirror's interaction delay right after the list opened the
    // pick is refused; the digit is then typed as usual.
    if (previous !== null) view.dispatch({ effects: setSelectedCompletion(previous) });
    return false;
  };
}

const digitKeys: KeyBinding[] = Array.from({ length: 9 }, (_, i) => ({
  key: String(i + 1),
  run: pickCandidate(i + 1),
}));

export const latexSourceCompletion: Extension = [
  autocompletion({
    override: [latexSourceCompletions],
    activateOnTyping: true,
    icons: false,
    maxRenderedOptions: 60,
    tooltipClass: () => "cm-latex-completion",
    optionClass: () => "cm-latex-completion-option",
    addToOptions: [
      { render: renderNumber, position: 10 },
      { render: renderPreview, position: 60 },
    ],
  }),
  candidateNumbers,
  // Tab also accepts while the list is open; otherwise it moves between
  // snippet fields or indents as before.
  Prec.highest(keymap.of([{ key: "Tab", run: acceptCompletion }, ...digitKeys])),
];

export const latexSourceCompletionTheme = EditorView.theme({
  // The tooltip element is only an invisible positioning frame: when space
  // is tight CodeMirror pins its height and keeps it after the list gets
  // shorter, which would show as empty space. The visible box is the list,
  // which is always exactly as tall as its rows and sits against the caret.
  ".cm-tooltip.cm-tooltip-autocomplete.cm-latex-completion": {
    display: "flex",
    flexDirection: "column",
    minWidth: "260px",
    maxWidth: "min(420px, calc(100vw - 24px))",
    border: "none",
    backgroundColor: "transparent",
    boxShadow: "none",
    overflow: "visible",
    padding: "0",
    pointerEvents: "none",
  },
  ".cm-tooltip.cm-tooltip-above.cm-tooltip-autocomplete.cm-latex-completion": {
    justifyContent: "flex-end",
  },
  // CodeMirror anchors the panel at the glyph box, which ends inside the
  // 1.62 line height: keep it clear of the line being typed.
  ".cm-tooltip.cm-tooltip-below.cm-latex-completion": { marginTop: "6px" },
  ".cm-tooltip.cm-tooltip-above.cm-latex-completion": { marginTop: "-6px" },
  ".cm-tooltip.cm-tooltip-autocomplete.cm-latex-completion > ul": {
    flex: "0 1 auto",
    height: "auto",
    minHeight: "0",
    maxHeight: "calc(8 * 34px + 10px)",
    boxSizing: "border-box",
    border: "1px solid var(--border-strong)",
    borderRadius: "8px",
    backgroundColor: "var(--surface)",
    boxShadow: "var(--shadow-md)",
    padding: "4px",
    pointerEvents: "auto",
    fontFamily: "'SFMono-Regular', Menlo, Consolas, monospace",
  },
  ".cm-tooltip-autocomplete.cm-latex-completion > ul > li.cm-latex-completion-option": {
    height: "34px",
    display: "flex",
    alignItems: "center",
    gap: "12px",
    padding: "0 8px",
    borderRadius: "5px",
    color: "var(--text)",
    lineHeight: "34px",
  },
  ".cm-tooltip-autocomplete.cm-latex-completion > ul > li[aria-selected]": {
    backgroundColor: "var(--accent-soft)",
    color: "var(--text)",
  },
  ".cm-latex-completion .cm-latex-completion-index": {
    flex: "0 0 1.1em",
    marginRight: "-4px",
    color: "var(--text-faint)",
    font: "600 12px/1 system-ui, 'Segoe UI', sans-serif",
    fontVariantNumeric: "tabular-nums",
    textAlign: "center",
  },
  ".cm-tooltip-autocomplete.cm-latex-completion > ul > li[aria-selected] .cm-latex-completion-index": {
    color: "var(--accent)",
  },
  ".cm-latex-completion .cm-completionLabel": {
    flex: "1 1 auto",
    minWidth: "0",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontSize: "12.5px",
  },
  ".cm-latex-completion .cm-completionMatchedText": {
    textDecoration: "none",
    color: "var(--accent)",
    fontWeight: "650",
  },
  ".cm-latex-completion .cm-latex-completion-preview": {
    flex: "0 0 auto",
    maxWidth: "190px",
    height: "30px",
    display: "flex",
    alignItems: "center",
    overflow: "hidden",
    fontSize: "15px",
    lineHeight: "1",
  },
});
