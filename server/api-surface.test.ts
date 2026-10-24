import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("vercel function budget", () => {
  it("deploys one node function and keeps the route files the builder opens", () => {
    const config = JSON.parse(readFileSync("vercel.json", "utf8")) as {
      functions?: unknown;
      builds?: Array<{ src: string; use: string }>;
    };
    const nodeBuilds = (config.builds ?? []).filter((build) => build.use === "@vercel/node");
    expect(config.functions).toBeUndefined();
    expect(nodeBuilds).toEqual([{ src: "api/index.js", use: "@vercel/node" }]);
    expect(existsSync("api/index.js")).toBe(true);
    expect(existsSync("api/agents/[id]/status.js")).toBe(true);
    expect(existsSync("api/leases/[id]/approve.js")).toBe(true);
    expect(existsSync("api/session.js")).toBe(true);
  });
});
