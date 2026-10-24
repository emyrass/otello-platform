import { formatPerThousand, formatUsd } from "./money.ts";
import type { AuditType, Availability, LeaseStatus, Network, RpcExecutionKind } from "./types.ts";

export function formatNumber(value: number): string {
  return value.toLocaleString("en-US");
}

export function formatDuration(ms: number): string {
  const safe = Math.max(0, Math.floor(ms / 1000));
  if (safe < 60) return `${safe}s`;
  const minutes = Math.floor(safe / 60);
  if (minutes < 60) {
    const seconds = safe % 60;
    return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  if (hours < 48) return remMinutes ? `${hours}h ${remMinutes}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours ? `${days}d ${remHours}h` : `${days}d`;
}

export function formatRemaining(expiresAt: number, now: number): string {
  if (expiresAt <= now) return "Ended";
  return formatDuration(expiresAt - now);
}

export function formatTimestamp(ms: number): string {
  const formatted = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Sao_Tome",
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).format(ms);
  return `${formatted} UTC`;
}

export function formatClock(ms: number): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Sao_Tome",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(ms);
}

const NETWORK_LABELS: Record<Network, string> = {
  ethereum: "Ethereum",
  base: "Base",
  arbitrum: "Arbitrum",
  polygon: "Polygon",
};

export function networkLabel(network: Network): string {
  return NETWORK_LABELS[network];
}

const STATUS_LABELS: Record<LeaseStatus, string> = {
  requested: "Requested",
  approved: "Approved",
  active: "Active",
  expired: "Expired",
  exhausted: "Exhausted",
  revoked: "Revoked",
  rejected: "Rejected",
};

export function statusLabel(status: LeaseStatus): string {
  return STATUS_LABELS[status];
}

const AVAILABILITY_LABELS: Record<Availability, string> = {
  available: "Available",
  limited: "Limited",
  unavailable: "Unavailable",
};

export function availabilityLabel(availability: Availability): string {
  return AVAILABILITY_LABELS[availability];
}

const AUDIT_LABELS: Record<AuditType, string> = {
  "lease.requested": "Lease requested",
  "lease.approved": "Lease approved",
  "lease.rejected": "Lease rejected",
  "lease.activated": "Lease activated",
  "lease.expired": "Lease expired",
  "lease.exhausted": "Lease exhausted",
  "lease.revoked": "Lease revoked",
  "agreement.signed": "Agreement signed",
  "agreement.verified": "Agreement verified",
  "credential.issued": "Credential issued",
  "credential.invalidated": "Credential invalidated",
  "rpc.accepted": "RPC request accepted",
  "rpc.denied": "RPC request denied",
  "settlement.preview": "Settlement preview",
  "settlement.settled": "Settlement recorded",
  "agent.registered": "Agent registered",
  "provider.registered": "Provider registered",
  "agent.status_changed": "Agent status changed",
  "provider.status_changed": "Provider status changed",
  "resource.published": "Resource published",
  "resource.updated": "Resource updated",
};

export function auditLabel(type: AuditType): string {
  return AUDIT_LABELS[type];
}

export function acceptedOutcome(execution: RpcExecutionKind | undefined): string {
  if (execution === "simulated") return "Accepted, simulated";
  if (execution === "example") return "Accepted, example";
  if (execution === "provider") return "Accepted, forwarded";
  return "Accepted";
}

export function humanizeKey(key: string): string {
  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (char) => char.toUpperCase())
    .trim();
}

export function formatDetailValue(key: string, value: string | number | boolean | null): string {
  if (value === null) return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number" && key.endsWith("Micro")) return formatUsd(value);
  if (typeof value === "number" && (key.endsWith("At") || key === "timestamp")) return formatTimestamp(value);
  if (typeof value === "number" && key === "latencyMs") return `${formatNumber(value)} ms`;
  if (typeof value === "number" && key.endsWith("Ms")) return formatDuration(value);
  if (typeof value === "number") return formatNumber(value);
  return value;
}

export { formatPerThousand, formatUsd };
