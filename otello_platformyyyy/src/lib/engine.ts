import { appendAudit } from "./audit.ts";
import { sortMethods } from "./canonical.ts";
import { generateSigningKey, samePublicKey, signAgreement, verifyAgreement } from "./crypto.ts";
import { invalidateCredential } from "./credentials.ts";
import { nextId } from "./ids.ts";
import { costForRequests } from "./money.ts";
import { evaluatePolicy, leaseTermsMatchAgreement } from "./policy.ts";
import { reconcile } from "./reconcile.ts";
import { unavailableExecutor, type RpcExecutor } from "./rpc.ts";
import { simulatedSettlement, type SettlementAdapter } from "./settlement.ts";
import {
  MIN_DURATION_MS,
  NETWORKS,
  RPC_METHODS,
  REVOCATION_CONDITIONS,
  type Agent,
  type AgreementPayload,
  type AppState,
  type Availability,
  type Lease,
  type LeaseRequestInput,
  type Provider,
  type Resource,
  type ResourceDraft,
  type RpcInput,
  type RpcResponseBody,
  type RpcResult,
  type UsageEvent,
} from "./types.ts";

export interface MutationResult {
  state: AppState;
  errors: string[];
  leaseId?: string;
  resourceId?: string;
  providerId?: string;
  agentId?: string;
}

function ok(state: AppState, extra: Partial<MutationResult> = {}): MutationResult {
  return { state, errors: [], ...extra };
}

function fail(state: AppState, errors: string[]): MutationResult {
  return { state, errors };
}

export function endpointProblem(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return "Endpoint must be an http or https URL.";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return "Endpoint must be an http or https URL.";
  if (url.username || url.password) return "Enter the endpoint without a username or password in the URL.";
  return null;
}

export function normalizeEndpoint(value: string | null | undefined): string | undefined {
  if (value === undefined || value === null) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return new URL(trimmed).toString();
}

function leaseById(state: AppState, leaseId: string): Lease | undefined {
  return state.leases.find((lease) => lease.id === leaseId);
}

function withLease(state: AppState, leaseId: string, update: (lease: Lease) => Lease): AppState {
  return {
    ...state,
    leases: state.leases.map((lease) => (lease.id === leaseId ? update(lease) : lease)),
  };
}

export function validateResourceDraft(draft: ResourceDraft): string[] {
  const errors: string[] = [];
  if (!draft.name.trim() || draft.name.trim().length > 80) errors.push("Name the resource in 80 characters or fewer.");
  if (!draft.summary.trim() || draft.summary.trim().length > 240) errors.push("Add a short summary, 240 characters or fewer.");
  if (!draft.region.trim()) errors.push("Name a region.");
  if (!NETWORKS.includes(draft.network)) errors.push("Choose a supported network.");
  if (!["available", "limited", "unavailable"].includes(draft.availability)) errors.push("Choose an availability.");
  if (!Number.isInteger(draft.pricePerThousandMicro) || draft.pricePerThousandMicro < 1000) {
    errors.push("Price must be at least $0.001 per 1,000 requests.");
  }
  if (!Number.isInteger(draft.requestRateLimit) || draft.requestRateLimit < 1 || draft.requestRateLimit > 100_000) {
    errors.push("Request rate must be between 1 and 100,000 per minute.");
  }
  if (!Number.isInteger(draft.maxLeaseDurationMs) || draft.maxLeaseDurationMs < MIN_DURATION_MS || draft.maxLeaseDurationMs > 30 * 24 * 60 * 60 * 1000) {
    errors.push("Maximum duration must be between 15 seconds and 30 days.");
  }
  if (!Number.isInteger(draft.capacityRequests) || draft.capacityRequests < 1) errors.push("Capacity must be a positive integer.");
  const endpointError = endpointProblem(draft.endpointUrl);
  if (endpointError) errors.push(endpointError);
  if (draft.supportedMethods.length === 0) errors.push("Offer at least one RPC method.");
  const unknown = draft.supportedMethods.filter((method) => !RPC_METHODS.includes(method));
  if (unknown.length > 0) errors.push(`Unknown methods: ${unknown.join(", ")}.`);
  if (new Set(draft.supportedMethods).size !== draft.supportedMethods.length) errors.push("Methods must be unique.");
  return errors;
}

