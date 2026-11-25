// The pictures the app puts into documents, for every LaTeX comparison case, in both font profiles: each must be
// exactly the stored SVG (testing/corpus/tex-layout/svg-*.jsonl, made by TexType at 83ce1a73, the code this
// kernel was ported from). A change in drawing shows here; a stored SVG changes only when the owners agree.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { kernelNodeUrl } from "./kernel-node.mjs";

const corpus = new URL("../../../testing/corpus/tex-layout/", import.meta.url);
const kernel = await import(kernelNodeUrl);

for (const [name, cases, letter] of [
  ["Computer Modern", "cases/", "katex"],
  ["newtx (Times)", "profiles/ntx/cases/", "times"],
]) {
  test(`every stored picture is drawn unchanged: ${name}`, async () => {
    const stored = readFileSync(new URL(`svg-${letter === "katex" ? "cm" : "ntx"}.jsonl`, corpus), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.ok(stored.length > 400);
    const changed = [];
    for (const want of stored) {
      const c = JSON.parse(readFileSync(new URL(cases + want.file, corpus), "utf8"));
      let got;
      try {
        const r = await kernel.renderEngineSvg(c.source, {
          displayMode: c.style === "display",
          fontSizePx: 16,
          color: "#000000",
          idPrefix: "f",
          fonts: { letter, chinese: "system" },
        });
        got = { file: want.file, body: r.body, left: r.left, right: r.right, ascent: r.ascent, descent: r.descent, missing: r.missing };
      } catch (error) {
        got = { file: want.file, error: String(error.message) };
      }
      if (JSON.stringify(got) !== JSON.stringify(want)) changed.push(want.file);
    }
    assert.deepEqual(changed, [], `${changed.length} pictures changed`);
  });
}

test("chemical formulas (mhchem) are drawn unchanged", async () => {
  const stored = readFileSync(new URL("svg-mhchem.jsonl", corpus), "utf8").trim().split("\n").map((line) => JSON.parse(line));
  const changed = [];
  for (const want of stored) {
    let got;
    try {
      const r = await kernel.renderEngineSvg(want.source, {
        displayMode: want.style === "display",
        fontSizePx: 16,
        color: "#000000",
        idPrefix: "f",
        fonts: { letter: "katex", chinese: "system" },
      });
      got = { source: want.source, style: want.style, body: r.body, left: r.left, right: r.right, ascent: r.ascent, descent: r.descent, missing: r.missing };
    } catch (error) {
      got = { source: want.source, style: want.style, error: String(error.message) };
    }
    if (JSON.stringify(got) !== JSON.stringify(want)) changed.push(`${want.style} ${want.source}`);
  }
  assert.deepEqual(changed, []);
});
