import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { AppState, LeaseRequestInput, ResourceDraft, RpcInput, RpcResult } from "../lib/types.ts";

export interface Account {
  id: string;
  name: string;
}

export type Scope = "live" | "examples";

export interface ActionResult {
  errors: string[];
  issuedSecret?: string;
  leaseId?: string;
}

interface StoreValue {
  ready: boolean;
  account: Account | null;
  scope: Scope;
  state: AppState | null;
  now: number;
  error: string | null;
  registerAccount: (name: string, password: string) => Promise<ActionResult>;
  login: (name: string, password: string) => Promise<ActionResult>;
  logout: () => Promise<void>;
  setScope: (scope: Scope) => Promise<void>;
  resetExamples: () => Promise<ActionResult>;
  requestLease: (input: LeaseRequestInput) => Promise<ActionResult>;
  approveLease: (leaseId: string, providerId: string) => Promise<ActionResult>;
  rejectLease: (leaseId: string, providerId: string, reason: string) => Promise<ActionResult>;
  revokeLease: (leaseId: string, reason: string) => Promise<ActionResult>;
  submitRpc: (input: RpcInput & { presentHeld?: boolean }) => Promise<{ result: RpcResult }>;
  recordVerification: (leaseId: string) => Promise<ActionResult>;
  registerAgent: (name: string, mandate: string) => Promise<ActionResult>;
  setAgentStatus: (agentId: string, status: "active" | "disabled") => Promise<ActionResult>;
  registerProvider: (name: string, desk: string) => Promise<ActionResult>;
  setProviderStatus: (providerId: string, status: "active" | "disabled") => Promise<ActionResult>;
  publishResource: (providerId: string, draft: ResourceDraft) => Promise<ActionResult>;
  updateResource: (resourceId: string, draft: ResourceDraft) => Promise<ActionResult>;
  revealCredential: (leaseId: string) => Promise<{ secret?: string; errors: string[] }>;
}

const StoreContext = createContext<StoreValue | null>(null);
const SCOPE_KEY = "otello.scope";

interface Envelope {
  account?: Account | null;
  now?: number;
  state?: AppState | null;
  errors?: string[];
  issuedSecret?: string;
  leaseId?: string;
  result?: RpcResult;
  secret?: string;
}

