// Builds the kernel's drawing path for Node (the tests here): kernel-node-entry.ts bundled by Vite into
// node_modules/.cache/kernel-node/kernel.mjs. The kernel's own sources run in the app's web view; Node needs a build
// because the kernel imports without file extensions and imports types like values, as bundlers allow.
import { build } from "vite";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const outDir = `${root}node_modules/.cache/kernel-node`;
/** The built kernel, as a module URL; `npm run test:ui` builds it before the tests run. */
export const kernelNodeUrl = pathToFileURL(`${outDir}/kernel.mjs`).href;

async function buildKernelForNode() {
  await build({
    configFile: false,
    root,
    logLevel: "warn",
    esbuild: { tsconfigRaw: { compilerOptions: { useDefineForClassFields: false } } },
    build: {
      ssr: fileURLToPath(new URL("kernel-node-entry.ts", import.meta.url)),
      outDir,
      emptyOutDir: true,
      target: "node22",
      minify: false,
      rollupOptions: { output: { format: "es", entryFileNames: "kernel.mjs" } },
    },
    ssr: { noExternal: true },
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await buildKernelForNode();
