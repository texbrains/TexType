// The kernel's MathML (copied formulas, speech) for every LaTeX comparison case must be exactly the stored MathML
// (testing/corpus/tex-layout/mathml-cm.jsonl; where it comes from: docs/SOURCES.md).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { kernelNodeUrl } from "./kernel-node.mjs";

const corpus = new URL("../../../testing/corpus/tex-layout/", import.meta.url);
const kernel = await import(kernelNodeUrl);

test("every formula converts to the stored MathML", () => {
  const stored = readFileSync(new URL("mathml-cm.jsonl", corpus), "utf8").trim().split("\n").map((line) => JSON.parse(line));
  const changed = [];
  for (const want of stored) {
    const c = JSON.parse(readFileSync(new URL(`cases/${want.file}`, corpus), "utf8"));
    const atoms = kernel.parseLatex(c.source, { parseMode: "math", mathstyle: c.style === "display" ? "displaystyle" : "textstyle" });
    if (kernel.toMathML(atoms) !== want.mathml) changed.push(want.file);
  }
  assert.deepEqual(changed, []);
});
