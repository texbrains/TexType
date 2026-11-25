// The hidden render page: the app (app/src/render.rs) sends formulas to draw, the page answers with each picture,
// drawn exactly as the editor draws it (svg.ts), or with a formula's MathML for a Word equation.
import { renderEngineSvg } from "./svg.ts";
import { latexToMathMl } from "../mathml/latex-to-mathml.ts";
import type { FormulaChineseFont, FormulaLetterFont } from "./fonts.ts";

/** One request, as app/src/render.rs sends it. */
type PageRequest = { id: number } & (
  | {
      kind: "svg";
      latex: string;
      display: boolean;
      fontSizePx: number;
      color: string;
      letterFont: FormulaLetterFont;
      chineseFont: FormulaChineseFont;
    }
  | { kind: "mathml"; latex: string; display: boolean }
);

/** What the page uses of Tauri's global API (withGlobalTauri in app/tauri.conf.json). */
export interface TauriGlobal {
  core: { invoke(command: string, args: Record<string, unknown>): Promise<unknown> };
  event: { listen(event: string, handler: (event: { payload: PageRequest }) => void): Promise<unknown> };
}

async function answer(request: PageRequest) {
  try {
    if (request.kind === "mathml") return { mathml: latexToMathMl(request.latex, request.display) };
    const svg = await renderEngineSvg(request.latex, {
      displayMode: request.display,
      fontSizePx: request.fontSizePx,
      color: request.color,
      fonts: { letter: request.letterFont, chinese: request.chineseFont },
    });
    return { svg: { body: svg.body, left: svg.left, right: svg.right, ascent: svg.ascent, descent: svg.descent } };
  } catch (error) {
    // the formula cannot be drawn or converted (an unknown command, say): the app reports it
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

/** Answers every request; tells the app once it is listening. */
export async function startRenderPage(tauri: TauriGlobal): Promise<void> {
  await tauri.event.listen("render-request", ({ payload }) => {
    void answer(payload).then((result) => tauri.core.invoke("render_done", { id: payload.id, result }));
  });
  await tauri.core.invoke("render_ready", {});
}
