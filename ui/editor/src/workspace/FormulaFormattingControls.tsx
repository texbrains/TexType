import {
  type ComponentProps,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Highlighter,
  Italic,
  Palette,
  Type,
} from "lucide-react";
import type {
  MathEditorHandle,
  MathEditorSelectionTarget,
} from "../editor/MathEditor";
import type { MathLivePersistentTypingStyle } from "../editor/mathLiveKernelCommands";
import type { FormulaAlignment } from "../types/formula";
import { Button } from "../controls/Button";
import styles from "./FormulaFormattingControls.module.css";
import { FormulaColorPopover, type FormulaColorMenu } from "./FormulaColorPopover";

type LetterShape = "auto" | "italic" | "upright";

/** The style for continued typing (the persistent buttons) and the colours last chosen. */
export function useTypingStyle() {
  const [bold, setBold] = useState(false);
  const [shape, setShape] = useState<LetterShape>("auto");
  const [textColor, setTextColor] = useState("#2563eb");
  const [backgroundColor, setBackgroundColor] = useState("#fef3c7");
  const [textColorOn, setTextColorOn] = useState(false);
  const [backgroundColorOn, setBackgroundColorOn] = useState(false);
  const style = useMemo<MathLivePersistentTypingStyle>(
    () => ({
      bold,
      italic: shape === "auto" ? null : shape === "italic",
      color: textColorOn ? textColor : null,
      backgroundColor: backgroundColorOn ? backgroundColor : null,
    }),
    [backgroundColor, backgroundColorOn, bold, shape, textColor, textColorOn],
  );
  return {
    style,
    bold, setBold,
    shape, setShape,
    textColor, setTextColor,
    backgroundColor, setBackgroundColor,
    textColorOn, setTextColorOn,
    backgroundColorOn, setBackgroundColorOn,
  };
}

type TypingStyleState = ReturnType<typeof useTypingStyle>;

interface Props {
  editorRef: RefObject<MathEditorHandle | null>;
  isEn: boolean;
  formulaAlignment: FormulaAlignment;
  onAlignment: (alignment: FormulaAlignment) => void;
  typing: TypingStyleState;
}

