/** Whether a colour may go into a formula's style: a #rrggbb value or one of MathLive's colour names. */
export function isSafeFormulaStyleColor(value: unknown) {
  return (
    typeof value === "string" &&
    (/^#[0-9a-f]{6}$/i.test(value) ||
      [
        "red",
        "orange",
        "yellow",
        "lime",
        "green",
        "teal",
        "cyan",
        "blue",
        "indigo",
        "purple",
        "magenta",
        "black",
        "dark-grey",
        "grey",
        "light-grey",
        "white",
      ].includes(value))
  );
}
