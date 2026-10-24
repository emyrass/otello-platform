import { generateSigningKey } from "./crypto.ts";
import { addProvider } from "./engine.ts";
import type { AppState, Provider, Resource, RpcMethod } from "./types.ts";
import { RPC_METHODS } from "./types.ts";

const METHODS: RpcMethod[] = [...RPC_METHODS];
const SAMPLE_KEY: JsonWebKey = { kty: "EC", crv: "P-256" };
const LISTED_AT = 1_700_000_000_000;

export const SAMPLE_PROVIDERS: Provider[] = [
  {
    id: "sample_prv_northline",
    name: "Northline Relay",
    desk: "Sample desk. Public reads from Frankfurt and Ashburn.",
    status: "active",
    ownerId: "sample",
    publicKeyJwk: SAMPLE_KEY,
    createdAt: LISTED_AT,
  },
  {
    id: "sample_prv_harbor",
    name: "Harbor RPC",
    desk: "Sample desk. Routes for Arbitrum and Polygon.",
    status: "active",
    ownerId: "sample",
    publicKeyJwk: SAMPLE_KEY,
    createdAt: LISTED_AT,
  },
  {
    id: "sample_prv_sable",
    name: "Sable Index",
    desk: "Sample desk. Withdrawn while the feed is down.",
    status: "active",
    ownerId: "sample",
    publicKeyJwk: SAMPLE_KEY,
    createdAt: LISTED_AT,
  },
];

function offer(input: {
  id: string;
  name: string;
  providerId: string;
  network: Resource["network"];
  summary: string;
  availability: Resource["availability"];
  region: string;
  pricePerThousandMicro: number;
  requestRateLimit: number;
  maxLeaseHours: number;
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
    supportedMethods: METHODS,
    capacityRequests: input.capacityRequests,
    endpointConfigured: false,
  };
}

export const SAMPLE_RESOURCES: Resource[] = [
  offer({
    id: "sample_res_northline_eth",
    name: "Northline Ethereum",
    providerId: "sample_prv_northline",
    network: "ethereum",
    summary: "Sample mainnet HTTP reads. Twenty cents per thousand accepted calls.",
    availability: "available",
    region: "Frankfurt",
    pricePerThousandMicro: 200_000,
    requestRateLimit: 600,
    maxLeaseHours: 24,
    capacityRequests: 5_000_000,
  }),
  offer({
    id: "sample_res_northline_base",
    name: "Northline Base",
    providerId: "sample_prv_northline",
    network: "base",
    summary: "Sample Base HTTP, listed for block and balance polling.",
    availability: "available",
    region: "Ashburn",
    pricePerThousandMicro: 120_000,
    requestRateLimit: 800,
    maxLeaseHours: 12,
    capacityRequests: 4_000_000,
  }),
  offer({
    id: "sample_res_harbor_arb",
    name: "Harbor Arbitrum",
    providerId: "sample_prv_harbor",
    network: "arbitrum",
    summary: "Sample Arbitrum reads. Spare capacity is limited.",
    availability: "limited",
    region: "Lisbon",
    pricePerThousandMicro: 150_000,
    requestRateLimit: 400,
    maxLeaseHours: 6,
    capacityRequests: 1_500_000,
  }),
  offer({
    id: "sample_res_harbor_pol",
    name: "Harbor Polygon",
    providerId: "sample_prv_harbor",
    network: "polygon",
    summary: "Sample Polygon HTTP for inexpensive inventory polling.",
    availability: "available",
    region: "Amsterdam",
    pricePerThousandMicro: 80_000,
    requestRateLimit: 900,
    maxLeaseHours: 24,
    capacityRequests: 6_000_000,
  }),
  offer({
    id: "sample_res_sable_pol",
    name: "Sable Polygon Trace",
    providerId: "sample_prv_sable",
    network: "polygon",
    summary: "Sample Polygon feed. Listed as unavailable.",
    availability: "unavailable",
    region: "Paris",
    pricePerThousandMicro: 250_000,
    requestRateLimit: 200,
    maxLeaseHours: 8,
    capacityRequests: 250_000,
  }),
];

const SAMPLE_RESOURCE_IDS = new Set(SAMPLE_RESOURCES.map((resource) => resource.id));

export function isSampleOffer(id: string | undefined): boolean {
  return Boolean(id && SAMPLE_RESOURCE_IDS.has(id));
}

export function isSampleProvider(id: string | undefined): boolean {
  return SAMPLE_PROVIDERS.some((provider) => provider.id === id);
}

/** Adds the sample market to a live workspace view. Example ledgers already carry their own records. */
export function withMarketSamples(state: AppState): AppState {
  if (state.origin === "example") return state;
  const providers = [...state.providers];
  for (const provider of SAMPLE_PROVIDERS) {
    if (!providers.some((item) => item.id === provider.id)) providers.push(provider);
  }
  const resources = [...state.resources];
  for (const resource of SAMPLE_RESOURCES) {
    if (!resources.some((item) => item.id === resource.id)) resources.push(resource);
  }
  return { ...state, providers, resources };
}

/** Persists sample desks and offers, with signing keys, so a request can be approved. */
export async function ensureSampleMarket(state: AppState): Promise<AppState> {
  if (state.origin === "example") return state;
  let next = state;
  for (const provider of SAMPLE_PROVIDERS) {
    const saved = next.providers.some((item) => item.id === provider.id);
    const keyed = Boolean(next.keystore[provider.id]);
    if (saved && keyed) continue;
    const keys = await generateSigningKey();
    if (saved) {
      next = {
        ...next,
        providers: next.providers.map((item) => (item.id === provider.id ? { ...item, publicKeyJwk: keys.publicJwk } : item)),
        keystore: { ...next.keystore, [provider.id]: keys.privateJwk },
      };
      continue;
    }
    next = await addProvider(
      next,
      {
        id: provider.id,
        name: provider.name,
        desk: provider.desk,
        status: provider.status,
        ownerId: provider.ownerId,
        createdAt: provider.createdAt,
      },
      keys.privateJwk,
      keys.publicJwk,
    );
  }
  const known = new Set(next.resources.map((resource) => resource.id));
  const missing = SAMPLE_RESOURCES.filter((resource) => !known.has(resource.id));
  if (missing.length > 0) next = { ...next, resources: [...next.resources, ...missing] };
  return next === state ? state : next;
}
