import { Component, type ErrorInfo, type ReactNode } from "react";
import styles from "./FormulaFieldErrorBoundary.module.css";

interface FormulaFieldErrorBoundaryProps {
  recoveryKey: string;
  language: "cn" | "en";
  children: ReactNode;
}

interface FormulaFieldErrorBoundaryState {
  error: unknown | null;
  recoveryKey: string;
}

export function FormulaFieldRenderFallback({ message }: { message: string }) {
  return (
    <div role="status" className={styles.fallback}>
      {message}
    </div>
  );
}

/** Keeps a failing formula renderer to its own row. */
export class FormulaFieldErrorBoundary extends Component<
  FormulaFieldErrorBoundaryProps,
  FormulaFieldErrorBoundaryState
> {
  state: FormulaFieldErrorBoundaryState = {
    error: null,
    recoveryKey: this.props.recoveryKey,
  };

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  static getDerivedStateFromProps(
    props: FormulaFieldErrorBoundaryProps,
    state: FormulaFieldErrorBoundaryState,
  ) {
    if (props.recoveryKey === state.recoveryKey) return null;
    return { error: null, recoveryKey: props.recoveryKey };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error("TexType isolated a formula renderer failure", error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <FormulaFieldRenderFallback
        message={
          this.props.language === "en"
            ? "Render failed. The LaTeX source is preserved."
            : "渲染失败，LaTeX 源码已保留。"
        }
      />
    );
  }
}
