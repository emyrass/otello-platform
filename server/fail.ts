import type { ServerResponse } from "node:http";
import { DatabaseConfigError } from "./db.ts";

export function sendFailure(res: ServerResponse, error: unknown): void {
  const tooLarge = error instanceof Error && error.message === "too large";
  const missingDatabase = error instanceof DatabaseConfigError;
  const status = tooLarge ? 413 : missingDatabase ? 503 : 500;
  const message = tooLarge
    ? "That request is too large."
    : missingDatabase
      ? error.message
      : "The server could not complete that operation.";
  if (!res.headersSent) {
    res.statusCode = status;
    res.setHeader("content-type", "application/json; charset=utf-8");
  }
  res.end(JSON.stringify({ errors: [message] }));
}
