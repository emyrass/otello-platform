/**
 * Settlement is deliberately separate from lease access.
 * A future onchain adapter can implement SettlementAdapter and post the same
 * amount due without rewriting the lease engine. This adapter never broadcasts.
 */
import type { SettlementRecord } from "./types.ts";

export interface SettlementQuote {
  leaseId: string;
  acceptedCostMicro: number;
  acceptedRequests: number;
  now: number;
}

export interface SettlementAdapter {
  id: "simulated";
  preview(input: SettlementQuote): Omit<SettlementRecord, "id">;
  settle(record: SettlementRecord, now: number): SettlementRecord;
}

export const simulatedSettlement: SettlementAdapter = {
  id: "simulated",
  preview(input) {
    return {
      leaseId: input.leaseId,
      amountDueMicro: input.acceptedCostMicro,
      acceptedRequests: input.acceptedRequests,
      status: "preview",
      adapter: "simulated",
      createdAt: input.now,
      note: "Simulated settlement preview. No transaction is broadcast and no contract is deployed.",
    };
  },
  settle(record, now) {
    return {
      ...record,
      status: "settled",
      settledAt: now,
      note: "Simulated settlement recorded. No transaction is broadcast and no contract is deployed.",
    };
  },
};
