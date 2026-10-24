import { AsyncLocalStorage } from "node:async_hooks";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { createClient, type Client, type InValue, type Transaction } from "@libsql/client";
import postgres, { type Sql, type TransactionSql } from "postgres";
import { emptyState, reconcile } from "../src/lib/engine.ts";
import { ensureSampleMarket } from "../src/lib/marketSamples.ts";
import type { AppState } from "../src/lib/types.ts";

export type Scope = "live" | "examples";

export class DatabaseConfigError extends Error {
  constructor() {
    super("The ledger database is not configured. In the Vercel project, add Postgres so POSTGRES_URL is set, or set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN.");
    this.name = "DatabaseConfigError";
  }
}

type SqlValue = string | number | null;
type Row = Record<string, unknown>;

interface Executor {
  get(statement: string, params: SqlValue[]): Promise<Row | undefined>;
  run(statement: string, params: SqlValue[]): Promise<void>;
}

type Kind = "sqlite" | "postgres" | "turso";

const storage = new AsyncLocalStorage<Executor>();

let sqliteExecutor: Executor | undefined;
let postgresClient: Sql | undefined;
let tursoClient: Client | undefined;
let schemaReady: Promise<void> | undefined;

export function databaseKind(): Kind {
  if (process.env.OTELLO_SQLITE_PATH) return "sqlite";
  if (postgresUrl()) return "postgres";
  if (process.env.TURSO_DATABASE_URL && process.env.TURSO_AUTH_TOKEN) return "turso";
  if (process.env.VERCEL) throw new DatabaseConfigError();
  return "sqlite";
}

function postgresUrl(): string | undefined {
  return process.env.POSTGRES_URL || process.env.DATABASE_URL || process.env.POSTGRES_PRISMA_URL || undefined;
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
  };
  return sqliteExecutor;
}

function postgresSql(): Sql {
  if (postgresClient) return postgresClient;
  const url = postgresUrl();
  if (!url) throw new DatabaseConfigError();
  postgresClient = postgres(url, {
    ssl: url.includes("sslmode=disable") ? false : "require",
    max: 1,
    prepare: false,
    idle_timeout: 20,
    connect_timeout: 15,
  });
  return postgresClient;
}

function postgresExecutor(sql: Sql | TransactionSql): Executor {
  return {
    async get(statement, params) {
      const rows = await sql.unsafe(toDollar(statement), params as never[]);
      const row = rows[0];
      return row ? (row as Row) : undefined;
    },
    async run(statement, params) {
      await sql.unsafe(toDollar(statement), params as never[]);
    },
  };
}

function turso(): Client {
  if (tursoClient) return tursoClient;
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url || !authToken) throw new DatabaseConfigError();
  tursoClient = createClient({ url, authToken });
  return tursoClient;
}

function tursoExecutor(client: Client | Transaction): Executor {
  return {
    async get(statement, params) {
      const result = await client.execute({ sql: statement, args: params as InValue[] });
      const row = result.rows[0];
      return row ? (row as unknown as Row) : undefined;
    },
    async run(statement, params) {
      await client.execute({ sql: statement, args: params as InValue[] });
    },
  };
}

async function autocommit(): Promise<Executor> {
  const kind = databaseKind();
  if (kind === "sqlite") return openSqlite();
  if (kind === "postgres") return postgresExecutor(postgresSql());
  return tursoExecutor(turso());
}

async function current(): Promise<Executor> {
  return storage.getStore() ?? autocommit();
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
    const executor = await autocommit();
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

export async function readLedger(scope: Scope): Promise<AppState | null> {
  await ensureSchema();
  const locking = storage.getStore() !== undefined && databaseKind() === "postgres";
  const statement = locking
    ? "SELECT document FROM ledgers WHERE scope = ? FOR UPDATE"
    : "SELECT document FROM ledgers WHERE scope = ?";
  const row = await (await current()).get(statement, [scope]);
  if (!row) return null;
  const document = row.document;
  if (typeof document !== "string") return null;
  return JSON.parse(document) as AppState;
}

export async function writeLedger(scope: Scope, state: AppState): Promise<void> {
  await ensureSchema();
  await (await current()).run(
    `INSERT INTO ledgers (scope, document, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(scope) DO UPDATE SET document = excluded.document, updated_at = excluded.updated_at`,
    [scope, JSON.stringify(state), Date.now()],
  );
}

export async function loadLedger(scope: Scope, now = Date.now()): Promise<AppState> {
  const stored = (await readLedger(scope)) ?? emptyState(now);
  const seeded = scope === "live" ? await ensureSampleMarket(stored) : stored;
  const next = reconcile(seeded, now);
  if (next !== stored || !(await readLedger(scope))) await writeLedger(scope, next);
  return next;
}

let queue: Promise<void> = Promise.resolve();

export function withLedger<T>(task: () => Promise<T> | T): Promise<T> {
  const run = queue.then(async () => {
    await ensureSchema();
    const kind = databaseKind();
    if (kind === "sqlite") return task();
    if (kind === "postgres") {
      const result = await postgresSql().begin(async (tx) => storage.run(postgresExecutor(tx), () => task()));
      return result as T;
    }
    const tx = await turso().transaction("write");
    try {
      const result = await storage.run(tursoExecutor(tx), () => task());
      await tx.commit();
      return result;
    } catch (error) {
      await tx.rollback();
      throw error;
    }
  });
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

let maintenanceStarted = false;

export function startMaintenance(): void {
  if (maintenanceStarted || process.env.VERCEL || databaseKind() !== "sqlite") return;
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
