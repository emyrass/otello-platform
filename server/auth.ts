import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { nextId } from "../src/lib/ids.ts";
import { dbGet, dbRun } from "./db.ts";

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

export async function createAccount(name: string, password: string): Promise<Account> {
  const account = { id: nextId("acct"), name };
  await dbRun("INSERT INTO accounts (id, name, password_hash, created_at) VALUES (?, ?, ?, ?)", [account.id, name, hashPassword(password), Date.now()]);
  return account;
}

export async function findAccountByName(name: string): Promise<(Account & { passwordHash: string }) | null> {
  const row = await dbGet("SELECT id, name, password_hash FROM accounts WHERE name = ?", [name]);
  if (!row || typeof row.id !== "string" || typeof row.name !== "string" || typeof row.password_hash !== "string") return null;
  return { id: row.id, name: row.name, passwordHash: row.password_hash };
}

export async function findAccountById(id: string): Promise<Account | null> {
  const row = await dbGet("SELECT id, name FROM accounts WHERE id = ?", [id]);
  if (!row || typeof row.id !== "string" || typeof row.name !== "string") return null;
  return { id: row.id, name: row.name };
}

export async function openSession(accountId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await dbRun("INSERT INTO sessions (token, account_id, expires_at) VALUES (?, ?, ?)", [token, accountId, Date.now() + SESSION_MS]);
  return token;
}

export async function closeSession(token: string): Promise<void> {
  await dbRun("DELETE FROM sessions WHERE token = ?", [token]);
}

function asTime(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string" && value.trim() !== "") return Number(value);
  return Number.NaN;
}

export async function accountForToken(token: string | null): Promise<Account | null> {
  if (!token) return null;
  const row = await dbGet("SELECT account_id, expires_at FROM sessions WHERE token = ?", [token]);
  if (!row || typeof row.account_id !== "string") return null;
  if (asTime(row.expires_at) <= Date.now()) {
    await closeSession(token);
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

export function accountFromRequest(req: IncomingMessage): Promise<Account | null> {
  return accountForToken(readToken(req));
}

export function writeSessionCookie(res: ServerResponse, token: string | null, req?: IncomingMessage): void {
  const maxAge = token ? Math.floor(SESSION_MS / 1000) : 0;
  const value = token ? encodeURIComponent(token) : "";
  const secure = req?.headers["x-forwarded-proto"] === "https" ? "; Secure" : "";
  res.setHeader("set-cookie", `${COOKIE}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure}`);
}
