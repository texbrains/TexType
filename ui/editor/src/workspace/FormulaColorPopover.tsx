import { forwardRef, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Plus } from "lucide-react";
import styles from "./FormulaColorPopover.module.css";

export type FormulaColorMenu = "color" | "backgroundColor";

const TEXT_COLORS = ["#111827", "#dc2626", "#ea580c", "#ca8a04", "#16a34a", "#0891b2", "#2563eb", "#7c3aed", "#db2777"];
const BACKGROUND_COLORS = ["#fef3c7", "#fed7aa", "#fecaca", "#fbcfe8", "#ddd6fe", "#bfdbfe", "#a5f3fc", "#bbf7d0", "#e5e7eb"];

interface Props {
  menu: FormulaColorMenu;
  /** fixed coordinates next to the button that opened it (the popover is on <body>) */
  style: CSSProperties | undefined;
  isEn: boolean;
  pickerValue: string;
  onApply: (value: string) => void;
}

/** The text or background colour chooser: the preset colours, "no background", and a picker for any colour. */
export const FormulaColorPopover = forwardRef<HTMLDivElement, Props>(function FormulaColorPopover(
  { menu, style, isEn, pickerValue, onApply },
  ref,
) {
  const text = menu === "color";
  return createPortal(
    <div
      ref={ref}
      className={styles.popover}
      style={style}
      role="dialog"
      aria-label={text ? (isEn ? "Formula text color" : "公式字体颜色") : isEn ? "Formula background color" : "公式背景颜色"}
    >
      <strong className={styles.title}>
        {text ? (isEn ? "Text color" : "字体颜色") : isEn ? "Background color" : "背景颜色"}
      </strong>
      <span className={styles.label}>{isEn ? "Preset" : "固定颜色"}</span>
      {!text && (
        <button
          type="button"
          className={styles.none}
          title={isEn ? "No background" : "取消背景颜色"}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onApply("none")}
        >
          <span className={styles.noneIcon} aria-hidden="true" />
          <span>{isEn ? "None" : "无背景"}</span>
        </button>
      )}
      <div className={styles.swatches} role="group">
        {(text ? TEXT_COLORS : BACKGROUND_COLORS).map((color) => (
          <button
            key={color}
            type="button"
            className={styles.swatch}
            style={{ backgroundColor: color }}
            aria-label={`${isEn ? "Use" : "使用"} ${color}`}
            title={color}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onApply(color)}
          />
        ))}
        <label className={styles.picker} title={isEn ? "Other color" : "其他颜色"}>
          <input
            type="color"
            value={pickerValue}
            aria-label={isEn ? "Other color" : "其他颜色"}
            onChange={(event) => onApply(event.currentTarget.value)}
          />
          <Plus size={13} />
        </label>
      </div>
    </div>,
    document.body,
  );
});
