import { bytesToB64Url, nextId } from "./ids.ts";
import { sortMethods } from "./canonical.ts";
import type { Credential, Lease } from "./types.ts";

export function generateCredential(lease: Lease, now: number): Credential {
  const secretBytes = new Uint8Array(32);
  crypto.getRandomValues(secretBytes);
  return {
    id: nextId("crd"),
    secret: `otl_${bytesToB64Url(secretBytes)}`,
    agentId: lease.agentId,
    leaseId: lease.id,
    resourceId: lease.resourceId,
    network: lease.network,
    permittedMethods: sortMethods(lease.permittedMethods),
    issuedAt: now,
    expiresAt: lease.expiresAt,
    status: "valid",
  };
}

export function invalidateCredential(credential: Credential | undefined, reason: string, now: number): Credential | undefined {
  if (!credential || credential.status === "invalid") return credential;
  return {
    ...credential,
    status: "invalid",
    invalidReason: reason,
    invalidatedAt: now,
  };
}

export function maskSecret(secret: string): string {
  if (secret.length <= 16) return "••••••••";
  return `${secret.slice(0, 8)}••••••••${secret.slice(-4)}`;
}

export function secretsMatch(left: string, right: string): boolean {
  const encoder = new TextEncoder();
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  const length = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < length; i += 1) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}
