// server/errors.ts
var DatabaseConfigError = class extends Error {
  constructor() {
    const present = [
      process.env.TURSO_DATABASE_URL ? "TURSO_DATABASE_URL" : "",
      process.env.TURSO_AUTH_TOKEN ? "TURSO_AUTH_TOKEN" : "",
      process.env.POSTGRES_URL || process.env.POSTGRES_URL_NON_POOLING || process.env.DATABASE_URL ? "POSTGRES_URL" : ""
    ].filter(Boolean);
    super(
      `The ledger database is not configured. Present: ${present.join(", ") || "none"}. Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN.`
    );
    this.name = "DatabaseConfigError";
  }
};
var LedgerConnectionError = class extends Error {
  kind;
  host;
  constructor(kind, host, message, cause) {
    super(message, cause === void 0 ? void 0 : { cause });
    this.name = "LedgerConnectionError";
    this.kind = kind;
    this.host = host;
  }
};
function connectionError(kind, host, error, statement) {
  const sql = statement ? redact(statement.replace(/\s+/g, " ").slice(0, 180)) : "";
  const detail = redact(causeChain(error)) || "The request failed.";
  const message = sql ? `${kind} (${host}) ${sql}: ${detail}` : `${kind} (${host}): ${detail}`;
  const wrapped = new LedgerConnectionError(kind, host, message, error);
  console.error("[otello] ledger connection failed", {
    kind,
    host,
    sql,
    detail,
    stack: error instanceof Error ? error.stack : void 0
  });
  return wrapped;
}
function publicErrorMessage(error) {
  if (error instanceof LedgerConnectionError || error instanceof DatabaseConfigError) return redact(error.message).slice(0, 700);
  return (redact(causeChain(error)) || "The server could not complete that operation.").slice(0, 700);
}
function logRequestFailure(status, error) {
  console.error("[otello] request failed", {
    status,
    message: publicErrorMessage(error),
    stack: error instanceof Error ? error.stack : void 0
  });
}
function causeChain(error) {
  const parts = [];
  const seen = /* @__PURE__ */ new Set();
  let current2 = error;
  while (current2 != null && !seen.has(current2) && parts.length < 4) {
    seen.add(current2);
    if (current2 instanceof Error) {
      const code = codeOf(current2);
      const text = current2.message?.trim() || current2.name;
      parts.push(code ? `${text} [${code}]` : text);
      current2 = current2.cause;
    } else {
      parts.push(String(current2));
      break;
    }
  }
  return parts.filter(Boolean).join(" \u2014 ");
}
function codeOf(error) {
  const code = error.code;
  if (typeof code === "string" && code) return code;
  if (typeof code === "number") return String(code);
  return void 0;
}
function redact(text) {
  return text.replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[redacted]").replace(/\b(?:postgres|postgresql|libsql|https?):\/\/[^\s'")]+/gi, (url) => {
    try {
      const parsed = new URL(url.replace(/^libsql:/i, "https:"));
      return `${parsed.protocol}//${parsed.host}`;
    } catch {
      return "[redacted-url]";
    }
  });
}

// server/fail.ts
function sendFailure(res, error) {
  const tooLarge = error instanceof Error && error.message === "too large";
  const missingDatabase = error instanceof DatabaseConfigError;
  const status = tooLarge ? 413 : missingDatabase ? 503 : 500;
  const message = tooLarge ? "That request is too large." : publicErrorMessage(error);
  logRequestFailure(status, error);
  if (!res.headersSent) {
    res.statusCode = status;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.setHeader("cache-control", "no-store");
  }
  res.end(JSON.stringify({ errors: [message] }));
}

// src/lib/hash.ts
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
function sha256Hex(text) {
  return bytesToHex(sha256(utf8ToBytes(text)));
}