/** The bottom bar's row alignment and formatting: bold, italic, colours for the selection and for continued typing. */
export function FormulaFormattingControls({ editorRef, isEn, formulaAlignment, onAlignment, typing }: Props) {
  const [colorMenu, setColorMenu] = useState<FormulaColorMenu | null>(null);
  const [popoverStyle, setPopoverStyle] = useState<CSSProperties>();
  const [textPickerValue, setTextPickerValue] = useState(typing.textColor);
  const [backgroundPickerValue, setBackgroundPickerValue] = useState(typing.backgroundColor);
  const groupRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const selectionTargetRef = useRef<MathEditorSelectionTarget | null>(null);

  const closeColorMenu = () => {
    setColorMenu(null);
    selectionTargetRef.current = null;
  };

  useEffect(() => {
    if (!colorMenu) return;
    const close = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        (groupRef.current?.contains(event.target) || popoverRef.current?.contains(event.target))
      ) {
        return;
      }
      closeColorMenu();
    };
    const closeFromKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      closeColorMenu();
    };
    document.addEventListener("pointerdown", close, true);
    document.addEventListener("keydown", closeFromKey, true);
    return () => {
      document.removeEventListener("pointerdown", close, true);
      document.removeEventListener("keydown", closeFromKey, true);
    };
  }, [colorMenu]);

  // The popover is rendered on <body> with fixed coordinates taken from its trigger, above or below it (wherever
  // there is more room) and never taller than that room (it scrolls inside).
  useLayoutEffect(() => {
    if (!colorMenu) {
      setPopoverStyle(undefined);
      return;
    }
    const place = () => {
      const trigger = groupRef.current?.querySelector<HTMLElement>(
        colorMenu === "color" ? "[data-formula-selection-color]" : "[data-formula-selection-background]",
      );
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const width = popoverRef.current?.offsetWidth ?? 196;
      const left = Math.round(Math.max(10, Math.min(rect.left, window.innerWidth - width - 10)));
      const above = rect.top - 7 - 10;
      const below = window.innerHeight - rect.bottom - 7 - 10;
      const height = popoverRef.current?.scrollHeight ?? 0;
      const opensUpward = below < height && above > below;
      const room = Math.max(120, Math.round(opensUpward ? above : below));
      const next: CSSProperties = opensUpward
        ? { left, top: "auto", bottom: Math.round(window.innerHeight - rect.top + 7), maxHeight: room, overflowY: "auto" }
        : { left, top: Math.round(rect.bottom + 7), bottom: "auto", maxHeight: room, overflowY: "auto" };
      setPopoverStyle((current) =>
        current?.left === next.left &&
        current?.top === next.top &&
        current?.bottom === next.bottom &&
        current?.maxHeight === next.maxHeight
          ? current
          : next,
      );
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [colorMenu]);

  const preserveFormulaFocus = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
  };

  const rememberFormulaSelection = () => {
    selectionTargetRef.current = editorRef.current?.captureSelectionTarget() ?? null;
  };

  const preserveFormulaSelection = (event: ReactPointerEvent<HTMLButtonElement>) => {
    preserveFormulaFocus(event);
    const liveTarget = editorRef.current?.captureSelectionTarget() ?? null;
    if (liveTarget) selectionTargetRef.current = liveTarget;
  };

  const applySelectedStyle = (kind: "bold" | "italic") => {
    const target = selectionTargetRef.current ?? editorRef.current?.captureSelectionTarget() ?? null;
    if (target) editorRef.current?.applySelectionStyle({ kind }, target);
    selectionTargetRef.current = null;
  };

  const applySelectedStyleFromPointer = (event: ReactPointerEvent<HTMLButtonElement>, kind: "bold" | "italic") => {
    preserveFormulaSelection(event);
    applySelectedStyle(kind);
  };

  const toggleColorMenu = (kind: FormulaColorMenu) => {
    // The palette also chooses the colour for continued typing: opening it without a selection must not create or
    // move a selection.
    selectionTargetRef.current = selectionTargetRef.current ?? editorRef.current?.captureSelectionTarget() ?? null;
    if (colorMenu === kind) closeColorMenu();
    else setColorMenu(kind);
  };

  const applyColor = (kind: FormulaColorMenu, value: string) => {
    const target = selectionTargetRef.current;
    if (target) editorRef.current?.applySelectionStyle({ kind, value }, target);
    if (kind === "color") {
      typing.setTextColor(value);
      setTextPickerValue(value);
    } else if (value !== "none") {
      typing.setBackgroundColor(value);
      setBackgroundPickerValue(value);
    }
    closeColorMenu();
  };

  const shapeLabel = isEn
    ? typing.shape === "auto"
      ? "Letter shape: automatic"
      : typing.shape === "italic"
        ? "Letter shape: italic"
        : "Letter shape: upright"
    : typing.shape === "auto"
      ? "字形：自动"
      : typing.shape === "italic"
        ? "字形：斜体"
        : "字形：正体";

  return (
    <div
      className={styles.controls}
      role="toolbar"
      aria-label={isEn ? "Formula alignment" : "公式对齐方式"}
    >
      {(
        [
          ["left", AlignLeft, isEn ? "Align left" : "左对齐"],
          ["center", AlignCenter, isEn ? "Centre" : "居中"],
          ["right", AlignRight, isEn ? "Align right" : "右对齐"],
        ] as const
      ).map(([alignment, Icon, label]) => (
        <Button
          key={alignment}
          kind="icon"
          active={formulaAlignment === alignment}
          aria-label={label}
          title={label}
          aria-pressed={formulaAlignment === alignment}
          data-formula-alignment={alignment}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onAlignment(alignment)}
        >
          <Icon size={16} strokeWidth={2} />
        </Button>
      ))}
      <span className={styles.divider} aria-hidden="true" />
      <div
        ref={groupRef}
        className={styles.group}
        role="group"
        aria-label={isEn ? "Formula formatting" : "公式格式"}
      >
        <FormatButton
          mark="selection"
          aria-label={isEn ? "Bold" : "粗体"}
          title={isEn ? "Bold" : "粗体"}
          data-formula-selection-bold
          onPointerEnter={rememberFormulaSelection}
          onPointerDown={(event) => applySelectedStyleFromPointer(event, "bold")}
          onClick={(event) => {
            if (event.detail === 0) applySelectedStyle("bold");
          }}
        >
          <Bold size={15} strokeWidth={2.2} />
        </FormatButton>
        <FormatButton
          mark="selection"
          aria-label={isEn ? "Italic / upright" : "斜体 / 正体"}
          title={isEn ? "Italic / upright" : "斜体 / 正体"}
          data-formula-selection-italic
          onPointerEnter={rememberFormulaSelection}
          onPointerDown={(event) => applySelectedStyleFromPointer(event, "italic")}
          onClick={(event) => {
            if (event.detail === 0) applySelectedStyle("italic");
          }}
        >
          <Italic size={15} strokeWidth={2.2} />
        </FormatButton>
        <FormatButton
          mark="selection"
          color={typing.textColor}
          active={colorMenu === "color"}
          aria-label={isEn ? "Selected text color" : "选中内容字体颜色"}
          title={isEn ? "Text color" : "文字颜色"}
          aria-pressed={colorMenu === "color"}
          data-formula-selection-color
          onPointerEnter={rememberFormulaSelection}
          onPointerDown={preserveFormulaSelection}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => toggleColorMenu("color")}
        >
          <Palette size={15} strokeWidth={2} />
        </FormatButton>
        <FormatButton
          mark="selection"
          color={typing.backgroundColor}
          active={colorMenu === "backgroundColor"}
          aria-label={isEn ? "Selected text background color" : "选中内容字体背景颜色"}
          title={isEn ? "Background color" : "背景颜色"}
          aria-pressed={colorMenu === "backgroundColor"}
          data-formula-selection-background
          onPointerEnter={rememberFormulaSelection}
          onPointerDown={preserveFormulaSelection}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => toggleColorMenu("backgroundColor")}
        >
          <Highlighter size={15} strokeWidth={2} />
        </FormatButton>

        <span className={styles.subdivider} aria-hidden="true" />

        <FormatButton
          mark="persistent"
          active={typing.bold}
          aria-label={isEn ? "Persistent bold input" : "持久化粗体输入"}
          title={isEn ? "Persistent bold" : "持续粗体"}
          aria-pressed={typing.bold}
          data-formula-persistent-bold
          onPointerDown={preserveFormulaFocus}
          onClick={() => typing.setBold((enabled) => !enabled)}
        >
          <Bold size={15} strokeWidth={2.2} />
        </FormatButton>
        <FormatButton
          mark="persistent"
          active={typing.shape !== "auto"}
          aria-label={shapeLabel}
          title={shapeLabel}
          aria-pressed={typing.shape !== "auto"}
          data-formula-persistent-italic
          data-formula-persistent-shape={typing.shape}
          onPointerDown={preserveFormulaFocus}
          onClick={() =>
            typing.setShape((shape) => (shape === "auto" ? "italic" : shape === "italic" ? "upright" : "auto"))
          }
        >
          {typing.shape === "upright" ? <Type size={15} strokeWidth={2.2} /> : <Italic size={15} strokeWidth={2.2} />}
        </FormatButton>
        <FormatButton
          mark="persistent"
          color={typing.textColor}
          active={typing.textColorOn}
          aria-label={isEn ? "Persistent font color input" : "持久化字体颜色输入"}
          title={isEn ? "Persistent text color" : "持续文字颜色"}
          aria-pressed={typing.textColorOn}
          data-formula-persistent-color
          onPointerDown={preserveFormulaFocus}
          onClick={() => typing.setTextColorOn((enabled) => !enabled)}
        >
          <Palette size={15} strokeWidth={2} />
        </FormatButton>
        <FormatButton
          mark="persistent"
          color={typing.backgroundColor}
          active={typing.backgroundColorOn}
          aria-label={isEn ? "Persistent background color input" : "持久化背景颜色输入"}
          title={isEn ? "Persistent background color" : "持续背景颜色"}
          aria-pressed={typing.backgroundColorOn}
          data-formula-persistent-background
          onPointerDown={preserveFormulaFocus}
          onClick={() => typing.setBackgroundColorOn((enabled) => !enabled)}
        >
          <Highlighter size={15} strokeWidth={2} />
        </FormatButton>

        {colorMenu && (
          <FormulaColorPopover
            ref={popoverRef}
            menu={colorMenu}
            style={popoverStyle}
            isEn={isEn}
            pickerValue={colorMenu === "color" ? textPickerValue : backgroundPickerValue}
            onApply={(value) => applyColor(colorMenu, value)}
          />
        )}
      </div>
    </div>
  );
}

interface FormatButtonProps extends Omit<ComponentProps<typeof Button>, "kind"> {
  /** selection: applies to the selected part (a corner mark, or the colour bar); persistent: holds for what is typed
   * next (a dot) */
  mark: "selection" | "persistent";
  /** the colour it applies, shown as a bar under the icon */
  color?: string;
}

/** A formatting button: an icon button with the marks that tell its kind and colour. */
function FormatButton({ mark, color, active = false, children, ...rest }: FormatButtonProps) {
  return (
    <Button kind="icon" active={active} {...rest}>
      {children}
      {mark === "persistent" && <span className={styles.dot} aria-hidden="true" />}
      {mark === "selection" && color === undefined && <span className={styles.cornerMark} aria-hidden="true" />}
      {color !== undefined && <span className={styles.colorBar} style={{ background: color }} aria-hidden="true" />}
    </Button>
  );
}