export function validateLeaseRequest(state: AppState, input: LeaseRequestInput, now: number): string[] {
  const errors: string[] = [];
  const agent = state.agents.find((item) => item.id === input.agentId);
  if (!agent) errors.push("Select a registered agent.");
  else if (agent.status !== "active") errors.push("That agent is disabled and cannot request a lease.");

  const resource = state.resources.find((item) => item.id === input.resourceId);
  if (!resource) errors.push("Select an RPC resource.");
  else {
    if (resource.kind !== "rpc") errors.push("Only RPC resources can be leased in this version.");
    if (resource.availability === "unavailable") errors.push("This resource is unavailable.");
    const provider = state.providers.find((item) => item.id === resource.providerId);
    if (!provider) errors.push("The resource has no provider.");
    else if (provider.status !== "active") errors.push("The provider is disabled and cannot take new leases.");

    if (!Number.isInteger(input.durationMs) || input.durationMs < MIN_DURATION_MS) {
      errors.push("Duration must be at least 15 seconds.");
    } else if (input.durationMs > resource.maxLeaseDurationMs) {
      errors.push("Duration exceeds the provider maximum for this resource.");
    }

    if (input.permittedMethods.length === 0) errors.push("Choose at least one RPC method.");
    const unsupported = input.permittedMethods.filter((method) => !resource.supportedMethods.includes(method));
    if (unsupported.length > 0) errors.push(`Unsupported methods: ${unsupported.join(", ")}.`);
    const unknown = input.permittedMethods.filter((method) => !RPC_METHODS.includes(method));
    if (unknown.length > 0) errors.push(`Unknown methods: ${unknown.join(", ")}.`);
    if (new Set(input.permittedMethods).size !== input.permittedMethods.length) errors.push("Methods must be unique.");

    if (!Number.isInteger(input.maxRequestRate) || input.maxRequestRate < 1) errors.push("Request rate must be a positive integer.");
    else if (input.maxRequestRate > resource.requestRateLimit) {
      errors.push(`Request rate exceeds the endpoint limit of ${resource.requestRateLimit} per minute.`);
    }

    if (!Number.isInteger(input.maxRequests) || input.maxRequests < 1) errors.push("Usage allowance must be a positive integer.");
    else if (input.maxRequests > resource.capacityRequests) {
      errors.push(`Allowance exceeds advertised capacity of ${resource.capacityRequests.toLocaleString("en-US")} requests.`);
    }

    if (!Number.isInteger(input.spendingCapMicro) || input.spendingCapMicro < 1) errors.push("Spending cap must be a positive amount.");
    else if (Number.isInteger(input.maxRequests) && input.maxRequests >= 1) {
      const one = costForRequests(1, resource.pricing.pricePerThousandMicro);
      if (input.spendingCapMicro < one) errors.push("Spending cap is below the cost of a single request.");
    }
  }

  const task = input.task.trim();
  if (!task) errors.push("Describe the task this lease is for.");
  else if (task.length > 280) errors.push("Task description must be 280 characters or fewer.");

  if (!Number.isFinite(input.startAt)) errors.push("Start time is invalid.");
  else if (input.startAt < now - 60_000) errors.push("Start time cannot be more than a minute in the past.");

  return errors;
}

export function requestLease(state: AppState, input: LeaseRequestInput, now: number): MutationResult {
  const errors = validateLeaseRequest(state, input, now);
  if (errors.length > 0) return fail(state, errors);
  const resource = state.resources.find((item) => item.id === input.resourceId)!;
  const id = nextId("lse");
  const permittedMethods = sortMethods(input.permittedMethods);
  const lease: Lease = {
    id,
    status: "requested",
    agentId: input.agentId,
    providerId: resource.providerId,
    resourceId: resource.id,
    network: resource.network,
    task: input.task.trim(),
    startAt: input.startAt,
    durationMs: input.durationMs,
    expiresAt: input.startAt + input.durationMs,
    maxRequests: input.maxRequests,
    spendingCapMicro: input.spendingCapMicro,
    maxRequestRate: input.maxRequestRate,
    permittedMethods,
    pricing: { ...resource.pricing },
    createdAt: now,
    usage: { requests: 0, costMicro: 0 },
    rateLog: [],
    timeline: [{ at: now, status: "requested", note: "Request submitted. Waiting for the provider." }],
  };
  let next: AppState = { ...state, leases: [...state.leases, lease] };
  next = appendAudit(next, {
    timestamp: now,
    type: "lease.requested",
    agentId: lease.agentId,
    providerId: lease.providerId,
    leaseId: lease.id,
    resourceId: lease.resourceId,
    network: lease.network,
    details: {
      task: lease.task,
      maxRequests: lease.maxRequests,
      spendingCapMicro: lease.spendingCapMicro,
      durationMs: lease.durationMs,
    },
  });
  return ok(next, { leaseId: id });
}

