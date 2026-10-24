export const NETWORKS = ["ethereum", "base", "arbitrum", "polygon"] as const;
export type Network = (typeof NETWORKS)[number];

export const RPC_METHODS = [
  "eth_blockNumber",
  "eth_getBalance",
  "eth_getBlockByNumber",
  "eth_call",
  "eth_getTransactionReceipt",
] as const;
export type RpcMethod = (typeof RPC_METHODS)[number];

export const LEASE_STATUSES = [
  "requested",
  "approved",
  "active",
  "expired",
  "exhausted",
  "revoked",
  "rejected",
] as const;
export type LeaseStatus = (typeof LEASE_STATUSES)[number];

export type PartyStatus = "active" | "disabled";
export type Availability = "available" | "limited" | "unavailable";

export interface PricingModel {
  model: "per_thousand_requests";
  /** Integer micro-USD charged per 1,000 accepted requests. $1 = 1_000_000. */
  pricePerThousandMicro: number;
}

export interface Agent {
  id: string;
  name: string;
  mandate: string;
  status: PartyStatus;
  ownerId: string;
  createdAt: number;
}

export interface Provider {
  id: string;
  name: string;
  desk: string;
  status: PartyStatus;
  ownerId: string;
  publicKeyJwk: JsonWebKey;
  createdAt: number;
}

export interface Resource {
  id: string;
  name: string;
  providerId: string;
  kind: "rpc";
  network: Network;
  summary: string;
  availability: Availability;
  region: string;
  pricing: PricingModel;
  requestRateLimit: number;
  maxLeaseDurationMs: number;
  supportedMethods: RpcMethod[];
  /** Provider-declared ceiling for a single lease allowance. Not a measured load. */
  capacityRequests: number;
  endpointConfigured: boolean;
  /** Server ledger only. Removed before a response leaves the API. */
  endpointUrl?: string;
}

export interface AgreementPayload {
  agreementVersion: number;
  leaseId: string;
  agentId: string;
  providerId: string;
  resourceId: string;
  network: Network;
  startAt: number;
  expiresAt: number;
  usageAllowance: number;
  spendingCapMicro: number;
  requestRatePerMinute: number;
  permittedMethods: RpcMethod[];
  pricingModel: "per_thousand_requests";
  pricePerThousandMicro: number;
  revocationConditions: string[];
  createdAt: number;
}

export interface SignedAgreement {
  payload: AgreementPayload;
  canonical: string;
  hashHex: string;
  signatureB64: string;
  signerId: string;
  publicKeyJwk: JsonWebKey;
  signedAt: number;
}

export interface Credential {
  id: string;
  /** Server ledger only. The public payload leaves this empty. Never copy into the audit log. */
  secret: string;
  agentId: string;
  leaseId: string;
  resourceId: string;
  network: Network;
  permittedMethods: RpcMethod[];
  issuedAt: number;
  expiresAt: number;
  status: "valid" | "invalid";
  invalidReason?: string;
  invalidatedAt?: number;
}

export interface TimelineEntry {
  at: number;
  status: LeaseStatus;
  note: string;
}

export interface RateSample {
  at: number;
  count: number;
}

export interface Lease {
  id: string;
  status: LeaseStatus;
  agentId: string;
  providerId: string;
  resourceId: string;
  network: Network;
  task: string;
  startAt: number;
  durationMs: number;
  expiresAt: number;
  maxRequests: number;
  spendingCapMicro: number;
  maxRequestRate: number;
  permittedMethods: RpcMethod[];
  pricing: PricingModel;
  createdAt: number;
  approvedAt?: number;
  activatedAt?: number;
  expiredAt?: number;
  exhaustedAt?: number;
  revokedAt?: number;
  rejectedAt?: number;
  rejectionReason?: string;
  revocationReason?: string;
  agreement?: SignedAgreement;
  credential?: Credential;
  usage: {
    requests: number;
    costMicro: number;
  };
  rateLog: RateSample[];
  timeline: TimelineEntry[];
}

export interface UsageEvent {
  id: string;
  leaseId: string;
  agentId: string;
  providerId: string;
  resourceId: string;
  network: Network;
  method: RpcMethod;
  requestCount: number;
  unitPriceMicroPerThousand: number;
  costMicro: number;
  timestamp: number;
  outcome: "accepted" | "denied";
  reason?: string;
  idempotencyKey?: string;
  /** How the batch was handled. Absent on older denied rows that never reached an endpoint. */
  execution?: RpcExecutionKind;
  /** Round-trip time recorded for a forwarded batch. Absent when nothing was sent. */
  latencyMs?: number;
}

