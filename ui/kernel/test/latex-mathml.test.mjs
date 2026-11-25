// LaTeX -> MathML for Word equations: every stored formula must give exactly the stored MathML
// (testing/corpus/omml/latex-to-mathml.jsonl, the same formulas as the MathML -> OMML corpus; where it comes from:
// docs/SOURCES.md).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { kernelNodeUrl } from "./kernel-node.mjs";

const kernel = await import(kernelNodeUrl);
const corpus = new URL("../../../testing/corpus/omml/latex-to-mathml.jsonl", import.meta.url);

test("every formula converts to the stored MathML", () => {
  const rows = readFileSync(corpus, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  assert.ok(rows.length > 100);
  const changed = rows
    .filter((row) => kernel.latexToMathMl(row.latex, row.display) !== row.mathml)
    .map((row) => `${row.source} (${row.display ? "display" : "inline"})`);
  assert.deepEqual(changed, []);
});

test("an unknown command is an error that names it", () => {
  assert.throws(() => kernel.latexToMathMl("x+\\nosuchcommand", false), /\\nosuchcommand/);
});
