import { webcrypto } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import postgres, { type Sql } from "postgres";
import { emptyState, reconcile } from "../src/lib/engine.ts";
import { ensureSampleMarket } from "../src/lib/marketSamples.ts";
import type { AppState } from "../src/lib/types.ts";
import { connectionError, DatabaseConfigError } from "./errors.ts";
import { tursoExecute, tursoHost, type Row as TursoRow } from "./turso.ts";

export { DatabaseConfigError };

if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });
}

export type Scope = "live" | "examples";

type SqlValue = string | number | null;
type Row = TursoRow;

interface Executor {
  get(statement: string, params: SqlValue[]): Promise<Row | undefined>;
  run(statement: string, params: SqlValue[]): Promise<void>;
  changes(statement: string, params: SqlValue[]): Promise<number>;
}

type Kind = "sqlite" | "postgres" | "turso";

let sqliteExecutor: Executor | undefined;
let postgresClient: Sql | undefined;
let schemaReady: Promise<void> | undefined;

export function databaseKind(): Kind {
  if (process.env.OTELLO_SQLITE_PATH && !hosted()) return "sqlite";
  if (tursoConfig()) return "turso";
  if (postgresUrl()) return "postgres";
  if (hosted()) throw new DatabaseConfigError();
  return "sqlite";
}

function hosted(): boolean {
  return Boolean(process.env.VERCEL || process.env.VERCEL_ENV || process.env.AWS_LAMBDA_FUNCTION_NAME);
}

function envValue(name: string): string | undefined {
  let value = process.env[name]?.trim();
  if (!value) return undefined;
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1).trim();
  }
  return value ? value : undefined;
}

function postgresUrl(): string | undefined {
  return (
    envValue("POSTGRES_URL_NON_POOLING") ||
    envValue("DATABASE_URL_UNPOOLED") ||
    envValue("POSTGRES_URL") ||
    envValue("DATABASE_URL") ||
    envValue("POSTGRES_PRISMA_URL")
  );
}

function tursoConfig(): { url: string; authToken: string; host: string } | undefined {
  const url = envValue("TURSO_DATABASE_URL");
  const authToken = envValue("TURSO_AUTH_TOKEN")?.replace(/^Bearer\s+/i, "");
  if (!url || !authToken) return undefined;
  return { url, authToken, host: tursoHost(url) };
}

export function configuredTursoHost(): string | undefined {
  return tursoConfig()?.host;
}

function toDollar(statement: string): string {
  let index = 0;
  return statement.replace(/\?/g, () => `$${++index}`);
}

function sqlitePath(): string {
  return process.env.OTELLO_SQLITE_PATH || path.join(process.cwd(), "data", "otello.sqlite");
}

async function openSqlite(): Promise<Executor> {
  if (sqliteExecutor) return sqliteExecutor;
  const { DatabaseSync } = await import("node:sqlite");
  const file = sqlitePath();
  mkdirSync(path.dirname(file), { recursive: true });
  const database = new DatabaseSync(file);
  database.exec("PRAGMA journal_mode = WAL;");
  sqliteExecutor = {
    async get(statement, params) {
      const row = database.prepare(statement).get(...params) as Row | undefined;
      return row;
    },
    async run(statement, params) {
      database.prepare(statement).run(...params);
    },
    async changes(statement, params) {
      const result = database.prepare(statement).run(...params) as { changes?: number };
      return Number(result.changes ?? 0);
    },
  };
  return sqliteExecutor;
}

function postgresSql(): Sql {
  if (postgresClient) return postgresClient;
  const url = postgresUrl();
  if (!url) throw new DatabaseConfigError();
  const pooled = /pooler|pgbouncer/i.test(url);
  postgresClient = postgres(url, {
    ssl: url.includes("sslmode=disable") ? false : "require",
    max: 1,
    prepare: false,
    fetch_types: false,
    idle_timeout: pooled ? 0 : 20,
    connect_timeout: 10,
    max_lifetime: 60 * 5,
  });
  return postgresClient;
}

