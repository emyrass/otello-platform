import type { IncomingMessage, ServerResponse } from "node:http";
import { createSeedState } from "../src/lib/seed.ts";
import {
  approveLease,
  publishResource,
  recordVerification,
  registerAgent,
  registerProvider,
  rejectLease,
  requestLease,
  revokeLease,
  setAgentStatus,
  setProviderStatus,
  submitRpc,
  updateResource,
  type MutationResult,
} from "../src/lib/engine.ts";
import { toPublicState } from "../src/lib/publicState.ts";
import { exampleExecutor } from "../src/lib/rpc.ts";
import type { AppState, LeaseRequestInput, ResourceDraft, RpcMethod, RpcResult } from "../src/lib/types.ts";
import { accountFromRequest, closeSession, createAccount, findAccountByName, openSession, passwordMatches, readToken, writeSessionCookie, type Account } from "./auth.ts";
import { commitChange, loadLedger, readLedger, withLedger, writeLedger, type Scope } from "./db.ts";
import { workspaceExecutor } from "./forward.ts";

const METHODS = ["eth_blockNumber", "eth_getBalance", "eth_getBlockByNumber", "eth_call", "eth_getTransactionReceipt"] as const;

export async function handleApi(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const path = url.pathname.replace(/\/$/, "") || "/";
  const method = req.method ?? "GET";
  const account = await accountFromRequest(req);

  if (method === "POST" && path === "/api/register") return register(req, res);
  if (method === "POST" && path === "/api/login") return login(req, res);
  if (method === "POST" && path === "/api/logout") return logout(req, res);
  if (method === "GET" && path === "/api/session") {
    send(res, 200, { account });
    return;
  }
  if (!account) {
    send(res, 401, { errors: ["Sign in to continue."] });
    return;
  }

  const scope = scopeFrom(url);
  if (method === "GET" && path === "/api/workspace") {
    const body = await withLedger(async () => {
      const state = scope === "examples" ? await readLedger("examples") : await loadLedger("live");
      return payload(account, scope, state);
    });
    send(res, 200, body);
    return;
  }
  if (method === "POST" && path === "/api/examples/open") {
    const body = await withLedger(async () => {
      const existing = await readLedger("examples");
      const state = existing ?? (await createSeedState(Date.now()));
      if (!existing) await writeLedger("examples", state);
      return payload(account, "examples", await loadLedger("examples"));
    });
    send(res, 200, body);
    return;
  }
  if (method === "POST" && path === "/api/examples/reset") {
    const body = await withLedger(async () => {
      const state = await createSeedState(Date.now());
      await writeLedger("examples", state);
      return payload(account, "examples", state);
    });
    send(res, 200, body);
    return;
  }

  const body = method === "GET" ? {} : await readJson(req);
  const record = asRecord(body);

  if (method === "POST" && path === "/api/agents") {
    await mutate(res, account, scope, (state, now) => registerAgent(state, stringField(record, "name"), stringField(record, "mandate"), now, account.id));
    return;
  }
  const agentStatus = path.match(/^\/api\/agents\/([^/]+)\/status$/);
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

  if (method === "POST" && path === "/api/providers") {
    await mutate(res, account, scope, (state, now) => registerProvider(state, stringField(record, "name"), stringField(record, "desk"), now, account.id));
    return;
  }
  const providerStatus = path.match(/^\/api\/providers\/([^/]+)\/status$/);
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

  if (method === "POST" && path === "/api/resources") {
    await mutate(res, account, scope, (state, now) => {
      const providerId = stringField(record, "providerId");
      const provider = state.providers.find((item) => item.id === providerId);
      if (!provider) return { state, errors: ["No provider matches that identifier."] };
      if (!canAct(scope, account.id, provider.ownerId)) return { state, errors: ["Only the owner of this provider can publish an offer."] };
      return publishResource(state, providerId, draftFrom(record), now);
    });
    return;
  }
  const resourceUpdate = path.match(/^\/api\/resources\/([^/]+)$/);
  if (method === "POST" && resourceUpdate && path !== "/api/resources") {
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

  if (method === "POST" && path === "/api/leases") {
    await mutate(res, account, scope, (state, now) => {
      const input = leaseInput(record);
      const agent = state.agents.find((item) => item.id === input.agentId);
      if (!agent) return { state, errors: ["Select a registered agent."] };
      if (!canAct(scope, account.id, agent.ownerId)) return { state, errors: ["Only the owner of this agent can request a lease."] };
      return requestLease(state, input, now);
    });
    return;
  }

  const leaseAction = path.match(/^\/api\/leases\/([^/]+)\/(approve|reject|revoke|verify|credential)$/);
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
      send(res, response.status, response.body);
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

  if (method === "POST" && path === "/api/rpc") {
    const outcome = await commitChange(scope, async (state, now): Promise<{ state: AppState; value: { status: number; errors: string[]; result: RpcResult | null } }> => {
      const leaseId = stringField(record, "leaseId");
      const lease = state.leases.find((item) => item.id === leaseId);
      const agent = state.agents.find((item) => item.id === lease?.agentId);
      let credentialSecret = stringField(record, "credentialSecret");
      if (record.presentHeld === true) {
        if (!lease?.credential || !agent || !canAct(scope, account.id, agent.ownerId)) {
          return { state, value: { status: 403, errors: ["The held credential is available to the agent owner."], result: null } };
        }
        credentialSecret = lease.credential.secret;
      }
      const methodName = stringField(record, "method");
      if (!METHODS.includes(methodName as RpcMethod)) {
        return { state, value: { status: 400, errors: ["Choose a supported RPC method."], result: null } };
      }
      const requestCount = numberField(record, "requestCount");
      const submitted = await submitRpc(
        state,
        {
          leaseId,
          agentId: stringField(record, "agentId"),
          method: methodName as RpcMethod,
          requestCount,
          credentialSecret,
          ...(typeof record.idempotencyKey === "string" ? { idempotencyKey: record.idempotencyKey } : {}),
          ...(record.params !== undefined ? { params: record.params } : {}),
        },
        now,
        scope === "examples" ? exampleExecutor : workspaceExecutor,
      );
      return { state: submitted.state, value: { status: 200, errors: [] as string[], result: submitted.result } };
    });
    send(res, outcome.value.status, {
      ...publicResult(account, scope, outcome.state),
      errors: outcome.value.errors,
      ...(outcome.value.result ? { result: outcome.value.result } : {}),
    });
    return;
  }

  send(res, 404, { errors: ["That action is not available."] });
}

function canAct(scope: Scope, accountId: string, ownerId: string): boolean {
  return scope === "examples" || accountId === ownerId;
}

function canDecideLease(scope: Scope, accountId: string, ownerId: string): boolean {
  return canAct(scope, accountId, ownerId) || ownerId === "sample";
}

async function mutate(
  res: ServerResponse,
  account: Account,
  scope: Scope,
  task: (state: AppState, now: number) => MutationResult | Promise<MutationResult>,
): Promise<void> {
  const outcome = await commitChange(scope, async (state, now) => {
    const result = await task(state, now);
    return { state: result.state, value: result };
  });
  const issued = issuedSecret(outcome.before, outcome.state, account.id, scope);
  send(res, outcome.value.errors.length > 0 ? 400 : 200, {
    ...publicResult(account, scope, outcome.state),
    errors: outcome.value.errors,
    ...(outcome.value.leaseId ? { leaseId: outcome.value.leaseId } : {}),
    ...(outcome.value.resourceId ? { resourceId: outcome.value.resourceId } : {}),
    ...(issued ? { issuedSecret: issued } : {}),
  });
}

function issuedSecret(before: AppState, after: AppState, accountId: string, scope: Scope): string | undefined {
  for (const lease of after.leases) {
    const previous = before.leases.find((item) => item.id === lease.id)?.credential?.secret;
    const secret = lease.credential?.secret;
    if (!secret || secret === previous) continue;
    const agent = after.agents.find((item) => item.id === lease.agentId);
    const provider = after.providers.find((item) => item.id === lease.providerId);
    if ((agent && canAct(scope, accountId, agent.ownerId)) || (provider && canAct(scope, accountId, provider.ownerId))) return secret;
  }
  return undefined;
}

function payload(account: Account, scope: Scope, state: AppState | null) {
  return {
    account,
    scope,
    now: Date.now(),
    ready: state !== null,
    state: state ? toPublicState(state) : null,
  };
}

function publicResult(account: Account, scope: Scope, state: AppState) {
  return { account, scope, now: Date.now(), state: toPublicState(state) };
}

function scopeFrom(url: URL): Scope {
  return url.searchParams.get("scope") === "examples" ? "examples" : "live";
}

async function register(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const record = asRecord(await readJson(req));
  const name = stringField(record, "name").trim();
  const password = stringField(record, "password");
  if (name.length < 2 || name.length > 40) {
    send(res, 400, { errors: ["Use a name between 2 and 40 characters."] });
    return;
  }
  if (password.length < 8 || password.length > 200) {
    send(res, 400, { errors: ["Use a password of at least 8 characters."] });
    return;
  }
  if (await findAccountByName(name)) {
    send(res, 409, { errors: ["That name is already registered."] });
    return;
  }
  try {
    const account = await createAccount(name, password);
    writeSessionCookie(res, await openSession(account.id), req);
    send(res, 200, { account });
  } catch {
    send(res, 409, { errors: ["That name is already registered."] });
  }
}

async function login(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const record = asRecord(await readJson(req));
  const name = stringField(record, "name").trim();
  const password = stringField(record, "password");
  const account = await findAccountByName(name);
  if (!account || !passwordMatches(password, account.passwordHash)) {
    send(res, 401, { errors: ["That name and password do not match."] });
    return;
  }
  writeSessionCookie(res, await openSession(account.id), req);
  send(res, 200, { account: { id: account.id, name: account.name } });
}

async function logout(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const token = readToken(req);
  if (token) await closeSession(token);
  writeSessionCookie(res, null, req);
  send(res, 200, { account: null });
}

function draftFrom(record: Record<string, unknown>): ResourceDraft {
  const methods = Array.isArray(record.supportedMethods) ? record.supportedMethods.filter((item): item is RpcMethod => METHODS.includes(item as RpcMethod)) : [];
  const draft: ResourceDraft = {
    name: stringField(record, "name"),
    summary: stringField(record, "summary"),
    region: stringField(record, "region"),
    network: stringField(record, "network") as ResourceDraft["network"],
    availability: stringField(record, "availability") as ResourceDraft["availability"],
    pricePerThousandMicro: numberField(record, "pricePerThousandMicro"),
    requestRateLimit: numberField(record, "requestRateLimit"),
    maxLeaseDurationMs: numberField(record, "maxLeaseDurationMs"),
    supportedMethods: methods,
    capacityRequests: numberField(record, "capacityRequests"),
  };
  if ("endpointUrl" in record) {
    draft.endpointUrl = record.endpointUrl === null ? null : stringField(record, "endpointUrl");
  }
  return draft;
}

function leaseInput(record: Record<string, unknown>): LeaseRequestInput {
  const methods = Array.isArray(record.permittedMethods) ? record.permittedMethods.filter((item): item is RpcMethod => METHODS.includes(item as RpcMethod)) : [];
  return {
    agentId: stringField(record, "agentId"),
    resourceId: stringField(record, "resourceId"),
    task: stringField(record, "task"),
    startAt: numberField(record, "startAt"),
    durationMs: numberField(record, "durationMs"),
    maxRequests: numberField(record, "maxRequests"),
    spendingCapMicro: numberField(record, "spendingCapMicro"),
    maxRequestRate: numberField(record, "maxRequestRate"),
    permittedMethods: methods,
  };
}

function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === "string" ? value : "";
}

function numberField(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : Number.NaN;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const prepared = (req as IncomingMessage & { body?: unknown }).body;
  if (typeof prepared === "string") {
    if (prepared.length > 65_536) throw new Error("too large");
    return prepared.length === 0 ? {} : (JSON.parse(prepared) as unknown);
  }
  if (prepared && typeof prepared === "object") return prepared;
  if (req.method === "GET" || req.headers["content-length"] === "0") return {};
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 65_536) throw new Error("too large");
    chunks.push(buffer);
  }
  if (size === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(body));
}
