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
  const pathname = url.pathname.replace(/\/+$/, "") || "/";
  if (pathname.startsWith("/api/") && !COLLAPSED.has(pathname)) return `${url.pathname}${url.search}`;

  const forwarded = forwardedApiUrl(headers);
  if (forwarded) return forwarded;

  const fromUrl = url.searchParams.getAll("path");
  const suffix = (fromUrl.length > 0 ? fromUrl : list(query.path)).map((part) => part.replace(/^\/+/, "")).filter(Boolean).join("/");
  if (!isSafeSuffix(suffix)) return `${url.pathname}${url.search}`;
  url.searchParams.delete("path");
  const search = url.searchParams.toString();
  return `/api/${suffix}${search ? `?${search}` : ""}`;
}

function list(value: HeaderValue): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string" && value) return [value];
  return [];
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
