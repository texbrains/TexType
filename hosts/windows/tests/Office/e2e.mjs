// TexType in real Word or WPS Writer: the add-in's Ribbon buttons, the app's editor window (Chrome DevTools Protocol
// into its WebView2, input sent to the page only), the document read back through COM. Stops at the first failure.
//   node hosts/windows/tests/Office/e2e.mjs <word|wps> [full|inserts|edge|source|file-undo]
// See README.md for what each mode checks and what has to be set up first.
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdirSync, appendFileSync, openSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const HOST = process.argv[2] ?? "word";
const MODE = process.argv[3] ?? "full";
const WPS = HOST === "wps";
if (!["word", "wps"].includes(HOST) || !["full", "inserts", "edge", "source", "file-undo"].includes(MODE)) {
  console.error("usage: node hosts/windows/tests/Office/e2e.mjs <word|wps> [full|inserts|edge|source|file-undo]");
  process.exit(2);
}
// WPS Writer's Ribbon buttons, in physical pixels relative to its window; measured on a 1020x1360 window
const WPS_BUTTONS = { "行内公式": [441, 170], "行间公式": [510, 170], "编辑公式": [579, 170] };
const PORT = 9341;
const kit = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(kit, "..", "..", "..", "..");
const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(4, 15);
const work = path.join(root, "target", "office-tests", `${HOST}-${MODE}-${stamp}`);
mkdirSync(work, { recursive: true });
const doc = path.join(work, "test.docx");
const logFile = path.join(work, "e2e.log");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => { const line = `${new Date().toTimeString().slice(0, 8)} ${a.join(" ")}`; console.log(line); appendFileSync(logFile, line + "\n"); };
const b64 = (s) => "b64:" + Buffer.from(String(s), "utf8").toString("base64");

