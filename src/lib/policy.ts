import { sameMethods } from "./canonical.ts";
import { secretsMatch } from "./credentials.ts";
import { formatUsd } from "./format.ts";
import { costForRequests } from "./money.ts";
import {
  MAX_BATCH,
  RATE_WINDOW_MS,
  type AppState,
  type Lease,
  type RateSample,
  type RpcInput,
} from "./types.ts";

export type PolicyCode =
  | "invalid_count"
  | "lease_not_found"
  | "agent_mismatch"
  | "agent_missing"
  | "agent_disabled"
  | "provider_missing"
  | "provider_disabled"
  | "rejected"
  | "revoked"
  | "expired"
  | "exhausted"
  | "awaiting_approval"
  | "not_started"
  | "not_active"
  | "agreement_missing"
  | "agreement_mismatch"
  | "credential_missing"
  | "credential_invalid"
  | "credential_mismatch"
  | "method_denied"
  | "rate_exceeded"
  | "allowance_exceeded"
  | "spending_cap_exceeded";

export type PolicyDecision =
  | {
      ok: true;
      costMicro: number;
      unitPriceMicroPerThousand: number;
      willExhaust: boolean;
    }
  | { ok: false; code: PolicyCode; reason: string };

export function requestsInWindow(log: readonly RateSample[], now: number): number {
  const cutoff = now - RATE_WINDOW_MS;
  return log.reduce((sum, sample) => sum + (sample.at > cutoff ? sample.count : 0), 0);
}

export function remainingRequests(lease: Lease): number {
  return Math.max(0, lease.maxRequests - lease.usage.requests);
}

export function remainingBudget(lease: Lease): number {
  return Math.max(0, lease.spendingCapMicro - lease.usage.costMicro);
}

export function leaseIsMathematicallyExhausted(lease: Lease): boolean {
  if (lease.usage.requests >= lease.maxRequests) return true;
  const one = costForRequests(1, lease.pricing.pricePerThousandMicro);
  return remainingBudget(lease) < one;
}

export function leaseTermsMatchAgreement(lease: Lease): boolean {
  const agreement = lease.agreement;
  if (!agreement) return false;
  const payload = agreement.payload;
  return (
    payload.leaseId === lease.id &&
    payload.agentId === lease.agentId &&
    payload.providerId === lease.providerId &&
    payload.resourceId === lease.resourceId &&
    payload.network === lease.network &&
    payload.startAt === lease.startAt &&
    payload.expiresAt === lease.expiresAt &&
    payload.usageAllowance === lease.maxRequests &&
    payload.spendingCapMicro === lease.spendingCapMicro &&
    payload.requestRatePerMinute === lease.maxRequestRate &&
    payload.pricingModel === lease.pricing.model &&
    payload.pricePerThousandMicro === lease.pricing.pricePerThousandMicro &&
    sameMethods(payload.permittedMethods, lease.permittedMethods)
  );
}

function deny(code: PolicyCode, reason: string): PolicyDecision {
  return { ok: false, code, reason };
}

