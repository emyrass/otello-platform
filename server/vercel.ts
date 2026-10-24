import type { IncomingMessage, ServerResponse } from "node:http";
import { sendFailure } from "./fail.ts";
import { handleApi } from "./http.ts";

export const config = {
  runtime: "nodejs",
  maxDuration: 30,
};

const COLLAPSED = new Set(["/api", "/api/index", "/api/index.js"]);

type HeaderValue = string | string[] | undefined;
type HeaderMap = Record<string, HeaderValue>;

export function resolveApiUrl(rawUrl: string, headers: HeaderMap = {}, query: Record<string, HeaderValue> = {}): string {
  const url = new URL(rawUrl || "/", "http://127.0.0.1");
  let pathname = url.pathname.replace(/\/+$/, "") || "/";
  for (const key of ["id", "route", "action"]) {
    const token = `[${key}]`;
    if (!pathname.includes(token)) continue;
    const value = url.searchParams.get(key) ?? single(query[key]);
    if (!value || !isSafeSuffix(value)) return applyScope(`${url.pathname}${url.search}`, headers);
    pathname = pathname.replaceAll(token, value);
    url.searchParams.delete(key);
  }
  const currentSearch = url.searchParams.toString();
  const current = `${pathname}${currentSearch ? `?${currentSearch}` : ""}`;
  if (pathname.startsWith("/api/") && !COLLAPSED.has(pathname)) return applyScope(current, headers);

  const forwarded = forwardedApiUrl(headers);
  if (forwarded) return applyScope(forwarded, headers);

  const fromUrl = url.searchParams.getAll("path");
  const suffix = (fromUrl.length > 0 ? fromUrl : list(query.path)).map((part) => part.replace(/^\/+/, "")).filter(Boolean).join("/");
  if (!isSafeSuffix(suffix)) return applyScope(rawUrl || "/", headers);
  url.searchParams.delete("path");
  const search = url.searchParams.toString();
  return applyScope(`/api/${suffix}${search ? `?${search}` : ""}`, headers);
}

function applyScope(raw: string, headers: HeaderMap): string {
  const scope = single(headers["x-otello-scope"]);
  if (scope !== "live" && scope !== "examples") return raw;
  const url = new URL(raw, "http://127.0.0.1");
  if (!url.searchParams.has("scope")) url.searchParams.set("scope", scope);
  return `${url.pathname}${url.search}`;
}

function list(value: HeaderValue): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string" && value) return [value];
  return [];
}

function single(value: HeaderValue): string | undefined {
  return list(value)[0];
}

function forwardedApiUrl(headers: HeaderMap): string | null {
  for (const name of ["x-forwarded-uri", "x-original-uri", "x-vercel-original-url", "x-invoke-path"]) {
    const value = headers[name];
    const text = (Array.isArray(value) ? value[0] : value)?.trim();
    if (!text) continue;
    let candidate = text;
    if (candidate.startsWith("http://") || candidate.startsWith("https://")) {
      try {
        const parsed = new URL(candidate);
        candidate = `${parsed.pathname}${parsed.search}`;
      } catch {
        continue;
      }
    }
    if (!candidate.startsWith("/")) candidate = `/${candidate}`;
    const pathOnly = candidate.split("?")[0]?.replace(/\/+$/, "") ?? "";
    if (pathOnly.startsWith("/api/") && !COLLAPSED.has(pathOnly) && !pathOnly.includes("..")) return candidate;
  }
  return null;
}

function isSafeSuffix(suffix: string): boolean {
  if (!suffix || suffix.includes("..") || suffix.includes("\\") || suffix.includes("://")) return false;
  return /^[\w./~:@%+-]+$/.test(suffix);
}

type FunctionRequest = IncomingMessage & { query?: { path?: string | string[] } };

export default async function handler(req: FunctionRequest, res: ServerResponse): Promise<void> {
  req.url = resolveApiUrl(req.url ?? "/", req.headers, req.query ?? {});
  try {
    await handleApi(req, res);
  } catch (error) {
    sendFailure(res, error);
  }
}
