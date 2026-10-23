import type { AppState, AuditEvent, AuditType, Availability, Lease, Network, Resource } from "./types.ts";

export interface ProtocolMetrics {
  activeLeases: number;
  pendingRequests: number;
  availableResources: number;
  registeredAgents: number;
  consumedRequests: number;
  spendingMicro: number;
  expiringSoon: number;
}

const EXPIRING_WINDOW_MS = 15 * 60 * 1000;

export function metrics(state: AppState, now: number): ProtocolMetrics {
  const active = state.leases.filter((lease) => lease.status === "active");
  let consumedRequests = 0;
  let spendingMicro = 0;
  for (const event of state.usageEvents) {
    if (event.outcome !== "accepted") continue;
    consumedRequests += event.requestCount;
    spendingMicro += event.costMicro;
  }
  return {
    activeLeases: active.length,
    pendingRequests: state.leases.filter((lease) => lease.status === "requested").length,
    availableResources: state.resources.filter((resource) => resource.availability !== "unavailable").length,
    registeredAgents: state.agents.length,
    consumedRequests,
    spendingMicro,
    expiringSoon: active.filter((lease) => {
      const left = lease.expiresAt - now;
      return left > 0 && left <= EXPIRING_WINDOW_MS;
    }).length,
  };
}

export function acceptedCost(events: AppState["usageEvents"], predicate: (event: AppState["usageEvents"][number]) => boolean): number {
  return events.reduce((sum, event) => (predicate(event) && event.outcome === "accepted" ? sum + event.costMicro : sum), 0);
}

export function providerRevenueMicro(state: AppState, providerId: string): number {
  return acceptedCost(state.usageEvents, (event) => event.providerId === providerId);
}

export function leaseAccepted(state: AppState, leaseId: string): { requests: number; costMicro: number } {
  return state.usageEvents.reduce(
    (sum, event) => {
      if (event.leaseId !== leaseId || event.outcome !== "accepted") return sum;
      return { requests: sum.requests + event.requestCount, costMicro: sum.costMicro + event.costMicro };
    },
    { requests: 0, costMicro: 0 },
  );
}

export interface SeriesPoint {
  start: number;
  requests: number;
  costMicro: number;
}

export function usageSeries(
  state: AppState,
  leaseId: string | "all",
  now: number,
  bucketMs: number,
  buckets: number,
): SeriesPoint[] {
  const start = now - bucketMs * buckets;
  const points: SeriesPoint[] = Array.from({ length: buckets }, (_, index) => ({
    start: start + index * bucketMs,
    requests: 0,
    costMicro: 0,
  }));
  for (const event of state.usageEvents) {
    if (event.outcome !== "accepted") continue;
    if (leaseId !== "all" && event.leaseId !== leaseId) continue;
    if (event.timestamp < start || event.timestamp > now) continue;
    const index = Math.min(buckets - 1, Math.floor((event.timestamp - start) / bucketMs));
    const point = points[index];
    if (!point) continue;
    point.requests += event.requestCount;
    point.costMicro += event.costMicro;
  }
  return points;
}

export function filterResources(
  state: AppState,
  query: {
    search: string;
    network: Network | "all";
    availability: Availability | "all";
    sort: "price-asc" | "price-desc" | "name" | "rate";
  },
): Resource[] {
  const needle = query.search.trim().toLowerCase();
  const rows = state.resources.filter((resource) => {
    if (query.network !== "all" && resource.network !== query.network) return false;
    if (query.availability !== "all" && resource.availability !== query.availability) return false;
    if (!needle) return true;
    const provider = state.providers.find((item) => item.id === resource.providerId);
    const haystack = [resource.name, resource.summary, resource.network, resource.region, provider?.name ?? "", ...resource.supportedMethods]
      .join(" ")
      .toLowerCase();
    return haystack.includes(needle);
  });
  rows.sort((a, b) => {
    if (query.sort === "price-asc") return a.pricing.pricePerThousandMicro - b.pricing.pricePerThousandMicro;
    if (query.sort === "price-desc") return b.pricing.pricePerThousandMicro - a.pricing.pricePerThousandMicro;
    if (query.sort === "rate") return b.requestRateLimit - a.requestRateLimit;
    return a.name.localeCompare(b.name);
  });
  return rows;
}

export function filterLeases(leases: readonly Lease[], status: Lease["status"] | "all"): Lease[] {
  return leases.filter((lease) => status === "all" || lease.status === status);
}

export function filterAudit(
  events: readonly AuditEvent[],
  query: {
    agentId?: string;
    providerId?: string;
    leaseId?: string;
    network?: Network | "all";
    type?: AuditType | "all";
    from?: number;
    to?: number;
  },
): AuditEvent[] {
  return events.filter((event) => {
    if (query.agentId && event.agentId !== query.agentId) return false;
    if (query.providerId && event.providerId !== query.providerId) return false;
    if (query.leaseId && event.leaseId !== query.leaseId) return false;
    if (query.network && query.network !== "all" && event.network !== query.network) return false;
    if (query.type && query.type !== "all" && event.type !== query.type) return false;
    if (query.from !== undefined && event.timestamp < query.from) return false;
    if (query.to !== undefined && event.timestamp > query.to) return false;
    return true;
  });
}

/** Median round-trip of forwarded calls. Null when no connected endpoint has answered. */
export function measuredLatencyMs(state: AppState, resourceId: string): number | null {
  const samples = state.usageEvents
    .filter(
      (event) =>
        event.resourceId === resourceId &&
        event.outcome === "accepted" &&
        event.execution === "provider" &&
        typeof event.latencyMs === "number",
    )
    .map((event) => event.latencyMs ?? 0)
    .sort((left, right) => left - right);
  if (samples.length === 0) return null;
  const mid = Math.floor(samples.length / 2);
  const median = samples.length % 2 === 1 ? samples[mid]! : Math.round((samples[mid - 1]! + samples[mid]!) / 2);
  return median;
}

export function nameOf(rows: readonly { id: string; name: string }[], id: string | undefined): string {
  if (!id) return "—";
  return rows.find((row) => row.id === id)?.name ?? id;
}