export const AUDIT_TYPES = [
  "lease.requested",
  "lease.approved",
  "lease.rejected",
  "lease.activated",
  "lease.expired",
  "lease.exhausted",
  "lease.revoked",
  "agreement.signed",
  "agreement.verified",
  "credential.issued",
  "credential.invalidated",
  "rpc.accepted",
  "rpc.denied",
  "settlement.preview",
  "settlement.settled",
  "agent.registered",
  "provider.registered",
  "agent.status_changed",
  "provider.status_changed",
  "resource.published",
  "resource.updated",
] as const;
export type AuditType = (typeof AUDIT_TYPES)[number];

export type AuditValue = string | number | boolean | null;

export interface AuditEvent {
  id: string;
  timestamp: number;
  type: AuditType;
  agentId?: string;
  providerId?: string;
  leaseId?: string;
  resourceId?: string;
  network?: Network;
  details: Record<string, AuditValue>;
  prevHash: string;
  hash: string;
}

export interface SettlementRecord {
  id: string;
  leaseId: string;
  amountDueMicro: number;
  acceptedRequests: number;
  status: "preview" | "settled";
  adapter: "simulated";
  createdAt: number;
  settledAt?: number;
  note: string;
}

export type LedgerOrigin = "record" | "example";

export interface AppState {
  version: 1;
  origin: LedgerOrigin;
  seededAt: number;
  agents: Agent[];
  providers: Provider[];
  resources: Resource[];
  leases: Lease[];
  usageEvents: UsageEvent[];
  audit: AuditEvent[];
  settlements: SettlementRecord[];
  /** Private signing keys. Never included in an API response. */
  keystore: Record<string, JsonWebKey>;
}

export interface LeaseRequestInput {
  agentId: string;
  resourceId: string;
  task: string;
  startAt: number;
  durationMs: number;
  maxRequests: number;
  spendingCapMicro: number;
  maxRequestRate: number;
  permittedMethods: RpcMethod[];
}

export interface RpcInput {
  leaseId: string;
  agentId: string;
  method: RpcMethod;
  requestCount: number;
  credentialSecret: string;
  idempotencyKey?: string;
  /** JSON-RPC params forwarded when an endpoint is configured. Defaults to an empty array. */
  params?: unknown;
}

export type RpcExecutionKind = "provider" | "example" | "unavailable" | "simulated";

export interface RpcResponseBody {
  execution: RpcExecutionKind;
  requestCount: number;
  latencyMs?: number;
  body?: unknown;
  note: string;
}

export interface RpcResult {
  ok: boolean;
  reason?: string;
  response?: RpcResponseBody;
  costMicro: number;
  requestCount: number;
  replayed: boolean;
  usageEventId?: string;
}

export interface ResourceDraft {
  name: string;
  summary: string;
  region: string;
  network: Network;
  availability: Availability;
  pricePerThousandMicro: number;
  requestRateLimit: number;
  maxLeaseDurationMs: number;
  supportedMethods: RpcMethod[];
  capacityRequests: number;
  /**
   * On publish, a blank value leaves the offer unconfigured.
   * On update, omit the field to keep the current endpoint, or send null to remove it.
   */
  endpointUrl?: string | null;
}

export const REVOCATION_CONDITIONS = [
  "The provider may revoke the lease, with a recorded reason, if capacity is withdrawn.",
  "Access is refused while the agent or the provider is disabled. Accrued usage stays on the books.",
  "Otello refuses further use when the lease expires, the request allowance is exhausted, or the spending cap is reached.",
  "The server checks the lease before a request is forwarded. An offer with no endpoint is simulated locally and is not called.",
] as const;

export const RATE_WINDOW_MS = 60_000;
export const GENESIS_HASH = "genesis";
export const STORAGE_KEY = "otello.protocol.v1";
export const MAX_BATCH = 100_000;
export const MIN_DURATION_MS = 15_000;

export const WORKSPACE_NOTICE =
  "This workspace is stored on the Otello server. A request is forwarded only when that resource has an endpoint. Otherwise an accepted batch is simulated here and labeled as simulated. Amounts are accrued from accepted usage. No payment rail is connected, so nothing here has been paid.";

export const EXAMPLE_NOTICE =
  "These are example records, kept apart from the workspace. Calls in this view are metered here and are not sent to a network.";