// src/lib/canonical.ts
function stableStringify(value) {
  if (value === null) return "null";
  const kind = typeof value;
  if (kind === "string" || kind === "boolean") return JSON.stringify(value);
  if (kind === "number") {
    if (!Number.isFinite(value) || !Number.isInteger(value)) {
      throw new Error("Canonical JSON only accepts integers");
    }
    return JSON.stringify(value);
  }
  if (kind !== "object") throw new Error("Unsupported canonical value");
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  const record = value;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => {
    if (record[key] === void 0) throw new Error(`Cannot canonicalize undefined at ${key}`);
    return `${JSON.stringify(key)}:${stableStringify(record[key])}`;
  }).join(",")}}`;
}
function sortMethods(methods) {
  return [...methods].sort((a, b) => a.localeCompare(b));
}
function sameMethods(left, right) {
  const a = sortMethods(left);
  const b = sortMethods(right);
  return a.length === b.length && a.every((method, index) => method === b[index]);
}
function agreementCanonical(payload2) {
  return stableStringify({
    ...payload2,
    permittedMethods: sortMethods(payload2.permittedMethods)
  });
}

// src/lib/ids.ts
function nextId(prefix) {
  const bytes = new Uint8Array(9);
  crypto.getRandomValues(bytes);
  const alphabet = "abcdefghijkmnopqrstuvwxyz23456789";
  let out = "";
  for (const byte of bytes) out += alphabet[byte % alphabet.length];
  return `${prefix}_${out}`;
}
function bytesToB64(bytes) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = "";
  for (const byte of view) bin += String.fromCharCode(byte);
  return btoa(bin);
}
function b64ToBytes(value) {
  const bin = atob(value);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}
function bytesToB64Url(bytes) {
  return bytesToB64(bytes).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

// src/lib/crypto.ts
var ECDSA = { name: "ECDSA", namedCurve: "P-256" };
async function generateSigningKey() {
  const pair = await crypto.subtle.generateKey(ECDSA, true, ["sign", "verify"]);
  const publicJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const privateJwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  return { publicJwk, privateJwk };
}
async function signCanonical(privateJwk, canonical) {
  const key = await crypto.subtle.importKey("jwk", privateJwk, ECDSA, false, ["sign"]);
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new TextEncoder().encode(canonical)
  );
  return bytesToB64(signature);
}
async function verifySignature(publicJwk, canonical, signatureB64) {
  const key = await crypto.subtle.importKey("jwk", publicJwk, ECDSA, false, ["verify"]);
  return crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    b64ToBytes(signatureB64),
    new TextEncoder().encode(canonical)
  );
}
function samePublicKey(left, right) {
  return left.kty === right.kty && left.crv === right.crv && left.x === right.x && left.y === right.y;
}
async function signAgreement(input) {
  const canonical = agreementCanonical(input.payload);
  const signatureB64 = await signCanonical(input.privateJwk, canonical);
  return {
    payload: input.payload,
    canonical,
    hashHex: sha256Hex(canonical),
    signatureB64,
    signerId: input.signerId,
    publicKeyJwk: input.publicJwk,
    signedAt: input.signedAt
  };
}
async function verifyAgreement(agreement) {
  if (!agreement) return false;
  try {
    const canonical = agreementCanonical(agreement.payload);
    if (canonical !== agreement.canonical) return false;
    if (sha256Hex(canonical) !== agreement.hashHex) return false;
    return await verifySignature(agreement.publicKeyJwk, canonical, agreement.signatureB64);
  } catch {
    return false;
  }
}

// src/lib/types.ts
var NETWORKS = ["ethereum", "base", "arbitrum", "polygon"];
var RPC_METHODS = [
  "eth_blockNumber",
  "eth_getBalance",
  "eth_getBlockByNumber",
  "eth_call",
  "eth_getTransactionReceipt"
];
var REVOCATION_CONDITIONS = [
  "The provider may revoke the lease, with a recorded reason, if capacity is withdrawn.",
  "Access is refused while the agent or the provider is disabled. Accrued usage stays on the books.",
  "Otello refuses further use when the lease expires, the request allowance is exhausted, or the spending cap is reached.",
  "The server checks the lease before a request is forwarded. An offer with no endpoint is simulated locally and is not called."
];
var RATE_WINDOW_MS = 6e4;
var GENESIS_HASH = "genesis";
var MAX_BATCH = 1e5;
var MIN_DURATION_MS = 15e3;

// src/lib/audit.ts
function withoutEmpty(draft) {
  const body = {
    id: nextId("evt"),
    timestamp: draft.timestamp,
    type: draft.type,
    details: draft.details,
    prevHash: GENESIS_HASH
  };
  if (draft.agentId) body.agentId = draft.agentId;
  if (draft.providerId) body.providerId = draft.providerId;
  if (draft.leaseId) body.leaseId = draft.leaseId;
  if (draft.resourceId) body.resourceId = draft.resourceId;
  if (draft.network) body.network = draft.network;
  return body;
}
function appendAudit(state, draft) {
  for (const value of Object.values(draft.details)) {
    if (typeof value === "string" && value.includes("otl_sim_")) {
      throw new Error("Refusing to write a credential secret into the audit log.");
    }
  }
  const prevHash = state.audit.length > 0 ? state.audit[state.audit.length - 1].hash : GENESIS_HASH;
  const body = { ...withoutEmpty(draft), prevHash };
  const hash = sha256Hex(stableStringify(body));
  const event = { ...body, hash };
  return { ...state, audit: [...state.audit, event] };
}

// src/lib/credentials.ts
function generateCredential(lease, now) {
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
    status: "valid"
  };
}
function invalidateCredential(credential, reason, now) {
  if (!credential || credential.status === "invalid") return credential;
  return {
    ...credential,
    status: "invalid",
    invalidReason: reason,
    invalidatedAt: now
  };
}
function secretsMatch(left, right) {
  const encoder = new TextEncoder();
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  const length = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < length; i += 1) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

// src/lib/money.ts
function costForRequests(requestCount, pricePerThousandMicro) {
  if (!Number.isInteger(requestCount) || requestCount < 0) {
    throw new Error("requestCount must be a non-negative integer");
  }
  if (!Number.isInteger(pricePerThousandMicro) || pricePerThousandMicro < 0) {
    throw new Error("pricePerThousandMicro must be a non-negative integer");
  }
  const product = BigInt(requestCount) * BigInt(pricePerThousandMicro);
  const cost = product / 1000n;
  if (cost > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("cost exceeds the safe integer range");
  }
  return Number(cost);
}
function formatUsd(micro) {
  const sign = micro < 0 ? "-" : "";
  const abs = Math.abs(Math.trunc(micro));
  const dollars = Math.floor(abs / 1e6);
  const frac = abs % 1e6;
  const cents = Math.floor(frac / 1e4);
  if (frac % 1e4 === 0) {
    return `${sign}$${dollars.toLocaleString("en-US")}.${cents.toString().padStart(2, "0")}`;
  }
  const digits = frac.toString().padStart(6, "0").replace(/0+$/, "");
  return `${sign}$${dollars.toLocaleString("en-US")}.${digits.padEnd(2, "0")}`;
}

// src/lib/policy.ts
function requestsInWindow(log, now) {
  const cutoff = now - RATE_WINDOW_MS;
  return log.reduce((sum, sample) => sum + (sample.at > cutoff ? sample.count : 0), 0);
}
function remainingRequests(lease) {
  return Math.max(0, lease.maxRequests - lease.usage.requests);
}
function remainingBudget(lease) {
  return Math.max(0, lease.spendingCapMicro - lease.usage.costMicro);
}
function leaseIsMathematicallyExhausted(lease) {
  if (lease.usage.requests >= lease.maxRequests) return true;
  const one = costForRequests(1, lease.pricing.pricePerThousandMicro);
  return remainingBudget(lease) < one;
}
function leaseTermsMatchAgreement(lease) {
  const agreement = lease.agreement;
  if (!agreement) return false;
  const payload2 = agreement.payload;
  return payload2.leaseId === lease.id && payload2.agentId === lease.agentId && payload2.providerId === lease.providerId && payload2.resourceId === lease.resourceId && payload2.network === lease.network && payload2.startAt === lease.startAt && payload2.expiresAt === lease.expiresAt && payload2.usageAllowance === lease.maxRequests && payload2.spendingCapMicro === lease.spendingCapMicro && payload2.requestRatePerMinute === lease.maxRequestRate && payload2.pricingModel === lease.pricing.model && payload2.pricePerThousandMicro === lease.pricing.pricePerThousandMicro && sameMethods(payload2.permittedMethods, lease.permittedMethods);
}
function deny(code, reason) {
  return { ok: false, code, reason };
}
function evaluatePolicy(state, input, now) {
  if (!Number.isInteger(input.requestCount) || input.requestCount < 1) {
    return deny("invalid_count", "Request count must be a positive integer.");
  }
  if (input.requestCount > MAX_BATCH) {
    return deny("invalid_count", `A single operation accepts at most ${MAX_BATCH.toLocaleString("en-US")} requests.`);
  }
  const lease = state.leases.find((item) => item.id === input.leaseId);
  if (!lease) return deny("lease_not_found", "No lease matches that identifier.");
  if (lease.agentId !== input.agentId) return deny("agent_mismatch", "This lease belongs to a different agent.");
  const agent = state.agents.find((item) => item.id === lease.agentId);
  if (!agent) return deny("agent_missing", "No agent is registered for this lease.");
  if (agent.status !== "active") return deny("agent_disabled", "Agent is disabled. Access is refused.");
  const provider = state.providers.find((item) => item.id === lease.providerId);
  if (!provider) return deny("provider_missing", "No provider is registered for this lease.");
  if (provider.status !== "active") return deny("provider_disabled", "Provider is disabled. Access is refused.");
  if (lease.status === "rejected") return deny("rejected", "The lease was rejected.");
  if (lease.status === "revoked") {
    const because = lease.revocationReason ? ` ${lease.revocationReason}` : "";
    return deny("revoked", `The lease was revoked.${because}`);
  }
  if (lease.status === "expired" || now >= lease.expiresAt) return deny("expired", "The lease expired.");
  if (lease.status === "exhausted" || leaseIsMathematicallyExhausted(lease)) {
    return deny("exhausted", "The lease is exhausted. The usage allowance or spending cap has been consumed.");
  }
  if (lease.status === "requested") return deny("awaiting_approval", "The lease is still awaiting provider approval.");
  if (lease.status === "approved" && now < lease.startAt) return deny("not_started", "The lease has not reached its start time.");
  if (lease.status !== "active") return deny("not_active", "The lease is not active.");
  if (now < lease.startAt) return deny("not_started", "The lease has not reached its start time.");
  if (!lease.agreement) return deny("agreement_missing", "This lease has no signed agreement.");
  if (!leaseTermsMatchAgreement(lease)) {
    return deny("agreement_mismatch", "The lease terms no longer match the signed agreement.");
  }
  const credential = lease.credential;
  if (!credential) return deny("credential_missing", "No credential has been issued for this lease.");
  if (credential.status !== "valid" || now >= credential.expiresAt) {
    const because = credential.invalidReason ? ` ${credential.invalidReason}` : "";
    return deny("credential_invalid", `The credential is no longer valid.${because}`);
  }
  if (credential.leaseId !== lease.id || credential.agentId !== lease.agentId || credential.resourceId !== lease.resourceId || credential.network !== lease.network) {
    return deny("credential_mismatch", "The credential is not scoped to this lease.");
  }
  if (!secretsMatch(input.credentialSecret, credential.secret)) {
    return deny("credential_mismatch", "The presented credential does not match the credential issued for this lease.");
  }
  if (!lease.permittedMethods.includes(input.method) || !credential.permittedMethods.includes(input.method)) {
    return deny("method_denied", `Method ${input.method} is not permitted by this lease.`);
  }
  const inWindow = requestsInWindow(lease.rateLog, now);
  if (inWindow + input.requestCount > lease.maxRequestRate) {
    return deny(
      "rate_exceeded",
      `Request rate would be ${inWindow + input.requestCount} per minute, above the lease limit of ${lease.maxRequestRate}.`
    );
  }
  const requestsLeft = remainingRequests(lease);
  if (input.requestCount > requestsLeft) {
    return deny(
      "allowance_exceeded",
      `This batch of ${input.requestCount} requests exceeds the remaining allowance of ${requestsLeft}.`
    );
  }
  const costMicro = costForRequests(input.requestCount, lease.pricing.pricePerThousandMicro);
  const budgetLeft = remainingBudget(lease);
  if (costMicro > budgetLeft) {
    return deny(
      "spending_cap_exceeded",
      `This batch would cost ${formatUsd(costMicro)}, above the remaining budget of ${formatUsd(budgetLeft)}.`
    );
  }
  const requestsAfter = requestsLeft - input.requestCount;
  const budgetAfter = budgetLeft - costMicro;
  const one = costForRequests(1, lease.pricing.pricePerThousandMicro);
  return {
    ok: true,
    costMicro,
    unitPriceMicroPerThousand: lease.pricing.pricePerThousandMicro,
    willExhaust: requestsAfter === 0 || budgetAfter < one
  };
}

// src/lib/reconcile.ts
function replaceLease(state, leaseId, lease) {
  return {
    ...state,
    leases: state.leases.map((item) => item.id === leaseId ? lease : item)
  };
}
function invalidate(state, lease, reason, now, type) {
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
      reason
    }
  });
  return next;
}
function reconcile(state, now) {
  let next = state;
  for (const lease of state.leases) {
    next = reconcileOne(next, lease.id, now);
  }
  return next;
}
function reconcileOne(state, leaseId, now) {
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
  if ((lease.status === "expired" || lease.status === "exhausted" || lease.status === "revoked" || lease.status === "rejected") && lease.credential?.status === "valid") {
    return invalidate(state, lease, `Credential invalidated because the lease is ${lease.status}.`, now, "credential.invalidated");
  }
  return state;
}
function activate(state, lease, now) {
  const credential = lease.credential?.status === "valid" ? lease.credential : generateCredential(lease, now);
  const issued = !lease.credential || lease.credential.status !== "valid";
  const nextLease = {
    ...lease,
    status: "active",
    activatedAt: lease.activatedAt ?? now,
    credential,
    timeline: [...lease.timeline, { at: now, status: "active", note: "Start time reached. Temporary credential issued." }]
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
    details: { credentialId: credential.id }
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
        expiresAt: credential.expiresAt
      }
    });
  }
  return next;
}
function expire(state, lease, now, note) {
  const credential = invalidateCredential(lease.credential, "Lease expired.", now);
  const nextLease = {
    ...lease,
    status: "expired",
    expiredAt: now,
    credential,
    timeline: [...lease.timeline, { at: now, status: "expired", note }]
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
    details: { expiresAt: lease.expiresAt }
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
      details: { credentialId: lease.credential.id, reason: "Lease expired." }
    });
  }
  return next;
}
function exhaust(state, lease, now) {
  const reason = "Usage allowance or spending cap reached.";
  const credential = invalidateCredential(lease.credential, reason, now);
  const nextLease = {
    ...lease,
    status: "exhausted",
    exhaustedAt: now,
    credential,
    timeline: [...lease.timeline, { at: now, status: "exhausted", note: reason }]
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
      costMicro: lease.usage.costMicro
    }
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
      details: { credentialId: lease.credential.id, reason }
    });
  }
  return next;
}

// src/lib/rpc.ts
var CHAIN_IDS = {
  ethereum: 1,
  base: 8453,
  arbitrum: 42161,
  polygon: 137
};
var unavailableExecutor = async () => ({
  ok: false,
  execution: "unavailable",
  reason: "RPC execution is unavailable. This resource has no endpoint configured, so the request was not sent."
});
var exampleExecutor = async (context) => ({
  ok: true,
  execution: "example",
  body: localSample(context),
  note: `Example ${context.network} sample for chain id ${CHAIN_IDS[context.network]}. Not sent to a network. ${context.requestCount.toLocaleString("en-US")} requests were evaluated as one batch.`
});
var simulatedExecutor = async (context) => ({
  ok: true,
  execution: "simulated",
  body: localSample(context),
  note: `Simulated ${context.network} response. Not sent to a provider or a network. ${context.requestCount.toLocaleString("en-US")} requests are priced from the signed agreement.`
});
function localSample(context) {
  const block = 21e6 + Math.floor(context.now / 12e3);
  const sampleCount = Math.min(3, Math.max(0, context.requestCount));
  return Array.from({ length: sampleCount }, (_, index) => sampleFor(context.method, block, index));
}
function sampleFor(method, block, index) {
  const number = `0x${(block + index).toString(16)}`;
  switch (method) {
    case "eth_blockNumber":
      return number;
    case "eth_getBalance":
      return `0x${(10n ** 18n * BigInt(index + 1)).toString(16)}`;
    case "eth_getBlockByNumber":
      return { number, hash: `0x${"ab".repeat(31)}${index.toString(16)}`, transactions: [] };
    case "eth_call":
      return `0x${(index + 1).toString(16).padStart(64, "0")}`;
    case "eth_getTransactionReceipt":
      return { status: "0x1", blockNumber: number, gasUsed: "0x5208", transactionIndex: `0x${index.toString(16)}` };
  }
}

// src/lib/engine.ts
function ok(state, extra = {}) {
  return { state, errors: [], ...extra };
}
function fail(state, errors) {
  return { state, errors };
}
function endpointProblem(value) {
  if (value === void 0 || value === null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  let url;
  try {
    url = new URL(trimmed);
  } catch {
    return "Endpoint must be an http or https URL.";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return "Endpoint must be an http or https URL.";
  if (url.username || url.password) return "Enter the endpoint without a username or password in the URL.";
  return null;
}
function normalizeEndpoint(value) {
  if (value === void 0 || value === null) return void 0;
  const trimmed = value.trim();
  if (!trimmed) return void 0;
  return new URL(trimmed).toString();
}
function leaseById(state, leaseId) {
  return state.leases.find((lease) => lease.id === leaseId);
}
function withLease(state, leaseId, update) {
  return {
    ...state,
    leases: state.leases.map((lease) => lease.id === leaseId ? update(lease) : lease)
  };
}
function validateResourceDraft(draft) {
  const errors = [];
  if (!draft.name.trim() || draft.name.trim().length > 80) errors.push("Name the resource in 80 characters or fewer.");
  if (!draft.summary.trim() || draft.summary.trim().length > 240) errors.push("Add a short summary, 240 characters or fewer.");
  if (!draft.region.trim()) errors.push("Name a region.");
  if (!NETWORKS.includes(draft.network)) errors.push("Choose a supported network.");
  if (!["available", "limited", "unavailable"].includes(draft.availability)) errors.push("Choose an availability.");
  if (!Number.isInteger(draft.pricePerThousandMicro) || draft.pricePerThousandMicro < 1e3) {
    errors.push("Price must be at least $0.001 per 1,000 requests.");
  }
  if (!Number.isInteger(draft.requestRateLimit) || draft.requestRateLimit < 1 || draft.requestRateLimit > 1e5) {
    errors.push("Request rate must be between 1 and 100,000 per minute.");
  }
  if (!Number.isInteger(draft.maxLeaseDurationMs) || draft.maxLeaseDurationMs < MIN_DURATION_MS || draft.maxLeaseDurationMs > 30 * 24 * 60 * 60 * 1e3) {
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
function validateLeaseRequest(state, input, now) {
  const errors = [];
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
  else if (input.startAt < now - 6e4) errors.push("Start time cannot be more than a minute in the past.");
  return errors;
}
function requestLease(state, input, now) {
  const errors = validateLeaseRequest(state, input, now);
  if (errors.length > 0) return fail(state, errors);
  const resource = state.resources.find((item) => item.id === input.resourceId);
  const id = nextId("lse");
  const permittedMethods = sortMethods(input.permittedMethods);
  const lease = {
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
    timeline: [{ at: now, status: "requested", note: "Request submitted. Waiting for the provider." }]
  };
  let next = { ...state, leases: [...state.leases, lease] };
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
      durationMs: lease.durationMs
    }
  });
  return ok(next, { leaseId: id });
}
function rejectLease(state, leaseId, providerId, reason, now) {
  const lease = leaseById(state, leaseId);
  if (!lease) return fail(state, ["No lease matches that identifier."]);
  if (lease.providerId !== providerId) return fail(state, ["Only the offering provider can reject this request."]);
  if (lease.status !== "requested") return fail(state, ["Only a pending request can be rejected."]);
  const trimmed = reason.trim();
  if (trimmed.length < 3) return fail(state, ["Record a reason for the rejection."]);
  if (trimmed.length > 400) return fail(state, ["Keep the reason under 400 characters."]);
  let next = withLease(state, leaseId, (current2) => ({
    ...current2,
    status: "rejected",
    rejectedAt: now,
    rejectionReason: trimmed,
    timeline: [...current2.timeline, { at: now, status: "rejected", note: trimmed }]
  }));
  next = appendAudit(next, {
    timestamp: now,
    type: "lease.rejected",
    agentId: lease.agentId,
    providerId: lease.providerId,
    leaseId: lease.id,
    resourceId: lease.resourceId,
    network: lease.network,
    details: { reason: trimmed }
  });
  return ok(next, { leaseId });
}
function payloadFromLease(lease, version, createdAt) {
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
    createdAt
  };
}
async function privateKeyCanSign(jwk) {
  if (!jwk?.d || !jwk.x || !jwk.y) return false;
  try {
    await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
    return true;
  } catch {
    return false;
  }
}
async function approveLease(state, leaseId, providerId, now) {
  const lease = leaseById(state, leaseId);
  if (!lease) return fail(state, ["No lease matches that identifier."]);
  if (lease.providerId !== providerId) return fail(state, ["Only the offering provider can approve this request."]);
  if (lease.status !== "requested") return fail(state, ["Only a pending request can be approved."]);
  if (now >= lease.expiresAt) return fail(state, ["The requested window has already ended."]);
  let provider = state.providers.find((item) => item.id === providerId);
  if (!provider || provider.status !== "active") return fail(state, ["The provider is disabled and cannot sign agreements."]);
  let next = state;
  let privateJwk = next.keystore[providerId];
  if (!await privateKeyCanSign(privateJwk)) {
    const keys = await generateSigningKey();
    privateJwk = keys.privateJwk;
    next = {
      ...next,
      providers: next.providers.map((item) => item.id === providerId ? { ...item, publicKeyJwk: keys.publicJwk } : item),
      keystore: { ...next.keystore, [providerId]: keys.privateJwk }
    };
    provider = next.providers.find((item) => item.id === providerId) ?? provider;
  }
  const payload2 = payloadFromLease(lease, 1, now);
  const agreement = await signAgreement({
    privateJwk,
    publicJwk: provider.publicKeyJwk,
    signerId: provider.id,
    payload: payload2,
    signedAt: now
  });
  next = withLease(next, leaseId, (current2) => ({
    ...current2,
    status: "approved",
    approvedAt: now,
    agreement,
    timeline: [...current2.timeline, { at: now, status: "approved", note: "Provider signed agreement version 1." }]
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
      signerId: provider.id
    }
  });
  next = appendAudit(next, {
    timestamp: now,
    type: "lease.approved",
    agentId: lease.agentId,
    providerId: lease.providerId,
    leaseId: lease.id,
    resourceId: lease.resourceId,
    network: lease.network,
    details: { hashHex: agreement.hashHex }
  });
  next = reconcile(next, now);
  return ok(next, { leaseId });
}
function revokeLease(state, leaseId, reason, now) {
  const lease = leaseById(state, leaseId);
  if (!lease) return fail(state, ["No lease matches that identifier."]);
  if (lease.status !== "active" && lease.status !== "approved") return fail(state, ["Only an approved or active lease can be revoked."]);
  const trimmed = reason.trim();
  if (trimmed.length < 3) return fail(state, ["Record a reason for the revocation."]);
  if (trimmed.length > 400) return fail(state, ["Keep the reason under 400 characters."]);
  const hadCredential = lease.credential?.status === "valid";
  const credential = invalidateCredential(lease.credential, "Lease revoked.", now);
  let next = withLease(state, leaseId, (current2) => ({
    ...current2,
    status: "revoked",
    revokedAt: now,
    revocationReason: trimmed,
    credential,
    timeline: [...current2.timeline, { at: now, status: "revoked", note: trimmed }]
  }));
  next = appendAudit(next, {
    timestamp: now,
    type: "lease.revoked",
    agentId: lease.agentId,
    providerId: lease.providerId,
    leaseId: lease.id,
    resourceId: lease.resourceId,
    network: lease.network,
    details: { reason: trimmed }
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
      details: { credentialId: lease.credential.id, reason: "Lease revoked." }
    });
  }
  return ok(next, { leaseId });
}
function usageIdentity(lease, input, now, outcome, costMicro, reason, execution, latencyMs) {
  if (!lease) return void 0;
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
    ...reason ? { reason } : {},
    ...input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {},
    ...execution ? { execution } : {},
    ...latencyMs !== void 0 ? { latencyMs } : {}
  };
}
function denyRpc(state, input, reason, now, execution, latencyMs) {
  const lease = leaseById(state, input.leaseId);
  const event = usageIdentity(lease, input, now, "denied", 0, reason, execution, latencyMs);
  let next = state;
  if (event) next = { ...next, usageEvents: [...next.usageEvents, event] };
  next = appendAudit(next, {
    timestamp: now,
    type: "rpc.denied",
    ...lease ? {
      agentId: lease.agentId,
      providerId: lease.providerId,
      leaseId: lease.id,
      resourceId: lease.resourceId,
      network: lease.network
    } : { leaseId: input.leaseId, agentId: input.agentId },
    details: {
      method: input.method,
      requestCount: input.requestCount,
      reason,
      ...execution ? { execution } : {},
      ...latencyMs !== void 0 ? { latencyMs } : {},
      ...lease?.credential ? { credentialId: lease.credential.id } : {}
    }
  });
  return {
    state: next,
    result: {
      ok: false,
      reason,
      costMicro: 0,
      requestCount: input.requestCount,
      replayed: false,
      usageEventId: event?.id
    }
  };
}
function replayNote(execution) {
  if (execution === "provider") return "Replayed a recorded acceptance. The endpoint was not called again.";
  if (execution === "example") return "Replayed an example acceptance. Nothing was sent.";
  if (execution === "simulated") return "Replayed a recorded simulation. Nothing was sent again.";
  return "Replayed a recorded result. Nothing was sent again.";
}
async function submitRpc(state, input, now, executor = unavailableExecutor) {
  const reconciled = reconcile(state, now);
  if (input.idempotencyKey) {
    const prior = reconciled.usageEvents.find(
      (event2) => event2.leaseId === input.leaseId && event2.idempotencyKey === input.idempotencyKey
    );
    if (prior) {
      const response2 = prior.outcome === "accepted" ? {
        execution: prior.execution ?? "unavailable",
        requestCount: prior.requestCount,
        ...prior.latencyMs !== void 0 ? { latencyMs: prior.latencyMs } : {},
        note: replayNote(prior.execution)
      } : void 0;
      return {
        state: reconciled,
        result: {
          ok: prior.outcome === "accepted",
          reason: prior.reason,
          response: response2,
          costMicro: prior.costMicro,
          requestCount: prior.requestCount,
          replayed: true,
          usageEventId: prior.id
        }
      };
    }
  }
  if (input.params !== void 0 && !Array.isArray(input.params) && (typeof input.params !== "object" || input.params === null)) {
    return denyRpc(reconciled, input, "Params must be a JSON array or object.", now);
  }
  const decision = evaluatePolicy(reconciled, input, now);
  if (!decision.ok) return denyRpc(reconciled, input, decision.reason, now);
  const lease = leaseById(reconciled, input.leaseId);
  const provider = reconciled.providers.find((item) => item.id === lease.providerId);
  const resource = reconciled.resources.find((item) => item.id === lease.resourceId);
  if (!lease.agreement || !samePublicKey(lease.agreement.publicKeyJwk, provider.publicKeyJwk) || lease.agreement.signerId !== provider.id) {
    return denyRpc(reconciled, input, "The signer does not match the provider's registered key.", now);
  }
  if (!leaseTermsMatchAgreement(lease) || !await verifyAgreement(lease.agreement)) {
    return denyRpc(reconciled, input, "Signature verification failed. Access is refused.", now);
  }
  const execution = await executor({
    endpointUrl: resource?.endpointUrl,
    network: lease.network,
    method: input.method,
    requestCount: input.requestCount,
    params: input.params ?? [],
    now,
    origin: reconciled.origin
  });
  if (!execution.ok) {
    return denyRpc(
      reconciled,
      input,
      execution.reason ?? "The request was not completed. Nothing was charged.",
      now,
      execution.execution,
      execution.latencyMs
    );
  }
  const response = {
    execution: execution.execution,
    requestCount: input.requestCount,
    ...execution.latencyMs !== void 0 ? { latencyMs: execution.latencyMs } : {},
    ...execution.body !== void 0 ? { body: execution.body } : {},
    note: execution.note ?? (execution.execution === "provider" ? "Forwarded to the configured endpoint." : "Recorded without a network call.")
  };
  const event = usageIdentity(lease, input, now, "accepted", decision.costMicro, void 0, execution.execution, execution.latencyMs);
  const cutoff = now - 6e4;
  let next = withLease(reconciled, lease.id, (current2) => ({
    ...current2,
    usage: {
      requests: current2.usage.requests + input.requestCount,
      costMicro: current2.usage.costMicro + decision.costMicro
    },
    rateLog: [...current2.rateLog.filter((sample) => sample.at > cutoff), { at: now, count: input.requestCount }]
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
      ...execution.latencyMs !== void 0 ? { latencyMs: execution.latencyMs } : {}
    }
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
      usageEventId: event.id
    }
  };
}
async function recordVerification(state, leaseId, now) {
  const lease = leaseById(state, leaseId);
  if (!lease?.agreement) return fail(state, ["This lease has no signed agreement."]);
  const verified = await verifyAgreement(lease.agreement);
  const matches = leaseTermsMatchAgreement(lease);
  const provider = state.providers.find((item) => item.id === lease.providerId);
  const signerOk = Boolean(
    provider && lease.agreement.signerId === provider.id && samePublicKey(lease.agreement.publicKeyJwk, provider.publicKeyJwk)
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
      agreementVersion: lease.agreement.payload.agreementVersion
    }
  });
  return passed ? ok(next, { leaseId }) : fail(next, ["Signature verification failed."]);
}
function registerAgent(state, name, mandate, now, ownerId = "local") {
  const trimmed = name.trim();
  const desk = mandate.trim();
  if (!trimmed || trimmed.length > 60) return fail(state, ["Name the agent in 60 characters or fewer."]);
  if (!desk || desk.length > 180) return fail(state, ["Describe the mandate in 180 characters or fewer."]);
  if (!ownerId) return fail(state, ["An owner is required."]);
  const agent = {
    id: nextId("agt"),
    name: trimmed,
    mandate: desk,
    status: "active",
    ownerId,
    createdAt: now
  };
  let next = { ...state, agents: [...state.agents, agent] };
  next = appendAudit(next, {
    timestamp: now,
    type: "agent.registered",
    agentId: agent.id,
    details: { name: agent.name }
  });
  return ok(next, { agentId: agent.id });
}
function setAgentStatus(state, agentId, status, now) {
  const agent = state.agents.find((item) => item.id === agentId);
  if (!agent) return fail(state, ["No agent matches that identifier."]);
  if (agent.status === status) return ok(state);
  let next = {
    ...state,
    agents: state.agents.map((item) => item.id === agentId ? { ...item, status } : item)
  };
  next = appendAudit(next, {
    timestamp: now,
    type: "agent.status_changed",
    agentId,
    details: { status }
  });
  return ok(next);
}
function setProviderStatus(state, providerId, status, now) {
  const provider = state.providers.find((item) => item.id === providerId);
  if (!provider) return fail(state, ["No provider matches that identifier."]);
  if (provider.status === status) return ok(state);
  let next = {
    ...state,
    providers: state.providers.map((item) => item.id === providerId ? { ...item, status } : item)
  };
  next = appendAudit(next, {
    timestamp: now,
    type: "provider.status_changed",
    providerId,
    details: { status }
  });
  return ok(next);
}
function publishResource(state, providerId, draft, now) {
  const provider = state.providers.find((item) => item.id === providerId);
  if (!provider) return fail(state, ["No provider matches that identifier."]);
  if (provider.status !== "active") return fail(state, ["A disabled provider cannot publish offers."]);
  const errors = validateResourceDraft(draft);
  if (errors.length > 0) return fail(state, errors);
  const resource = {
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
    ...normalizeEndpoint(draft.endpointUrl) ? { endpointUrl: normalizeEndpoint(draft.endpointUrl) } : {}
  };
  let next = { ...state, resources: [...state.resources, resource] };
  next = appendAudit(next, {
    timestamp: now,
    type: "resource.published",
    providerId,
    resourceId: resource.id,
    network: resource.network,
    details: {
      name: resource.name,
      pricePerThousandMicro: resource.pricing.pricePerThousandMicro,
      endpointConfigured: resource.endpointConfigured
    }
  });
  return ok(next, { resourceId: resource.id });
}
function updateResource(state, resourceId, draft, now) {
  const resource = state.resources.find((item) => item.id === resourceId);
  if (!resource) return fail(state, ["No resource matches that identifier."]);
  const errors = validateResourceDraft(draft);
  if (errors.length > 0) return fail(state, errors);
  if (draft.network !== resource.network) return fail(state, ["Network stays fixed after publication."]);
  let endpointUrl = resource.endpointUrl;
  if (draft.endpointUrl === null || draft.endpointUrl === "") endpointUrl = void 0;
  else if (typeof draft.endpointUrl === "string") endpointUrl = normalizeEndpoint(draft.endpointUrl);
  const updated = {
    ...resource,
    name: draft.name.trim(),
    summary: draft.summary.trim(),
    availability: draft.availability,
    region: draft.region.trim(),
    pricing: { model: "per_thousand_requests", pricePerThousandMicro: draft.pricePerThousandMicro },
    requestRateLimit: draft.requestRateLimit,
    maxLeaseDurationMs: draft.maxLeaseDurationMs,
    supportedMethods: sortMethods(draft.supportedMethods),
    capacityRequests: draft.capacityRequests,
    endpointConfigured: Boolean(endpointUrl)
  };
  if (endpointUrl) updated.endpointUrl = endpointUrl;
  else delete updated.endpointUrl;
  let next = {
    ...state,
    resources: state.resources.map((item) => item.id === resourceId ? updated : item)
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
      endpointConfigured: updated.endpointConfigured
    }
  });
  return ok(next, { resourceId });
}
function emptyState(now) {
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
    keystore: {}
  };
}
async function addProvider(state, input, privateJwk, publicJwk) {
  const provider = {
    id: input.id,
    name: input.name,
    desk: input.desk,
    status: input.status,
    ownerId: input.ownerId,
    publicKeyJwk: publicJwk,
    createdAt: input.createdAt ?? state.seededAt
  };
  return {
    ...state,
    providers: [...state.providers, provider],
    keystore: { ...state.keystore, [provider.id]: privateJwk }
  };
}
async function registerProvider(state, name, desk, now, ownerId) {
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
    keys.publicJwk
  );
  next = appendAudit(next, {
    timestamp: now,
    type: "provider.registered",
    providerId: id,
    details: { name: trimmed }
  });
  return ok(next, { providerId: id });
}

// src/lib/seed.ts
var ALL_METHODS = [...RPC_METHODS];
var READ_METHODS = ALL_METHODS.filter((method) => method !== "eth_call");
function must(result, label) {
  if (result.errors.length > 0) throw new Error(`${label}: ${result.errors.join(" ")}`);
  return result.state;
}
function credentialSecret(state, leaseId) {
  const secret = state.leases.find((lease) => lease.id === leaseId)?.credential?.secret;
  if (!secret) throw new Error(`Seed lease ${leaseId} has no credential.`);
  return secret;
}
async function send(state, leaseId, agentId, method, requestCount, now, label) {
  const result = await submitRpc(
    state,
    { leaseId, agentId, method, requestCount, credentialSecret: credentialSecret(state, leaseId) },
    now,
    exampleExecutor
  );
  if (!result.result.ok) throw new Error(`${label}: ${result.result.reason ?? "denied"}`);
  return result.state;
}
function offer(input) {
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
    maxLeaseDurationMs: input.maxLeaseHours * 60 * 60 * 1e3,
    supportedMethods: input.supportedMethods,
    capacityRequests: input.capacityRequests,
    endpointConfigured: false
  };
}
async function createSeedState(now) {
  const hour = 60 * 60 * 1e3;
  const minute = 60 * 1e3;
  let state = emptyState(now);
  const providerDrafts = [
    { id: "prv_northline", name: "Northline Relay", desk: "Public reads from Frankfurt and Ashburn.", status: "active", ownerId: "example", createdAt: now - 40 * hour },
    { id: "prv_harbor", name: "Harbor RPC", desk: "Routes for Base, Arbitrum, and Polygon.", status: "active", ownerId: "example", createdAt: now - 36 * hour },
    { id: "prv_kiln", name: "Kiln & Copper", desk: "Archive-friendly Ethereum and lighter L2 reads.", status: "active", ownerId: "example", createdAt: now - 30 * hour },
    { id: "prv_sable", name: "Sable Index", desk: "Paused for maintenance.", status: "active", ownerId: "example", createdAt: now - 28 * hour },
    { id: "prv_marlowe", name: "Marlowe Grid", desk: "Base relay with a narrower method list.", status: "active", ownerId: "example", createdAt: now - 24 * hour }
  ];
  for (const draft of providerDrafts) {
    const keys = await generateSigningKey();
    state = await addProvider(state, draft, keys.privateJwk, keys.publicJwk);
  }
  const agents = [
    { id: "agt_meridian", name: "Meridian Desk", mandate: "Basis and funding reads on Ethereum mainnet.", status: "active", ownerId: "example", createdAt: now - 20 * hour },
    { id: "agt_lowtide", name: "Lowtide", mandate: "Cross-L2 dislocations and sequencer drift.", status: "active", ownerId: "example", createdAt: now - 18 * hour },
    { id: "agt_lantern", name: "Paper Lantern", mandate: "Research desk. Block and balance reads.", status: "active", ownerId: "example", createdAt: now - 16 * hour },
    { id: "agt_quill", name: "Halted Quill", mandate: "Disabled after a risk halt.", status: "active", ownerId: "example", createdAt: now - 48 * hour },
    { id: "agt_cinder", name: "Cinder Route", mandate: "Polygon inventory and transfer receipts.", status: "active", ownerId: "example", createdAt: now - 14 * hour }
  ];
  const resources = [
    offer({
      id: "res_northline_eth",
      name: "Northline Ethereum",
      providerId: "prv_northline",
      network: "ethereum",
      summary: "Full-node HTTP reads for mainnet. Priced at twenty cents per thousand accepted calls.",
      availability: "available",
      region: "Frankfurt",
      pricePerThousandMicro: 2e5,
      requestRateLimit: 600,
      maxLeaseHours: 24,
      supportedMethods: ALL_METHODS,
      capacityRequests: 5e6
    }),
    offer({
      id: "res_northline_base",
      name: "Northline Base",
      providerId: "prv_northline",
      network: "base",
      summary: "Base mainnet HTTP, tuned for block and balance polling.",
      availability: "available",
      region: "Ashburn",
      pricePerThousandMicro: 12e4,
      requestRateLimit: 800,
      maxLeaseHours: 12,
      supportedMethods: ALL_METHODS,
      capacityRequests: 4e6
    }),
    offer({
      id: "res_harbor_arb",
      name: "Harbor Arbitrum",
      providerId: "prv_harbor",
      network: "arbitrum",
      summary: "Sequencer-adjacent Arbitrum reads. Spare capacity is limited this session.",
      availability: "limited",
      region: "Lisbon",
      pricePerThousandMicro: 15e4,
      requestRateLimit: 400,
      maxLeaseHours: 6,
      supportedMethods: ALL_METHODS,
      capacityRequests: 15e5
    }),
    offer({
      id: "res_harbor_pol",
      name: "Harbor Polygon",
      providerId: "prv_harbor",
      network: "polygon",
      summary: "Bor full node for inexpensive inventory polling.",
      availability: "available",
      region: "Amsterdam",
      pricePerThousandMicro: 8e4,
      requestRateLimit: 900,
      maxLeaseHours: 24,
      supportedMethods: ALL_METHODS,
      capacityRequests: 6e6
    }),
    offer({
      id: "res_kiln_eth",
      name: "Kiln Archive",
      providerId: "prv_kiln",
      network: "ethereum",
      summary: "Ethereum archive reads. Higher price, lower rate, shorter leases.",
      availability: "available",
      region: "Zurich",
      pricePerThousandMicro: 45e4,
      requestRateLimit: 120,
      maxLeaseHours: 4,
      supportedMethods: ALL_METHODS,
      capacityRequests: 4e5
    }),
    offer({
      id: "res_sable_pol",
      name: "Sable Polygon Trace",
      providerId: "prv_sable",
      network: "polygon",
      summary: "Trace-capable Polygon endpoint. Withdrawn while Sable is disabled.",
      availability: "unavailable",
      region: "Paris",
      pricePerThousandMicro: 25e4,
      requestRateLimit: 200,
      maxLeaseHours: 8,
      supportedMethods: ALL_METHODS,
      capacityRequests: 25e4
    }),
    offer({
      id: "res_marlowe_base",
      name: "Marlowe Base",
      providerId: "prv_marlowe",
      network: "base",
      summary: "Base relay that does not offer eth_call.",
      availability: "available",
      region: "London",
      pricePerThousandMicro: 18e4,
      requestRateLimit: 300,
      maxLeaseHours: 8,
      supportedMethods: READ_METHODS,
      capacityRequests: 8e5
    }),
    offer({
      id: "res_kiln_arb",
      name: "Kiln Arbitrum Light",
      providerId: "prv_kiln",
      network: "arbitrum",
      summary: "A lighter Arbitrum feed for agents that only need heads and receipts.",
      availability: "available",
      region: "Zurich",
      pricePerThousandMicro: 1e5,
      requestRateLimit: 500,
      maxLeaseHours: 12,
      supportedMethods: ALL_METHODS,
      capacityRequests: 2e6
    })
  ];
  state = { ...state, agents, resources };
  const ask = (current2, input, at, label) => {
    const result = requestLease(
      current2,
      {
        ...input,
        spendingCapMicro: costForRequests(input.maxRequests, input.pricePerThousandMicro)
      },
      at
    );
    return { state: must(result, label), leaseId: result.leaseId };
  };
  const rejected = ask(
    state,
    {
      agentId: "agt_quill",
      resourceId: "res_northline_eth",
      task: "Probe halted-desk access to mainnet heads.",
      startAt: now - 26 * hour,
      durationMs: hour,
      maxRequests: 2e3,
      maxRequestRate: 60,
      permittedMethods: ["eth_blockNumber"],
      pricePerThousandMicro: 2e5
    },
    now - 26 * hour,
    "rejected request"
  );
  state = must(
    rejectLease(rejected.state, rejected.leaseId, "prv_northline", "Agent is outside the provider's allowed desk list.", now - 26 * hour + minute),
    "reject"
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
      pricePerThousandMicro: 45e4
    },
    now - 20 * hour,
    "exhausted request"
  );
  state = must(await approveLease(exhausted.state, exhausted.leaseId, "prv_kiln", now - 20 * hour + 3e4), "approve exhausted");
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
      maxRequests: 5e4,
      maxRequestRate: 600,
      permittedMethods: ALL_METHODS,
      pricePerThousandMicro: 2e5
    },
    activeStart,
    "active request"
  );
  state = must(await approveLease(active.state, active.leaseId, "prv_northline", activeStart + 2e4), "approve active");
  for (let index = 0; index <= 20; index += 1) {
    const count = index === 20 ? 400 : 600;
    state = await send(
      state,
      active.leaseId,
      "agt_meridian",
      index % 2 === 0 ? "eth_blockNumber" : "eth_getBalance",
      count,
      activeStart + (index + 1) * 28 * minute,
      "active batch"
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
      maxRequests: 5e3,
      maxRequestRate: 200,
      permittedMethods: ALL_METHODS,
      pricePerThousandMicro: 8e4
    },
    expiredStart,
    "expired request"
  );
  state = must(await approveLease(expired.state, expired.leaseId, "prv_harbor", expiredStart + 15e3), "approve expired");
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
      maxRequests: 8e3,
      maxRequestRate: 200,
      permittedMethods: ALL_METHODS,
      pricePerThousandMicro: 12e4
    },
    revokedStart,
    "revoked request"
  );
  state = must(await approveLease(revoked.state, revoked.leaseId, "prv_northline", revokedStart + 1e4), "approve revoked");
  state = await send(state, revoked.leaseId, "agt_lowtide", "eth_blockNumber", 80, revokedStart + 20 * minute, "revoked usage");
  state = must(
    revokeLease(state, revoked.leaseId, "Provider withdrew capacity after a routing incident.", revokedStart + hour),
    "revoke"
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
      maxRequests: 8e3,
      maxRequestRate: 300,
      permittedMethods: ALL_METHODS,
      pricePerThousandMicro: 8e4
    },
    expiringStart,
    "expiring request"
  );
  state = must(await approveLease(expiring.state, expiring.leaseId, "prv_harbor", expiringStart + 5e3), "approve expiring");
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
      maxRequests: 6e3,
      maxRequestRate: 120,
      permittedMethods: READ_METHODS,
      pricePerThousandMicro: 18e4
    },
    restrictedStart,
    "restricted request"
  );
  state = must(await approveLease(restricted.state, restricted.leaseId, "prv_marlowe", restrictedStart + 5e3), "approve restricted");
  state = await send(state, restricted.leaseId, "agt_lantern", "eth_getBalance", 40, restrictedStart + 8 * minute, "restricted usage");
  const future = ask(
    state,
    {
      agentId: "agt_lantern",
      resourceId: "res_northline_base",
      task: "Scheduled research window that has not started.",
      startAt: now + 2 * hour,
      durationMs: hour,
      maxRequests: 3e3,
      maxRequestRate: 100,
      permittedMethods: ["eth_blockNumber", "eth_getBalance"],
      pricePerThousandMicro: 12e4
    },
    now,
    "future request"
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
      maxRequests: 2e4,
      maxRequestRate: 180,
      permittedMethods: ALL_METHODS,
      pricePerThousandMicro: 15e4
    },
    now,
    "pending request"
  ).state;
  state = must(setAgentStatus(state, "agt_quill", "disabled", now), "disable agent");
  state = must(setProviderStatus(state, "prv_sable", "disabled", now), "disable provider");
  state = reconcile(state, now);
  return { ...state, origin: "example" };
}

// src/lib/publicState.ts
function toPublicState(state) {
  return {
    ...state,
    keystore: {},
    resources: state.resources.map((resource) => {
      const next = { ...resource, endpointConfigured: Boolean(resource.endpointUrl) };
      delete next.endpointUrl;
      return next;
    }),
    leases: state.leases.map((lease) => {
      if (!lease.credential) return lease;
      return {
        ...lease,
        credential: { ...lease.credential, secret: "" }
      };
    })
  };
}

// server/auth.ts
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

// server/db.ts
import { webcrypto } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";

// src/lib/marketSamples.ts
var METHODS = [...RPC_METHODS];
var SAMPLE_KEY = { kty: "EC", crv: "P-256" };
var LISTED_AT = 17e11;
var SAMPLE_PROVIDERS = [
  {
    id: "sample_prv_northline",
    name: "Northline Relay",
    desk: "Sample desk. Public reads from Frankfurt and Ashburn.",
    status: "active",
    ownerId: "sample",
    publicKeyJwk: SAMPLE_KEY,
    createdAt: LISTED_AT
  },
  {
    id: "sample_prv_harbor",
    name: "Harbor RPC",
    desk: "Sample desk. Routes for Arbitrum and Polygon.",
    status: "active",
    ownerId: "sample",
    publicKeyJwk: SAMPLE_KEY,
    createdAt: LISTED_AT
  },
  {
    id: "sample_prv_sable",
    name: "Sable Index",
    desk: "Sample desk. Withdrawn while the feed is down.",
    status: "active",
    ownerId: "sample",
    publicKeyJwk: SAMPLE_KEY,
    createdAt: LISTED_AT
  }
];
function offer2(input) {
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
    maxLeaseDurationMs: input.maxLeaseHours * 60 * 60 * 1e3,
    supportedMethods: METHODS,
    capacityRequests: input.capacityRequests,
    endpointConfigured: false
  };
}
var SAMPLE_RESOURCES = [
  offer2({
    id: "sample_res_northline_eth",
    name: "Northline Ethereum",
    providerId: "sample_prv_northline",
    network: "ethereum",
    summary: "Sample mainnet HTTP reads. Twenty cents per thousand accepted calls.",
    availability: "available",
    region: "Frankfurt",
    pricePerThousandMicro: 2e5,
    requestRateLimit: 600,
    maxLeaseHours: 24,
    capacityRequests: 5e6
  }),
  offer2({
    id: "sample_res_northline_base",
    name: "Northline Base",
    providerId: "sample_prv_northline",
    network: "base",
    summary: "Sample Base HTTP, listed for block and balance polling.",
    availability: "available",
    region: "Ashburn",
    pricePerThousandMicro: 12e4,
    requestRateLimit: 800,
    maxLeaseHours: 12,
    capacityRequests: 4e6
  }),
  offer2({
    id: "sample_res_harbor_arb",
    name: "Harbor Arbitrum",
    providerId: "sample_prv_harbor",
    network: "arbitrum",
    summary: "Sample Arbitrum reads. Spare capacity is limited.",
    availability: "limited",
    region: "Lisbon",
    pricePerThousandMicro: 15e4,
    requestRateLimit: 400,
    maxLeaseHours: 6,
    capacityRequests: 15e5
  }),
  offer2({
    id: "sample_res_harbor_pol",
    name: "Harbor Polygon",
    providerId: "sample_prv_harbor",
    network: "polygon",
    summary: "Sample Polygon HTTP for inexpensive inventory polling.",
    availability: "available",
    region: "Amsterdam",
    pricePerThousandMicro: 8e4,
    requestRateLimit: 900,
    maxLeaseHours: 24,
    capacityRequests: 6e6
  }),
  offer2({
    id: "sample_res_sable_pol",
    name: "Sable Polygon Trace",
    providerId: "sample_prv_sable",
    network: "polygon",
    summary: "Sample Polygon feed. Listed as unavailable.",
    availability: "unavailable",
    region: "Paris",
    pricePerThousandMicro: 25e4,
    requestRateLimit: 200,
    maxLeaseHours: 8,
    capacityRequests: 25e4
  })
];
var SAMPLE_RESOURCE_IDS = new Set(SAMPLE_RESOURCES.map((resource) => resource.id));
async function ensureSampleMarket(state) {
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
        providers: next.providers.map((item) => item.id === provider.id ? { ...item, publicKeyJwk: keys.publicJwk } : item),
        keystore: { ...next.keystore, [provider.id]: keys.privateJwk }
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
        createdAt: provider.createdAt
      },
      keys.privateJwk,
      keys.publicJwk
    );
  }
  const known = new Set(next.resources.map((resource) => resource.id));
  const missing = SAMPLE_RESOURCES.filter((resource) => !known.has(resource.id));
  if (missing.length > 0) next = { ...next, resources: [...next.resources, ...missing] };
  return next === state ? state : next;
}

// server/turso.ts
function tursoPipelineUrl(raw) {
  const trimmed = stripQuotes(raw.trim());
  let withScheme = trimmed;
  if (/^libsql:\/\//i.test(withScheme)) withScheme = `https://${withScheme.slice("libsql://".length)}`;
  else if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(withScheme)) withScheme = `https://${withScheme}`;
  const parsed = new URL(withScheme);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(`The Turso URL must use libsql, https, or http (${parsed.protocol}).`);
  }
  return `${parsed.origin}/v2/pipeline`;
}
function tursoHost(raw) {
  try {
    return new URL(tursoPipelineUrl(raw)).host;
  } catch {
    return "invalid";
  }
}
async function tursoExecute(config2, statement, params, wantRows, fetchImpl = globalThis.fetch) {
  const pipelineUrl = tursoPipelineUrl(config2.url);
  const body = JSON.stringify({
    requests: [
      {
        type: "execute",
        stmt: {
          sql: statement,
          args: params.map(encodeValue),
          named_args: [],
          want_rows: wantRows
        }
      },
      { type: "close" }
    ]
  });
  let response;
  try {
    response = await fetchImpl(pipelineUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config2.authToken}`
      },
      body,
      duplex: "half",
      signal: AbortSignal.timeout(12e3)
    });
  } catch (error) {
    throw new Error(`The Turso host did not answer (${tursoHost(config2.url)}).`, { cause: error });
  }
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${serverMessage(text) || response.statusText || "Turso rejected the request."}`);
  }
  let payload2;
  try {
    payload2 = text ? JSON.parse(text) : {};
  } catch (error) {
    throw new Error("Turso returned a response that was not JSON.", { cause: error });
  }
  const result = executeResult(payload2);
  return { row: rowFrom(result), rowsAffected: Number(result.affected_row_count ?? 0) };
}
function encodeValue(value) {
  if (value === null) return { type: "null" };
  if (typeof value === "number") {
    if (Number.isSafeInteger(value)) return { type: "integer", value: String(value) };
    return { type: "float", value };
  }
  return { type: "text", value };
}
function executeResult(payload2) {
  if (!payload2 || typeof payload2 !== "object") throw new Error("Turso returned an empty pipeline response.");
  const results = payload2.results;
  if (!Array.isArray(results) || results.length === 0) throw new Error("Turso returned no pipeline result.");
  const first = results[0];
  if (!first || typeof first !== "object") throw new Error("Turso returned an unreadable pipeline result.");
  const entry = first;
  if (entry.type === "error") {
    const message = entry.error?.message || "Turso rejected the statement.";
    const code = entry.error?.code ? ` [${entry.error.code}]` : "";
    throw new Error(`${message}${code}`);
  }
  if (entry.type !== "ok" || entry.response?.type !== "execute" || !entry.response.result) {
    throw new Error("Turso returned an unexpected pipeline result.");
  }
  return entry.response.result;
}
function rowFrom(result) {
  const values = result.rows?.[0];
  if (!values) return void 0;
  const row = {};
  values.forEach((value, index) => {
    const name = result.cols?.[index]?.name || String(index);
    row[name] = decodeValue(value);
  });
  return row;
}
function decodeValue(value) {
  if (!value || value.type === "null") return null;
  if (value.type === "integer") {
    const parsed = Number(value.value);
    return Number.isSafeInteger(parsed) ? parsed : String(value.value);
  }
  if (value.type === "float" || value.type === "text") return value.value ?? null;
  if (value.type === "blob" && value.base64) return Uint8Array.from(Buffer.from(value.base64, "base64"));
  return null;
}
function serverMessage(text) {
  const trimmed = text.trim();
  if (!trimmed) return "";
  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed.message === "string") return parsed.message;
    if (typeof parsed.error === "string") return parsed.error;
  } catch {
  }
  return trimmed.replace(/\s+/g, " ").slice(0, 300);
}
function stripQuotes(value) {
  if (value.startsWith('"') && value.endsWith('"') || value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).trim();
  }
  return value;
}

