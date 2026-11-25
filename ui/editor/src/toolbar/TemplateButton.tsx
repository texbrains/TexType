import { storedLatexToUser } from "@app/kernel/latex/exam-zh-symbols.ts";
import { MathPreview } from "../components/MathPreview";
import type { Command } from "../types/command";
import {
  TOOLBAR_BUTTON_PADDING,
  TOOLBAR_BUTTON_SIZE,
  toolbarPreviewLatex,
  wideToolbarCommandIds,
} from "./toolbarGroups";
import styles from "./TemplateButton.module.css";

// How far a preview may grow inside its button: less with more padding, more with bigger buttons.
const previewInsetRatio = Math.max(0.58, Math.min(0.94, 0.94 - TOOLBAR_BUTTON_PADDING * 0.03));
const previewMaximumScale = Math.min(1.55, Math.max(1, TOOLBAR_BUTTON_SIZE / 42));
// cases previews are drawn larger so their brace stays legible
const casesPreviewMaximumScale = Math.max(1.85, previewMaximumScale);
const casesPreviewInsetRatio = 0.98;

interface Props {
  command: Command;
  isEn: boolean;
  onInsert: (command: Command) => void;
}

export function TemplateButton({ command, isEn, onInsert }: Props) {
  const previewLatex = toolbarPreviewLatex(command);
  const cases = command.id === "cases" || command.id === "cases-three";
  const label = isEn ? command.nameEn : command.name;
  return (
    <button
      type="button"
      className={wideToolbarCommandIds.has(command.id) ? styles.wide : styles.button}
      data-command-id={command.id}
      data-preview-latex={previewLatex}
      onClick={() => onInsert(command)}
      aria-label={label}
      // the command as the user writes it (exam-zh's \cong for ≌)
      title={label + " · " + storedLatexToUser(command.command)}
    >
      <MathPreview
        latex={previewLatex}
        fit
        maximumFitScale={cases ? casesPreviewMaximumScale : previewMaximumScale}
        fitInsetRatio={cases ? casesPreviewInsetRatio : previewInsetRatio}
      />
    </button>
  );
}
