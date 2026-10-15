// Bundles the Electron main process, preload bridge and UI with esbuild.
//   node build.mjs            -> dist/ (what the app runs)
//   node build.mjs --preview  -> dist-preview/ (UI with a mock backend, for a browser)
import * as esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const preview = process.argv.includes("--preview");
const out = path.join(here, preview ? "dist-preview" : "dist");
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, "renderer"), { recursive: true });

const common = { bundle: true, sourcemap: true, logLevel: "warning", legalComments: "none" };

if (!preview) {
  await esbuild.build({
    ...common,
    entryPoints: [path.join(here, "src/main.ts")],
    outfile: path.join(out, "main.mjs"),
    platform: "node",
    format: "esm",
    target: "node22",
    // playwright-core loads its own files at runtime, so it ships as a package, not bundled.
    external: ["electron", "playwright-core", "pdfjs-dist", "mammoth"],
    // Some bundled dependencies are CommonJS and call require().
    banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  });
  await esbuild.build({
    ...common,
    entryPoints: [path.join(here, "src/preload.ts")],
    outfile: path.join(out, "preload.cjs"),
    platform: "node",
    format: "cjs",
    target: "node22",
    external: ["electron"],
  });
}

await esbuild.build({
  ...common,
  entryPoints: [path.join(here, preview ? "src/renderer/preview-entry.ts" : "src/renderer/app.ts")],
  outfile: path.join(out, "renderer", "app.js"),
  platform: "browser",
  format: "iife",
  target: "chrome120",
});
if (!preview) {
  // Built-in skills ship next to main.mjs (src/skills.ts looks there).
  fs.cpSync(path.join(here, "..", "skills"), path.join(out, "skills"), { recursive: true });
}
for (const f of ["index.html", "styles.css"]) {
  fs.copyFileSync(path.join(here, "src/renderer", f), path.join(out, "renderer", f));
}
console.log(`built ${path.relative(here, out)}/`);
