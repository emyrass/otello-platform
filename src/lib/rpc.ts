import type { LedgerOrigin, Network, RpcExecutionKind, RpcMethod } from "./types.ts";

const CHAIN_IDS: Record<Network, number> = {
  ethereum: 1,
  base: 8453,
  arbitrum: 42161,
  polygon: 137,
};

export interface RpcExecutionContext {
  endpointUrl?: string;
  network: Network;
  method: RpcMethod;
  requestCount: number;
  params: unknown;
  now: number;
  origin: LedgerOrigin;
}

export interface RpcExecution {
  ok: boolean;
  execution: RpcExecutionKind;
  reason?: string;
  latencyMs?: number;
  body?: unknown;
  note?: string;
}

export type RpcExecutor = (context: RpcExecutionContext) => Promise<RpcExecution>;

export const unavailableExecutor: RpcExecutor = async () => ({
  ok: false,
  execution: "unavailable",
  reason: "RPC execution is unavailable. This resource has no endpoint configured, so the request was not sent.",
});

/** Example ledger only. Produces a labeled sample and does not open a network connection. */
export const exampleExecutor: RpcExecutor = async (context) => ({
  ok: true,
  execution: "example",
  body: localSample(context),
  note: `Example ${context.network} sample for chain id ${CHAIN_IDS[context.network]}. Not sent to a network. ${context.requestCount.toLocaleString("en-US")} requests were evaluated as one batch.`,
});

/** Workspace offers with no endpoint. A labeled local sample, priced by the agreement, never a network call. */
export const simulatedExecutor: RpcExecutor = async (context) => ({
  ok: true,
  execution: "simulated",
  body: localSample(context),
  note: `Simulated ${context.network} response. Not sent to a provider or a network. ${context.requestCount.toLocaleString("en-US")} requests are priced from the signed agreement.`,
});

function localSample(context: RpcExecutionContext): unknown[] {
  const block = 21_000_000 + Math.floor(context.now / 12_000);
  const sampleCount = Math.min(3, Math.max(0, context.requestCount));
  return Array.from({ length: sampleCount }, (_, index) => sampleFor(context.method, block, index));
}

function sampleFor(method: RpcMethod, block: number, index: number): unknown {
  const number = `0x${(block + index).toString(16)}`;
  switch (method) {
    case "eth_blockNumber":
      return number;
    case "eth_getBalance":
      return `0x${(10n ** 18n * BigInt(index + 1)).toString(16)}`;
    case "eth_getBlockByNumber":
      return { number, hash: `0x${"ab".repeat(31)}${index.toString(16)}`, transactions: [] };
    case "eth_call":
      return `0x${(index + 1).toString(16).padStart(64, "0")}`;
    case "eth_getTransactionReceipt":
      return { status: "0x1", blockNumber: number, gasUsed: "0x5208", transactionIndex: `0x${index.toString(16)}` };
  }
}