export function rejectLease(state: AppState, leaseId: string, providerId: string, reason: string, now: number): MutationResult {
  const lease = leaseById(state, leaseId);
  if (!lease) return fail(state, ["No lease matches that identifier."]);
  if (lease.providerId !== providerId) return fail(state, ["Only the offering provider can reject this request."]);
  if (lease.status !== "requested") return fail(state, ["Only a pending request can be rejected."]);
  const trimmed = reason.trim();
  if (trimmed.length < 3) return fail(state, ["Record a reason for the rejection."]);
  if (trimmed.length > 400) return fail(state, ["Keep the reason under 400 characters."]);
  let next = withLease(state, leaseId, (current) => ({
    ...current,
    status: "rejected",
    rejectedAt: now,
    rejectionReason: trimmed,
    timeline: [...current.timeline, { at: now, status: "rejected", note: trimmed }],
  }));
  next = appendAudit(next, {
    timestamp: now,
    type: "lease.rejected",
    agentId: lease.agentId,
    providerId: lease.providerId,
    leaseId: lease.id,
    resourceId: lease.resourceId,
    network: lease.network,
    details: { reason: trimmed },
  });
  return ok(next, { leaseId });
}

function payloadFromLease(lease: Lease, version: number, createdAt: number): AgreementPayload {
  return {
    agreementVersion: version,
    leaseId: lease.id,
    agentId: lease.agentId,
    providerId: lease.providerId,
    resourceId: lease.resourceId,
    network: lease.network,
    startAt: lease.startAt,
    expiresAt: lease.expiresAt,
    usageAllowance: lease.maxRequests,
    spendingCapMicro: lease.spendingCapMicro,
    requestRatePerMinute: lease.maxRequestRate,
    permittedMethods: sortMethods(lease.permittedMethods),
    pricingModel: lease.pricing.model,
    pricePerThousandMicro: lease.pricing.pricePerThousandMicro,
    revocationConditions: [...REVOCATION_CONDITIONS],
    createdAt,
  };
}

export async function approveLease(state: AppState, leaseId: string, providerId: string, now: number): Promise<MutationResult> {
  const lease = leaseById(state, leaseId);
  if (!lease) return fail(state, ["No lease matches that identifier."]);
  if (lease.providerId !== providerId) return fail(state, ["Only the offering provider can approve this request."]);
  if (lease.status !== "requested") return fail(state, ["Only a pending request can be approved."]);
  if (now >= lease.expiresAt) return fail(state, ["The requested window has already ended."]);
  const provider = state.providers.find((item) => item.id === providerId);
  if (!provider || provider.status !== "active") return fail(state, ["The provider is disabled and cannot sign agreements."]);
  const privateJwk = state.keystore[providerId];
  if (!privateJwk) return fail(state, ["This provider has no signing key in the simulation keystore."]);

  const payload = payloadFromLease(lease, 1, now);
  const agreement = await signAgreement({
    privateJwk,
    publicJwk: provider.publicKeyJwk,
    signerId: provider.id,
    payload,
    signedAt: now,
  });
  let next = withLease(state, leaseId, (current) => ({
    ...current,
    status: "approved",
    approvedAt: now,
    agreement,
    timeline: [...current.timeline, { at: now, status: "approved", note: "Provider signed agreement version 1." }],
  }));
  next = appendAudit(next, {
    timestamp: now,
    type: "agreement.signed",
    agentId: lease.agentId,
    providerId: lease.providerId,
    leaseId: lease.id,
    resourceId: lease.resourceId,
    network: lease.network,
    details: {
      agreementVersion: 1,
      hashHex: agreement.hashHex,
      signerId: provider.id,
    },
  });
  next = appendAudit(next, {
    timestamp: now,
    type: "lease.approved",
    agentId: lease.agentId,
    providerId: lease.providerId,
    leaseId: lease.id,
    resourceId: lease.resourceId,
    network: lease.network,
    details: { hashHex: agreement.hashHex },
  });
  next = reconcile(next, now);
  return ok(next, { leaseId });
}