export function evaluatePolicy(state: AppState, input: RpcInput, now: number): PolicyDecision {
  if (!Number.isInteger(input.requestCount) || input.requestCount < 1) {
    return deny("invalid_count", "Request count must be a positive integer.");
  }
  if (input.requestCount > MAX_BATCH) {
    return deny("invalid_count", `A single operation accepts at most ${MAX_BATCH.toLocaleString("en-US")} requests.`);
  }

  const lease = state.leases.find((item) => item.id === input.leaseId);
  if (!lease) return deny("lease_not_found", "No lease matches that identifier.");
  if (lease.agentId !== input.agentId) return deny("agent_mismatch", "This lease belongs to a different agent.");

  const agent = state.agents.find((item) => item.id === lease.agentId);
  if (!agent) return deny("agent_missing", "No agent is registered for this lease.");
  if (agent.status !== "active") return deny("agent_disabled", "Agent is disabled. Access is refused.");

  const provider = state.providers.find((item) => item.id === lease.providerId);
  if (!provider) return deny("provider_missing", "No provider is registered for this lease.");
  if (provider.status !== "active") return deny("provider_disabled", "Provider is disabled. Access is refused.");

  if (lease.status === "rejected") return deny("rejected", "The lease was rejected.");
  if (lease.status === "revoked") {
    const because = lease.revocationReason ? ` ${lease.revocationReason}` : "";
    return deny("revoked", `The lease was revoked.${because}`);
  }
  if (lease.status === "expired" || now >= lease.expiresAt) return deny("expired", "The lease expired.");
  if (lease.status === "exhausted" || leaseIsMathematicallyExhausted(lease)) {
    return deny("exhausted", "The lease is exhausted. The usage allowance or spending cap has been consumed.");
  }
  if (lease.status === "requested") return deny("awaiting_approval", "The lease is still awaiting provider approval.");
  if (lease.status === "approved" && now < lease.startAt) return deny("not_started", "The lease has not reached its start time.");
  if (lease.status !== "active") return deny("not_active", "The lease is not active.");
  if (now < lease.startAt) return deny("not_started", "The lease has not reached its start time.");

  if (!lease.agreement) return deny("agreement_missing", "This lease has no signed agreement.");
  if (!leaseTermsMatchAgreement(lease)) {
    return deny("agreement_mismatch", "The lease terms no longer match the signed agreement.");
  }

  const credential = lease.credential;
  if (!credential) return deny("credential_missing", "No credential has been issued for this lease.");
  if (credential.status !== "valid" || now >= credential.expiresAt) {
    const because = credential.invalidReason ? ` ${credential.invalidReason}` : "";
    return deny("credential_invalid", `The credential is no longer valid.${because}`);
  }
  if (
    credential.leaseId !== lease.id ||
    credential.agentId !== lease.agentId ||
    credential.resourceId !== lease.resourceId ||
    credential.network !== lease.network
  ) {
    return deny("credential_mismatch", "The credential is not scoped to this lease.");
  }
  if (!secretsMatch(input.credentialSecret, credential.secret)) {
    return deny("credential_mismatch", "The presented credential does not match the credential issued for this lease.");
  }
  if (!lease.permittedMethods.includes(input.method) || !credential.permittedMethods.includes(input.method)) {
    return deny("method_denied", `Method ${input.method} is not permitted by this lease.`);
  }

  const inWindow = requestsInWindow(lease.rateLog, now);
  if (inWindow + input.requestCount > lease.maxRequestRate) {
    return deny(
      "rate_exceeded",
      `Request rate would be ${inWindow + input.requestCount} per minute, above the lease limit of ${lease.maxRequestRate}.`,
    );
  }

  const requestsLeft = remainingRequests(lease);
  if (input.requestCount > requestsLeft) {
    return deny(
      "allowance_exceeded",
      `This batch of ${input.requestCount} requests exceeds the remaining allowance of ${requestsLeft}.`,
    );
  }

  const costMicro = costForRequests(input.requestCount, lease.pricing.pricePerThousandMicro);
  const budgetLeft = remainingBudget(lease);
  if (costMicro > budgetLeft) {
    return deny(
      "spending_cap_exceeded",
      `This batch would cost ${formatUsd(costMicro)}, above the remaining budget of ${formatUsd(budgetLeft)}.`,
    );
  }

  const requestsAfter = requestsLeft - input.requestCount;
  const budgetAfter = budgetLeft - costMicro;
  const one = costForRequests(1, lease.pricing.pricePerThousandMicro);
  return {
    ok: true,
    costMicro,
    unitPriceMicroPerThousand: lease.pricing.pricePerThousandMicro,
    willExhaust: requestsAfter === 0 || budgetAfter < one,
  };
}
