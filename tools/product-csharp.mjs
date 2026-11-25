// Writes the product.toml values a C# project needs as constants, so they are written in product.toml only.
// Run by hosts/windows/Directory.Build.targets before compiling; the file goes to the project's obj folder.
// Usage: node tools/product-csharp.mjs <output .cs> <product.toml key>...
// Besides the named keys it always writes Version: the release number of the Cargo workspace.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const [output, ...keys] = process.argv.slice(2);
if (!output || keys.length === 0) {
  console.error('usage: node tools/product-csharp.mjs <output .cs> <product.toml key>...');
  process.exit(2);
}

const product = Object.fromEntries(
  [...readFileSync(join(root, 'product.toml'), 'utf8').matchAll(/^(\w+)\s*=\s*"([^"]*)"/gm)].map((m) => [m[1], m[2]]),
);
const cargo = readFileSync(join(root, 'Cargo.toml'), 'utf8');
const version = cargo.split(/^\[/m).find((section) => section.startsWith('workspace.package]'))?.match(/^version\s*=\s*"([^"]+)"/m);
if (!version) {
  console.error('Cargo.toml: [workspace.package] has no version');
  process.exit(1);
}

const pascal = (key) => key.split('_').map((word) => word[0].toUpperCase() + word.slice(1)).join('');
const constants = keys.map((key) => {
  if (!(key in product)) {
    console.error(`product.toml: no string value "${key}"`);
    process.exit(1);
  }
  return `        public const string ${pascal(key)} = ${JSON.stringify(product[key])};`;
});
constants.push(`        public const string Version = ${JSON.stringify(version[1])};`);

mkdirSync(dirname(output), { recursive: true });
writeFileSync(
  output,
  [
    '// Generated from product.toml and Cargo.toml by tools/product-csharp.mjs. Do not edit.',
    'namespace TexType',
    '{',
    '    internal static class Product',
    '    {',
    ...constants,
    '    }',
    '}',
    '',
  ].join('\n'),
);