export async function reissueAgreement(
  state: AppState,
  leaseId: string,
  patch: Partial<Pick<Lease, "maxRequests" | "spendingCapMicro" | "maxRequestRate" | "permittedMethods">>,
  now: number,
): Promise<MutationResult> {
  const lease = leaseById(state, leaseId);
  if (!lease) return fail(state, ["No lease matches that identifier."]);
  if (lease.status !== "approved" && lease.status !== "active") {
    return fail(state, ["Only an approved or active lease can take a new agreement version."]);
  }
  const provider = state.providers.find((item) => item.id === lease.providerId);
  const privateJwk = state.keystore[lease.providerId];
  if (!provider || !privateJwk) return fail(state, ["The provider signing key is unavailable."]);
  const revised: Lease = {
    ...lease,
    ...patch,
    permittedMethods: patch.permittedMethods ? sortMethods(patch.permittedMethods) : lease.permittedMethods,
  };
  const version = (lease.agreement?.payload.agreementVersion ?? 0) + 1;
  const agreement = await signAgreement({
    privateJwk,
    publicJwk: provider.publicKeyJwk,
    signerId: provider.id,
    payload: payloadFromLease(revised, version, now),
    signedAt: now,
  });
  let next = withLease(state, leaseId, () => ({
    ...revised,
    agreement,
    timeline: [...revised.timeline, { at: now, status: revised.status, note: `Agreement replaced with version ${version}.` }],
  }));
  next = appendAudit(next, {
    timestamp: now,
    type: "agreement.signed",
    agentId: lease.agentId,
    providerId: lease.providerId,
    leaseId: lease.id,
    resourceId: lease.resourceId,
    network: lease.network,
    details: { agreementVersion: version, hashHex: agreement.hashHex, signerId: provider.id },
  });
  return ok(next, { leaseId });
}

export function revokeLease(state: AppState, leaseId: string, reason: string, now: number): MutationResult {
  const lease = leaseById(state, leaseId);
  if (!lease) return fail(state, ["No lease matches that identifier."]);
  if (lease.status !== "active" && lease.status !== "approved") return fail(state, ["Only an approved or active lease can be revoked."]);
  const trimmed = reason.trim();
  if (trimmed.length < 3) return fail(state, ["Record a reason for the revocation."]);
  if (trimmed.length > 400) return fail(state, ["Keep the reason under 400 characters."]);
  const hadCredential = lease.credential?.status === "valid";
  const credential = invalidateCredential(lease.credential, "Lease revoked.", now);
  let next = withLease(state, leaseId, (current) => ({
    ...current,
    status: "revoked",
    revokedAt: now,
    revocationReason: trimmed,
    credential,
    timeline: [...current.timeline, { at: now, status: "revoked", note: trimmed }],
  }));
  next = appendAudit(next, {
    timestamp: now,
    type: "lease.revoked",
    agentId: lease.agentId,
    providerId: lease.providerId,
    leaseId: lease.id,
    resourceId: lease.resourceId,
    network: lease.network,
    details: { reason: trimmed },
  });
  if (hadCredential && lease.credential) {
    next = appendAudit(next, {
      timestamp: now,
      type: "credential.invalidated",
      agentId: lease.agentId,
      providerId: lease.providerId,
      leaseId: lease.id,
      resourceId: lease.resourceId,
      network: lease.network,
      details: { credentialId: lease.credential.id, reason: "Lease revoked." },
    });
  }
  return ok(next, { leaseId });
}

function usageIdentity(
  lease: Lease | undefined,
  input: RpcInput,
  now: number,
  outcome: "accepted" | "denied",
  costMicro: number,
  reason?: string,
  execution?: UsageEvent["execution"],
  latencyMs?: number,
): UsageEvent | undefined {
  if (!lease) return undefined;
  return {
    id: nextId("use"),
    leaseId: lease.id,
    agentId: lease.agentId,
    providerId: lease.providerId,
    resourceId: lease.resourceId,
    network: lease.network,
    method: input.method,
    requestCount: input.requestCount,
    unitPriceMicroPerThousand: lease.pricing.pricePerThousandMicro,
    costMicro,
    timestamp: now,
    outcome,
    ...(reason ? { reason } : {}),
    ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
    ...(execution ? { execution } : {}),
    ...(latencyMs !== undefined ? { latencyMs } : {}),
  };
}

