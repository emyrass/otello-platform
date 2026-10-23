import { build } from "esbuild";
import { mkdir } from "node:fs/promises";

await mkdir("api", { recursive: true });

await build({
  entryPoints: ["server/vercel.ts"],
  outfile: "api/[...path].js",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  packages: "external",
  legalComments: "none",
});
