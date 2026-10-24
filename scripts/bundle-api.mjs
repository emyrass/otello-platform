import { build } from "esbuild";
import { mkdir, rm } from "node:fs/promises";

await mkdir("api", { recursive: true });
await rm("api/[...path].js", { force: true });

await build({
  entryPoints: ["server/vercel.ts"],
  outfile: "api/index.js",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  packages: "external",
  legalComments: "none",
});
