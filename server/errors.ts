export class DatabaseConfigError extends Error {
  constructor() {
    const present = [
      process.env.TURSO_DATABASE_URL ? "TURSO_DATABASE_URL" : "",
      process.env.TURSO_AUTH_TOKEN ? "TURSO_AUTH_TOKEN" : "",
      process.env.POSTGRES_URL || process.env.POSTGRES_URL_NON_POOLING || process.env.DATABASE_URL ? "POSTGRES_URL" : "",
    ].filter(Boolean);
    super(
      `The ledger database is not configured. Present: ${present.join(", ") || "none"}. Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN.`,
    );
    this.name = "DatabaseConfigError";
  }
}

export class LedgerConnectionError extends Error {
  readonly kind: "turso" | "postgres";
  readonly host: string;

  constructor(kind: "turso" | "postgres", host: string, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "LedgerConnectionError";
    this.kind = kind;
    this.host = host;
  }
}

export function connectionError(kind: "turso" | "postgres", host: string, error: unknown, statement?: string): LedgerConnectionError {
  const sql = statement ? redact(statement.replace(/\s+/g, " ").slice(0, 180)) : "";
  const detail = redact(causeChain(error)) || "The request failed.";
  const message = sql ? `${kind} (${host}) ${sql}: ${detail}` : `${kind} (${host}): ${detail}`;
  const wrapped = new LedgerConnectionError(kind, host, message, error);
  console.error("[otello] ledger connection failed", {
    kind,
    host,
    sql,
    detail,
    stack: error instanceof Error ? error.stack : undefined,
  });
  return wrapped;
}

export function publicErrorMessage(error: unknown): string {
  if (error instanceof LedgerConnectionError || error instanceof DatabaseConfigError) return redact(error.message).slice(0, 700);
  return (redact(causeChain(error)) || "The server could not complete that operation.").slice(0, 700);
}

export function logRequestFailure(status: number, error: unknown): void {
  console.error("[otello] request failed", {
    status,
    message: publicErrorMessage(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
}

function causeChain(error: unknown): string {
  const parts: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current != null && !seen.has(current) && parts.length < 4) {
    seen.add(current);
    if (current instanceof Error) {
      const code = codeOf(current);
      const text = current.message?.trim() || current.name;
      parts.push(code ? `${text} [${code}]` : text);
      current = current.cause;
    } else {
      parts.push(String(current));
      break;
    }
  }
  return parts.filter(Boolean).join(" — ");
}

function codeOf(error: Error): string | undefined {
  const code = (error as Error & { code?: unknown }).code;
  if (typeof code === "string" && code) return code;
  if (typeof code === "number") return String(code);
  return undefined;
}

export function redact(text: string): string {
  return text
    .replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/\b(?:postgres|postgresql|libsql|https?):\/\/[^\s'")]+/gi, (url) => {
      try {
        const parsed = new URL(url.replace(/^libsql:/i, "https:"));
        return `${parsed.protocol}//${parsed.host}`;
      } catch {
        return "[redacted-url]";
      }
    });
}