function denyRpc(
  state: AppState,
  input: RpcInput,
  reason: string,
  now: number,
  execution?: UsageEvent["execution"],
  latencyMs?: number,
): { state: AppState; result: RpcResult } {
  const lease = leaseById(state, input.leaseId);
  const event = usageIdentity(lease, input, now, "denied", 0, reason, execution, latencyMs);
  let next = state;
  if (event) next = { ...next, usageEvents: [...next.usageEvents, event] };
  next = appendAudit(next, {
    timestamp: now,
    type: "rpc.denied",
    ...(lease
      ? {
          agentId: lease.agentId,
          providerId: lease.providerId,
          leaseId: lease.id,
          resourceId: lease.resourceId,
          network: lease.network,
        }
      : { leaseId: input.leaseId, agentId: input.agentId }),
    details: {
      method: input.method,
      requestCount: input.requestCount,
      reason,
      ...(execution ? { execution } : {}),
      ...(latencyMs !== undefined ? { latencyMs } : {}),
      ...(lease?.credential ? { credentialId: lease.credential.id } : {}),
    },
  });
  return {
    state: next,
    result: {
      ok: false,
      reason,
      costMicro: 0,
      requestCount: input.requestCount,
      replayed: false,
      usageEventId: event?.id,
    },
  };
}

function replayNote(execution: UsageEvent["execution"]): string {
  if (execution === "provider") return "Replayed a recorded acceptance. The endpoint was not called again.";
  if (execution === "example") return "Replayed an example acceptance. Nothing was sent.";
  return "Replayed a recorded result. Nothing was sent again.";
}

export async function submitRpc(
  state: AppState,
  input: RpcInput,
  now: number,
  executor: RpcExecutor = unavailableExecutor,
): Promise<{ state: AppState; result: RpcResult }> {
  const reconciled = reconcile(state, now);
  if (input.idempotencyKey) {
    const prior = reconciled.usageEvents.find(
      (event) => event.leaseId === input.leaseId && event.idempotencyKey === input.idempotencyKey,
    );
    if (prior) {
      const response: RpcResponseBody | undefined =
        prior.outcome === "accepted"
          ? {
              execution: prior.execution ?? "unavailable",
              requestCount: prior.requestCount,
              ...(prior.latencyMs !== undefined ? { latencyMs: prior.latencyMs } : {}),
              note: replayNote(prior.execution),
            }
          : undefined;
      return {
        state: reconciled,
        result: {
          ok: prior.outcome === "accepted",
          reason: prior.reason,
          response,
          costMicro: prior.costMicro,
          requestCount: prior.requestCount,
          replayed: true,
          usageEventId: prior.id,
        },
      };
    }
  }

  if (input.params !== undefined && !Array.isArray(input.params) && (typeof input.params !== "object" || input.params === null)) {
    return denyRpc(reconciled, input, "Params must be a JSON array or object.", now);
  }

  const decision = evaluatePolicy(reconciled, input, now);
  if (!decision.ok) return denyRpc(reconciled, input, decision.reason, now);

  const lease = leaseById(reconciled, input.leaseId)!;
  const provider = reconciled.providers.find((item) => item.id === lease.providerId)!;
  const resource = reconciled.resources.find((item) => item.id === lease.resourceId);
  if (!lease.agreement || !samePublicKey(lease.agreement.publicKeyJwk, provider.publicKeyJwk) || lease.agreement.signerId !== provider.id) {
    return denyRpc(reconciled, input, "The signer does not match the provider's registered key.", now);
  }
  if (!leaseTermsMatchAgreement(lease) || !(await verifyAgreement(lease.agreement))) {
    return denyRpc(reconciled, input, "Signature verification failed. Access is refused.", now);
  }

  const execution = await executor({
    endpointUrl: resource?.endpointUrl,
    network: lease.network,
    method: input.method,
    requestCount: input.requestCount,
    params: input.params ?? [],
    now,
    origin: reconciled.origin,
  });
  if (!execution.ok) {
    return denyRpc(
      reconciled,
      input,
      execution.reason ?? "The request was not completed. Nothing was charged.",
      now,
      execution.execution,
      execution.latencyMs,
    );
  }

  const response: RpcResponseBody = {
    execution: execution.execution,
    requestCount: input.requestCount,
    ...(execution.latencyMs !== undefined ? { latencyMs: execution.latencyMs } : {}),
    ...(execution.body !== undefined ? { body: execution.body } : {}),
    note: execution.note ?? (execution.execution === "provider" ? "Forwarded to the configured endpoint." : "Recorded without a network call."),
  };
  const event = usageIdentity(lease, input, now, "accepted", decision.costMicro, undefined, execution.execution, execution.latencyMs)!;
  const cutoff = now - 60_000;
  let next = withLease(reconciled, lease.id, (current) => ({
    ...current,
    usage: {
      requests: current.usage.requests + input.requestCount,
      costMicro: current.usage.costMicro + decision.costMicro,
    },
    rateLog: [...current.rateLog.filter((sample) => sample.at > cutoff), { at: now, count: input.requestCount }],
  }));
  next = { ...next, usageEvents: [...next.usageEvents, event] };
  next = appendAudit(next, {
    timestamp: now,
    type: "rpc.accepted",
    agentId: lease.agentId,
    providerId: lease.providerId,
    leaseId: lease.id,
    resourceId: lease.resourceId,
    network: lease.network,
    details: {
      method: input.method,
      requestCount: input.requestCount,
      costMicro: decision.costMicro,
      credentialId: lease.credential?.id ?? null,
      execution: execution.execution,
      ...(execution.latencyMs !== undefined ? { latencyMs: execution.latencyMs } : {}),
    },
  });
  next = reconcile(next, now);
  return {
    state: next,
    result: {
      ok: true,
      response,
      costMicro: decision.costMicro,
      requestCount: input.requestCount,
      replayed: false,
      usageEventId: event.id,
    },
  };
}

