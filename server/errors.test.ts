import { describe, expect, it } from "vitest";
import { connectionError, publicErrorMessage, redact } from "./errors.ts";

describe("ledger errors", () => {
  it("keeps the connection detail and hides secrets", () => {
    const cause = new Error("fetch failed", { cause: new Error("connect ECONNREFUSED 127.0.0.1:443") });
    const error = connectionError("turso", "ledger-org.turso.io", cause, "SELECT document FROM ledgers WHERE scope = ?");
    const message = publicErrorMessage(error);
    expect(message).toContain("turso (ledger-org.turso.io)");
    expect(message).toContain("SELECT document FROM ledgers");
    expect(message).toContain("fetch failed");
    expect(message).toContain("ECONNREFUSED");
    expect(redact("postgres://otello:secret@db.example/otello eyJhbGciOiJIUzI1NiJ9.bbb.ccc")).toBe("postgres://db.example [redacted]");
    expect(message).not.toContain("secret");
  });
});
