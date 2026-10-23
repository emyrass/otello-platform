import { mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { emptyState, reconcile } from "../src/lib/engine.ts";
import type { AppState } from "../src/lib/types.ts";

export type Scope = "live" | "examples";

const databasePath = path.join(process.cwd(), "data", "otello.sqlite");

let database: DatabaseSync | undefined;

export function db(): DatabaseSync {
  if (database) return database;
  mkdirSync(path.dirname(databasePath), { recursive: true });
  database = new DatabaseSync(databasePath);
  database.exec(`
    PRAGMA journal_mode = WAL;
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
  `);
  return database;
}

export function readLedger(scope: Scope): AppState | null {
  const row = db().prepare("SELECT document FROM ledgers WHERE scope = ?").get(scope) as { document: string } | undefined;
  if (!row) return null;
  return JSON.parse(row.document) as AppState;
}

export function writeLedger(scope: Scope, state: AppState): void {
  db()
    .prepare(
      `INSERT INTO ledgers (scope, document, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(scope) DO UPDATE SET document = excluded.document, updated_at = excluded.updated_at`,
    )
    .run(scope, JSON.stringify(state), Date.now());
}

export function loadLedger(scope: Scope, now = Date.now()): AppState {
  const stored = readLedger(scope) ?? emptyState(now);
  const next = reconcile(stored, now);
  if (next !== stored || !readLedger(scope)) writeLedger(scope, next);
  return next;
}

let queue: Promise<void> = Promise.resolve();

export function withLedger<T>(task: () => Promise<T> | T): Promise<T> {
  const run = queue.then(task, task);
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

let maintenanceStarted = false;

export function startMaintenance(): void {
  if (maintenanceStarted) return;
  maintenanceStarted = true;
  const timer = setInterval(() => {
    void withLedger(() => {
      const now = Date.now();
      for (const scope of ["live", "examples"] as const) {
        const stored = readLedger(scope);
        if (!stored) continue;
        const next = reconcile(stored, now);
        if (next !== stored) writeLedger(scope, next);
      }
    });
  }, 1000);
  timer.unref();
}
