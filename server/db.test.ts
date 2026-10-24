import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const directory = mkdtempSync(path.join(tmpdir(), "otello-ledger-"));
process.env.OTELLO_SQLITE_PATH = path.join(directory, "otello.sqlite");
delete process.env.TURSO_DATABASE_URL;
delete process.env.TURSO_AUTH_TOKEN;
delete process.env.POSTGRES_URL;
delete process.env.DATABASE_URL;
delete process.env.POSTGRES_PRISMA_URL;
delete process.env.VERCEL;

afterAll(() => {
  rmSync(directory, { recursive: true, force: true });
});

describe("ledger database", () => {
  it("keeps accounts and ledger rows in sqlite", async () => {
    const { createAccount, findAccountByName, openSession, accountForToken } = await import("./auth.ts");
    const { loadLedger, readLedger, writeLedger } = await import("./db.ts");
    const { emptyState } = await import("../src/lib/engine.ts");

    const account = await createAccount("north-desk", "ledger-pass");
    const found = await findAccountByName("north-desk");
    expect(found?.id).toBe(account.id);
    const token = await openSession(account.id);
    expect((await accountForToken(token))?.name).toBe("north-desk");

    const now = Date.UTC(2026, 9, 23);
    const created = await loadLedger("live", now);
    expect(created.origin).toBe("record");
    expect(created.resources.some((resource) => resource.id === "sample_res_northline_eth")).toBe(true);
    expect(created.keystore.sample_prv_northline).toBeTruthy();
    const stored = emptyState(now);
    stored.agents.push({
      id: "agt_test",
      ownerId: account.id,
      name: "Test",
      mandate: "Read the head.",
      status: "active",
      createdAt: now,
    });
    await writeLedger("live", stored);
    const read = await readLedger("live");
    expect(read?.agents.map((agent) => agent.id)).toEqual(["agt_test"]);
  });

  it("refuses Vercel when no hosted database is configured", async () => {
    const previous = process.env.OTELLO_SQLITE_PATH;
    delete process.env.OTELLO_SQLITE_PATH;
    process.env.VERCEL = "1";
    const { readLedger, DatabaseConfigError } = await import("./db.ts");
    await expect(readLedger("live")).rejects.toBeInstanceOf(DatabaseConfigError);
    process.env.OTELLO_SQLITE_PATH = previous;
    delete process.env.VERCEL;
  });
});
