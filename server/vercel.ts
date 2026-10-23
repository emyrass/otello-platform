import type { IncomingMessage, ServerResponse } from "node:http";
import { sendFailure } from "./fail.ts";
import { handleApi } from "./http.ts";

export const config = {
  runtime: "nodejs",
  maxDuration: 30,
};

type FunctionRequest = IncomingMessage & { query?: { path?: string | string[] } };

function normalizeRequestUrl(req: FunctionRequest): void {
  const raw = req.url ?? "/";
  if (raw.startsWith("/api")) return;
  const query = raw.includes("?") ? raw.slice(raw.indexOf("?")) : "";
  const pathParam = req.query?.path;
  const segments = Array.isArray(pathParam) ? pathParam : pathParam ? [pathParam] : [];
  if (segments.length === 0) return;
  req.url = `/api/${segments.map((part) => encodeURIComponent(part)).join("/")}${query}`;
}

export default async function handler(req: FunctionRequest, res: ServerResponse): Promise<void> {
  normalizeRequestUrl(req);
  try {
    await handleApi(req, res);
  } catch (error) {
    sendFailure(res, error);
  }
}
