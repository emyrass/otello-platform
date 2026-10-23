import { unavailableExecutor, type RpcExecution, type RpcExecutor } from "../src/lib/rpc.ts";

export const FORWARD_LIMIT = 50;

export const providerExecutor: RpcExecutor = async (context) => {
  if (!context.endpointUrl) return unavailableExecutor(context);
  if (!Number.isInteger(context.requestCount) || context.requestCount < 1) {
    return { ok: false, execution: "unavailable", reason: "Request count must be a positive integer. Nothing was sent." };
  }
  if (context.requestCount > FORWARD_LIMIT) {
    return {
      ok: false,
      execution: "unavailable",
      reason: `This gateway forwards at most ${FORWARD_LIMIT} calls in one submission. The batch was not sent and was not charged.`,
    };
  }
  const started = performance.now();
  try {
    const calls = Array.from({ length: context.requestCount }, (_, index) => ({
      jsonrpc: "2.0",
      id: index + 1,
      method: context.method,
      params: context.params ?? [],
    }));
    const response = await fetch(context.endpointUrl, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(context.requestCount === 1 ? calls[0] : calls),
      signal: AbortSignal.timeout(12_000),
      redirect: "error",
    });
    const latencyMs = Math.max(0, Math.round(performance.now() - started));
    if (!response.ok) {
      return {
        ok: false,
        execution: "provider",
        latencyMs,
        reason: `The endpoint responded with HTTP ${response.status}. The batch was not charged.`,
      };
    }
    const body: unknown = await response.json();
    const rows = Array.isArray(body) ? body : [body];
    if (rows.length !== context.requestCount) {
      return {
        ok: false,
        execution: "provider",
        latencyMs,
        reason: "The endpoint did not return one result per request. The batch was not charged.",
      };
    }
    const failed = rows.find((row) => isRpcError(row));
    if (failed) {
      return {
        ok: false,
        execution: "provider",
        latencyMs,
        reason: `The endpoint returned ${rpcErrorMessage(failed)}. The batch was not charged.`,
      };
    }
    return {
      ok: true,
      execution: "provider",
      latencyMs,
      body: context.requestCount === 1 ? rows[0] : rows,
      note: "Forwarded to the configured endpoint.",
    };
  } catch {
    const latencyMs = Math.max(0, Math.round(performance.now() - started));
    return {
      ok: false,
      execution: "provider",
      latencyMs,
      reason: "The endpoint could not be reached. The batch was not charged.",
    };
  }
};

function isRpcError(row: unknown): boolean {
  return Boolean(row && typeof row === "object" && "error" in row && (row as { error?: unknown }).error);
}

function rpcErrorMessage(row: unknown): string {
  if (!row || typeof row !== "object" || !("error" in row)) return "an error";
  const error = (row as { error?: unknown }).error;
  if (error && typeof error === "object" && "message" in error && typeof (error as { message?: unknown }).message === "string") {
    return (error as { message: string }).message.slice(0, 180);
  }
  return "an error";
}

export type { RpcExecution };
