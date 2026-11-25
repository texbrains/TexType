// Checks the separation rules of docs/ARCHITECTURE.md. Run: node tools/check-structure.mjs
// Every rule here exists so that a change is made in the part that owns it,
// instead of being patched into a part that happens to be nearby.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const problems = [];
const fail = (rule, message) => problems.push(`[${rule}] ${message}`);
const rel = (path) => relative(root, path).split(sep).join('/');
const read = (path) => readFileSync(path, 'utf8');
const dirs = (path) =>
  existsSync(path)
    ? readdirSync(path).filter((name) => statSync(join(path, name)).isDirectory())
    : [];

const SKIP_DIRS = new Set(['target', 'node_modules', '.git', 'dist']);
function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else yield path;
  }
}
const allFiles = [...walk(root)];
const SOURCE = /\.(rs|ts|tsx|js|mjs|cs|cpp|h|idl|bas|cls|swift)$/;
const TEXT = /\.(rs|ts|tsx|js|mjs|cs|cpp|h|idl|bas|cls|swift|toml|json|md|xml|html|css|yml|yaml|iss|wxs|ps1|sh)$/;

// Dependency names and local paths of a Cargo.toml (all dependency tables).
function cargoDeps(manifestPath) {
  const deps = [];
  let inDeps = false;
  for (const raw of read(manifestPath).split('\n')) {
    const line = raw.trim();
    if (line.startsWith('[')) {
      inDeps = /dependencies\]$/.test(line) || /dependencies\./.test(line);
      continue;
    }
    if (!inDeps || !line || line.startsWith('#')) continue;
    const match = line.match(/^([A-Za-z0-9_-]+)\s*=\s*(.*)$/);
    if (!match) continue;
    const path = match[2].match(/path\s*=\s*"([^"]+)"/);
    deps.push({ name: match[1], path: path ? path[1] : null });
  }
  return deps;
}

// ---- Rule 1: the core has no interface and no host. --------------------------
const FORBIDDEN_IN_CORE = /^(tauri|tauri-.*|wry|tao|webview2-com.*|eframe|egui|winit)$/;
for (const crate of dirs(join(root, 'core'))) {
  const manifest = join(root, 'core', crate, 'Cargo.toml');
  if (!existsSync(manifest)) {
    fail('core', `core/${crate} has no Cargo.toml`);
    continue;
  }
  for (const dep of cargoDeps(manifest)) {
    if (FORBIDDEN_IN_CORE.test(dep.name)) {
      fail('core', `core/${crate} depends on ${dep.name}: the core has no windows`);
    }
    if (dep.path) {
      const target = rel(join(root, 'core', crate, dep.path));
      if (!target.startsWith('core/') && target !== 'legacy-import') {
        fail('core', `core/${crate} depends on ${target}: the core depends only on the core`);
      }
      // ---- Rule 2: the temporary importer can be deleted at any time. ---------
      if (target === 'legacy-import') {
        fail('legacy', `core/${crate} depends on legacy-import: only the app may`);
      }
    }
  }
}
for (const dep of cargoDeps(join(root, 'app', 'Cargo.toml'))) {
  const target = dep.path ? rel(join(root, 'app', dep.path)) : null;
  if (target && !target.startsWith('core/') && target !== 'legacy-import') {
    fail('app', `app depends on ${target}: the app's local dependencies are core crates and legacy-import`);
  }
}

// ---- Rule 2b: the old-format reader can be removed. ----------------------------
// It lives outside core/, depends on core only, is used by nothing but the app, only as an optional
// feature, and only from app/src/legacy.rs.
if (existsSync(join(root, 'legacy-import'))) {
  for (const dep of cargoDeps(join(root, 'legacy-import', 'Cargo.toml'))) {
    if (dep.path && !rel(join(root, 'legacy-import', dep.path)).startsWith('core/')) {
      fail('legacy', `legacy-import depends on ${dep.path}: it may depend on core crates only`);
    }
  }
  for (const line of read(join(root, 'app', 'Cargo.toml')).split('\n')) {
    if (/path\s*=\s*"\.\.\/legacy-import"/.test(line) && !/optional\s*=\s*true/.test(line)) {
      fail('legacy', `app/Cargo.toml: legacy-import must be an optional dependency (feature "legacy-import")`);
    }
  }
  for (const file of allFiles) {
    const path = rel(file);
    if (path.startsWith('app/src/') && path.endsWith('.rs') && path !== 'app/src/legacy.rs' && /\blegacy_import\b/.test(read(file))) {
      fail('legacy', `${path} uses legacy_import: only app/src/legacy.rs may`);
    }
  }
}