export function OtelloProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [account, setAccount] = useState<Account | null>(null);
  const [scope, setScopeState] = useState<Scope>("live");
  const [state, setState] = useState<AppState | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState<string | null>(null);
  const scopeRef = useRef<Scope>("live");
  const epoch = useRef(0);
  const mutations = useRef(0);

  const applyEnvelope = useCallback((envelope: Envelope) => {
    if (envelope.account) setAccount(envelope.account);
    if (typeof envelope.now === "number") setNow(envelope.now);
    if (envelope.state) {
      epoch.current += 1;
      setState(envelope.state);
    }
  }, []);

  const request = useCallback(async (path: string, init?: RequestInit): Promise<Envelope & { status: number }> => {
    const scoped = path.startsWith("/api/register") || path.startsWith("/api/login") || path.startsWith("/api/logout") || path.startsWith("/api/session");
    const url = scoped ? path : `${path}${path.includes("?") ? "&" : "?"}scope=${scopeRef.current}`;
    let response: Response;
    try {
      response = await fetch(url, {
        ...init,
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          "x-otello-scope": scopeRef.current,
          ...(init?.body ? { "content-type": "application/json" } : {}),
          ...init?.headers,
        },
      });
    } catch {
      return { errors: ["The ledger could not be reached."], status: 503 };
    }
    const text = await response.text();
    let envelope: Envelope;
    try {
      envelope = text ? (JSON.parse(text) as Envelope) : {};
    } catch {
      const snippet = text.replace(/\s+/g, " ").trim().slice(0, 180);
      return {
        errors: [snippet ? `The ledger is not available from this deployment. ${snippet}` : "The ledger is not available from this deployment."],
        status: response.status || 502,
      };
    }
    if (response.status === 401) {
      setAccount(null);
      setState(null);
    }
    return { ...envelope, status: response.status };
  }, []);

  const refresh = useCallback(async () => {
    if (mutations.current > 0) return;
    const seen = epoch.current;
    const envelope = await request("/api/workspace");
    if (mutations.current > 0 || seen !== epoch.current) return;
    if (envelope.state) {
      setState(envelope.state);
      if (typeof envelope.now === "number") setNow(envelope.now);
    } else if (scopeRef.current === "live") {
      setError(envelope.errors?.[0] ?? "The workspace could not be opened.");
    } else {
      setState(null);
    }
  }, [request]);

  useEffect(() => {
    let cancel = false;
    void (async () => {
      try {
        const stored = window.sessionStorage.getItem(SCOPE_KEY);
        const initialScope: Scope = stored === "examples" ? "examples" : "live";
        scopeRef.current = initialScope;
        setScopeState(initialScope);
        const session = await request("/api/session");
        if (cancel) return;
        if (session.status >= 500) {
          setError(session.errors?.[0] ?? "The ledger could not be opened.");
          setReady(true);
          return;
        }
        if (session.account) {
          setAccount(session.account);
          const opened =
            initialScope === "examples"
              ? await request("/api/examples/open", { method: "POST" })
              : await request("/api/workspace");
          if (cancel) return;
          applyEnvelope(opened);
          if (!opened.state && opened.status >= 500) setError(opened.errors?.[0] ?? "The workspace could not be opened.");
        }
        if (!cancel) setReady(true);
      } catch (caught) {
        if (!cancel) {
          setError(caught instanceof Error ? caught.message : "The ledger could not be opened.");
          setReady(true);
        }
      }
    })();
    return () => {
      cancel = true;
    };
  }, [applyEnvelope, request]);

  useEffect(() => {
    if (!account || !state) return;
    const id = window.setInterval(() => {
      void refresh().catch(() => undefined);
    }, 1000);
    return () => window.clearInterval(id);
  }, [account, refresh, state]);

  const postAction = useCallback(
    async (path: string, body: unknown): Promise<ActionResult> => {
      mutations.current += 1;
      try {
        const envelope = await request(path, { method: "POST", body: JSON.stringify(body ?? {}) });
        applyEnvelope(envelope);
        return {
          errors: envelope.errors ?? (envelope.status >= 400 ? ["The server did not complete that operation."] : []),
          issuedSecret: envelope.issuedSecret,
          leaseId: envelope.leaseId,
        };
      } finally {
        mutations.current -= 1;
      }
    },
    [applyEnvelope, request],
  );

  const value = useMemo<StoreValue>(
    () => ({
      ready,
      account,
      scope,
      state,
      now,
      error,
      registerAccount: async (name, password) => {
        const envelope = await request("/api/register", { method: "POST", body: JSON.stringify({ name, password }) });
        if (envelope.account) {
          setAccount(envelope.account);
          const workspace = await request("/api/workspace");
          applyEnvelope(workspace);
        }
        return { errors: envelope.errors ?? (envelope.status >= 400 ? ["The account could not be created."] : []) };
      },
      login: async (name, password) => {
        const envelope = await request("/api/login", { method: "POST", body: JSON.stringify({ name, password }) });
        if (envelope.account) {
          setAccount(envelope.account);
          if (scopeRef.current === "examples") {
            applyEnvelope(await request("/api/examples/open", { method: "POST" }));
          } else {
            applyEnvelope(await request("/api/workspace"));
          }
        }
        return { errors: envelope.errors ?? (envelope.status >= 400 ? ["Sign-in failed."] : []) };
      },
      logout: async () => {
        await request("/api/logout", { method: "POST" });
        setAccount(null);
        setState(null);
      },
      setScope: async (next) => {
        scopeRef.current = next;
        window.sessionStorage.setItem(SCOPE_KEY, next);
        setScopeState(next);
        setState(null);
        if (next === "examples") applyEnvelope(await request("/api/examples/open", { method: "POST" }));
        else applyEnvelope(await request("/api/workspace"));
      },
      resetExamples: () => postAction("/api/examples/reset", {}),
      requestLease: (input) => postAction("/api/leases", input),
      approveLease: (leaseId) => postAction(`/api/leases/${encodeURIComponent(leaseId)}/approve`, {}),
      rejectLease: (leaseId, _providerId, reason) => postAction(`/api/leases/${encodeURIComponent(leaseId)}/reject`, { reason }),
      revokeLease: (leaseId, reason) => postAction(`/api/leases/${encodeURIComponent(leaseId)}/revoke`, { reason }),
      submitRpc: async (input) => {
        mutations.current += 1;
        try {
          const envelope = await request("/api/rpc", { method: "POST", body: JSON.stringify(input) });
          applyEnvelope(envelope);
          return {
            result: envelope.result ?? {
              ok: false,
              reason: envelope.errors?.[0] ?? "The server did not complete that operation.",
              costMicro: 0,
              requestCount: input.requestCount,
              replayed: false,
            },
          };
        } finally {
          mutations.current -= 1;
        }
      },
      recordVerification: (leaseId) => postAction(`/api/leases/${encodeURIComponent(leaseId)}/verify`, {}),
      registerAgent: (name, mandate) => postAction("/api/agents", { name, mandate }),
      setAgentStatus: (agentId, status) => postAction(`/api/agents/${encodeURIComponent(agentId)}/status`, { status }),
      registerProvider: (name, desk) => postAction("/api/providers", { name, desk }),
      setProviderStatus: (providerId, status) => postAction(`/api/providers/${encodeURIComponent(providerId)}/status`, { status }),
      publishResource: (providerId, draft) => postAction("/api/resources", { providerId, ...draft }),
      updateResource: (resourceId, draft) => postAction(`/api/resources/${encodeURIComponent(resourceId)}`, draft),
      revealCredential: async (leaseId) => {
        const envelope = await request(`/api/leases/${encodeURIComponent(leaseId)}/credential`);
        return { secret: envelope.secret, errors: envelope.errors ?? (envelope.status >= 400 ? ["The credential could not be read."] : []) };
      },
    }),
    [account, applyEnvelope, error, now, postAction, ready, request, scope, state],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useOtello(): StoreValue {
  const value = useContext(StoreContext);
  if (!value) throw new Error("useOtello must be used inside OtelloProvider");
  return value;
}

export function useLedger(): StoreValue & { state: AppState; account: Account } {
  const value = useOtello();
  if (!value.state || !value.account) throw new Error("The ledger is not ready.");
  return { ...value, state: value.state, account: value.account };
}