// server/db.ts
if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });
}
var sqliteExecutor;
var postgresClient;
var schemaReady;
function databaseKind() {
  if (process.env.OTELLO_SQLITE_PATH && !hosted()) return "sqlite";
  if (tursoConfig()) return "turso";
  if (postgresUrl()) return "postgres";
  if (hosted()) throw new DatabaseConfigError();
  return "sqlite";
}
function hosted() {
  return Boolean(process.env.VERCEL || process.env.VERCEL_ENV || process.env.AWS_LAMBDA_FUNCTION_NAME);
}
function envValue(name) {
  let value = process.env[name]?.trim();
  if (!value) return void 0;
  if (value.startsWith('"') && value.endsWith('"') || value.startsWith("'") && value.endsWith("'")) {
    value = value.slice(1, -1).trim();
  }
  return value ? value : void 0;
}
function postgresUrl() {
  return envValue("POSTGRES_URL_NON_POOLING") || envValue("DATABASE_URL_UNPOOLED") || envValue("POSTGRES_URL") || envValue("DATABASE_URL") || envValue("POSTGRES_PRISMA_URL");
}
function tursoConfig() {
  const url = envValue("TURSO_DATABASE_URL");
  const authToken = envValue("TURSO_AUTH_TOKEN")?.replace(/^Bearer\s+/i, "");
  if (!url || !authToken) return void 0;
  return { url, authToken, host: tursoHost(url) };
}
function toDollar(statement) {
  let index = 0;
  return statement.replace(/\?/g, () => `$${++index}`);
}
function sqlitePath() {
  return process.env.OTELLO_SQLITE_PATH || path.join(process.cwd(), "data", "otello.sqlite");
}
async function openSqlite() {
  if (sqliteExecutor) return sqliteExecutor;
  const { DatabaseSync } = await import("node:sqlite");
  const file = sqlitePath();
  mkdirSync(path.dirname(file), { recursive: true });
  const database = new DatabaseSync(file);
  database.exec("PRAGMA journal_mode = WAL;");
  sqliteExecutor = {
    async get(statement, params) {
      const row = database.prepare(statement).get(...params);
      return row;
    },
    async run(statement, params) {
      database.prepare(statement).run(...params);
    },
    async changes(statement, params) {
      const result = database.prepare(statement).run(...params);
      return Number(result.changes ?? 0);
    }
  };
  return sqliteExecutor;
}
function postgresSql() {
  if (postgresClient) return postgresClient;
  const url = postgresUrl();
  if (!url) throw new DatabaseConfigError();
  const pooled = /pooler|pgbouncer/i.test(url);
  postgresClient = postgres(url, {
    ssl: url.includes("sslmode=disable") ? false : "require",
    max: 1,
    prepare: false,
    fetch_types: false,
    idle_timeout: pooled ? 0 : 20,
    connect_timeout: 10,
    max_lifetime: 60 * 5
  });
  return postgresClient;
}
function postgresHost() {
  const url = postgresUrl();
  if (!url) return "unset";
  try {
    return new URL(url).host || "unknown";
  } catch {
    return "invalid";
  }
}
function postgresExecutor(sql) {
  const host = postgresHost();
  return {
    async get(statement, params) {
      try {
        const rows = await sql.unsafe(toDollar(statement), params);
        const row = rows[0];
        return row ? row : void 0;
      } catch (error) {
        throw connectionError("postgres", host, error, statement);
      }
    },
    async run(statement, params) {
      try {
        await sql.unsafe(toDollar(statement), params);
      } catch (error) {
        throw connectionError("postgres", host, error, statement);
      }
    },
    async changes(statement, params) {
      try {
        const rows = await sql.unsafe(toDollar(statement), params);
        return Number(rows.count ?? 0);
      } catch (error) {
        throw connectionError("postgres", host, error, statement);
      }
    }
  };
}
function tursoExecutor() {
  const config2 = tursoConfig();
  if (!config2) throw new DatabaseConfigError();
  const call = async (statement, params, wantRows) => {
    try {
      return await tursoExecute(config2, statement, params, wantRows);
    } catch (error) {
      throw connectionError("turso", config2.host, error, statement);
    }
  };
  return {
    async get(statement, params) {
      return (await call(statement, params, true)).row;
    },
    async run(statement, params) {
      await call(statement, params, false);
    },
    async changes(statement, params) {
      return (await call(statement, params, false)).rowsAffected;
    }
  };
}
async function current() {
  const kind = databaseKind();
  if (kind === "sqlite") return openSqlite();
  if (kind === "postgres") return postgresExecutor(postgresSql());
  return tursoExecutor();
}
var SQLITE_SCHEMA = `
  CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS ledgers (
    scope TEXT PRIMARY KEY,
    document TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
`;
var REMOTE_SCHEMA = `
  CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at BIGINT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    expires_at BIGINT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS ledgers (
    scope TEXT PRIMARY KEY,
    document TEXT NOT NULL,
    updated_at BIGINT NOT NULL
  );
`;
function ensureSchema() {
  schemaReady ??= (async () => {
    const executor = await current();
    const schema = databaseKind() === "sqlite" ? SQLITE_SCHEMA : REMOTE_SCHEMA;
    for (const statement of schema.split(";").map((part) => part.trim()).filter(Boolean)) {
      await executor.run(statement, []);
    }
  })().catch((error) => {
    schemaReady = void 0;
    throw error;
  });
  return schemaReady;
}
function asText(value) {
  if (typeof value === "string") return value;
  if (value instanceof Uint8Array) return new TextDecoder().decode(value);
  return null;
}
function asNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}
async function readLedgerRecord(scope) {
  await ensureSchema();
  const row = await (await current()).get("SELECT document, updated_at FROM ledgers WHERE scope = ?", [scope]);
  if (!row) return null;
  const document = asText(row.document);
  const updatedAt = asNumber(row.updated_at);
  if (!document || updatedAt === null) return null;
  return { state: JSON.parse(document), updatedAt };
}
async function readLedger(scope) {
  const record = await readLedgerRecord(scope);
  return record?.state ?? null;
}
async function writeLedger(scope, state, expectedUpdatedAt) {
  await ensureSchema();
  const stamp = expectedUpdatedAt == null ? Date.now() : Math.max(Date.now(), expectedUpdatedAt + 1);
  const document = JSON.stringify(state);
  const executor = await current();
  if (expectedUpdatedAt === void 0) {
    await executor.run(
      `INSERT INTO ledgers (scope, document, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(scope) DO UPDATE SET document = excluded.document, updated_at = excluded.updated_at`,
      [scope, document, stamp]
    );
    return true;
  }
  if (expectedUpdatedAt === null) {
    const inserted = await executor.changes(
      `INSERT INTO ledgers (scope, document, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(scope) DO NOTHING`,
      [scope, document, stamp]
    );
    return inserted > 0;
  }
  const updated = await executor.changes(
    "UPDATE ledgers SET document = ?, updated_at = ? WHERE scope = ? AND updated_at = ?",
    [document, stamp, scope, expectedUpdatedAt]
  );
  return updated > 0;
}
async function loadLedger(scope, now = Date.now()) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const record = await readLedgerRecord(scope);
    const base = record?.state ?? emptyState(now);
    const seeded = scope === "live" ? await ensureSampleMarket(base) : base;
    const next = reconcile(seeded, now);
    if (record && next === record.state) return next;
    const saved = await writeLedger(scope, next, record?.updatedAt ?? null);
    if (saved) return next;
  }
  return await readLedger(scope) ?? emptyState(now);
}
var queue = Promise.resolve();
function withLedger(task) {
  const run = queue.then(async () => {
    await ensureSchema();
    return task();
  });
  queue = run.then(
    () => void 0,
    () => void 0
  );
  return run;
}
async function commitChange(scope, task) {
  return withLedger(async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const now = Date.now();
      const record = await readLedgerRecord(scope);
      const base = record?.state ?? emptyState(now);
      const seeded = scope === "live" ? await ensureSampleMarket(base) : base;
      const prepared = reconcile(seeded, now);
      const changed = await task(prepared, now);
      if (record && changed.state === record.state) return { before: prepared, state: prepared, value: changed.value };
      const saved = await writeLedger(scope, changed.state, record?.updatedAt ?? null);
      if (!saved) continue;
      const committed = await readLedger(scope);
      if (!committed) continue;
      const leaseId = leaseIdOf(changed.value);
      if (leaseId) {
        const wanted = changed.state.leases.find((lease) => lease.id === leaseId);
        const seen = committed.leases.find((lease) => lease.id === leaseId);
        if (!wanted || !seen) continue;
        if (seen.status !== wanted.status) continue;
        if (Boolean(wanted.agreement) !== Boolean(seen.agreement)) continue;
        if (Boolean(wanted.credential) !== Boolean(seen.credential)) continue;
      }
      return { before: prepared, state: committed, value: changed.value };
    }
    throw new Error("The ledger commit did not persist.");
  });
}
function leaseIdOf(value) {
  if (!value || typeof value !== "object" || !("leaseId" in value)) return void 0;
  const leaseId = value.leaseId;
  return typeof leaseId === "string" ? leaseId : void 0;
}
async function dbGet(statement, params) {
  await ensureSchema();
  return (await current()).get(statement, params);
}
async function dbRun(statement, params) {
  await ensureSchema();
  return (await current()).run(statement, params);
}