export async function recordVerification(state: AppState, leaseId: string, now: number): Promise<MutationResult> {
  const lease = leaseById(state, leaseId);
  if (!lease?.agreement) return fail(state, ["This lease has no signed agreement."]);
  const verified = await verifyAgreement(lease.agreement);
  const matches = leaseTermsMatchAgreement(lease);
  const provider = state.providers.find((item) => item.id === lease.providerId);
  const signerOk = Boolean(
    provider && lease.agreement.signerId === provider.id && samePublicKey(lease.agreement.publicKeyJwk, provider.publicKeyJwk),
  );
  const passed = verified && matches && signerOk;
  const next = appendAudit(state, {
    timestamp: now,
    type: "agreement.verified",
    agentId: lease.agentId,
    providerId: lease.providerId,
    leaseId: lease.id,
    resourceId: lease.resourceId,
    network: lease.network,
    details: {
      passed,
      hashHex: lease.agreement.hashHex,
      agreementVersion: lease.agreement.payload.agreementVersion,
    },
  });
  return passed ? ok(next, { leaseId }) : fail(next, ["Signature verification failed."]);
}

function acceptedTotals(state: AppState, leaseId: string): { costMicro: number; requests: number } {
  return state.usageEvents.reduce(
    (sum, event) => {
      if (event.leaseId !== leaseId || event.outcome !== "accepted") return sum;
      return { costMicro: sum.costMicro + event.costMicro, requests: sum.requests + event.requestCount };
    },
    { costMicro: 0, requests: 0 },
  );
}

export function previewSettlement(
  state: AppState,
  leaseId: string,
  now: number,
  adapter: SettlementAdapter = simulatedSettlement,
): MutationResult {
  const lease = leaseById(state, leaseId);
  if (!lease) return fail(state, ["No lease matches that identifier."]);
  const existing = state.settlements.find((item) => item.leaseId === leaseId);
  if (existing?.status === "settled") return fail(state, ["This lease already has a simulated settlement."]);
  const totals = acceptedTotals(state, leaseId);
  const preview = adapter.preview({
    leaseId,
    acceptedCostMicro: totals.costMicro,
    acceptedRequests: totals.requests,
    now,
  });
  const record = { ...preview, id: existing?.id ?? nextId("stl") };
  const settlements = existing
    ? state.settlements.map((item) => (item.leaseId === leaseId ? record : item))
    : [...state.settlements, record];
  let next: AppState = { ...state, settlements };
  next = appendAudit(next, {
    timestamp: now,
    type: "settlement.preview",
    agentId: lease.agentId,
    providerId: lease.providerId,
    leaseId: lease.id,
    resourceId: lease.resourceId,
    network: lease.network,
    details: {
      amountDueMicro: record.amountDueMicro,
      acceptedRequests: record.acceptedRequests,
      adapter: adapter.id,
    },
  });
  return ok(next, { leaseId });
}

