import { describe, expect, it } from "vitest";
import { verifyAuditChain } from "./audit.ts";
import { agreementCanonical } from "./canonical.ts";
import { generateSigningKey, signAgreement, verifyAgreement } from "./crypto.ts";
import {
  approveLease,
  emptyState,
  previewSettlement,
  publishResource,
  reconcile,
  registerAgent,
  rejectLease,
  reissueAgreement,
  requestLease,
  revokeLease,
  setAgentStatus,
  setProviderStatus,
  settleLease,
  submitRpc as submitRpcEngine,
  updateResource,
} from "./engine.ts";
import { toPublicState } from "./publicState.ts";
import { exampleExecutor, simulatedExecutor } from "./rpc.ts";
import { sha256Hex } from "./hash.ts";
import { costForRequests, formatUsd, parseUsdToMicro } from "./money.ts";
import { createSeedState } from "./seed.ts";
import { metrics, providerRevenueMicro } from "./selectors.ts";
import { loadState, saveState, type KeyValueStore } from "./storage.ts";
import { RPC_METHODS, type Agent, type AppState, type LeaseRequestInput, type Provider, type Resource, type RpcInput, type RpcMethod } from "./types.ts";

function submitRpc(state: AppState, input: RpcInput, now: number) {
  return submitRpcEngine(state, input, now, exampleExecutor);
}

const NOW = 1_700_000_000_000;
const HOUR = 60 * 60 * 1000;

function memoryStore(): KeyValueStore & { dump: () => string | null } {
  let raw: string | null = null;
  return {
    getItem: () => raw,
    setItem: (_key, value) => {
      raw = value;
    },
    removeItem: () => {
      raw = null;
    },
    dump: () => raw,
  };
}

async function world(methods: RpcMethod[] = [...RPC_METHODS]) {
  const keys = await generateSigningKey();
  const provider: Provider = {
    id: "prv_test",
    name: "Test Relay",
    desk: "Fixture",
    status: "active",
    ownerId: "acct_test",
    publicKeyJwk: keys.publicJwk,
    createdAt: NOW,
  };
  const agent: Agent = {
    id: "agt_test",
    name: "Test Desk",
    mandate: "Fixture",
    status: "active",
    ownerId: "acct_test",
    createdAt: NOW,
  };
  const resource: Resource = {
    id: "res_test",
    name: "Test Ethereum",
    providerId: provider.id,
    kind: "rpc",
    network: "ethereum",
    summary: "Fixture endpoint",
    availability: "available",
    region: "Lisbon",
    pricing: { model: "per_thousand_requests", pricePerThousandMicro: 200_000 },
    requestRateLimit: 100_000,
    maxLeaseDurationMs: 24 * HOUR,
    supportedMethods: methods,
    capacityRequests: 1_000_000,
    endpointConfigured: false,
  };
  const state: AppState = {
    ...emptyState(NOW),
    agents: [agent],
    providers: [provider],
    resources: [resource],
    keystore: { [provider.id]: keys.privateJwk },
  };
  return { state, provider, agent, resource, privateJwk: keys.privateJwk, publicJwk: keys.publicJwk };
}

function requestInput(overrides: Partial<LeaseRequestInput> = {}): LeaseRequestInput {
  return {
    agentId: "agt_test",
    resourceId: "res_test",
    task: "Watch blocks",
    startAt: NOW,
    durationMs: HOUR,
    maxRequests: 1_000,
    spendingCapMicro: costForRequests(1_000, 200_000),
    maxRequestRate: 10_000,
    permittedMethods: [...RPC_METHODS],
    ...overrides,
  };
}

async function activeLease(overrides: Partial<LeaseRequestInput> = {}, at = NOW) {
  const base = await world();
  const requested = requestLease(base.state, requestInput(overrides), at);
  expect(requested.errors).toEqual([]);
  const approved = await approveLease(requested.state, requested.leaseId!, base.provider.id, at);
  expect(approved.errors).toEqual([]);
  const lease = approved.state.leases[0]!;
  return { ...base, state: approved.state, leaseId: lease.id, secret: lease.credential!.secret };
}

