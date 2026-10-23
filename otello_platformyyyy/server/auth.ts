import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { nextId } from "../src/lib/ids.ts";
import { db } from "./db.ts";

export interface Account {
  id: string;
  name: string;
}

const COOKIE = "otello_session";
const SESSION_MS = 14 * 24 * 60 * 60 * 1000;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 32);
  return `${salt.toString("base64")}.${hash.toString("base64")}`;
}

export function passwordMatches(password: string, stored: string): boolean {
  const [saltB64, hashB64] = stored.split(".");
  if (!saltB64 || !hashB64) return false;
  const salt = Buffer.from(saltB64, "base64");
  const expected = Buffer.from(hashB64, "base64");
  const actual = scryptSync(password, salt, expected.length);
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

export function createAccount(name: string, password: string): Account {
  const account = { id: nextId("acct"), name };
  db().prepare("INSERT INTO accounts (id, name, password_hash, created_at) VALUES (?, ?, ?, ?)").run(account.id, name, hashPassword(password), Date.now());
  return account;
}

export function findAccountByName(name: string): (Account & { passwordHash: string }) | null {
  const row = db().prepare("SELECT id, name, password_hash FROM accounts WHERE name = ?").get(name) as
    | { id: string; name: string; password_hash: string }
    | undefined;
  if (!row) return null;
  return { id: row.id, name: row.name, passwordHash: row.password_hash };
}

export function findAccountById(id: string): Account | null {
  const row = db().prepare("SELECT id, name FROM accounts WHERE id = ?").get(id) as { id: string; name: string } | undefined;
  return row ?? null;
}

export function openSession(accountId: string): string {
  const token = randomBytes(32).toString("base64url");
  db().prepare("INSERT INTO sessions (token, account_id, expires_at) VALUES (?, ?, ?)").run(token, accountId, Date.now() + SESSION_MS);
  return token;
}

export function closeSession(token: string): void {
  db().prepare("DELETE FROM sessions WHERE token = ?").run(token);
}

export function accountForToken(token: string | null): Account | null {
  if (!token) return null;
  const row = db().prepare("SELECT account_id, expires_at FROM sessions WHERE token = ?").get(token) as
    | { account_id: string; expires_at: number }
    | undefined;
  if (!row) return null;
  if (row.expires_at <= Date.now()) {
    closeSession(token);
    return null;
  }
  return findAccountById(row.account_id);
}

export function readToken(req: IncomingMessage): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === COOKIE) return decodeURIComponent(rest.join("="));
  }
  return null;
}

export function accountFromRequest(req: IncomingMessage): Account | null {
  return accountForToken(readToken(req));
}

export function writeSessionCookie(res: ServerResponse, token: string | null): void {
  const maxAge = token ? Math.floor(SESSION_MS / 1000) : 0;
  const value = token ? encodeURIComponent(token) : "";
  res.setHeader("set-cookie", `${COOKIE}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}`);
}
