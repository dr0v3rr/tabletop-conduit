// Bundle the Electron main, preload, and sheet renderer with esbuild.
import { build } from "esbuild";
import { existsSync, copyFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = resolve(root, "dist-electron");
mkdirSync(out, { recursive: true });

// Resolve TS-ESM ".js" import specifiers to their ".ts" source files.
const tsResolve = {
  name: "ts-resolve",
  setup(b) {
    b.onResolve({ filter: /\.js$/ }, (args) => {
      if (args.kind === "entry-point" || !args.path.startsWith(".")) return;
      const tsPath = resolve(args.resolveDir, args.path.replace(/\.js$/, ".ts"));
      if (existsSync(tsPath)) return { path: tsPath };
      return;
    });
  },
};

const common = { bundle: true, sourcemap: true, logLevel: "info", plugins: [tsResolve] };

await build({
  ...common,
  entryPoints: [resolve(root, "electron/main.ts")],
  outfile: resolve(out, "main.js"),
  platform: "node",
  format: "esm",
  external: ["electron"],
  // The ESM bundle pulls in CommonJS deps (electron-updater → fs-extra) that call require("fs").
  // ESM has no require, so give the bundle a real one built from the module URL.
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
});

await build({
  ...common,
  entryPoints: [resolve(root, "electron/preload.ts")],
  outfile: resolve(out, "preload.cjs"),
  platform: "node",
  format: "cjs",
  external: ["electron"],
});

await build({
  ...common,
  entryPoints: [resolve(root, "electron/oauth-preload.ts")],
  outfile: resolve(out, "oauth-preload.cjs"),
  platform: "browser",
  format: "cjs",
});

await build({
  ...common,
  entryPoints: [resolve(root, "electron/sheet.ts")],
  outfile: resolve(out, "sheet.js"),
  platform: "browser",
  format: "iife",
});

await build({
  ...common,
  entryPoints: [resolve(root, "electron/splash.ts")],
  outfile: resolve(out, "splash.js"),
  platform: "browser",
  format: "iife",
});

for (const f of ["sheet.html", "sheet.css", "splash.html", "splash.css"]) {
  copyFileSync(resolve(root, "electron", f), resolve(out, f));
}
console.log("electron bundles written to dist-electron/");
