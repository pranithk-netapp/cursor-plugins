// esbuild bundling script for the open-api-viewer extension host and its
// webview browser bundles.
//
// Usage:
//   node esbuild.mjs                 build once (dev)
//   node esbuild.mjs --watch         rebuild on change
//   node esbuild.mjs --production    minified, no sourcemap (for packaging)

import * as esbuild from "esbuild";
import { glob } from "glob";
import * as fs from "node:fs";
import * as path from "node:path";

const watch = process.argv.includes("--watch");
const production = process.argv.includes("--production");

/** @type {esbuild.BuildOptions} */
const extensionConfig = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "dist/extension.js",
  format: "cjs",
  platform: "node",
  target: "node20",
  external: ["vscode"],
  sourcemap: !production,
  minify: production,
  logLevel: "info",
  // Prefer ESM entry points (e.g. jsonc-parser's "module" field) over CJS
  // "main" ones. jsonc-parser's CJS/UMD build (lib/umd/main.js) does its
  // submodule requires as `factory(require, exports)` -> `require2("./impl/format")`
  // using a *parameter* named `require` passed in from the outer scope,
  // which esbuild cannot statically rewrite into a bundled reference (it
  // only rewrites literal `require(...)` calls it recognizes as the real
  // module-level `require`). Left alone, that produces a real runtime
  // `require("./impl/format")` call resolved relative to dist/extension.js
  // instead of node_modules/jsonc-parser/lib/umd/, which throws
  // "Cannot find module './impl/format'" the moment the extension host
  // activates and jsonc-parser's module body runs. The ESM build
  // (lib/esm/main.js) uses static `import` statements instead, which
  // esbuild bundles correctly.
  mainFields: ["module", "main"]
};

/**
 * Copy the static swagger-ui-dist assets the Preview webview loads offline
 * into media/swagger-ui/. swagger-ui-dist is a devDependency used ONLY as a
 * source of these static files at build time — it must never be imported or
 * bundled into the extension host or webview JS.
 */
function copySwaggerUiAssets() {
  const srcDir = "node_modules/swagger-ui-dist";
  const destDir = "media/swagger-ui";
  fs.mkdirSync(destDir, { recursive: true });

  const assets = ["swagger-ui-bundle.js", "swagger-ui.css", "LICENSE"];
  for (const asset of assets) {
    const from = path.join(srcDir, asset);
    if (!fs.existsSync(from)) {
      console.warn(`[esbuild] swagger-ui-dist asset not found, skipping: ${asset}`);
      continue;
    }
    fs.copyFileSync(from, path.join(destDir, asset));
  }
}

/**
 * Glob src/webview/{name}/main.ts for webview browser-script entry points.
 * Guarded with try/catch so a from-scratch checkout (before any such file
 * exists) doesn't crash the build — it just skips the webview bundle step.
 */
async function getWebviewEntryPoints() {
  try {
    return await glob("src/webview/*/main.ts");
  } catch {
    return [];
  }
}

/**
 * Bundle each src/webview/<name>/main.ts as a standalone IIFE browser script
 * at media/dist/<name>.js. Webview code never imports "vscode" (it talks to
 * the extension host via the global acquireVsCodeApi()), so — unlike the
 * extension host bundle — there is no `external: ["vscode"]` here.
 */
async function buildWebviews(entryPoints) {
  if (entryPoints.length === 0) {
    console.log("[esbuild] no webview entry points found (src/webview/*/main.ts), skipping webview bundle");
    return;
  }

  /** @type {esbuild.BuildOptions} */
  const webviewConfig = {
    entryPoints,
    bundle: true,
    outdir: "media/dist",
    // outbase + entryNames "[dir]" flattens src/webview/<name>/main.ts to
    // media/dist/<name>.js (one file per webview subfolder).
    outbase: "src/webview",
    entryNames: "[dir]",
    format: "iife",
    platform: "browser",
    target: "es2020",
    sourcemap: !production,
    minify: production,
    logLevel: "info"
  };

  if (watch) {
    const ctx = await esbuild.context(webviewConfig);
    await ctx.watch();
  } else {
    await esbuild.build(webviewConfig);
  }
}

async function main() {
  copySwaggerUiAssets();
  const webviewEntryPoints = await getWebviewEntryPoints();

  if (watch) {
    const ctx = await esbuild.context(extensionConfig);
    await ctx.watch();
    await buildWebviews(webviewEntryPoints);
    console.log("[esbuild] watching for changes...");
  } else {
    await esbuild.build(extensionConfig);
    await buildWebviews(webviewEntryPoints);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