// server/auth.ts
var COOKIE = "otello_session";
var SESSION_MS = 14 * 24 * 60 * 60 * 1e3;
function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 32);
  return `${salt.toString("base64")}.${hash.toString("base64")}`;
}
function passwordMatches(password, stored) {
  const [saltB64, hashB64] = stored.split(".");
  if (!saltB64 || !hashB64) return false;
  const salt = Buffer.from(saltB64, "base64");
  const expected = Buffer.from(hashB64, "base64");
  const actual = scryptSync(password, salt, expected.length);
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}
async function createAccount(name, password) {
  const account = { id: nextId("acct"), name };
  await dbRun("INSERT INTO accounts (id, name, password_hash, created_at) VALUES (?, ?, ?, ?)", [account.id, name, hashPassword(password), Date.now()]);
  return account;
}
async function findAccountByName(name) {
  const row = await dbGet("SELECT id, name, password_hash FROM accounts WHERE name = ?", [name]);
  if (!row || typeof row.id !== "string" || typeof row.name !== "string" || typeof row.password_hash !== "string") return null;
  return { id: row.id, name: row.name, passwordHash: row.password_hash };
}
async function findAccountById(id) {
  const row = await dbGet("SELECT id, name FROM accounts WHERE id = ?", [id]);
  if (!row || typeof row.id !== "string" || typeof row.name !== "string") return null;
  return { id: row.id, name: row.name };
}
async function openSession(accountId) {
  const token = randomBytes(32).toString("base64url");
  await dbRun("INSERT INTO sessions (token, account_id, expires_at) VALUES (?, ?, ?)", [token, accountId, Date.now() + SESSION_MS]);
  return token;
}
async function closeSession(token) {
  await dbRun("DELETE FROM sessions WHERE token = ?", [token]);
}
function asTime(value) {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string" && value.trim() !== "") return Number(value);
  return Number.NaN;
}
async function accountForToken(token) {
  if (!token) return null;
  const row = await dbGet("SELECT account_id, expires_at FROM sessions WHERE token = ?", [token]);
  if (!row || typeof row.account_id !== "string") return null;
  if (asTime(row.expires_at) <= Date.now()) {
    await closeSession(token);
    return null;
  }
  return findAccountById(row.account_id);
}
function readToken(req) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === COOKIE) return decodeURIComponent(rest.join("="));
  }
  return null;
}
function accountFromRequest(req) {
  return accountForToken(readToken(req));
}
function writeSessionCookie(res, token, req) {
  const maxAge = token ? Math.floor(SESSION_MS / 1e3) : 0;
  const value = token ? encodeURIComponent(token) : "";
  const secure = req?.headers["x-forwarded-proto"] === "https" ? "; Secure" : "";
  res.setHeader("set-cookie", `${COOKIE}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure}`);
}

