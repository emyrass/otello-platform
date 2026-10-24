export type SqlValue = string | number | null;
export type Row = Record<string, unknown>;

type FetchInit = RequestInit & { duplex?: "half" };
type TursoFetch = (url: string, init: FetchInit) => Promise<Response>;

interface HranaValue {
  type: "null" | "integer" | "float" | "text" | "blob";
  value?: string | number;
  base64?: string;
}

interface StmtResult {
  cols?: Array<{ name?: string | null }>;
  rows?: HranaValue[][];
  affected_row_count?: number;
}

export function tursoPipelineUrl(raw: string): string {
  const trimmed = stripQuotes(raw.trim());
  let withScheme = trimmed;
  if (/^libsql:\/\//i.test(withScheme)) withScheme = `https://${withScheme.slice("libsql://".length)}`;
  else if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(withScheme)) withScheme = `https://${withScheme}`;
  const parsed = new URL(withScheme);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(`The Turso URL must use libsql, https, or http (${parsed.protocol}).`);
  }
  return `${parsed.origin}/v2/pipeline`;
}

export function tursoHost(raw: string): string {
  try {
    return new URL(tursoPipelineUrl(raw)).host;
  } catch {
    return "invalid";
  }
}

export async function tursoExecute(
  config: { url: string; authToken: string },
  statement: string,
  params: SqlValue[],
  wantRows: boolean,
  fetchImpl: TursoFetch = globalThis.fetch,
): Promise<{ row?: Row; rowsAffected: number }> {
  const pipelineUrl = tursoPipelineUrl(config.url);
  const body = JSON.stringify({
    requests: [
      {
        type: "execute",
        stmt: {
          sql: statement,
          args: params.map(encodeValue),
          named_args: [],
          want_rows: wantRows,
        },
      },
      { type: "close" },
    ],
  });
  let response: Response;
  try {
    response = await fetchImpl(pipelineUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.authToken}`,
      },
      body,
      duplex: "half",
      signal: AbortSignal.timeout(12_000),
    });
  } catch (error) {
    throw new Error(`The Turso host did not answer (${tursoHost(config.url)}).`, { cause: error });
  }
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${serverMessage(text) || response.statusText || "Turso rejected the request."}`);
  }
  let payload: unknown;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch (error) {
    throw new Error("Turso returned a response that was not JSON.", { cause: error });
  }
  const result = executeResult(payload);
  return { row: rowFrom(result), rowsAffected: Number(result.affected_row_count ?? 0) };
}

function encodeValue(value: SqlValue): HranaValue {
  if (value === null) return { type: "null" };
  if (typeof value === "number") {
    if (Number.isSafeInteger(value)) return { type: "integer", value: String(value) };
    return { type: "float", value };
  }
  return { type: "text", value };
}

function executeResult(payload: unknown): StmtResult {
  if (!payload || typeof payload !== "object") throw new Error("Turso returned an empty pipeline response.");
  const results = (payload as { results?: unknown }).results;
  if (!Array.isArray(results) || results.length === 0) throw new Error("Turso returned no pipeline result.");
  const first = results[0];
  if (!first || typeof first !== "object") throw new Error("Turso returned an unreadable pipeline result.");
  const entry = first as { type?: string; error?: { message?: string; code?: string }; response?: { type?: string; result?: StmtResult } };
  if (entry.type === "error") {
    const message = entry.error?.message || "Turso rejected the statement.";
    const code = entry.error?.code ? ` [${entry.error.code}]` : "";
    throw new Error(`${message}${code}`);
  }
  if (entry.type !== "ok" || entry.response?.type !== "execute" || !entry.response.result) {
    throw new Error("Turso returned an unexpected pipeline result.");
  }
  return entry.response.result;
}

function rowFrom(result: StmtResult): Row | undefined {
  const values = result.rows?.[0];
  if (!values) return undefined;
  const row: Row = {};
  values.forEach((value, index) => {
    const name = result.cols?.[index]?.name || String(index);
    row[name] = decodeValue(value);
  });
  return row;
}

function decodeValue(value: HranaValue): unknown {
  if (!value || value.type === "null") return null;
  if (value.type === "integer") {
    const parsed = Number(value.value);
    return Number.isSafeInteger(parsed) ? parsed : String(value.value);
  }
  if (value.type === "float" || value.type === "text") return value.value ?? null;
  if (value.type === "blob" && value.base64) return Uint8Array.from(Buffer.from(value.base64, "base64"));
  return null;
}

function serverMessage(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  try {
    const parsed = JSON.parse(trimmed) as { message?: unknown; error?: unknown };
    if (typeof parsed.message === "string") return parsed.message;
    if (typeof parsed.error === "string") return parsed.error;
  } catch {
    // The body is plain text.
  }
  return trimmed.replace(/\s+/g, " ").slice(0, 300);
}

function stripQuotes(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1).trim();
  }
  return value;
}
