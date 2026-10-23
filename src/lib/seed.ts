import { generateSigningKey } from "./crypto.ts";
import {
  addProvider,
  approveLease,
  emptyState,
  reconcile,
  rejectLease,
  requestLease,
  revokeLease,
  setAgentStatus,
  setProviderStatus,
  submitRpc,
  type MutationResult,
} from "./engine.ts";
import { exampleExecutor } from "./rpc.ts";
import { costForRequests } from "./money.ts";
import type { Agent, AppState, Network, Provider, Resource, RpcMethod } from "./types.ts";
import { RPC_METHODS } from "./types.ts";

const ALL_METHODS: RpcMethod[] = [...RPC_METHODS];
const READ_METHODS = ALL_METHODS.filter((method) => method !== "eth_call");

function must(result: MutationResult, label: string): AppState {
  if (result.errors.length > 0) throw new Error(`${label}: ${result.errors.join(" ")}`);
  return result.state;
}

function credentialSecret(state: AppState, leaseId: string): string {
  const secret = state.leases.find((lease) => lease.id === leaseId)?.credential?.secret;
  if (!secret) throw new Error(`Seed lease ${leaseId} has no credential.`);
  return secret;
}

async function send(
  state: AppState,
  leaseId: string,
  agentId: string,
  method: RpcMethod,
  requestCount: number,
  now: number,
  label: string,
): Promise<AppState> {
  const result = await submitRpc(
    state,
    { leaseId, agentId, method, requestCount, credentialSecret: credentialSecret(state, leaseId) },
    now,
    exampleExecutor,
  );
  if (!result.result.ok) throw new Error(`${label}: ${result.result.reason ?? "denied"}`);
  return result.state;
}

function offer(input: {
  id: string;
  name: string;
  providerId: string;
  network: Network;
  summary: string;
  availability: Resource["availability"];
  region: string;
  pricePerThousandMicro: number;
  requestRateLimit: number;
  maxLeaseHours: number;
  supportedMethods: RpcMethod[];
  capacityRequests: number;
}): Resource {
  return {
    id: input.id,
    name: input.name,
    providerId: input.providerId,
    kind: "rpc",
    network: input.network,
    summary: input.summary,
    availability: input.availability,
    region: input.region,
    pricing: { model: "per_thousand_requests", pricePerThousandMicro: input.pricePerThousandMicro },
    requestRateLimit: input.requestRateLimit,
    maxLeaseDurationMs: input.maxLeaseHours * 60 * 60 * 1000,
    supportedMethods: input.supportedMethods,
    capacityRequests: input.capacityRequests,
    endpointConfigured: false,
  };
}