// server/forward.ts
var FORWARD_LIMIT = 50;
var workspaceExecutor = async (context) => {
  if (!context.endpointUrl) return simulatedExecutor(context);
  return providerExecutor(context);
};
var providerExecutor = async (context) => {
  if (!context.endpointUrl) return unavailableExecutor(context);
  if (!Number.isInteger(context.requestCount) || context.requestCount < 1) {
    return { ok: false, execution: "unavailable", reason: "Request count must be a positive integer. Nothing was sent." };
  }
  if (context.requestCount > FORWARD_LIMIT) {
    return {
      ok: false,
      execution: "unavailable",
      reason: `This gateway forwards at most ${FORWARD_LIMIT} calls in one submission. The batch was not sent and was not charged.`
    };
  }
  const started = performance.now();
  try {
    const calls = Array.from({ length: context.requestCount }, (_, index) => ({
      jsonrpc: "2.0",
      id: index + 1,
      method: context.method,
      params: context.params ?? []
    }));
    const response = await fetch(context.endpointUrl, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(context.requestCount === 1 ? calls[0] : calls),
      signal: AbortSignal.timeout(12e3),
      redirect: "error"
    });
    const latencyMs = Math.max(0, Math.round(performance.now() - started));
    if (!response.ok) {
      return {
        ok: false,
        execution: "provider",
        latencyMs,
        reason: `The endpoint responded with HTTP ${response.status}. The batch was not charged.`
      };
    }
    const body = await response.json();
    const rows = Array.isArray(body) ? body : [body];
    if (rows.length !== context.requestCount) {
      return {
        ok: false,
        execution: "provider",
        latencyMs,
        reason: "The endpoint did not return one result per request. The batch was not charged."
      };
    }
    const failed = rows.find((row) => isRpcError(row));
    if (failed) {
      return {
        ok: false,
        execution: "provider",
        latencyMs,
        reason: `The endpoint returned ${rpcErrorMessage(failed)}. The batch was not charged.`
      };
    }
    return {
      ok: true,
      execution: "provider",
      latencyMs,
      body: context.requestCount === 1 ? rows[0] : rows,
      note: "Forwarded to the configured endpoint."
    };
  } catch {
    const latencyMs = Math.max(0, Math.round(performance.now() - started));
    return {
      ok: false,
      execution: "provider",
      latencyMs,
      reason: "The endpoint could not be reached. The batch was not charged."
    };
  }
};
function isRpcError(row) {
  return Boolean(row && typeof row === "object" && "error" in row && row.error);
}
function rpcErrorMessage(row) {
  if (!row || typeof row !== "object" || !("error" in row)) return "an error";
  const error = row.error;
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message.slice(0, 180);
  }
  return "an error";
}