describe("money", () => {
  it("prices 2,500 requests at $0.20 per thousand as $0.50", () => {
    expect(costForRequests(2_500, 200_000)).toBe(500_000);
    expect(formatUsd(500_000)).toBe("$0.50");
    expect(costForRequests(1, 200_000)).toBe(200);
  });

  it("parses dollar input without floating point drift", () => {
    expect(parseUsdToMicro("0.20")).toBe(200_000);
    expect(parseUsdToMicro("$2.48")).toBe(2_480_000);
    expect(parseUsdToMicro("nope")).toBeNull();
  });
});

describe("agreements", () => {
  it("replaces a broken signing key, activates the lease, and issues a credential", async () => {
    const base = await world();
    const broken: AppState = {
      ...base.state,
      providers: base.state.providers.map((provider) =>
        provider.id === base.provider.id ? { ...provider, publicKeyJwk: { kty: "EC", crv: "P-256" } } : provider,
      ),
      keystore: { ...base.state.keystore, [base.provider.id]: { kty: "EC", crv: "P-256" } },
    };
    const requested = requestLease(broken, requestInput(), NOW);
    expect(requested.errors).toEqual([]);
    const approved = await approveLease(requested.state, requested.leaseId!, base.provider.id, NOW);
    expect(approved.errors).toEqual([]);
    const lease = approved.state.leases[0]!;
    expect(lease.status).toBe("active");
    expect(lease.credential?.status).toBe("valid");
    expect(lease.credential?.secret.startsWith("otl_")).toBe(true);
    expect(await verifyAgreement(lease.agreement)).toBe(true);
  });

  it("signs and verifies, then fails when a signed term changes", async () => {
    const opened = await activeLease();
    const agreement = opened.state.leases[0]!.agreement!;
    expect(await verifyAgreement(agreement)).toBe(true);

    const tampered = structuredClone(agreement);
    tampered.payload = { ...tampered.payload, usageAllowance: tampered.payload.usageAllowance - 1 };
    tampered.canonical = agreementCanonical(tampered.payload);
    tampered.hashHex = sha256Hex(tampered.canonical);
    expect(await verifyAgreement(tampered)).toBe(false);

    const reissued = await reissueAgreement(opened.state, opened.leaseId, { maxRequests: 2_000 }, NOW + 1_000);
    expect(reissued.errors).toEqual([]);
    const next = reissued.state.leases[0]!.agreement!;
    expect(next.payload.agreementVersion).toBe(2);
    expect(await verifyAgreement(next)).toBe(true);
    expect(next.hashHex).not.toBe(agreement.hashHex);
  });

  it("rejects a signature from a key that is not the provider's", async () => {
    const opened = await activeLease();
    const other = await generateSigningKey();
    const lease = opened.state.leases[0]!;
    const forged = await signAgreement({
      privateJwk: other.privateJwk,
      publicJwk: other.publicJwk,
      signerId: lease.providerId,
      payload: lease.agreement!.payload,
      signedAt: NOW,
    });
    const tampered = structuredClone(opened.state);
    tampered.leases[0] = { ...lease, agreement: forged };
    const before = tampered.leases[0].usage.requests;
    const result = await submitRpc(
      tampered,
      { leaseId: opened.leaseId, agentId: "agt_test", method: "eth_blockNumber", requestCount: 1, credentialSecret: opened.secret },
      NOW + 1_000,
    );
    expect(result.result.ok).toBe(false);
    expect(result.result.reason).toBe("The signer does not match the provider's registered key.");
    expect(result.state.leases[0]!.usage.requests).toBe(before);
    expect(result.state.leases[0]!.usage.costMicro).toBe(0);
  });
});