async function ps(script, args, timeout = 90000) {
  const { stdout } = await run("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(kit, script), ...args], { timeout, encoding: "utf8" });
  return stdout.trim();
}
// an action of document.ps1 on the test document
function word(action, opts = {}) {
  const args = ["-Action", action, "-Path", doc];
  for (const [k, v] of Object.entries(opts)) args.push(`-${k}`, typeof v === "number" ? String(v) : b64(v));
  if (WPS) args.push("-Wps");
  return ps("document.ps1", args);
}
const state = async () => JSON.parse(await word(WPS ? "xstate" : "state"));
const eqs = async () => (await state()).equations.map((e) => ({ text: e.text.normalize("NFKC"), display: e.display, size: e.size }));
const popupList = async (press) => JSON.parse((await ps("popups.ps1", ["-Process", WPS ? "wps" : "WINWORD", ...(press ? ["-Press", b64(press)] : [])])) || "[]");
// a TexType Ribbon button
async function press(button) {
  if (!WPS) return ps("ribbon.ps1", ["-Name", b64(button)]);
  const [x, y] = WPS_BUTTONS[button];
  const result = await ps("ribbon.ps1", ["-Wps", "-X", String(x), "-Y", String(y)]);
  if (!/bosa_sdm/.test(result)) throw new Error(`the click did not reach the Ribbon: ${result}`);
  return result;
}
// selects equation n (document order): Word selects it; WPS gets the caret inside it (equation positions are not
// readable out of process, so the places of the full run's two equations are used)
async function selectEq(n) {
  if (!WPS) return word("select-omath", { Index: n });
  const e = await eqs();
  return e[n - 1].display ? word("caret-at", { Index: 2, Offset: 1 }) : word("caret-at", { Index: 1, Offset: 15 });
}

// ---------- the editor page ----------
class Page {
  constructor(t) { this.t = t; this.seq = 0; this.pending = new Map(); this.errors = []; }
  async open() {
    this.ws = new WebSocket(this.t.webSocketDebuggerUrl);
    await new Promise((res, rej) => { this.ws.onopen = res; this.ws.onerror = rej; });
    this.ws.onmessage = ({ data }) => {
      const m = JSON.parse(data);
      if (m.id) { const p = this.pending.get(m.id); this.pending.delete(m.id); if (p) (m.error ? p.rej(new Error(m.error.message)) : p.res(m.result)); return; }
      if (m.method === "Runtime.exceptionThrown") this.errors.push(m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text);
      if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") this.errors.push(m.params.args.map((a) => a.value ?? a.description).join(" "));
    };
    await this.send("Runtime.enable");
  }
  send(method, params = {}) {
    const id = ++this.seq;
    return new Promise((res, rej) => {
      const timer = setTimeout(() => { this.pending.delete(id); rej(new Error(`${method} timed out`)); }, 20000);
      this.pending.set(id, { res: (v) => { clearTimeout(timer); res(v); }, rej: (e) => { clearTimeout(timer); rej(e); } });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expr) {
    const r = await this.send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  }
  async key(key, code, vk, text) {
    await this.send("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode: vk, text });
    await this.send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: vk });
  }
  async type(text) {
    for (const ch of text) {
      if (/[a-z]/.test(ch)) await this.key(ch, `Key${ch.toUpperCase()}`, ch.toUpperCase().charCodeAt(0), ch);
      else if (/[0-9]/.test(ch)) await this.key(ch, `Digit${ch}`, ch.charCodeAt(0), ch);
      else if (ch === "+") await this.key("+", "Equal", 187, "+");
      else if (ch === "=") await this.key("=", "Equal", 187, "=");
      else if (ch === "/") await this.key("/", "Slash", 191, "/");
      else if (ch === "\\") await this.key("\\", "Backslash", 220, "\\");
      else throw new Error(`no key for ${ch}`);
      await sleep(60);
    }
  }
  end() { return this.key("End", "End", 35); }
  enter() { return this.key("Enter", "Enter", 13, "\r"); }
  down() { return this.key("ArrowDown", "ArrowDown", 40); }
  // the formula the app has open in the window (null between formulas); the page's visibility does not follow the
  // hidden window
  openFormula() { return this.eval("window.__TAURI__.core.invoke('editor_input').then((v) => JSON.stringify(v))"); }
  value() { return this.eval("document.querySelector('math-field')?.value ?? null"); }
  button(re) { return this.eval(`(() => { const b = [...document.querySelectorAll('button')].find((b) => ${re}.test(b.textContent.trim())); if (!b) return false; b.click(); return true; })()`); }
}

async function waitFor(what, test, timeout = 20000) {
  const t0 = Date.now();
  for (;;) {
    const v = await test().catch(() => undefined);
    if (v) return v;
    if (Date.now() - t0 > timeout) throw new Error(`timed out: ${what}`);
    await sleep(300);
  }
}

let app = null;
let page = null;
async function popups() {
  const list = await popupList();
  if (list.length) log("POP-UP", JSON.stringify(list));
  return list;
}
function check(cond, message) { if (!cond) throw new Error(`check failed: ${message}`); log("ok", message); }

// Opens the editor with a Ribbon button; returns the formula shown in it.
async function openEditor(button) {
  log(await press(button));
  try {
    await waitFor("editor shown", async () => (await page.openFormula()) !== "null" && (await page.eval("!!document.querySelector('math-field')")));
  } catch (error) {
    await popups();
    throw error;
  }
  await sleep(700);
  return page.value();
}
async function finish(re) {
  check(await page.button(re), `pressed ${re}`);
  try {
    await waitFor("editor closed", async () => (await page.openFormula()) === "null");
  } catch (error) {
    log("toast", JSON.stringify(await page.eval("document.querySelector('[role=status]')?.textContent ?? null")));
    throw error;
  }
  await sleep(1200);
  if ((await popups()).length) throw new Error("a message box appeared");
}
const INSERT = "/^(完成并插入|更新公式|Insert|Update)$/";
const CANCEL = "/^(取消|Cancel)$/";

// Writes with the editor, then checks one Undo (the document exactly as before) and one Redo (exactly as after).
async function undoableCase(snapshot, name, button, typed, place, expected, end = false) {
  if (place) log(await place());
  const before = await snapshot();
  await openEditor(button);
  if (end) await page.end();
  if (typeof typed === "function") await typed(); else await page.type(typed);
  log(`${name}: editor value`, await page.value());
  await finish(INSERT);
  const after = await snapshot();
  log(`${name}: after`, after);
  if (!(after !== before && expected(JSON.parse(after), JSON.parse(before))) && !WPS) {
    // the characters of the paragraphs that changed, for the diagnosis
    const [a, b] = [JSON.parse(after).p, JSON.parse(before).p];
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) log(await word("chars", { Index: i + 1 }));
  }
  check(after !== before && expected(JSON.parse(after), JSON.parse(before)), `${name}: written as expected`);
  log(await word("undo"));
  const undone = await snapshot();
  if (undone !== before) log(`${name}: before`, before, "undone", undone);
  check(undone === before, `${name}: one undo restores the document exactly`);
  log(await word("redo"));
  check((await snapshot()) === after, `${name}: redo restores it`);
}

// ---------- the modes ----------

// Insert inline and display, edit, undo and redo, save and reopen, five edits in a row, cancel, edit the display one.
async function full() {
  log(await word("caret", { Where: "end" }));
  check((await openEditor("行内公式")) === "", "new inline formula opens empty");
  await page.type("a+b");
  await finish(INSERT);
  let e = await eqs();
  log("equations", JSON.stringify(e));
  check(e.length === 1 && e[0].text === "a+b" && !e[0].display, "inline a+b inserted");

  // the add-in left the caret after the inline equation (WPS: no equation positions out of process)
  if (!WPS) log(await word("caret", { Where: "after-omath", Index: 1 }));
  check((await openEditor("行间公式")) === "", "new display formula opens empty");
  await page.type("c=d");
  await finish(INSERT);
  e = await eqs();
  log("equations", JSON.stringify(e));
  check(e.length === 2 && e.some((x) => x.text === "c=d" && x.display), "display c=d inserted");

  log(await selectEq(1));
  check((await openEditor("编辑公式")) === "a+b", "edit opens with a+b");
  await page.end();
  await page.type("+e");
  await finish(INSERT);
  e = await eqs();
  check(e[0].text === "a+b+e" && !e[0].display && e.length === 2, "inline edited to a+b+e");

  // Word: undo and redo right after the checked edit
  if (!WPS) {
    log(await word("undo"));
    check((await eqs())[0].text === "a+b", "one undo restores a+b");
    log(await word("redo"));
    check((await eqs())[0].text === "a+b+e", "redo restores a+b+e");
  }
  // a second edit undone with nothing read in between, as a user does (WPS: reading saves the document, so the edit
  // is read once to see it)
  log(await selectEq(1));
  check((await openEditor("编辑公式")) === "a+b+e", "edit before undo opens a+b+e");
  await page.end();
  await page.type("+u");
  await finish(INSERT);
  if (WPS) check((await eqs())[0].text === "a+b+e+u", "second edit a+b+e+u");
  log(await word("undo"));
  e = await eqs();
  check(e.length === 2 && e[0].text === "a+b+e", "one undo takes back the unsaved edit +u");
  log(await word("redo"));
  check((await eqs())[0].text === "a+b+e+u", "redo brings +u back");
  log(await word("undo"));
  check((await eqs())[0].text === "a+b+e", "undo again");

  log(await word("save"));
  log(await word("reopen"));
  await sleep(1500);
  // WPS: closing the last document ends the add-in's connection
  if (WPS) { log(await word("connect")); await sleep(1500); }
  e = await eqs();
  check(e.length === 2 && e[0].text === "a+b+e" && e.some((x) => x.text === "c=d" && x.display), "equations survive save and reopen");
  log(await selectEq(1));
  check((await openEditor("编辑公式")) === "a+b+e", "reopened equation opens in the editor");
  await page.end();
  await page.type("+f");
  await finish(INSERT);
  check((await eqs())[0].text === "a+b+e+f", "reopened equation edited");

  for (let i = 1; i <= 5; i++) {
    log(await selectEq(1));
    const before = await openEditor("编辑公式");
    await page.end();
    await page.type(`+${i}`);
    await finish(INSERT);
    const now = (await eqs())[0].text;
    check(now === `${before}+${i}`, `edit ${i} of 5: ${now}`);
  }

  const kept = (await eqs())[0].text;
  log(await selectEq(1));
  await openEditor("编辑公式");
  await page.end();
  await page.type("+z");
  await finish(CANCEL);
  check((await eqs())[0].text === kept, "cancel leaves the equation unchanged");

  const d = (await eqs()).findIndex((x) => x.display) + 1;
  log(await selectEq(d));
  check((await openEditor("编辑公式")) === "c=d", "display equation opens in the editor");
  await page.end();
  await page.type("+g");
  await finish(INSERT);
  e = await eqs();
  check(e[d - 1].text === "c=d+g" && e[d - 1].display, "display equation edited and still display");
  log(await word("undo"));
  e = await eqs();
  check(e[d - 1].text === "c=d" && e[d - 1].display && e.length === 2, "one undo restores the display c=d");
  log(await word("redo"));
  e = await eqs();
  check(e[d - 1].text === "c=d+g" && e[d - 1].display, "redo restores c=d+g");
  log(await word("save"));
  log("final", JSON.stringify(await state()));
}

// Each kind of insert, each with one Undo and one Redo.
async function inserts() {
  const snapshot = async () => {
    const s = await state();
    return JSON.stringify({ p: s.paragraphs.map((p) => p.normalize("NFKC")), e: s.equations.map((x) => [x.text.normalize("NFKC"), x.display]) });
  };
  const insert = (...args) => undoableCase(snapshot, ...args);
  log(await word("add-table"));
  log("document", await snapshot());
  await insert("inline at a paragraph's end", "行内公式", "a+b", () => word("caret", { Where: "end" }),
    (s, b) => s.e.length === 1 && s.e[0][0] === "a+b" && !s.e[0][1] && s.p[0].replace(/\r$/, "") === "TexType test: a+b" && s.p.length === b.p.length);
  await insert("display right after an inline equation", "行间公式", "c=d", null,
    (s, b) => s.e.length === 2 && s.e[1][0] === "c=d" && s.e[1][1] && s.p[1].replace(/\r$/, "") === "c=d" && s.p.length === b.p.length + 1);
  await insert("inline inside text", "行内公式", "y", () => word("caret-at", { Index: 3, Offset: 6 }),
    (s, b) => s.e.length === 3 && s.p[2].replace(/\r$/, "") === "Secondy paragraph." && s.p.length === b.p.length);
  // before text: Word imports the package's paragraph mark there, which the add-in takes out again
  await insert("inline at a paragraph's start", "行内公式", "z", () => word("caret-at", { Index: 3, Offset: 0 }),
    (s, b) => s.e.length === 4 && s.e[2][0] === "z" && !s.e[2][1] && s.p[2].replace(/\r$/, "") === "zSecondy paragraph." && s.p.length === b.p.length);
  await insert("inline in a table cell", "行内公式", "t", () => word("caret-cell"),
    (s, b) => s.e.length === 5 && s.p.some((p) => /^cellt(\r\u0007)?$/.test(p)) && s.p.length === b.p.length);
  // between a and + (the math italic a counts as two characters)
  await insert("inline with the caret inside an equation (joins it)", "行内公式", "x", () => word("caret-at", { Index: 1, Offset: 16 }),
    (s, b) => s.e.length === 5 && s.e[0][0] === "ax+b" && !s.e[0][1] && s.p.length === b.p.length);
  // the host's own rule: an equation alone in its paragraph is a display equation
  await insert("inline in an empty paragraph (the host makes it display)", "行内公式", "w", () => word("caret-last"),
    (s, b) => s.e.length === 6 && s.e[5][0] === "w" && s.e[5][1] && s.p.length === b.p.length);
}

// Writing next to a hyperlink, a content control and tracked changes, and joining inside a fraction.
async function edge() {
  const snapshot = async () => {
    const s = await state();
    return JSON.stringify({
      p: s.paragraphs.map((p) => p.normalize("NFKC").replace(/[\r\u0007]/g, "")),
      e: s.equations.map((x) => [x.text.normalize("NFKC"), x.display]),
      links: s.links, ccs: s.ccs, revs: s.revs, linkMath: s.linkMath, ccMath: s.ccMath,
    });
  };
  const write = (...args) => undoableCase(snapshot, ...args);
  log(await word("setup-edge"));
  const start = JSON.parse(await snapshot());
  log("document", JSON.stringify(start));
  await write("inline inside a hyperlink", "行内公式", "h", () => word("caret-after-text", { Index: 3, Name: "link" }),
    (s, b) => s.p[2] === "linkh text" && s.links === b.links && s.linkMath === 1);
  await write("edit of the equation inside the hyperlink", "编辑公式", "+i", () => word("caret-after-text", { Index: 3, Name: "link" }),
    (s, b) => s.p[2] === "linkh+i text" && s.links === b.links && s.linkMath === 1, true);
  // at the start of the link's text the hosts put a new equation in front of the link, as typing there does
  await write("inline at the start of the hyperlink's text", "行内公式", "s", () => word("caret-link-start", { Index: 1 }),
    (s, b) => s.p[2] === "slinkh+i text" && s.links === b.links && s.linkMath === 1);
  // the link's equation is now the second of its paragraph: the edit takes the right one out of the paragraph's export
  await write("edit of the hyperlink's equation, second in its paragraph", "编辑公式", "+k", () => word("caret-after-text", { Index: 3, Name: "link" }),
    (s, b) => s.p[2] === "slinkh+i+k text" && s.links === b.links && s.linkMath === 1, true);
  // written over an equation that a field follows: Word does not import the package's paragraph mark there
  await write("edit of the equation in front of the hyperlink", "编辑公式", "+j", () => word("caret-at", { Index: 3, Offset: 0 }),
    (s, b) => s.p[2] === "s+jlinkh+i+k text" && s.links === b.links && s.linkMath === 1, true);
  if (start.ccs > 0) {
    await write("inline inside a content control", "行内公式", "k", () => word("caret-after-text", { Index: 4, Name: "cc" }),
      (s, b) => s.p[3] === "cck text" && s.ccs === b.ccs && s.ccMath === 1);
  } else log("SKIPPED: content control (the host could not add one)");
  // \frac from the command candidates: the numerator gets 1, the denominator 2
  const fractionKeys = async () => {
    await page.type("\\frac");
    await sleep(400);
    await page.enter();
    await sleep(300);
    await page.type("1");
    await page.down();
    await page.type("2");
  };
  await write("inline fraction at a paragraph's end", "行内公式", fractionKeys, () => word("caret-after-text", { Index: 2, Name: "paragraph." }),
    (s) => s.e.some((x) => x[0].replace(/[^0-9]/g, "") === "12"));
  await write("join inside the fraction's numerator", "行内公式", "x", () => word("caret-after-text", { Index: 2, Name: "1" }),
    (s, b) => s.e.length === b.e.length);
  const fraction = (await state()).equations.find((x) => /<m:f>|<m:f /.test(x.xml ?? ""));
  check(fraction && /<m:num>[\s\S]*>1<[\s\S]*>x<[\s\S]*<\/m:num>/.test(fraction.xml), "x joined the numerator after 1");
  log(await word("track", { Where: "on" }));
  await write("inline with tracked changes on", "行内公式", "r", () => word("caret-after-text", { Index: 5, Name: "tracked" }),
    (s, b) => s.p[4] === "trackedr text" && s.revs > b.revs);
  log(await word("track", { Where: "off" }));
}

// The LaTeX source view's completion list and colours, which read the command catalogue.
async function source() {
  log(await word("caret", { Where: "end" }));
  await openEditor("行内公式");
  check(await page.button("/LaTeX/"), "opened the LaTeX source");
  await sleep(600);
  await page.eval("document.querySelector('[data-source-editor] .cm-content').focus()");
  await page.type("\\alpha+\\fr");
  await sleep(800);
  const options = await page.eval("[...document.querySelectorAll('.cm-tooltip-autocomplete li')].slice(0, 6).map((li) => li.textContent)");
  log("source completion for \\fr", JSON.stringify(options));
  check(options.some((o) => o.includes("\\frac")), "the source view offers \\frac");
  const colour = await page.eval("[...document.querySelectorAll('[data-source-editor] [class*=cm-latex-command-]')].map((e) => e.className).join(' ')");
  check(colour.includes("cm-latex-command-greek"), "\\alpha is coloured as a Greek letter");
  await finish(CANCEL);

  // a formula the app cannot convert stays in the window, which says why: an unknown command typed is dropped by the
  // editor, a pasted one stays (shown as its text), so it is pasted into the field's keyboard sink
  await openEditor("行内公式");
  await page.eval(`(() => {
    const sink = document.querySelector('math-field').shadowRoot.activeElement;
    const data = new DataTransfer();
    data.setData('text/plain', 'x+\\\\nosuchcommand');
    sink.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  })()`);
  await sleep(500);
  const pasted = await page.value();
  log("editor value", pasted);
  check(/nosuchcommand/.test(pasted), "the pasted formula holds the unknown command");
  check(await page.button(INSERT), "pressed insert with an unknown command");
  const toast = await waitFor("the refusal shown", () => page.eval("document.querySelector('[role=status]')?.textContent ?? null"));
  log("toast", toast);
  check(/nosuchcommand/.test(toast), "the window names the unknown command");
  check((await page.openFormula()) !== "null", "the formula is still open");
  await finish(CANCEL);
  check((await state()).equations.length === 0, "nothing was written");
}

// An equation written in the file (not by the add-in): edited, then one Undo gives it back.
async function fileUndo() {
  log(await word("caret-at", { Index: 1, Offset: 15 }));
  check((await openEditor("编辑公式")) === "a+b", "file equation opens");
  await page.end();
  await page.type("+e");
  await finish(INSERT);
  check((await eqs())[0].text === "a+b+e", "file equation edited");
  log(await word("undo"));
  const e = await eqs();
  check(e.length === 1 && e[0].text === "a+b", "one undo restores the file's a+b");
}

// ---------- the run ----------
let failed = null;
try {
  log("work folder", work);
  log(await word("newdoc", MODE === "file-undo" ? { Where: "equation" } : {}));

  const exe = path.join(root, "target", "debug", "app.exe");
  const out = openSync(path.join(work, "app.log"), "a");
  app = spawn(exe, [], {
    cwd: path.dirname(exe), stdio: ["ignore", out, out],
    env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT} --remote-debugging-address=127.0.0.1` },
  });
  log("app pid", app.pid);
  const target = await waitFor("editor page on the debug port", async () =>
    (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === "page" && /editor\.html/.test(t.url)), 40000);
  page = new Page(target);
  await page.open();
  // the toolbar, made from the command catalogue: nine tabs, the common tab's 45 templates
  const toolbar = await waitFor("toolbar drawn", async () => {
    const t = await page.eval("({ tabs: document.querySelectorAll('[data-category]').length, templates: document.querySelectorAll('[aria-label=\"公式模板\"] button').length })");
    return t.tabs ? t : null;
  });
  check(toolbar.tabs === 9 && toolbar.templates === 45, "toolbar has 9 tabs and the 45 common templates");

  if (WPS) {
    // only a newly started WPS reads the add-in registration
    await run("powershell", ["-NoProfile", "-Command", "Get-Process wps,wpp,et -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue; exit 0"]);
    await sleep(2500);
  }
  log(await word("start"));
  for (let i = 0; i < 15; i++) {
    await sleep(1000);
    // a start prompt (WPS: the file association question) is answered with No
    const seen = await popupList("否");
    if (seen.length) log("start prompt", JSON.stringify(seen));
    if (i >= 4 && (await word("caret-at", { Index: 1, Offset: 0 }).then(() => true).catch(() => false))) break;
  }
  // WPS does not connect a newly registered add-in by itself
  if (WPS) { log(await word("connect")); await sleep(1500); }
  log("document", JSON.stringify(await state()));

  await { full, inserts, edge, source, "file-undo": fileUndo }[MODE]();
} catch (error) {
  failed = error;
  log("FAILED", error.message);
  try { await popups(); } catch {}
} finally {
  if (page?.errors.length) log("page errors", JSON.stringify(page.errors.slice(0, 10)));
  if (failed) {
    // what was on screen: the host's window and the editor page
    try {
      const { stdout } = await run("powershell", ["-NoProfile", "-Command", "'{0:x}' -f (Get-Process " + (WPS ? "wps" : "WINWORD") + " | ? { $_.MainWindowHandle -ne 0 } | select -First 1).MainWindowHandle.ToInt64()"], { encoding: "utf8" });
      log(await ps("capture-window.ps1", ["-Handle", stdout.trim(), "-Out", path.join(work, "host.png")]));
    } catch (error) { log("host screenshot:", error.message); }
    try {
      const shot = await page.send("Page.captureScreenshot", { format: "png" });
      writeFileSync(path.join(work, "editor.png"), Buffer.from(shot.data, "base64"));
      log("screenshot editor.png");
    } catch (error) { log("editor screenshot:", error.message); }
  }
  // the document stays in the work folder as last saved; the host is closed either way, after its message boxes
  // (the add-in's error, Word's "a dialog is open") are closed with their one button
  try {
    for (let i = 0; i < 3 && (await popupList("确定")).length; i++) await sleep(700);
  } catch (error) { log("message boxes:", error.message); }
  try { log(await word("quit")); } catch (error) { log("quit:", error.message); }
  if (WPS) {
    // a normal exit (WM_CLOSE to its main window) instead of dying with this run
    try {
      await run("powershell", ["-NoProfile", "-Command", "Add-Type -Name W -Namespace U -MemberDefinition '[DllImport(\"user32.dll\")] public static extern bool PostMessage(System.IntPtr h, int m, System.IntPtr w, System.IntPtr l);'; Get-Process wps | ? { $_.MainWindowHandle -ne 0 } | % { [U.W]::PostMessage($_.MainWindowHandle, 0x10, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null }"]);
      await sleep(4000);
      log("WPS closed", JSON.stringify(await popupList()));
    } catch (error) { log("WPS close:", error.message); }
  }
  try { page?.ws.close(); } catch {}
  if (app) { app.kill(); log("app stopped"); }
  log(failed ? "RESULT: FAILED" : "RESULT: PASSED");
  process.exitCode = failed ? 1 : 0;
}
