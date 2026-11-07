import { build } from "esbuild";
import { cp, mkdir } from "node:fs/promises";

await mkdir("dist", { recursive: true });
await build({
  entryPoints: ["src/index.js"],
  outfile: "dist/plugin.js",
  bundle: true,
  format: "esm",
  minify: true,
  target: "es2022",
  legalComments: "none",
});
await cp("manifest.json", "dist/manifest.json");
await cp("README.md", "dist/README.md");

await cp("THIRD-PARTY-NOTICES.md", "dist/THIRD-PARTY-NOTICES.md");
