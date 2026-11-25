import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { MathPreview } from "../components/MathPreview";
import type { Command } from "../types/command";
import styles from "./MatrixBuilder.module.css";

type MatrixDelimiter = "matrix" | "pmatrix" | "bmatrix" | "Bmatrix" | "vmatrix" | "Vmatrix";

/** The size grid: up to 5 rows by 5 columns (a larger matrix grows with Tab and the row/column commands). */
const MATRIX_GRID_SIZE = 5;
const matrixGridCells = Array.from({ length: MATRIX_GRID_SIZE * MATRIX_GRID_SIZE }, (_, index) => ({
  row: Math.floor(index / MATRIX_GRID_SIZE) + 1,
  column: (index % MATRIX_GRID_SIZE) + 1,
}));

const matrixDelimiterOptions: Array<{
  id: MatrixDelimiter;
  preview: string;
  labelZh: string;
  labelEn: string;
}> = [
  { id: "matrix", preview: "\\begin{matrix}a\\end{matrix}", labelZh: "无边界", labelEn: "Plain" },
  { id: "pmatrix", preview: "\\begin{pmatrix}a\\end{pmatrix}", labelZh: "圆括号", labelEn: "Parentheses" },
  { id: "bmatrix", preview: "\\begin{bmatrix}a\\end{bmatrix}", labelZh: "方括号", labelEn: "Brackets" },
  { id: "Bmatrix", preview: "\\begin{Bmatrix}a\\end{Bmatrix}", labelZh: "花括号", labelEn: "Braces" },
  { id: "vmatrix", preview: "\\begin{vmatrix}a\\end{vmatrix}", labelZh: "单竖线", labelEn: "Bars" },
  { id: "Vmatrix", preview: "\\begin{Vmatrix}a\\end{Vmatrix}", labelZh: "双竖线", labelEn: "Double bars" },
];

function createMatrixCommand(rows: number, columns: number, delimiter: MatrixDelimiter): Command {
  const body = Array.from({ length: rows }, () =>
    Array.from({ length: columns }, () => "\\placeholder{}").join(" & "),
  ).join(" \\\\ ");
  const option = matrixDelimiterOptions.find((candidate) => candidate.id === delimiter)!;
  return {
    exact: true,
    id: `custom-${delimiter}-${rows}x${columns}`,
    command: `\\begin{${delimiter}}`,
    category: "matrix",
    latex: `\\begin{${delimiter}}${body}\\end{${delimiter}}`,
    preview: option.preview,
    name: `${rows}×${columns} ${option.labelZh}矩阵`,
    nameEn: `${rows}×${columns} ${option.labelEn.toLowerCase()} matrix`,
    words: ["matrix", delimiter, "矩阵", "自定义矩阵", `${rows}x${columns}`],
    priority: 120,
  };
}

/**
 * Sizes the picker to the template strip it stands in: as large as the strip's width and height allow (44-220 px),
 * written as CSS variables on the toolbar.
 */
function useMatrixPanelSize(builderRef: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const builder = builderRef.current;
    const strip = builder?.parentElement;
    if (!builder || !strip) return;

    const railWidth = 32;
    const builderGap = 6;
    const builderHorizontalPadding = 12;
    const headingHeight = 20;
    const insertHeight = 28;
    const verticalGaps = 10;
    const builderVerticalPadding = 12;
    const chromeHeight = headingHeight + insertHeight + verticalGaps + builderVerticalPadding;

    let frame = 0;
    const measure = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const stripStyle = window.getComputedStyle(strip);
        const padding = (name: string) => Number.parseFloat(stripStyle.getPropertyValue(name)) || 0;
        const availableHeight = Math.max(0, strip.clientHeight - padding("padding-top") - padding("padding-bottom"));
        const availableWidth = Math.max(0, strip.clientWidth - padding("padding-left") - padding("padding-right"));
        const widthBound = Math.max(44, availableWidth - railWidth - builderGap - builderHorizontalPadding);
        const heightBound = Math.max(44, availableHeight - chromeHeight);
        const pickerSize = Math.max(44, Math.min(220, Math.floor(widthBound), Math.floor(heightBound)));
        const panelHeight = Math.max(112, Math.min(Math.floor(availableHeight), pickerSize + chromeHeight));
        builder.style.setProperty("--local-picker-size", `${pickerSize}px`);
        builder.style.setProperty("--local-panel-height", `${panelHeight}px`);
      });
    };

    const observer = new ResizeObserver(measure);
    observer.observe(strip);
    measure();
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [builderRef]);
}

