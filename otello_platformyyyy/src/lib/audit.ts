import { stableStringify } from "./canonical.ts";
import { sha256Hex } from "./hash.ts";
import { nextId } from "./ids.ts";
import { GENESIS_HASH, type AppState, type AuditEvent, type AuditType, type AuditValue, type Network } from "./types.ts";

export interface AuditDraft {
  timestamp: number;
  type: AuditType;
  agentId?: string;
  providerId?: string;
  leaseId?: string;
  resourceId?: string;
  network?: Network;
  details: Record<string, AuditValue>;
}

function withoutEmpty(draft: AuditDraft): Omit<AuditEvent, "hash"> {
  const body: Omit<AuditEvent, "hash"> = {
    id: nextId("evt"),
    timestamp: draft.timestamp,
    type: draft.type,
    details: draft.details,
    prevHash: GENESIS_HASH,
  };
  if (draft.agentId) body.agentId = draft.agentId;
  if (draft.providerId) body.providerId = draft.providerId;
  if (draft.leaseId) body.leaseId = draft.leaseId;
  if (draft.resourceId) body.resourceId = draft.resourceId;
  if (draft.network) body.network = draft.network;
  return body;
}

export function appendAudit(state: AppState, draft: AuditDraft): AppState {
  for (const value of Object.values(draft.details)) {
    if (typeof value === "string" && value.includes("otl_sim_")) {
      throw new Error("Refusing to write a credential secret into the audit log.");
    }
  }
  const prevHash = state.audit.length > 0 ? state.audit[state.audit.length - 1]!.hash : GENESIS_HASH;
  const body = { ...withoutEmpty(draft), prevHash };
  const hash = sha256Hex(stableStringify(body));
  const event: AuditEvent = { ...body, hash };
  return { ...state, audit: [...state.audit, event] };
}

export function verifyAuditChain(events: readonly AuditEvent[]): boolean {
  let prev = GENESIS_HASH;
  for (const event of events) {
    if (event.prevHash !== prev) return false;
    const { hash, ...body } = event;
    if (sha256Hex(stableStringify(body)) !== hash) return false;
    prev = hash;
  }
  return true;
}
