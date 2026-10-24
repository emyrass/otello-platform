import type { ServerResponse } from "node:http";
import { DatabaseConfigError, logRequestFailure, publicErrorMessage } from "./errors.ts";

export function sendFailure(res: ServerResponse, error: unknown): void {
  const tooLarge = error instanceof Error && error.message === "too large";
  const missingDatabase = error instanceof DatabaseConfigError;
  const status = tooLarge ? 413 : missingDatabase ? 503 : 500;
  const message = tooLarge ? "That request is too large." : publicErrorMessage(error);
  logRequestFailure(status, error);
  if (!res.headersSent) {
    res.statusCode = status;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.setHeader("cache-control", "no-store");
  }
  res.end(JSON.stringify({ errors: [message] }));
}
