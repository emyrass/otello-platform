import { build } from "esbuild";
import { readdir, rm } from "node:fs/promises";
import path from "node:path";

const entry = path.resolve("api/index.js");

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

// One file under api/ is one Vercel function. The Hobby plan allows 12.
for (const entryName of await readdir("api", { withFileTypes: true })) {
  const full = path.resolve("api", entryName.name);
  if (full === entry) continue;
  await rm(full, { recursive: true, force: true });
}