// server/http.ts
var METHODS2 = ["eth_blockNumber", "eth_getBalance", "eth_getBlockByNumber", "eth_call", "eth_getTransactionReceipt"];
async function handleApi(req, res) {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const path2 = url.pathname.replace(/\/$/, "") || "/";
  const method = req.method ?? "GET";
  const account = await accountFromRequest(req);
  if (method === "POST" && path2 === "/api/register") return register(req, res);
  if (method === "POST" && path2 === "/api/login") return login(req, res);
  if (method === "POST" && path2 === "/api/logout") return logout(req, res);
  if (method === "GET" && path2 === "/api/session") {
    send2(res, 200, { account });
    return;
  }
  if (!account) {
    send2(res, 401, { errors: ["Sign in to continue."] });
    return;
  }
  const scope = scopeFrom(url);
  if (method === "GET" && path2 === "/api/workspace") {
    const body2 = await withLedger(async () => {
      const state = scope === "examples" ? await readLedger("examples") : await loadLedger("live");
      return payload(account, scope, state);
    });
    send2(res, 200, body2);
    return;
  }
  if (method === "POST" && path2 === "/api/examples/open") {
    const body2 = await withLedger(async () => {
      const existing = await readLedger("examples");
      const state = existing ?? await createSeedState(Date.now());
      if (!existing) await writeLedger("examples", state);
      return payload(account, "examples", await loadLedger("examples"));
    });
    send2(res, 200, body2);
    return;
  }
  if (method === "POST" && path2 === "/api/examples/reset") {
    const body2 = await withLedger(async () => {
      const state = await createSeedState(Date.now());
      await writeLedger("examples", state);
      return payload(account, "examples", state);
    });
    send2(res, 200, body2);
    return;
  }
  const body = method === "GET" ? {} : await readJson(req);
  const record = asRecord(body);
  if (method === "POST" && path2 === "/api/agents") {
    await mutate(res, account, scope, (state, now) => registerAgent(state, stringField(record, "name"), stringField(record, "mandate"), now, account.id));
    return;
  }
  const agentStatus = path2.match(/^\/api\/agents\/([^/]+)\/status$/);
  if (method === "POST" && agentStatus) {
    const agentId = decodeURIComponent(agentStatus[1] ?? "");
    await mutate(res, account, scope, (state, now) => {
      const agent = state.agents.find((item) => item.id === agentId);
      if (!agent) return { state, errors: ["No agent matches that identifier."] };
      if (!canAct(scope, account.id, agent.ownerId)) return { state, errors: ["Only the owner of this agent can change its status."] };
      const status = stringField(record, "status");
      if (status !== "active" && status !== "disabled") return { state, errors: ["Status must be active or disabled."] };
      return setAgentStatus(state, agentId, status, now);
    });
    return;
  }
  if (method === "POST" && path2 === "/api/providers") {
    await mutate(res, account, scope, (state, now) => registerProvider(state, stringField(record, "name"), stringField(record, "desk"), now, account.id));
    return;
  }
  const providerStatus = path2.match(/^\/api\/providers\/([^/]+)\/status$/);
  if (method === "POST" && providerStatus) {
    const providerId = decodeURIComponent(providerStatus[1] ?? "");
    await mutate(res, account, scope, (state, now) => {
      const provider = state.providers.find((item) => item.id === providerId);
      if (!provider) return { state, errors: ["No provider matches that identifier."] };
      if (!canAct(scope, account.id, provider.ownerId)) return { state, errors: ["Only the owner of this provider can change its status."] };
      const status = stringField(record, "status");
      if (status !== "active" && status !== "disabled") return { state, errors: ["Status must be active or disabled."] };
      return setProviderStatus(state, providerId, status, now);
    });
    return;
  }
  if (method === "POST" && path2 === "/api/resources") {
    await mutate(res, account, scope, (state, now) => {
      const providerId = stringField(record, "providerId");
      const provider = state.providers.find((item) => item.id === providerId);
      if (!provider) return { state, errors: ["No provider matches that identifier."] };
      if (!canAct(scope, account.id, provider.ownerId)) return { state, errors: ["Only the owner of this provider can publish an offer."] };
      return publishResource(state, providerId, draftFrom(record), now);
    });
    return;
  }
  const resourceUpdate = path2.match(/^\/api\/resources\/([^/]+)$/);
  if (method === "POST" && resourceUpdate && path2 !== "/api/resources") {
    const resourceId = decodeURIComponent(resourceUpdate[1] ?? "");
    await mutate(res, account, scope, (state, now) => {
      const resource = state.resources.find((item) => item.id === resourceId);
      if (!resource) return { state, errors: ["No resource matches that identifier."] };
      const provider = state.providers.find((item) => item.id === resource.providerId);
      if (!provider || !canAct(scope, account.id, provider.ownerId)) return { state, errors: ["Only the owner of this provider can edit the offer."] };
      return updateResource(state, resourceId, draftFrom(record), now);
    });
    return;
  }
  if (method === "POST" && path2 === "/api/leases") {
    await mutate(res, account, scope, (state, now) => {
      const input = leaseInput(record);
      const agent = state.agents.find((item) => item.id === input.agentId);
      if (!agent) return { state, errors: ["Select a registered agent."] };
      if (!canAct(scope, account.id, agent.ownerId)) return { state, errors: ["Only the owner of this agent can request a lease."] };
      return requestLease(state, input, now);
    });
    return;
  }
  const leaseAction = path2.match(/^\/api\/leases\/([^/]+)\/(approve|reject|revoke|verify|credential)$/);
  if (leaseAction) {
    const leaseId = decodeURIComponent(leaseAction[1] ?? "");
    const action = leaseAction[2];
    if (method === "GET" && action === "credential") {
      const response = await withLedger(async () => {
        const state = await loadLedger(scope);
        const lease = state.leases.find((item) => item.id === leaseId);
        const agent = state.agents.find((item) => item.id === lease?.agentId);
        if (!lease?.credential || !agent) return { status: 404, body: { errors: ["This lease has no credential."] } };
        if (!canAct(scope, account.id, agent.ownerId)) {
          return { status: 403, body: { errors: ["Only the owner of this agent can read the credential."] } };
        }
        return { status: 200, body: { secret: lease.credential.secret } };
      });
      send2(res, response.status, response.body);
      return;
    }
    if (method === "POST" && action === "approve") {
      await mutate(res, account, scope, async (state, now) => {
        const lease = state.leases.find((item) => item.id === leaseId);
        const provider = state.providers.find((item) => item.id === lease?.providerId);
        if (!lease || !provider) return { state, errors: ["No lease matches that identifier."] };
        if (!canDecideLease(scope, account.id, provider.ownerId)) return { state, errors: ["Only the provider can approve this request."] };
        return approveLease(state, leaseId, provider.id, now);
      });
      return;
    }
    if (method === "POST" && action === "reject") {
      await mutate(res, account, scope, (state, now) => {
        const lease = state.leases.find((item) => item.id === leaseId);
        const provider = state.providers.find((item) => item.id === lease?.providerId);
        if (!lease || !provider) return { state, errors: ["No lease matches that identifier."] };
        if (!canDecideLease(scope, account.id, provider.ownerId)) return { state, errors: ["Only the provider can reject this request."] };
        return rejectLease(state, leaseId, provider.id, stringField(record, "reason"), now);
      });
      return;
    }
    if (method === "POST" && action === "revoke") {
      await mutate(res, account, scope, (state, now) => {
        const lease = state.leases.find((item) => item.id === leaseId);
        const provider = state.providers.find((item) => item.id === lease?.providerId);
        if (!lease || !provider) return { state, errors: ["No lease matches that identifier."] };
        if (!canDecideLease(scope, account.id, provider.ownerId)) return { state, errors: ["Only the provider can revoke this lease."] };
        return revokeLease(state, leaseId, stringField(record, "reason"), now);
      });
      return;
    }
    if (method === "POST" && action === "verify") {
      await mutate(res, account, scope, (state, now) => recordVerification(state, leaseId, now));
      return;
    }
  }
  if (method === "POST" && path2 === "/api/rpc") {
    const outcome = await commitChange(scope, async (state, now) => {
      const leaseId = stringField(record, "leaseId");
      const lease = state.leases.find((item) => item.id === leaseId);
      const agent = state.agents.find((item) => item.id === lease?.agentId);
      let credentialSecret2 = stringField(record, "credentialSecret");
      if (record.presentHeld === true) {
        if (!lease?.credential || !agent || !canAct(scope, account.id, agent.ownerId)) {
          return { state, value: { status: 403, errors: ["The held credential is available to the agent owner."], result: null } };
        }
        credentialSecret2 = lease.credential.secret;
      }
      const methodName = stringField(record, "method");
      if (!METHODS2.includes(methodName)) {
        return { state, value: { status: 400, errors: ["Choose a supported RPC method."], result: null } };
      }
      const requestCount = numberField(record, "requestCount");
      const submitted = await submitRpc(
        state,
        {
          leaseId,
          agentId: stringField(record, "agentId"),
          method: methodName,
          requestCount,
          credentialSecret: credentialSecret2,
          ...typeof record.idempotencyKey === "string" ? { idempotencyKey: record.idempotencyKey } : {},
          ...record.params !== void 0 ? { params: record.params } : {}
        },
        now,
        scope === "examples" ? exampleExecutor : workspaceExecutor
      );
      return { state: submitted.state, value: { status: 200, errors: [], result: submitted.result } };
    });
    send2(res, outcome.value.status, {
      ...publicResult(account, scope, outcome.state),
      errors: outcome.value.errors,
      ...outcome.value.result ? { result: outcome.value.result } : {}
    });
    return;
  }
  send2(res, 404, { errors: ["That action is not available."] });
}
function canAct(scope, accountId, ownerId) {
  return scope === "examples" || accountId === ownerId;
}
function canDecideLease(scope, accountId, ownerId) {
  return canAct(scope, accountId, ownerId) || ownerId === "sample";
}
async function mutate(res, account, scope, task) {
  const outcome = await commitChange(scope, async (state, now) => {
    const result = await task(state, now);
    return { state: result.state, value: result };
  });
  const issued = issuedSecret(outcome.before, outcome.state, account.id, scope);
  send2(res, outcome.value.errors.length > 0 ? 400 : 200, {
    ...publicResult(account, scope, outcome.state),
    errors: outcome.value.errors,
    ...outcome.value.leaseId ? { leaseId: outcome.value.leaseId } : {},
    ...outcome.value.resourceId ? { resourceId: outcome.value.resourceId } : {},
    ...issued ? { issuedSecret: issued } : {}
  });
}
function issuedSecret(before, after, accountId, scope) {
  for (const lease of after.leases) {
    const previous = before.leases.find((item) => item.id === lease.id)?.credential?.secret;
    const secret = lease.credential?.secret;
    if (!secret || secret === previous) continue;
    const agent = after.agents.find((item) => item.id === lease.agentId);
    const provider = after.providers.find((item) => item.id === lease.providerId);
    if (agent && canAct(scope, accountId, agent.ownerId) || provider && canAct(scope, accountId, provider.ownerId)) return secret;
  }
  return void 0;
}
function payload(account, scope, state) {
  return {
    account,
    scope,
    now: Date.now(),
    ready: state !== null,
    state: state ? toPublicState(state) : null
  };
}
function publicResult(account, scope, state) {
  return { account, scope, now: Date.now(), state: toPublicState(state) };
}
function scopeFrom(url) {
  return url.searchParams.get("scope") === "examples" ? "examples" : "live";
}
async function register(req, res) {
  const record = asRecord(await readJson(req));
  const name = stringField(record, "name").trim();
  const password = stringField(record, "password");
  if (name.length < 2 || name.length > 40) {
    send2(res, 400, { errors: ["Use a name between 2 and 40 characters."] });
    return;
  }
  if (password.length < 8 || password.length > 200) {
    send2(res, 400, { errors: ["Use a password of at least 8 characters."] });
    return;
  }
  if (await findAccountByName(name)) {
    send2(res, 409, { errors: ["That name is already registered."] });
    return;
  }
  try {
    const account = await createAccount(name, password);
    writeSessionCookie(res, await openSession(account.id), req);
    send2(res, 200, { account });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/unique|already exists/i.test(message)) {
      send2(res, 409, { errors: ["That name is already registered."] });
      return;
    }
    throw error;
  }
}
async function login(req, res) {
  const record = asRecord(await readJson(req));
  const name = stringField(record, "name").trim();
  const password = stringField(record, "password");
  const account = await findAccountByName(name);
  if (!account || !passwordMatches(password, account.passwordHash)) {
    send2(res, 401, { errors: ["That name and password do not match."] });
    return;
  }
  writeSessionCookie(res, await openSession(account.id), req);
  send2(res, 200, { account: { id: account.id, name: account.name } });
}
async function logout(req, res) {
  const token = readToken(req);
  if (token) await closeSession(token);
  writeSessionCookie(res, null, req);
  send2(res, 200, { account: null });
}
function draftFrom(record) {
  const methods = Array.isArray(record.supportedMethods) ? record.supportedMethods.filter((item) => METHODS2.includes(item)) : [];
  const draft = {
    name: stringField(record, "name"),
    summary: stringField(record, "summary"),
    region: stringField(record, "region"),
    network: stringField(record, "network"),
    availability: stringField(record, "availability"),
    pricePerThousandMicro: numberField(record, "pricePerThousandMicro"),
    requestRateLimit: numberField(record, "requestRateLimit"),
    maxLeaseDurationMs: numberField(record, "maxLeaseDurationMs"),
    supportedMethods: methods,
    capacityRequests: numberField(record, "capacityRequests")
  };
  if ("endpointUrl" in record) {
    draft.endpointUrl = record.endpointUrl === null ? null : stringField(record, "endpointUrl");
  }
  return draft;
}
function leaseInput(record) {
  const methods = Array.isArray(record.permittedMethods) ? record.permittedMethods.filter((item) => METHODS2.includes(item)) : [];
  return {
    agentId: stringField(record, "agentId"),
    resourceId: stringField(record, "resourceId"),
    task: stringField(record, "task"),
    startAt: numberField(record, "startAt"),
    durationMs: numberField(record, "durationMs"),
    maxRequests: numberField(record, "maxRequests"),
    spendingCapMicro: numberField(record, "spendingCapMicro"),
    maxRequestRate: numberField(record, "maxRequestRate"),
    permittedMethods: methods
  };
}
function stringField(record, key) {
  const value = record[key];
  return typeof value === "string" ? value : "";
}
function numberField(record, key) {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : Number.NaN;
}
function asRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value;
}
async function readJson(req) {
  const prepared = req.body;
  if (typeof prepared === "string") {
    if (prepared.length > 65536) throw new Error("too large");
    return prepared.length === 0 ? {} : JSON.parse(prepared);
  }
  if (prepared && typeof prepared === "object") return prepared;
  if (req.method === "GET" || req.headers["content-length"] === "0") return {};
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 65536) throw new Error("too large");
    chunks.push(buffer);
  }
  if (size === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
function send2(res, status, body) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(body));
}

// server/vercel.ts
var config = {
  runtime: "nodejs",
  maxDuration: 30
};
function normalizeRequestUrl(req) {
  const raw = req.url ?? "/";
  if (raw.startsWith("/api")) return;
  const query = raw.includes("?") ? raw.slice(raw.indexOf("?")) : "";
  const pathParam = req.query?.path;
  const segments = Array.isArray(pathParam) ? pathParam : pathParam ? [pathParam] : [];
  if (segments.length === 0) return;
  req.url = `/api/${segments.map((part) => encodeURIComponent(part)).join("/")}${query}`;
}
async function handler(req, res) {
  normalizeRequestUrl(req);
  try {
    await handleApi(req, res);
  } catch (error) {
    sendFailure(res, error);
  }
}
export {
  config,
  handler as default
};
