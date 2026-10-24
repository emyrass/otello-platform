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

  it("does not let a stale ledger write overwrite a committed approval", async () => {
    const { readLedger, readLedgerRecord, writeLedger } = await import("./db.ts");
    const { emptyState } = await import("../src/lib/engine.ts");
    const now = Date.UTC(2026, 9, 24);
    const original = emptyState(now);
    await writeLedger("live", original);
    const current = await readLedgerRecord("live");
    expect(current?.updatedAt).toEqual(expect.any(Number));
    const newer = emptyState(now + 1);
    newer.agents.push({
      id: "agt_saved",
      ownerId: "acct_test",
      name: "Saved",
      mandate: "Stay approved.",
      status: "active",
      createdAt: now,
    });
    await writeLedger("live", newer, current!.updatedAt);
    const stale = emptyState(now);
    const overwritten = await writeLedger("live", stale, current!.updatedAt);
    expect(overwritten).toBe(false);
    const saved = await readLedger("live");
    expect(saved?.agents.map((agent) => agent.id)).toEqual(["agt_saved"]);
  });

  it("selects Turso or Postgres on Vercel and does not open a local file", async () => {
    const keys = ["OTELLO_SQLITE_PATH", "VERCEL", "TURSO_DATABASE_URL", "TURSO_AUTH_TOKEN", "POSTGRES_URL", "POSTGRES_URL_NON_POOLING", "DATABASE_URL", "DATABASE_URL_UNPOOLED", "POSTGRES_PRISMA_URL"] as const;
    const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
    try {
      for (const key of keys) delete process.env[key];
      process.env.VERCEL = "1";
      process.env.TURSO_DATABASE_URL = "libsql://example.turso.io";
      process.env.TURSO_AUTH_TOKEN = "token";
      const { databaseKind, DatabaseConfigError } = await import("./db.ts");
      expect(databaseKind()).toBe("turso");
      process.env.POSTGRES_URL_NON_POOLING = "postgres://direct.example/otello";
      expect(databaseKind()).toBe("postgres");
      delete process.env.POSTGRES_URL_NON_POOLING;
      delete process.env.TURSO_DATABASE_URL;
      delete process.env.TURSO_AUTH_TOKEN;
      expect(() => databaseKind()).toThrow(DatabaseConfigError);
    } finally {
      for (const key of keys) {
        const value = previous[key];
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
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