function postgresHost(): string {
  const url = postgresUrl();
  if (!url) return "unset";
  try {
    return new URL(url).host || "unknown";
  } catch {
    return "invalid";
  }
}

function postgresExecutor(sql: Sql): Executor {
  const host = postgresHost();
  return {
    async get(statement, params) {
      try {
        const rows = await sql.unsafe(toDollar(statement), params as never[]);
        const row = rows[0];
        return row ? (row as Row) : undefined;
      } catch (error) {
        throw connectionError("postgres", host, error, statement);
      }
    },
    async run(statement, params) {
      try {
        await sql.unsafe(toDollar(statement), params as never[]);
      } catch (error) {
        throw connectionError("postgres", host, error, statement);
      }
    },
    async changes(statement, params) {
      try {
        const rows = await sql.unsafe(toDollar(statement), params as never[]);
        return Number(rows.count ?? 0);
      } catch (error) {
        throw connectionError("postgres", host, error, statement);
      }
    },
  };
}

function tursoExecutor(): Executor {
  const config = tursoConfig();
  if (!config) throw new DatabaseConfigError();
  const call = async (statement: string, params: SqlValue[], wantRows: boolean) => {
    try {
      return await tursoExecute(config, statement, params, wantRows);
    } catch (error) {
      throw connectionError("turso", config.host, error, statement);
    }
  };
  return {
    async get(statement, params) {
      return (await call(statement, params, true)).row;
    },
    async run(statement, params) {
      await call(statement, params, false);
    },
    async changes(statement, params) {
      return (await call(statement, params, false)).rowsAffected;
    },
  };
}

async function current(): Promise<Executor> {
  const kind = databaseKind();
  if (kind === "sqlite") return openSqlite();
  if (kind === "postgres") return postgresExecutor(postgresSql());
  return tursoExecutor();
}

const SQLITE_SCHEMA = `
  CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS ledgers (
    scope TEXT PRIMARY KEY,
    document TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
`;

const REMOTE_SCHEMA = `
  CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at BIGINT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    expires_at BIGINT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS ledgers (
    scope TEXT PRIMARY KEY,
    document TEXT NOT NULL,
    updated_at BIGINT NOT NULL
  );
`;

export function ensureSchema(): Promise<void> {
  schemaReady ??= (async () => {
    const executor = await current();
    const schema = databaseKind() === "sqlite" ? SQLITE_SCHEMA : REMOTE_SCHEMA;
    for (const statement of schema.split(";").map((part) => part.trim()).filter(Boolean)) {
      await executor.run(statement, []);
    }
  })().catch((error: unknown) => {
    schemaReady = undefined;
    throw error;
  });
  return schemaReady;
}

function asText(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value instanceof Uint8Array) return new TextDecoder().decode(value);
  return null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

interface LedgerRecord {
  state: AppState;
  updatedAt: number;
}

export async function readLedgerRecord(scope: Scope): Promise<LedgerRecord | null> {
  await ensureSchema();
  const row = await (await current()).get("SELECT document, updated_at FROM ledgers WHERE scope = ?", [scope]);
  if (!row) return null;
  const document = asText(row.document);
  const updatedAt = asNumber(row.updated_at);
  if (!document || updatedAt === null) return null;
  return { state: JSON.parse(document) as AppState, updatedAt };
}

export async function readLedger(scope: Scope): Promise<AppState | null> {
  const record = await readLedgerRecord(scope);
  return record?.state ?? null;
}

