// The editor's buttons. A parent picks a kind and whether the button is on; how each kind looks is this
// component's alone (Button.module.css).
import type { ButtonHTMLAttributes } from "react";
import styles from "./Button.module.css";

/** icon: a bare icon (the bottom bar); framed: an icon in a frame (the header); secondary and primary: text. */
export type ButtonKind = "icon" | "framed" | "secondary" | "primary";

interface Props extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "type"> {
  kind: ButtonKind;
  /** a toggle that is on, or the chosen one of a group */
  active?: boolean;
}

export function Button({ kind, active = false, ...rest }: Props) {
  return <button type="button" className={styles[kind]} data-active={active || undefined} {...rest} />;
}
