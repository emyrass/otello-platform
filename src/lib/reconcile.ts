import { appendAudit } from "./audit.ts";
import { generateCredential, invalidateCredential } from "./credentials.ts";
import { leaseIsMathematicallyExhausted } from "./policy.ts";
import type { AppState, Lease } from "./types.ts";

function replaceLease(state: AppState, leaseId: string, lease: Lease): AppState {
  return {
    ...state,
    leases: state.leases.map((item) => (item.id === leaseId ? lease : item)),
  };
}

function invalidate(state: AppState, lease: Lease, reason: string, now: number, type: "credential.invalidated"): AppState {
  if (!lease.credential || lease.credential.status === "invalid") return state;
  const credential = invalidateCredential(lease.credential, reason, now);
  let next = replaceLease(state, lease.id, { ...lease, credential });
  next = appendAudit(next, {
    timestamp: now,
    type,
    agentId: lease.agentId,
    providerId: lease.providerId,
    leaseId: lease.id,
    resourceId: lease.resourceId,
    network: lease.network,
    details: {
      credentialId: lease.credential.id,
      reason,
    },
  });
  return next;
}

export function reconcile(state: AppState, now: number): AppState {
  let next = state;
  for (const lease of state.leases) {
    next = reconcileOne(next, lease.id, now);
  }
  return next;
}

function reconcileOne(state: AppState, leaseId: string, now: number): AppState {
  const lease = state.leases.find((item) => item.id === leaseId);
  if (!lease) return state;

  if (lease.status === "approved") {
    if (now >= lease.expiresAt) return expire(state, lease, now, "The approved window ended before use began.");
    if (now >= lease.startAt && lease.agreement) return activate(state, lease, now);
    return state;
  }

  if (lease.status === "active") {
    if (now >= lease.expiresAt) return expire(state, lease, now, "The lease reached its expiry time.");
    if (leaseIsMathematicallyExhausted(lease)) return exhaust(state, lease, now);
    return state;
  }

  if (
    (lease.status === "expired" || lease.status === "exhausted" || lease.status === "revoked" || lease.status === "rejected") &&
    lease.credential?.status === "valid"
  ) {
    return invalidate(state, lease, `Credential invalidated because the lease is ${lease.status}.`, now, "credential.invalidated");
  }

  return state;
}

function activate(state: AppState, lease: Lease, now: number): AppState {
  const credential = lease.credential?.status === "valid" ? lease.credential : generateCredential(lease, now);
  const issued = !lease.credential || lease.credential.status !== "valid";
  const nextLease: Lease = {
    ...lease,
    status: "active",
    activatedAt: lease.activatedAt ?? now,
    credential,
    timeline: [...lease.timeline, { at: now, status: "active", note: "Start time reached. Temporary credential issued." }],
  };
  let next = replaceLease(state, lease.id, nextLease);
  next = appendAudit(next, {
    timestamp: now,
    type: "lease.activated",
    agentId: lease.agentId,
    providerId: lease.providerId,
    leaseId: lease.id,
    resourceId: lease.resourceId,
    network: lease.network,
    details: { credentialId: credential.id },
  });
  if (issued) {
    next = appendAudit(next, {
      timestamp: now,
      type: "credential.issued",
      agentId: lease.agentId,
      providerId: lease.providerId,
      leaseId: lease.id,
      resourceId: lease.resourceId,
      network: lease.network,
      details: {
        credentialId: credential.id,
        expiresAt: credential.expiresAt,
      },
    });
  }
  return next;
}

function expire(state: AppState, lease: Lease, now: number, note: string): AppState {
  const credential = invalidateCredential(lease.credential, "Lease expired.", now);
  const nextLease: Lease = {
    ...lease,
    status: "expired",
    expiredAt: now,
    credential,
    timeline: [...lease.timeline, { at: now, status: "expired", note }],
  };
  let next = replaceLease(state, lease.id, nextLease);
  next = appendAudit(next, {
    timestamp: now,
    type: "lease.expired",
    agentId: lease.agentId,
    providerId: lease.providerId,
    leaseId: lease.id,
    resourceId: lease.resourceId,
    network: lease.network,
    details: { expiresAt: lease.expiresAt },
  });
  if (lease.credential && lease.credential.status === "valid") {
    next = appendAudit(next, {
      timestamp: now,
      type: "credential.invalidated",
      agentId: lease.agentId,
      providerId: lease.providerId,
      leaseId: lease.id,
      resourceId: lease.resourceId,
      network: lease.network,
      details: { credentialId: lease.credential.id, reason: "Lease expired." },
    });
  }
  return next;
}

function exhaust(state: AppState, lease: Lease, now: number): AppState {
  const reason = "Usage allowance or spending cap reached.";
  const credential = invalidateCredential(lease.credential, reason, now);
  const nextLease: Lease = {
    ...lease,
    status: "exhausted",
    exhaustedAt: now,
    credential,
    timeline: [...lease.timeline, { at: now, status: "exhausted", note: reason }],
  };
  let next = replaceLease(state, lease.id, nextLease);
  next = appendAudit(next, {
    timestamp: now,
    type: "lease.exhausted",
    agentId: lease.agentId,
    providerId: lease.providerId,
    leaseId: lease.id,
    resourceId: lease.resourceId,
    network: lease.network,
    details: {
      requests: lease.usage.requests,
      costMicro: lease.usage.costMicro,
    },
  });
  if (lease.credential && lease.credential.status === "valid") {
    next = appendAudit(next, {
      timestamp: now,
      type: "credential.invalidated",
      agentId: lease.agentId,
      providerId: lease.providerId,
      leaseId: lease.id,
      resourceId: lease.resourceId,
      network: lease.network,
      details: { credentialId: lease.credential.id, reason },
    });
  }
  return next;
}