export function settleLease(
  state: AppState,
  leaseId: string,
  now: number,
  adapter: SettlementAdapter = simulatedSettlement,
): MutationResult {
  const previewed = previewSettlement(state, leaseId, now, adapter);
  if (previewed.errors.length > 0) return previewed;
  const lease = leaseById(previewed.state, leaseId)!;
  const current = previewed.state.settlements.find((item) => item.leaseId === leaseId)!;
  const settled = adapter.settle(current, now);
  let next: AppState = {
    ...previewed.state,
    settlements: previewed.state.settlements.map((item) => (item.leaseId === leaseId ? settled : item)),
  };
  next = appendAudit(next, {
    timestamp: now,
    type: "settlement.settled",
    agentId: lease.agentId,
    providerId: lease.providerId,
    leaseId: lease.id,
    resourceId: lease.resourceId,
    network: lease.network,
    details: {
      amountDueMicro: settled.amountDueMicro,
      acceptedRequests: settled.acceptedRequests,
      adapter: adapter.id,
    },
  });
  return ok(next, { leaseId });
}

export function registerAgent(state: AppState, name: string, mandate: string, now: number, ownerId = "local"): MutationResult {
  const trimmed = name.trim();
  const desk = mandate.trim();
  if (!trimmed || trimmed.length > 60) return fail(state, ["Name the agent in 60 characters or fewer."]);
  if (!desk || desk.length > 180) return fail(state, ["Describe the mandate in 180 characters or fewer."]);
  if (!ownerId) return fail(state, ["An owner is required."]);
  const agent: Agent = {
    id: nextId("agt"),
    name: trimmed,
    mandate: desk,
    status: "active",
    ownerId,
    createdAt: now,
  };
  let next: AppState = { ...state, agents: [...state.agents, agent] };
  next = appendAudit(next, {
    timestamp: now,
    type: "agent.registered",
    agentId: agent.id,
    details: { name: agent.name },
  });
  return ok(next, { agentId: agent.id });
}

export function setAgentStatus(state: AppState, agentId: string, status: "active" | "disabled", now: number): MutationResult {
  const agent = state.agents.find((item) => item.id === agentId);
  if (!agent) return fail(state, ["No agent matches that identifier."]);
  if (agent.status === status) return ok(state);
  let next: AppState = {
    ...state,
    agents: state.agents.map((item) => (item.id === agentId ? { ...item, status } : item)),
  };
  next = appendAudit(next, {
    timestamp: now,
    type: "agent.status_changed",
    agentId,
    details: { status },
  });
  return ok(next);
}

export function setProviderStatus(state: AppState, providerId: string, status: "active" | "disabled", now: number): MutationResult {
  const provider = state.providers.find((item) => item.id === providerId);
  if (!provider) return fail(state, ["No provider matches that identifier."]);
  if (provider.status === status) return ok(state);
  let next: AppState = {
    ...state,
    providers: state.providers.map((item) => (item.id === providerId ? { ...item, status } : item)),
  };
  next = appendAudit(next, {
    timestamp: now,
    type: "provider.status_changed",
    providerId,
    details: { status },
  });
  return ok(next);
}

export function publishResource(state: AppState, providerId: string, draft: ResourceDraft, now: number): MutationResult {
  const provider = state.providers.find((item) => item.id === providerId);
  if (!provider) return fail(state, ["No provider matches that identifier."]);
  if (provider.status !== "active") return fail(state, ["A disabled provider cannot publish offers."]);
  const errors = validateResourceDraft(draft);
  if (errors.length > 0) return fail(state, errors);
  const resource: Resource = {
    id: nextId("res"),
    name: draft.name.trim(),
    providerId,
    kind: "rpc",
    network: draft.network,
    summary: draft.summary.trim(),
    availability: draft.availability,
    region: draft.region.trim(),
    pricing: { model: "per_thousand_requests", pricePerThousandMicro: draft.pricePerThousandMicro },
    requestRateLimit: draft.requestRateLimit,
    maxLeaseDurationMs: draft.maxLeaseDurationMs,
    supportedMethods: sortMethods(draft.supportedMethods),
    capacityRequests: draft.capacityRequests,
    endpointConfigured: Boolean(normalizeEndpoint(draft.endpointUrl)),
    ...(normalizeEndpoint(draft.endpointUrl) ? { endpointUrl: normalizeEndpoint(draft.endpointUrl) } : {}),
  };
  let next: AppState = { ...state, resources: [...state.resources, resource] };
  next = appendAudit(next, {
    timestamp: now,
    type: "resource.published",
    providerId,
    resourceId: resource.id,
    network: resource.network,
    details: {
      name: resource.name,
      pricePerThousandMicro: resource.pricing.pricePerThousandMicro,
      endpointConfigured: resource.endpointConfigured,
    },
  });
  return ok(next, { resourceId: resource.id });
}

