// The engine against real LaTeX: every comparison case (testing/corpus/tex-layout/cases, made with tools of the
// earlier product from LaTeX's own \showlists and box output) is typeset from TeX's own math list and must match
// LaTeX to the scaled point, except the cases known-differences.json lists with their reason.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { compareCase } from "./oracle-compare.ts";

const corpus = fileURLToPath(new URL("../../../testing/corpus/tex-layout/", import.meta.url));

test("the engine matches LaTeX on every case but the known differences", () => {
  const known = (JSON.parse(readFileSync(`${corpus}known-differences.json`, "utf8")) as { file: string }[]).map((k) => k.file);
  const differing: string[] = [];
  let cases = 0;
  for (const dir of readdirSync(`${corpus}cases`).sort()) {
    for (const name of readdirSync(`${corpus}cases/${dir}`).sort()) {
      cases++;
      if (!compareCase(`${corpus}cases/${dir}/${name}`).ok) differing.push(`${dir}/${name}`);
    }
  }
  assert.ok(cases > 400);
  assert.deepEqual(differing, known);
});