export async function createSeedState(now: number): Promise<AppState> {
  const hour = 60 * 60 * 1000;
  const minute = 60 * 1000;
  let state = emptyState(now);

  const providerDrafts: Array<Omit<Provider, "publicKeyJwk">> = [
    { id: "prv_northline", name: "Northline Relay", desk: "Public reads from Frankfurt and Ashburn.", status: "active", ownerId: "example", createdAt: now - 40 * hour },
    { id: "prv_harbor", name: "Harbor RPC", desk: "Routes for Base, Arbitrum, and Polygon.", status: "active", ownerId: "example", createdAt: now - 36 * hour },
    { id: "prv_kiln", name: "Kiln & Copper", desk: "Archive-friendly Ethereum and lighter L2 reads.", status: "active", ownerId: "example", createdAt: now - 30 * hour },
    { id: "prv_sable", name: "Sable Index", desk: "Paused for maintenance.", status: "active", ownerId: "example", createdAt: now - 28 * hour },
    { id: "prv_marlowe", name: "Marlowe Grid", desk: "Base relay with a narrower method list.", status: "active", ownerId: "example", createdAt: now - 24 * hour },
  ];

  for (const draft of providerDrafts) {
    const keys = await generateSigningKey();
    state = await addProvider(state, draft, keys.privateJwk, keys.publicJwk);
  }

  const agents: Agent[] = [
    { id: "agt_meridian", name: "Meridian Desk", mandate: "Basis and funding reads on Ethereum mainnet.", status: "active", ownerId: "example", createdAt: now - 20 * hour },
    { id: "agt_lowtide", name: "Lowtide", mandate: "Cross-L2 dislocations and sequencer drift.", status: "active", ownerId: "example", createdAt: now - 18 * hour },
    { id: "agt_lantern", name: "Paper Lantern", mandate: "Research desk. Block and balance reads.", status: "active", ownerId: "example", createdAt: now - 16 * hour },
    { id: "agt_quill", name: "Halted Quill", mandate: "Disabled after a risk halt.", status: "active", ownerId: "example", createdAt: now - 48 * hour },
    { id: "agt_cinder", name: "Cinder Route", mandate: "Polygon inventory and transfer receipts.", status: "active", ownerId: "example", createdAt: now - 14 * hour },
  ];

  const resources: Resource[] = [
    offer({
      id: "res_northline_eth",
      name: "Northline Ethereum",
      providerId: "prv_northline",
      network: "ethereum",
      summary: "Full-node HTTP reads for mainnet. Priced at twenty cents per thousand accepted calls.",
      availability: "available",
      region: "Frankfurt",
      pricePerThousandMicro: 200_000,
      requestRateLimit: 600,
      maxLeaseHours: 24,
      supportedMethods: ALL_METHODS,
      capacityRequests: 5_000_000,
    }),
    offer({
      id: "res_northline_base",
      name: "Northline Base",
      providerId: "prv_northline",
      network: "base",
      summary: "Base mainnet HTTP, tuned for block and balance polling.",
      availability: "available",
      region: "Ashburn",
      pricePerThousandMicro: 120_000,
      requestRateLimit: 800,
      maxLeaseHours: 12,
      supportedMethods: ALL_METHODS,
      capacityRequests: 4_000_000,
    }),
    offer({
      id: "res_harbor_arb",
      name: "Harbor Arbitrum",
      providerId: "prv_harbor",
      network: "arbitrum",
      summary: "Sequencer-adjacent Arbitrum reads. Spare capacity is limited this session.",
      availability: "limited",
      region: "Lisbon",
      pricePerThousandMicro: 150_000,
      requestRateLimit: 400,
      maxLeaseHours: 6,
      supportedMethods: ALL_METHODS,
      capacityRequests: 1_500_000,
    }),
    offer({
      id: "res_harbor_pol",
      name: "Harbor Polygon",
      providerId: "prv_harbor",
      network: "polygon",
      summary: "Bor full node for inexpensive inventory polling.",
      availability: "available",
      region: "Amsterdam",
      pricePerThousandMicro: 80_000,
      requestRateLimit: 900,
      maxLeaseHours: 24,
      supportedMethods: ALL_METHODS,
      capacityRequests: 6_000_000,
    }),
    offer({
      id: "res_kiln_eth",
      name: "Kiln Archive",
      providerId: "prv_kiln",
      network: "ethereum",
      summary: "Ethereum archive reads. Higher price, lower rate, shorter leases.",
      availability: "available",
      region: "Zurich",
      pricePerThousandMicro: 450_000,
      requestRateLimit: 120,
      maxLeaseHours: 4,
      supportedMethods: ALL_METHODS,
      capacityRequests: 400_000,
    }),
    offer({
      id: "res_sable_pol",
      name: "Sable Polygon Trace",
      providerId: "prv_sable",
      network: "polygon",
      summary: "Trace-capable Polygon endpoint. Withdrawn while Sable is disabled.",
      availability: "unavailable",
      region: "Paris",
      pricePerThousandMicro: 250_000,
      requestRateLimit: 200,
      maxLeaseHours: 8,
      supportedMethods: ALL_METHODS,
      capacityRequests: 250_000,
    }),
    offer({
      id: "res_marlowe_base",
      name: "Marlowe Base",
      providerId: "prv_marlowe",
      network: "base",
      summary: "Base relay that does not offer eth_call.",
      availability: "available",
      region: "London",
      pricePerThousandMicro: 180_000,
      requestRateLimit: 300,
      maxLeaseHours: 8,
      supportedMethods: READ_METHODS,
      capacityRequests: 800_000,
    }),
    offer({
      id: "res_kiln_arb",
      name: "Kiln Arbitrum Light",
      providerId: "prv_kiln",
      network: "arbitrum",
      summary: "A lighter Arbitrum feed for agents that only need heads and receipts.",
      availability: "available",
      region: "Zurich",
      pricePerThousandMicro: 100_000,
      requestRateLimit: 500,
      maxLeaseHours: 12,
      supportedMethods: ALL_METHODS,
      capacityRequests: 2_000_000,
    }),
  ];

  state = { ...state, agents, resources };

  const ask = (
    current: AppState,
    input: {
      agentId: string;
      resourceId: string;
      task: string;
      startAt: number;
      durationMs: number;
      maxRequests: number;
      maxRequestRate: number;
      permittedMethods: RpcMethod[];
      pricePerThousandMicro: number;
    },
    at: number,
    label: string,
  ) => {
    const result = requestLease(
      current,
      {
        ...input,
        spendingCapMicro: costForRequests(input.maxRequests, input.pricePerThousandMicro),
      },
      at,
    );
    return { state: must(result, label), leaseId: result.leaseId! };
  };

  const rejected = ask(
    state,
    {
      agentId: "agt_quill",
      resourceId: "res_northline_eth",
      task: "Probe halted-desk access to mainnet heads.",
      startAt: now - 26 * hour,
      durationMs: hour,
      maxRequests: 2_000,
      maxRequestRate: 60,
      permittedMethods: ["eth_blockNumber"],
      pricePerThousandMicro: 200_000,
    },
    now - 26 * hour,
    "rejected request",
  );
  state = must(
    rejectLease(rejected.state, rejected.leaseId, "prv_northline", "Agent is outside the provider's allowed desk list.", now - 26 * hour + minute),
    "reject",
  );

  const exhausted = ask(
    state,
    {
      agentId: "agt_meridian",
      resourceId: "res_kiln_eth",
      task: "Archive backfill for a funding print.",
      startAt: now - 20 * hour,
      durationMs: 3 * hour,
      maxRequests: 480,
      maxRequestRate: 120,
      permittedMethods: ALL_METHODS,
      pricePerThousandMicro: 450_000,
    },
    now - 20 * hour,
    "exhausted request",
  );
  state = must(await approveLease(exhausted.state, exhausted.leaseId, "prv_kiln", now - 20 * hour + 30_000), "approve exhausted");
  for (let index = 0; index < 4; index += 1) {
    state = await send(state, exhausted.leaseId, "agt_meridian", "eth_getBlockByNumber", 120, now - 20 * hour + (index + 1) * minute, "exhaust batch");
  }

  const activeStart = now - 10 * hour;
  const active = ask(
    state,
    {
      agentId: "agt_meridian",
      resourceId: "res_northline_eth",
      task: "Watch mainnet heads and balances through the session.",
      startAt: activeStart,
      durationMs: 16 * hour,
      maxRequests: 50_000,
      maxRequestRate: 600,
      permittedMethods: ALL_METHODS,
      pricePerThousandMicro: 200_000,
    },
    activeStart,
    "active request",
  );
  state = must(await approveLease(active.state, active.leaseId, "prv_northline", activeStart + 20_000), "approve active");
  for (let index = 0; index <= 20; index += 1) {
    const count = index === 20 ? 400 : 600;
    state = await send(
      state,
      active.leaseId,
      "agt_meridian",
      index % 2 === 0 ? "eth_blockNumber" : "eth_getBalance",
      count,
      activeStart + (index + 1) * 28 * minute,
      "active batch",
    );
  }

  const expiredStart = now - 8 * hour;
  const expired = ask(
    state,
    {
      agentId: "agt_cinder",
      resourceId: "res_harbor_pol",
      task: "Morning inventory pass on Polygon.",
      startAt: expiredStart,
      durationMs: 2 * hour,
      maxRequests: 5_000,
      maxRequestRate: 200,
      permittedMethods: ALL_METHODS,
      pricePerThousandMicro: 80_000,
    },
    expiredStart,
    "expired request",
  );
  state = must(await approveLease(expired.state, expired.leaseId, "prv_harbor", expiredStart + 15_000), "approve expired");
  state = await send(state, expired.leaseId, "agt_cinder", "eth_getTransactionReceipt", 200, expiredStart + hour, "expired usage");

  const revokedStart = now - 5 * hour;
  const revoked = ask(
    state,
    {
      agentId: "agt_lowtide",
      resourceId: "res_northline_base",
      task: "Base drift check before a routing change.",
      startAt: revokedStart,
      durationMs: 4 * hour,
      maxRequests: 8_000,
      maxRequestRate: 200,
      permittedMethods: ALL_METHODS,
      pricePerThousandMicro: 120_000,
    },
    revokedStart,
    "revoked request",
  );
  state = must(await approveLease(revoked.state, revoked.leaseId, "prv_northline", revokedStart + 10_000), "approve revoked");
  state = await send(state, revoked.leaseId, "agt_lowtide", "eth_blockNumber", 80, revokedStart + 20 * minute, "revoked usage");
  state = must(
    revokeLease(state, revoked.leaseId, "Provider withdrew capacity after a routing incident.", revokedStart + hour),
    "revoke",
  );

  const expiringStart = now - 50 * minute;
  const expiring = ask(
    state,
    {
      agentId: "agt_cinder",
      resourceId: "res_harbor_pol",
      task: "Short Polygon window used to show a lease ending soon.",
      startAt: expiringStart,
      durationMs: 60 * minute,
      maxRequests: 8_000,
      maxRequestRate: 300,
      permittedMethods: ALL_METHODS,
      pricePerThousandMicro: 80_000,
    },
    expiringStart,
    "expiring request",
  );
  state = must(await approveLease(expiring.state, expiring.leaseId, "prv_harbor", expiringStart + 5_000), "approve expiring");
  state = await send(state, expiring.leaseId, "agt_cinder", "eth_blockNumber", 150, expiringStart + 10 * minute, "expiring usage");

  const restrictedStart = now - 30 * minute;
  const restricted = ask(
    state,
    {
      agentId: "agt_lantern",
      resourceId: "res_marlowe_base",
      task: "Research reads on Base. eth_call is outside this offer.",
      startAt: restrictedStart,
      durationMs: 4 * hour,
      maxRequests: 6_000,
      maxRequestRate: 120,
      permittedMethods: READ_METHODS,
      pricePerThousandMicro: 180_000,
    },
    restrictedStart,
    "restricted request",
  );
  state = must(await approveLease(restricted.state, restricted.leaseId, "prv_marlowe", restrictedStart + 5_000), "approve restricted");
  state = await send(state, restricted.leaseId, "agt_lantern", "eth_getBalance", 40, restrictedStart + 8 * minute, "restricted usage");

  const future = ask(
    state,
    {
      agentId: "agt_lantern",
      resourceId: "res_northline_base",
      task: "Scheduled research window that has not started.",
      startAt: now + 2 * hour,
      durationMs: hour,
      maxRequests: 3_000,
      maxRequestRate: 100,
      permittedMethods: ["eth_blockNumber", "eth_getBalance"],
      pricePerThousandMicro: 120_000,
    },
    now,
    "future request",
  );
  state = must(await approveLease(future.state, future.leaseId, "prv_northline", now), "approve future");

  state = ask(
    state,
    {
      agentId: "agt_lowtide",
      resourceId: "res_harbor_arb",
      task: "Watch Arbitrum sequencer drift for the next two hours.",
      startAt: now,
      durationMs: 2 * hour,
      maxRequests: 20_000,
      maxRequestRate: 180,
      permittedMethods: ALL_METHODS,
      pricePerThousandMicro: 150_000,
    },
    now,
    "pending request",
  ).state;

  state = must(setAgentStatus(state, "agt_quill", "disabled", now), "disable agent");
  state = must(setProviderStatus(state, "prv_sable", "disabled", now), "disable provider");
  state = reconcile(state, now);
  return { ...state, origin: "example" };
}