export function updateResource(state: AppState, resourceId: string, draft: ResourceDraft, now: number): MutationResult {
  const resource = state.resources.find((item) => item.id === resourceId);
  if (!resource) return fail(state, ["No resource matches that identifier."]);
  const errors = validateResourceDraft(draft);
  if (errors.length > 0) return fail(state, errors);
  if (draft.network !== resource.network) return fail(state, ["Network stays fixed after publication."]);
  let endpointUrl = resource.endpointUrl;
  if (draft.endpointUrl === null || draft.endpointUrl === "") endpointUrl = undefined;
  else if (typeof draft.endpointUrl === "string") endpointUrl = normalizeEndpoint(draft.endpointUrl);
  const updated: Resource = {
    ...resource,
    name: draft.name.trim(),
    summary: draft.summary.trim(),
    availability: draft.availability as Availability,
    region: draft.region.trim(),
    pricing: { model: "per_thousand_requests", pricePerThousandMicro: draft.pricePerThousandMicro },
    requestRateLimit: draft.requestRateLimit,
    maxLeaseDurationMs: draft.maxLeaseDurationMs,
    supportedMethods: sortMethods(draft.supportedMethods),
    capacityRequests: draft.capacityRequests,
    endpointConfigured: Boolean(endpointUrl),
  };
  if (endpointUrl) updated.endpointUrl = endpointUrl;
  else delete updated.endpointUrl;
  let next: AppState = {
    ...state,
    resources: state.resources.map((item) => (item.id === resourceId ? updated : item)),
  };
  next = appendAudit(next, {
    timestamp: now,
    type: "resource.updated",
    providerId: resource.providerId,
    resourceId,
    network: resource.network,
    details: {
      pricePerThousandMicro: updated.pricing.pricePerThousandMicro,
      availability: updated.availability,
      endpointConfigured: updated.endpointConfigured,
    },
  });
  return ok(next, { resourceId });
}

export function emptyState(now: number): AppState {
  return {
    version: 1,
    origin: "record",
    seededAt: now,
    agents: [],
    providers: [],
    resources: [],
    leases: [],
    usageEvents: [],
    audit: [],
    settlements: [],
    keystore: {},
  };
}

export async function addProvider(
  state: AppState,
  input: Omit<Provider, "publicKeyJwk" | "createdAt"> & { createdAt?: number },
  privateJwk: JsonWebKey,
  publicJwk: JsonWebKey,
): Promise<AppState> {
  const provider: Provider = {
    id: input.id,
    name: input.name,
    desk: input.desk,
    status: input.status,
    ownerId: input.ownerId,
    publicKeyJwk: publicJwk,
    createdAt: input.createdAt ?? state.seededAt,
  };
  return {
    ...state,
    providers: [...state.providers, provider],
    keystore: { ...state.keystore, [provider.id]: privateJwk },
  };
}

export async function registerProvider(state: AppState, name: string, desk: string, now: number, ownerId: string): Promise<MutationResult> {
  const trimmed = name.trim();
  const about = desk.trim();
  if (!trimmed || trimmed.length > 60) return fail(state, ["Name the provider in 60 characters or fewer."]);
  if (!about || about.length > 180) return fail(state, ["Describe the desk in 180 characters or fewer."]);
  if (!ownerId) return fail(state, ["An owner is required."]);
  const keys = await generateSigningKey();
  const id = nextId("prv");
  let next = await addProvider(
    state,
    { id, name: trimmed, desk: about, status: "active", ownerId, createdAt: now },
    keys.privateJwk,
    keys.publicJwk,
  );
  next = appendAudit(next, {
    timestamp: now,
    type: "provider.registered",
    providerId: id,
    details: { name: trimmed },
  });
  return ok(next, { providerId: id });
}

export { reconcile };
