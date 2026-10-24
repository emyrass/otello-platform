import { build } from "esbuild";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const stubs = [
  "register.js",
  "login.js",
  "logout.js",
  "session.js",
  "workspace.js",
  "rpc.js",
  "agents.js",
  "agents/[id]/status.js",
  "providers.js",
  "providers/[id]/status.js",
  "resources.js",
  "resources/[id].js",
  "leases.js",
  "leases/[id]/approve.js",
  "leases/[id]/reject.js",
  "leases/[id]/revoke.js",
  "leases/[id]/verify.js",
  "leases/[id]/credential.js",
  "examples/open.js",
  "examples/reset.js",
];

await mkdir("api", { recursive: true });

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

// The previous function path is still opened literally during the Vercel build.
await copyFile("api/index.js", "api/[...path].js");

for (const stub of stubs) {
  const file = path.join("api", stub);
  await mkdir(path.dirname(file), { recursive: true });
  const depth = stub.split("/").length - 1;
  const target = `${"../".repeat(depth)}index.js`;
  await writeFile(file, `export { default, config } from "./${target}";\n`);
}