describe("lease lifecycle", () => {
  it("requests, rejects with a reason, and refuses an invalid request", async () => {
    const base = await world();
    const bad = requestLease(base.state, requestInput({ durationMs: 1_000, permittedMethods: ["eth_call"], task: "" }), NOW);
    expect(bad.errors.length).toBeGreaterThan(0);
    expect(bad.state.leases).toHaveLength(0);

    const unavailable = structuredClone(base.state);
    unavailable.resources[0] = { ...unavailable.resources[0]!, availability: "unavailable" };
    const blocked = requestLease(unavailable, requestInput(), NOW);
    expect(blocked.errors.join(" ")).toContain("unavailable");

    const requested = requestLease(base.state, requestInput(), NOW);
    const rejected = rejectLease(requested.state, requested.leaseId!, base.provider.id, "Capacity reserved for another desk.", NOW + 1);
    expect(rejected.state.leases[0]!.status).toBe("rejected");
    expect(rejected.state.leases[0]!.rejectionReason).toBe("Capacity reserved for another desk.");
    expect(rejected.state.audit.some((event) => event.type === "lease.rejected")).toBe(true);
  });

  it("stays approved until the start time, then activates with a credential", async () => {
    const base = await world();
    const requested = requestLease(base.state, requestInput({ startAt: NOW + 10_000, durationMs: HOUR }), NOW);
    const approved = await approveLease(requested.state, requested.leaseId!, base.provider.id, NOW);
    expect(approved.state.leases[0]!.status).toBe("approved");
    expect(approved.state.leases[0]!.credential).toBeUndefined();
    const early = await submitRpc(
      approved.state,
      { leaseId: requested.leaseId!, agentId: "agt_test", method: "eth_blockNumber", requestCount: 1, credentialSecret: "missing" },
      NOW + 1_000,
    );
    expect(early.result.reason).toBe("The lease has not reached its start time.");
    const started = reconcile(approved.state, NOW + 10_000);
    expect(started.leases[0]!.status).toBe("active");
    expect(started.leases[0]!.credential?.status).toBe("valid");
    const again = reconcile(started, NOW + 10_000);
    expect(again).toBe(started);
  });

  it("accepts a valid call and meters it exactly", async () => {
    const opened = await activeLease({ maxRequests: 10_000, spendingCapMicro: costForRequests(10_000, 200_000) });
    const result = await submitRpc(
      opened.state,
      { leaseId: opened.leaseId, agentId: "agt_test", method: "eth_blockNumber", requestCount: 2_500, credentialSecret: opened.secret },
      NOW + 1_000,
    );
    expect(result.result.ok).toBe(true);
    expect(result.result.response?.execution).toBe("example");
    expect(result.result.response?.note).toContain("Not sent");
    expect(result.result.costMicro).toBe(500_000);
    expect(result.state.leases[0]!.usage).toEqual({ requests: 2_500, costMicro: 500_000 });
    const event = result.state.usageEvents.at(-1)!;
    expect(event.outcome).toBe("accepted");
    expect(event.unitPriceMicroPerThousand).toBe(200_000);
    expect(event.method).toBe("eth_blockNumber");
  });

  it("denies an unauthorized method without changing consumption", async () => {
    const opened = await activeLease({ permittedMethods: ["eth_blockNumber", "eth_getBalance"], maxRequests: 100, spendingCapMicro: costForRequests(100, 200_000) });
    const before = structuredClone(opened.state.leases[0]!.usage);
    const result = await submitRpc(
      opened.state,
      { leaseId: opened.leaseId, agentId: "agt_test", method: "eth_call", requestCount: 4, credentialSecret: opened.secret },
      NOW + 1_000,
    );
    expect(result.result.ok).toBe(false);
    expect(result.result.reason).toBe("Method eth_call is not permitted by this lease.");
    expect(result.state.leases[0]!.usage).toEqual(before);
    expect(result.state.leases[0]!.rateLog).toEqual([]);
  });

  it("does not partially consume a rejected batch", async () => {
    const opened = await activeLease({ maxRequests: 100, spendingCapMicro: costForRequests(100, 200_000), maxRequestRate: 1_000 });
    const result = await submitRpc(
      opened.state,
      { leaseId: opened.leaseId, agentId: "agt_test", method: "eth_getBalance", requestCount: 250, credentialSecret: opened.secret },
      NOW + 1_000,
    );
    expect(result.result.reason).toContain("remaining allowance of 100");
    expect(result.state.leases[0]!.usage).toEqual({ requests: 0, costMicro: 0 });
    expect(result.state.leases[0]!.status).toBe("active");
  });

  it("enforces the spending cap exactly and leaves a too-large batch unpaid", async () => {
    const opened = await activeLease({ maxRequests: 100, spendingCapMicro: costForRequests(10, 200_000), maxRequestRate: 100 });
    const tooBig = await submitRpc(
      opened.state,
      { leaseId: opened.leaseId, agentId: "agt_test", method: "eth_blockNumber", requestCount: 11, credentialSecret: opened.secret },
      NOW + 1_000,
    );
    expect(tooBig.result.ok).toBe(false);
    expect(tooBig.result.reason).toContain("remaining budget");
    expect(tooBig.state.leases[0]!.usage.costMicro).toBe(0);
    const fit = await submitRpc(
      tooBig.state,
      { leaseId: opened.leaseId, agentId: "agt_test", method: "eth_blockNumber", requestCount: 10, credentialSecret: opened.secret },
      NOW + 2_000,
    );
    expect(fit.result.ok).toBe(true);
    expect(fit.result.costMicro).toBe(costForRequests(10, 200_000));
    expect(fit.state.leases[0]!.status).toBe("exhausted");
    expect(fit.state.leases[0]!.credential?.status).toBe("invalid");
  });

  it("enforces the request rate, then allows a later call", async () => {
    const opened = await activeLease({ maxRequestRate: 10, maxRequests: 100, spendingCapMicro: costForRequests(100, 200_000) });
    const first = await submitRpc(
      opened.state,
      { leaseId: opened.leaseId, agentId: "agt_test", method: "eth_blockNumber", requestCount: 10, credentialSecret: opened.secret },
      NOW + 1_000,
    );
    expect(first.result.ok).toBe(true);
    const second = await submitRpc(
      first.state,
      { leaseId: opened.leaseId, agentId: "agt_test", method: "eth_blockNumber", requestCount: 1, credentialSecret: opened.secret },
      NOW + 2_000,
    );
    expect(second.result.reason).toContain("above the lease limit of 10");
    expect(second.state.leases[0]!.usage.requests).toBe(10);
    const later = await submitRpc(
      second.state,
      { leaseId: opened.leaseId, agentId: "agt_test", method: "eth_blockNumber", requestCount: 1, credentialSecret: opened.secret },
      NOW + 62_000,
    );
    expect(later.result.ok).toBe(true);
    expect(later.state.leases[0]!.usage.requests).toBe(11);
  });

  it("denies expired, revoked, disabled agent, and disabled provider use", async () => {
    const opened = await activeLease({ durationMs: 30_000 });
    const expired = await submitRpc(
      opened.state,
      { leaseId: opened.leaseId, agentId: "agt_test", method: "eth_blockNumber", requestCount: 1, credentialSecret: opened.secret },
      NOW + 30_000,
    );
    expect(expired.result.reason).toBe("The lease expired.");
    expect(expired.state.leases[0]!.status).toBe("expired");
    expect(expired.state.leases[0]!.credential?.status).toBe("invalid");
    expect(expired.state.leases[0]!.usage.requests).toBe(0);

    const live = await activeLease();
    const revoked = revokeLease(live.state, live.leaseId, "Operator stopped the desk.", NOW + 1_000);
    const afterRevoke = await submitRpc(
      revoked.state,
      { leaseId: live.leaseId, agentId: "agt_test", method: "eth_blockNumber", requestCount: 1, credentialSecret: live.secret },
      NOW + 2_000,
    );
    expect(afterRevoke.result.reason).toContain("revoked");
    expect(afterRevoke.state.leases[0]!.usage.requests).toBe(0);
    expect(afterRevoke.state.leases[0]!.credential?.status).toBe("invalid");

    const agentOff = setAgentStatus(live.state, "agt_test", "disabled", NOW + 500);
    const agentDenied = await submitRpc(
      agentOff.state,
      { leaseId: live.leaseId, agentId: "agt_test", method: "eth_blockNumber", requestCount: 2, credentialSecret: live.secret },
      NOW + 1_000,
    );
    expect(agentDenied.result.reason).toBe("Agent is disabled. Access is refused.");
    expect(agentDenied.state.leases[0]!.usage).toEqual({ requests: 0, costMicro: 0 });

    const providerOff = setProviderStatus(live.state, "prv_test", "disabled", NOW + 500);
    const providerDenied = await submitRpc(
      providerOff.state,
      { leaseId: live.leaseId, agentId: "agt_test", method: "eth_blockNumber", requestCount: 2, credentialSecret: live.secret },
      NOW + 1_000,
    );
    expect(providerDenied.result.reason).toBe("Provider is disabled. Access is refused.");
    expect(providerDenied.state.leases[0]!.usage.requests).toBe(0);
  });

  it("rejects a bad credential and replays an idempotent key without double charging", async () => {
    const opened = await activeLease();
    const wrong = await submitRpc(
      opened.state,
      { leaseId: opened.leaseId, agentId: "agt_test", method: "eth_blockNumber", requestCount: 5, credentialSecret: "otl_sim_wrong" },
      NOW + 1_000,
    );
    expect(wrong.result.reason).toContain("does not match");
    expect(wrong.state.leases[0]!.usage.requests).toBe(0);

    const key = "idem-1";
    const first = await submitRpc(
      opened.state,
      { leaseId: opened.leaseId, agentId: "agt_test", method: "eth_call", requestCount: 4, credentialSecret: opened.secret, idempotencyKey: key },
      NOW + 1_000,
    );
    const second = await submitRpc(
      first.state,
      { leaseId: opened.leaseId, agentId: "agt_test", method: "eth_call", requestCount: 4, credentialSecret: opened.secret, idempotencyKey: key },
      NOW + 5_000,
    );
    expect(second.result.replayed).toBe(true);
    expect(second.state.leases[0]!.usage.requests).toBe(4);
    expect(second.state.usageEvents.filter((event) => event.idempotencyKey === key)).toHaveLength(1);
  });

  it("keeps a price change on the offer from rewriting a signed lease", async () => {
    const opened = await activeLease({ maxRequests: 10_000, spendingCapMicro: costForRequests(10_000, 200_000) });
    const resource = opened.state.resources[0]!;
    const updated = updateResource(
      opened.state,
      resource.id,
      {
        name: resource.name,
        summary: resource.summary,
        region: resource.region,
        network: resource.network,
        availability: resource.availability,
        pricePerThousandMicro: 900_000,
        requestRateLimit: resource.requestRateLimit,
        maxLeaseDurationMs: resource.maxLeaseDurationMs,
        supportedMethods: resource.supportedMethods,
        capacityRequests: resource.capacityRequests,
      },
      NOW + 500,
    );
    const result = await submitRpc(
      updated.state,
      { leaseId: opened.leaseId, agentId: "agt_test", method: "eth_blockNumber", requestCount: 2_500, credentialSecret: opened.secret },
      NOW + 1_000,
    );
    expect(result.result.costMicro).toBe(500_000);
  });

  it("settles only accepted usage and leaves access status untouched", async () => {
    const opened = await activeLease({ maxRequests: 10_000, spendingCapMicro: costForRequests(10_000, 200_000) });
    const accepted = await submitRpc(
      opened.state,
      { leaseId: opened.leaseId, agentId: "agt_test", method: "eth_blockNumber", requestCount: 2_500, credentialSecret: opened.secret },
      NOW + 1_000,
    );
    const denied = await submitRpc(
      accepted.state,
      { leaseId: opened.leaseId, agentId: "agt_test", method: "eth_call", requestCount: 9, credentialSecret: "nope" },
      NOW + 2_000,
    );
    const settled = settleLease(denied.state, opened.leaseId, NOW + 3_000);
    expect(settled.errors).toEqual([]);
    const record = settled.state.settlements[0]!;
    expect(record.status).toBe("settled");
    expect(record.amountDueMicro).toBe(500_000);
    expect(record.acceptedRequests).toBe(2_500);
    expect(record.adapter).toBe("simulated");
    expect(settled.state.leases[0]!.status).toBe("active");
    expect(settled.state.audit.some((event) => event.type === "settlement.settled")).toBe(true);
    const again = previewSettlement(settled.state, opened.leaseId, NOW + 4_000);
    expect(again.errors[0]).toContain("already");
  });

  it("writes a hash-chained audit log without credential secrets", async () => {
    const opened = await activeLease();
    const result = await submitRpc(
      opened.state,
      { leaseId: opened.leaseId, agentId: "agt_test", method: "eth_getBalance", requestCount: 3, credentialSecret: opened.secret },
      NOW + 1_000,
    );
    expect(verifyAuditChain(result.state.audit)).toBe(true);
    const secret = result.state.leases[0]!.credential!.secret;
    expect(secret.startsWith("otl_")).toBe(true);
    const publicLog = JSON.stringify({ audit: result.state.audit, usage: result.state.usageEvents });
    expect(publicLog.includes(secret)).toBe(false);
    expect(result.state.audit.some((event) => event.type === "credential.issued")).toBe(true);
    expect(result.state.audit.some((event) => event.type === "rpc.accepted")).toBe(true);
  });

  it("simulates a workspace call with no endpoint and meters the signed price", async () => {
    const opened = await activeLease({ maxRequests: 10_000, spendingCapMicro: costForRequests(10_000, 200_000) });
    const result = await submitRpcEngine(
      opened.state,
      {
        leaseId: opened.leaseId,
        agentId: "agt_test",
        method: "eth_blockNumber",
        requestCount: 2_500,
        credentialSecret: opened.secret,
        idempotencyKey: "sim-1",
      },
      NOW + 1_000,
      simulatedExecutor,
    );
    expect(result.result.ok).toBe(true);
    expect(result.result.costMicro).toBe(500_000);
    expect(result.result.response?.execution).toBe("simulated");
    expect(result.result.response?.note).toContain("Not sent");
    expect(result.state.leases[0]!.usage).toEqual({ requests: 2_500, costMicro: 500_000 });
    expect(result.state.audit.some((event) => event.type === "rpc.accepted" && event.details.execution === "simulated")).toBe(true);
    const replay = await submitRpcEngine(
      result.state,
      {
        leaseId: opened.leaseId,
        agentId: "agt_test",
        method: "eth_blockNumber",
        requestCount: 2_500,
        credentialSecret: opened.secret,
        idempotencyKey: "sim-1",
      },
      NOW + 2_000,
      simulatedExecutor,
    );
    expect(replay.result.replayed).toBe(true);
    expect(replay.result.response?.note).toContain("Nothing was sent again");
    expect(replay.state.leases[0]!.usage.requests).toBe(2_500);
  });

  it("refuses a call when the executor is unavailable and does not charge it", async () => {
    const opened = await activeLease();
    const before = opened.state.leases[0]!.usage;
    const result = await submitRpcEngine(
      opened.state,
      { leaseId: opened.leaseId, agentId: "agt_test", method: "eth_blockNumber", requestCount: 4, credentialSecret: opened.secret },
      NOW + 1_000,
    );
    expect(result.result.ok).toBe(false);
    expect(result.result.reason).toContain("no endpoint");
    expect(result.result.response).toBeUndefined();
    expect(result.state.leases[0]!.usage).toEqual(before);
    const denied = result.state.usageEvents.at(-1)!;
    expect(denied.outcome).toBe("denied");
    expect(denied.costMicro).toBe(0);
    expect(denied.execution).toBe("unavailable");
  });

  it("removes signing keys, endpoint urls, and credential secrets from a public ledger", async () => {
    const opened = await activeLease();
    const resource = opened.state.resources[0]!;
    const withEndpoint = updateResource(
      opened.state,
      resource.id,
      {
        name: resource.name,
        summary: resource.summary,
        region: resource.region,
        network: resource.network,
        availability: resource.availability,
        pricePerThousandMicro: resource.pricing.pricePerThousandMicro,
        requestRateLimit: resource.requestRateLimit,
        maxLeaseDurationMs: resource.maxLeaseDurationMs,
        supportedMethods: resource.supportedMethods,
        capacityRequests: resource.capacityRequests,
        endpointUrl: "https://rpc.example/secret-path",
      },
      NOW + 500,
    );
    const secret = withEndpoint.state.leases[0]!.credential!.secret;
    const published = toPublicState(withEndpoint.state);
    expect(published.keystore).toEqual({});
    expect(published.resources[0]!.endpointConfigured).toBe(true);
    expect(published.resources[0]).not.toHaveProperty("endpointUrl");
    expect(published.leases[0]!.credential!.secret).toBe("");
    expect(JSON.stringify(published).includes(secret)).toBe(false);
    expect(JSON.stringify(published).includes("secret-path")).toBe(false);
  });
});