interface Props {
  isEn: boolean;
  onInsert: (command: Command) => void;
}

export function MatrixBuilder({ isEn, onInsert }: Props) {
  const [rows, setRows] = useState(2);
  const [columns, setColumns] = useState(2);
  const [hover, setHover] = useState<{ rows: number; columns: number } | null>(null);
  const [delimiter, setDelimiter] = useState<MatrixDelimiter>("bmatrix");
  const builderRef = useRef<HTMLElement>(null);
  useMatrixPanelSize(builderRef);
  const previewRows = hover?.rows ?? rows;
  const previewColumns = hover?.columns ?? columns;

  return (
    <section ref={builderRef} className={styles.builder} aria-label={isEn ? "Custom matrix" : "自定义矩阵"}>
      <div className={styles.picker}>
        <div className={styles.heading}>
          <strong>{isEn ? "Matrix" : "矩阵"}</strong>
          <span className={styles.badge} aria-live="polite">
            {previewRows} × {previewColumns}
          </span>
        </div>
        <div className={styles.gridArea}>
          <div
            className={styles.grid}
            role="grid"
            aria-label={isEn ? "Select matrix rows and columns" : "选择矩阵行数和列数"}
            aria-rowcount={MATRIX_GRID_SIZE}
            aria-colcount={MATRIX_GRID_SIZE}
            onPointerLeave={() => setHover(null)}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setHover(null);
            }}
          >
            {matrixGridCells.map(({ row, column }) => {
              const previewed = row <= previewRows && column <= previewColumns;
              const selectedCorner = row === rows && column === columns;
              return (
                <button
                  key={`${row}-${column}`}
                  type="button"
                  role="gridcell"
                  className={styles.cell}
                  data-previewed={previewed || undefined}
                  aria-label={isEn ? `${row} rows by ${column} columns` : `${row} 行 ${column} 列`}
                  aria-selected={selectedCorner}
                  data-matrix-rows={row}
                  data-matrix-columns={column}
                  onPointerEnter={() => setHover({ rows: row, columns: column })}
                  onFocus={() => setHover({ rows: row, columns: column })}
                  onClick={() => {
                    setRows(row);
                    setColumns(column);
                    setHover(null);
                  }}
                />
              );
            })}
          </div>
        </div>
        <button
          type="button"
          className={styles.insert}
          data-command-id="custom-matrix"
          onClick={() => onInsert(createMatrixCommand(rows, columns, delimiter))}
          title={isEn ? "Insert matrix" : "插入矩阵"}
        >
          {isEn ? `Insert ${rows} × ${columns}` : `插入 ${rows} × ${columns}`}
        </button>
      </div>

      <div className={styles.options}>
        <span className={styles.optionsLabel}>{isEn ? "Border" : "边界"}</span>
        <div className={styles.delimiters} role="group" aria-label={isEn ? "Matrix delimiter" : "矩阵边界"}>
          {matrixDelimiterOptions.map((option) => (
            <button
              key={option.id}
              type="button"
              className={styles.delimiter}
              aria-pressed={delimiter === option.id}
              onClick={() => setDelimiter(option.id)}
              title={isEn ? option.labelEn : option.labelZh}
              aria-label={isEn ? option.labelEn : option.labelZh}
            >
              <MathPreview latex={option.preview} fit maximumFitScale={1.15} fitInsetRatio={0.72} />
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
