import { build } from "esbuild";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const stubs = [
  "[...path].js",
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

const outfile = path.resolve("api/index.js");
const temporary = path.resolve("api/.index.build.js");

await build({
  entryPoints: ["server/vercel.ts"],
  outfile: temporary,
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  packages: "external",
  legalComments: "none",
});
await rename(temporary, outfile);

for (const stub of stubs) {
  const file = path.join("api", stub);
  await mkdir(path.dirname(file), { recursive: true });
  const depth = stub.split("/").length - 1;
  const relative = `${"../".repeat(depth)}index.js`;
  const specifier = relative.startsWith(".") ? relative : `./${relative}`;
  await writeFile(file, `export { default, config } from "${specifier}";\n`);
}
