import { build } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const dist = resolve(root, "dist");
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

const common = {
  bundle: true,
  platform: "browser",
  target: ["chrome116"],
  sourcemap: false,
  minify: true,
  legalComments: "none",
};

await build({ ...common, entryPoints: ["src/sw/background.ts"], outfile: "dist/sw/background.js", format: "esm" });
await mkdir("dist/content", { recursive: true });
await build({ ...common, entryPoints: ["src/content/index.ts"], outfile: "dist/content/index.js", format: "iife" });
await build({ ...common, entryPoints: ["src/popup/popup.tsx"], outfile: "dist/popup/popup.js", format: "iife", loader: { ".tsx": "tsx" }, jsx: "automatic" });
await cp("manifest.json", "dist/manifest.json");
await cp("src/content/content.css", "dist/content/content.css");
await cp("src/popup/popup.html", "dist/popup/popup.html");
await cp("src/popup/popup.css", "dist/popup/popup.css");
await cp("icons", "dist/icons", { recursive: true });
console.log("Built PolliStretch at dist/");
