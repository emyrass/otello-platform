import { describe, expect, it } from "vitest";
import handler, { resolveApiUrl } from "./vercel.ts";

describe("vercel api routing", () => {
  it("keeps a full api path and rebuilds one collapsed by the rewrite", () => {
    expect(resolveApiUrl("/api/workspace?scope=live")).toBe("/api/workspace?scope=live");
    expect(resolveApiUrl("/api?path=workspace&scope=examples")).toBe("/api/workspace?scope=examples");
    expect(resolveApiUrl("/api/index?path=leases/lse_1/approve")).toBe("/api/leases/lse_1/approve");
    expect(resolveApiUrl("/api", { "x-forwarded-uri": "/api/session" })).toBe("/api/session");
    expect(resolveApiUrl("/api?scope=live", {}, { path: ["leases", "lse_1", "approve"] })).toBe("/api/leases/lse_1/approve?scope=live");
    expect(resolveApiUrl("/api?path=../secret")).toBe("/api?path=../secret");
  });

  it("routes a rewritten workspace request to the ledger handler", async () => {
    let body = "";
    let status = 0;
    const req = { url: "/api?path=workspace&scope=live", method: "GET", headers: {} };
    const res = {
      headersSent: false,
      statusCode: 0,
      setHeader() {},
      end(payload: string) {
        body = payload;
        status = this.statusCode;
      },
    };
    await handler({ ...req, query: { path: "workspace", scope: "live" } } as never, res as never);
    expect(status).toBe(401);
    expect(JSON.parse(body).errors).toEqual(["Sign in to continue."]);
  });
});