// ---- Rule 3: UI packages depend in one direction. ---------------------------
const UI_MAY_USE = {
  kernel: [],
  editor: ['kernel'],
  'app-ui': ['editor', 'kernel'],
};
for (const name of dirs(join(root, 'ui'))) {
  if (!(name in UI_MAY_USE)) {
    fail('ui', `ui/${name} is not in the layering table of tools/check-structure.mjs`);
    continue;
  }
  const allowed = new Set(UI_MAY_USE[name]);
  const manifestPath = join(root, 'ui', name, 'package.json');
  const manifest = existsSync(manifestPath) ? JSON.parse(read(manifestPath)) : {};
  for (const dep of Object.keys({ ...manifest.dependencies, ...manifest.devDependencies })) {
    const local = dep.match(/^@app\/(.+)$/);
    if (local && !allowed.has(local[1])) {
      fail('ui', `ui/${name} depends on ${dep}: allowed are [${[...allowed].join(', ')}]`);
    }
  }
  for (const file of allFiles) {
    const path = rel(file);
    if (!path.startsWith(`ui/${name}/`) || !/\.(ts|tsx|js|mjs)$/.test(path)) continue;
    for (const match of read(file).matchAll(/from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      const spec = match[1] ?? match[2];
      const local = spec.match(/^@app\/([^/]+)/);
      if (local && local[1] !== name && !allowed.has(local[1])) {
        fail('ui', `${path} imports ${spec}: ui/${name} may use [${[...allowed].join(', ')}]`);
      }
      if (spec.startsWith('.')) {
        const target = rel(join(file, '..', spec));
        if (!target.startsWith(`ui/${name}/`)) {
          fail('ui', `${path} reaches outside its package with ${spec}: import the package by name`);
        }
      }
    }
  }
}

// ---- Rule 4: the earlier products are named only where they are imported. ----
// (Patterns are assembled so that this file does not match itself.)
const EARLIER = [new RegExp('visual' + 'tex', 'i'), new RegExp('latex' + 'snipper', 'i')];
const EARLIER_ALLOWED = ['docs/', 'legacy-import/', 'core/mathcraft/'];
// ---- Rule 5: the product's technical identifiers are written in product.toml only.
// The technical identifiers only; the product name itself may appear in prose and comments.
const productValues = [...read(join(root, 'product.toml')).matchAll(/^(?!name\b|vendor\b)(\w+)\s*=\s*"([^"]+)"/gm)]
  .map((match) => match[2])
  .filter((value) => value.length >= 6);
for (const file of allFiles) {
  const path = rel(file);
  if (!TEXT.test(path) || path === 'Cargo.lock' || path === 'package-lock.json') continue;
  const text = read(file);
  if (!EARLIER_ALLOWED.some((prefix) => path.startsWith(prefix))) {
    for (const pattern of EARLIER) {
      if (pattern.test(text)) fail('names', `${path} names an earlier product: only docs/ and legacy-import/ may`);
    }
  }
  // testing/corpus and testing/fixtures hold stored formulas and documents, which carry the identifiers by nature.
  const IDENTIFIERS_ALLOWED = ['docs/', 'testing/corpus/', 'testing/fixtures/'];
  if (path !== 'product.toml' && path !== 'README.md' && path !== 'app/tauri.conf.json' && !IDENTIFIERS_ALLOWED.some((prefix) => path.startsWith(prefix))) {
    for (const value of productValues) {
      if (text.includes(value)) fail('names', `${path} spells out "${value}": read it from core/protocol (product.toml)`);
    }
  }
}

// ---- Rule 5b: Tauri's config must repeat product.toml exactly (Tauri cannot read product.toml). ----
{
  const product = Object.fromEntries([...read(join(root, 'product.toml')).matchAll(/^(\w+)\s*=\s*"([^"]+)"/gm)].map((m) => [m[1], m[2]]));
  const tauri = JSON.parse(read(join(root, 'app', 'tauri.conf.json')));
  if (tauri.identifier !== product.identifier) fail('names', `app/tauri.conf.json identifier "${tauri.identifier}" differs from product.toml "${product.identifier}"`);
  if (tauri.productName !== product.name) fail('names', `app/tauri.conf.json productName "${tauri.productName}" differs from product.toml "${product.name}"`);
}

// ---- Rule 6: no Python in the product. ---------------------------------------
// ---- Rule 7: a large file is a decision, not an accident. ---------------------
// Over MAX_LINES a source file is split along a real seam, or named here with the reason it stays whole.
const MAX_LINES = 1000;
const LARGE_FILES = {
  'ui/kernel/src/kernel/core/parser.ts': 'the LaTeX parser taken over from MathLive, kept in its shape',
  'ui/kernel/src/kernel/latex-commands/mhchem.ts': "mhchem as MathJax and KaTeX wrote it (third-party code)",
  'ui/kernel/src/kernel/latex-commands/styling.ts': 'MathLive\'s styling commands, kept in their shape',
  'ui/kernel/src/kernel/formats/atom-to-math-ml.ts': 'MathLive\'s MathML conversion, kept in its shape',
  'ui/kernel/src/kernel/public/mathfield-element.ts': 'MathLive\'s editor element; no editor tests yet',
  'ui/kernel/src/kernel/editor-mathfield/mathfield-private.ts': 'MathLive\'s editor internals; no editor tests yet',
  'ui/kernel/src/kernel/editor-mathfield/keyboard-input.ts': 'MathLive\'s keyboard input; no editor tests yet',
  'ui/kernel/src/kernel/editor-model/delete.ts': 'MathLive\'s deletion; no editor tests yet',
  'ui/kernel/src/kernel/editor-model/array.ts': 'MathLive\'s array editing; no editor tests yet',
  // The Word equation converters are byte-exact ports of a C# converter, one file per C# class or reader, kept in
  // that shape so a fix in the reference maps onto one place.
  'core/convert/src/omml/write/proj/projection.rs': 'port of the MathML -> OMML projection class, kept in its shape',
  'core/convert/src/omml/write/proj/converter.rs': 'port of the OMML passes after the projection, kept in its shape',
  'core/convert/src/omml/write/prep/xlinq.rs': 'the System.Xml.Linq reader and writer the MathML passes rely on, kept in its shape',
  'core/convert/src/omml/write/prep/prepasses.rs': 'port of the MathML passes before the projection, kept in their shape',
  'core/convert/src/omml/read/omml_mathml/projection.rs': 'port of the OMML -> MathML projection class, kept in its shape',
  'core/convert/src/omml/read/omml_mathml/transform.rs': 'port of the OMML -> MathML recovery passes, kept in their shape',
  'core/convert/src/omml/read/mathml_latex/converter.rs': 'port of the MathML -> LaTeX converter class, kept in its shape',
  'core/convert/src/omml/read/mathml_latex/unit_tests.rs': 'the C# converter\'s unit tests, ported one to one',
  'core/convert/src/omml/dotnet/unicode_tables.rs': 'generated Unicode 15.0 data tables',
};
const PRODUCT_DIRS = ['core/', 'app/', 'ui/', 'hosts/', 'legacy-import/'];
for (const file of allFiles) {
  const path = rel(file);
  if (!PRODUCT_DIRS.some((prefix) => path.startsWith(prefix))) continue;
  if (path.endsWith('.py')) fail('language', `${path}: the product ships no Python`);
  if (SOURCE.test(path)) {
    const lines = read(file).split('\n').length;
    if (lines > MAX_LINES && !(path in LARGE_FILES)) {
      fail('size', `${path} has ${lines} lines: split it along a real seam, or name it in LARGE_FILES with a reason`);
    }
    if (lines <= MAX_LINES && path in LARGE_FILES) {
      fail('size', `${path} has ${lines} lines: remove it from LARGE_FILES`);
    }
  }
}
for (const path of Object.keys(LARGE_FILES)) {
  if (!existsSync(join(root, path))) fail('size', `LARGE_FILES names ${path}, which does not exist`);
}

// ---- Rule 8: every part says what it owns. -----------------------------------
for (const crate of dirs(join(root, 'core'))) {
  const lib = join(root, 'core', crate, 'src', 'lib.rs');
  if (!existsSync(lib) || !read(lib).startsWith('//!')) {
    fail('ownership', `core/${crate}/src/lib.rs must start with a //! statement of what it owns`);
  }
}
for (const file of allFiles) {
  const path = rel(file);
  if (path.startsWith('app/src/') && path.endsWith('.rs') && !read(file).startsWith('//!')) {
    fail('ownership', `${path} must start with a //! statement of what it owns`);
  }
}
for (const parent of ['ui', 'hosts/windows', 'hosts/macos', 'resources', 'installer', 'testing']) {
  for (const name of dirs(join(root, parent))) {
    const readme = join(root, parent, name, 'README.md');
    if (!existsSync(readme)) {
      if (parent === 'hosts/macos' || parent === 'hosts/windows' || parent === 'ui') {
        fail('ownership', `${parent}/${name} has no README.md`);
      }
      continue;
    }
    const text = read(readme);
    if (!text.includes('**Owns**') || !text.includes('**Limits**')) {
      fail('ownership', `${parent}/${name}/README.md must state **Owns** and **Limits**`);
    }
  }
}

// ---- Rule 9: the windows' CSS is layered and owned by one component each. ------
// ui/editor/src/styles/tokens.css defines every custom property (@layer tokens); styles/base.css styles elements
// only (@layer base); every other stylesheet is a *.module.css beside the one component that imports it, inside
// @layer components. A component sets only its own --local-* properties inline. Nothing overrides by force.
const STYLE_ROOTS = ['ui/editor/src/', 'ui/app-ui/src/'];
const TOKENS = 'ui/editor/src/styles/tokens.css';
const BASE = 'ui/editor/src/styles/base.css';
const styleFiles = allFiles.map(rel).filter((path) => STYLE_ROOTS.some((r) => path.startsWith(r)));
const cssImports = new Map();
for (const path of styleFiles.filter((p) => /\.(ts|tsx)$/.test(p))) {
  const text = read(join(root, path));
  for (const [, spec] of text.matchAll(/import\s+(?:\w+\s+from\s+)?["']([^"']+\.css)["']/g)) {
    const target = rel(join(root, path, '..', spec));
    cssImports.set(target, [...(cssImports.get(target) ?? []), path]);
  }
  for (const [, name] of text.matchAll(/["'`](--[\w-]+)["'`]\s*[:,]/g)) {
    if (!name.startsWith('--local-')) fail('styles', `${path} sets ${name}: a component sets only --local-* properties`);
  }
}
const withoutComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
for (const path of styleFiles.filter((p) => p.endsWith('.css'))) {
  const css = withoutComments(read(join(root, path)));
  if (css.includes('!important')) fail('styles', `${path} uses !important`);
  if (css.includes(':global')) fail('styles', `${path} uses :global`);
  if (path !== TOKENS) {
    for (const [, name] of css.matchAll(/[{;\s](--[\w-]+)\s*:/g)) {
      if (!name.startsWith('--local-')) fail('styles', `${path} defines ${name}: custom properties live in ${TOKENS}`);
    }
  }
  if (path === TOKENS || path === BASE) {
    const layer = path === TOKENS ? 'tokens' : 'base';
    if (!new RegExp(`@layer ${layer}\\s*\\{`).test(css)) fail('styles', `${path} must be inside @layer ${layer}`);
    if (path === BASE && /[.#][A-Za-z_]|\[/.test(css.replace(/@layer[^{;]*[{;]/g, '').replace(/\{[^{}]*\}/g, '{}'))) {
      fail('styles', `${BASE} styles elements only (no class, id or attribute selectors)`);
    }
    continue;
  }
  if (!path.endsWith('.module.css')) {
    fail('styles', `${path}: a component's stylesheet is a *.module.css beside it`);
    continue;
  }
  if (!/^\s*@layer components\s*\{[\s\S]*\}\s*$/.test(css)) fail('styles', `${path} must hold one @layer components block`);
  const importers = cssImports.get(path) ?? [];
  if (importers.length !== 1) {
    fail('styles', `${path} is imported by ${importers.length} files: a module belongs to exactly one component`);
  } else if (importers[0].split('/').slice(0, -1).join('/') !== path.split('/').slice(0, -1).join('/')) {
    fail('styles', `${path} is imported from ${importers[0]}: a module sits beside its component`);
  }
}
for (const [target, importers] of cssImports) {
  if ((target === TOKENS || target === BASE) && !importers.every((p) => p === 'ui/editor/src/index.ts')) {
    fail('styles', `${target} is imported by ${importers.join(', ')}: only ui/editor/src/index.ts loads it`);
  }
}

if (problems.length) {
  console.error(problems.join('\n'));
  console.error(`\n${problems.length} structure problem(s).`);
  process.exit(1);
}
console.log('structure: ok');
