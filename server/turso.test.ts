import { describe, expect, it } from "vitest";
import { tursoExecute, tursoPipelineUrl } from "./turso.ts";

describe("turso http", () => {
  it("turns a libsql URL into the hrana pipeline endpoint", () => {
    expect(tursoPipelineUrl("libsql://ledger-org.turso.io")).toBe("https://ledger-org.turso.io/v2/pipeline");
    expect(tursoPipelineUrl('"https://ledger-org.turso.io"')).toBe("https://ledger-org.turso.io/v2/pipeline");
  });

  it("posts the statement over HTTP and reads the row", async () => {
    const result = await tursoExecute(
      { url: "libsql://ledger-org.turso.io", authToken: "secret-token" },
      "SELECT document, updated_at FROM ledgers WHERE scope = ?",
      ["live"],
      true,
      async (url, init) => {
        expect(url).toBe("https://ledger-org.turso.io/v2/pipeline");
        expect(init.duplex).toBe("half");
        expect(new Headers(init.headers).get("authorization")).toBe("Bearer secret-token");
        const body = JSON.parse(String(init.body)) as {
          requests: Array<{ type: string; stmt?: { sql: string; args: Array<{ type: string; value?: string }>; want_rows: boolean } }>;
        };
        expect(body.requests[0]?.stmt?.args[0]).toEqual({ type: "text", value: "live" });
        expect(body.requests[1]?.type).toBe("close");
        return new Response(
          JSON.stringify({
            results: [
              {
                type: "ok",
                response: {
                  type: "execute",
                  result: {
                    cols: [{ name: "document" }, { name: "updated_at" }],
                    rows: [[{ type: "text", value: "{\"agents\":[]}" }, { type: "integer", value: "10" }]],
                    affected_row_count: 0,
                  },
                },
              },
              { type: "ok", response: { type: "close" } },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    );
    expect(result.row).toEqual({ document: "{\"agents\":[]}", updated_at: 10 });
  });

  it("includes the HTTP status and server message", async () => {
    await expect(
      tursoExecute({ url: "https://ledger-org.turso.io", authToken: "secret-token" }, "SELECT 1", [], false, async () => {
        return new Response(JSON.stringify({ message: "unauthorized: invalid jwt" }), {
          status: 401,
          headers: { "content-type": "application/json" },
        });
      }),
    ).rejects.toThrow("HTTP 401: unauthorized: invalid jwt");
  });

  it("reports a statement error from the pipeline", async () => {
    await expect(
      tursoExecute({ url: "https://ledger-org.turso.io", authToken: "secret-token" }, "SELECT missing", [], true, async () => {
        return new Response(
          JSON.stringify({
            results: [{ type: "error", error: { message: "no such table: ledgers", code: "SQLITE_ERROR" } }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }),
    ).rejects.toThrow("no such table: ledgers [SQLITE_ERROR]");
  });
});