/** Writes the ledger. When `expectedUpdatedAt` is set, the write commits only if that stamp is still current. */
export async function writeLedger(scope: Scope, state: AppState, expectedUpdatedAt?: number | null): Promise<boolean> {
  await ensureSchema();
  const stamp = expectedUpdatedAt == null ? Date.now() : Math.max(Date.now(), expectedUpdatedAt + 1);
  const document = JSON.stringify(state);
  const executor = await current();
  if (expectedUpdatedAt === undefined) {
    await executor.run(
      `INSERT INTO ledgers (scope, document, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(scope) DO UPDATE SET document = excluded.document, updated_at = excluded.updated_at`,
      [scope, document, stamp],
    );
    return true;
  }
  if (expectedUpdatedAt === null) {
    const inserted = await executor.changes(
      `INSERT INTO ledgers (scope, document, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(scope) DO NOTHING`,
      [scope, document, stamp],
    );
    return inserted > 0;
  }
  const updated = await executor.changes(
    "UPDATE ledgers SET document = ?, updated_at = ? WHERE scope = ? AND updated_at = ?",
    [document, stamp, scope, expectedUpdatedAt],
  );
  return updated > 0;
}

export async function loadLedger(scope: Scope, now = Date.now()): Promise<AppState> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const record = await readLedgerRecord(scope);
    const base = record?.state ?? emptyState(now);
    const seeded = scope === "live" ? await ensureSampleMarket(base) : base;
    const next = reconcile(seeded, now);
    if (record && next === record.state) return next;
    const saved = await writeLedger(scope, next, record?.updatedAt ?? null);
    if (saved) return next;
  }
  return (await readLedger(scope)) ?? emptyState(now);
}

let queue: Promise<void> = Promise.resolve();

export function withLedger<T>(task: () => Promise<T> | T): Promise<T> {
  const run = queue.then(async () => {
    await ensureSchema();
    return task();
  });
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/**
 * Applies a change and returns only after a committed read matches it.
 * Remote databases autocommit each statement, so the write is durable before this resolves.
 */
export async function commitChange<T>(
  scope: Scope,
  task: (state: AppState, now: number) => Promise<{ state: AppState; value: T }>,
): Promise<{ before: AppState; state: AppState; value: T }> {
  return withLedger(async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const now = Date.now();
      const record = await readLedgerRecord(scope);
      const base = record?.state ?? emptyState(now);
      const seeded = scope === "live" ? await ensureSampleMarket(base) : base;
      const prepared = reconcile(seeded, now);
      const changed = await task(prepared, now);
      if (record && changed.state === record.state) return { before: prepared, state: prepared, value: changed.value };
      const saved = await writeLedger(scope, changed.state, record?.updatedAt ?? null);
      if (!saved) continue;
      const committed = await readLedger(scope);
      if (!committed) continue;
      const leaseId = leaseIdOf(changed.value);
      if (leaseId) {
        const wanted = changed.state.leases.find((lease) => lease.id === leaseId);
        const seen = committed.leases.find((lease) => lease.id === leaseId);
        if (!wanted || !seen) continue;
        if (seen.status !== wanted.status) continue;
        if (Boolean(wanted.agreement) !== Boolean(seen.agreement)) continue;
        if (Boolean(wanted.credential) !== Boolean(seen.credential)) continue;
      }
      return { before: prepared, state: committed, value: changed.value };
    }
    throw new Error("The ledger commit did not persist.");
  });
}

function leaseIdOf(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || !("leaseId" in value)) return undefined;
  const leaseId = (value as { leaseId?: unknown }).leaseId;
  return typeof leaseId === "string" ? leaseId : undefined;
}

let maintenanceStarted = false;

export function startMaintenance(): void {
  if (maintenanceStarted || hosted() || databaseKind() !== "sqlite") return;
  maintenanceStarted = true;
  const timer = setInterval(() => {
    void withLedger(async () => {
      const now = Date.now();
      for (const scope of ["live", "examples"] as const) {
        const stored = await readLedger(scope);
        if (!stored) continue;
        const next = reconcile(stored, now);
        if (next !== stored) await writeLedger(scope, next);
      }
    });
  }, 1000);
  timer.unref();
}

export async function dbGet(statement: string, params: SqlValue[]): Promise<Row | undefined> {
  await ensureSchema();
  return (await current()).get(statement, params);
}

export async function dbRun(statement: string, params: SqlValue[]): Promise<void> {
  await ensureSchema();
  return (await current()).run(statement, params);
}