describe("seed and persistence", () => {
  it("boots a full lifecycle and round-trips through storage", async () => {
    const now = Date.now();
    const seeded = await createSeedState(now);
    expect(verifyAuditChain(seeded.audit)).toBe(true);
    const statuses = new Set(seeded.leases.map((lease) => lease.status));
    for (const status of ["requested", "approved", "active", "expired", "exhausted", "revoked", "rejected"] as const) {
      expect(statuses.has(status)).toBe(true);
    }
    const figures = metrics(seeded, now);
    expect(figures.activeLeases).toBeGreaterThan(0);
    expect(figures.pendingRequests).toBe(1);
    expect(figures.expiringSoon).toBeGreaterThan(0);
    expect(figures.consumedRequests).toBeGreaterThan(0);
    expect(figures.spendingMicro).toBeGreaterThan(0);

    const active = seeded.leases.find((lease) => lease.status === "active" && lease.permittedMethods.includes("eth_call"));
    expect(active?.credential?.status).toBe("valid");
    const used = await submitRpc(
      seeded,
      {
        leaseId: active!.id,
        agentId: active!.agentId,
        method: "eth_blockNumber",
        requestCount: 1,
        credentialSecret: active!.credential!.secret,
      },
      now + 1_000,
    );
    expect(used.result.ok).toBe(true);

    const restricted = seeded.leases.find((lease) => lease.status === "active" && !lease.permittedMethods.includes("eth_call"));
    const denied = await submitRpc(
      seeded,
      {
        leaseId: restricted!.id,
        agentId: restricted!.agentId,
        method: "eth_call",
        requestCount: 1,
        credentialSecret: restricted!.credential!.secret,
      },
      now + 1_000,
    );
    expect(denied.result.reason).toContain("eth_call");

    const expired = seeded.leases.find((lease) => lease.status === "expired")!;
    expect(expired.credential?.status).toBe("invalid");
    const blob = JSON.stringify(seeded.audit);
    for (const lease of seeded.leases) {
      if (lease.credential) expect(blob.includes(lease.credential.secret)).toBe(false);
    }

    expect(providerRevenueMicro(seeded, "prv_northline")).toBeGreaterThan(0);
    const store = memoryStore();
    saveState(store, seeded);
    const loaded = loadState(store);
    expect(loaded?.leases).toHaveLength(seeded.leases.length);
    expect(await verifyAgreement(loaded!.leases.find((lease) => lease.agreement)?.agreement)).toBe(true);
    expect(verifyAuditChain(loaded!.audit)).toBe(true);

    const registered = registerAgent(seeded, "New Desk", "A desk added after the seed.", now);
    expect(registered.errors).toEqual([]);
    const published = publishResource(
      seeded,
      "prv_harbor",
      {
        name: "Harbor Spare",
        summary: "An extra simulated Polygon route.",
        region: "Amsterdam",
        network: "polygon",
        availability: "available",
        pricePerThousandMicro: 90_000,
        requestRateLimit: 100,
        maxLeaseDurationMs: HOUR,
        supportedMethods: ["eth_blockNumber"],
        capacityRequests: 10_000,
      },
      now,
    );
    expect(published.errors).toEqual([]);
  }, 30_000);
});
