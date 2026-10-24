import { describe, expect, it } from "vitest";
import { connectionError } from "./errors.ts";
import { sendFailure } from "./fail.ts";

describe("api failures", () => {
  it("returns the ledger connection error in the response body", () => {
    let body = "";
    const res = {
      headersSent: false,
      statusCode: 0,
      setHeader() {},
      end(payload: string) {
        body = payload;
      },
    };
    sendFailure(res as never, connectionError("turso", "ledger-org.turso.io", new Error("HTTP 401: unauthorized")));
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(body).errors[0]).toContain("turso (ledger-org.turso.io)");
    expect(JSON.parse(body).errors[0]).toContain("HTTP 401: unauthorized");
  });
});
