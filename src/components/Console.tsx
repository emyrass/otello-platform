import { useMemo, useState } from "react";
import { useLedger } from "../context/Store.tsx";
import { formatUsd } from "../lib/format.ts";
import { RPC_METHODS, type RpcMethod, type RpcResult } from "../lib/types.ts";
import { Button, Field, NumberInput, SelectInput, TextArea, TextInput } from "./ui.tsx";

export function Console({ initialAgentId, initialLeaseId }: { initialAgentId?: string; initialLeaseId?: string }) {
  const { state, scope, submitRpc } = useLedger();
  const [agentId, setAgentId] = useState(initialAgentId ?? state.agents.find((agent) => agent.status === "active")?.id ?? "");
  const [leaseId, setLeaseId] = useState(initialLeaseId ?? "");
  const [method, setMethod] = useState<RpcMethod>("eth_blockNumber");
  const [count, setCount] = useState(10);
  const [paramsText, setParamsText] = useState("[]");
  const [present, setPresent] = useState(true);
  const [pasted, setPasted] = useState("");
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<RpcResult | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const leases = useMemo(
    () => state.leases.filter((lease) => !agentId || lease.agentId === agentId),
    [agentId, state.leases],
  );
  const selected = state.leases.find((lease) => lease.id === (leaseId || leases[0]?.id));

  return (
    <div>
      <div className="grid gap-6 md:grid-cols-2">
        <Field label="Agent">
          <SelectInput
            value={agentId}
            onChange={(event) => {
              setAgentId(event.target.value);
              setLeaseId("");
            }}
          >
            {state.agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name}
                {agent.status === "disabled" ? " · disabled" : ""}
              </option>
            ))}
          </SelectInput>
        </Field>
        <Field label="Lease">
          <SelectInput value={selected?.id ?? ""} onChange={(event) => setLeaseId(event.target.value)}>
            {leases.length === 0 ? <option value="">No leases for this agent</option> : null}
            {leases.map((lease) => (
              <option key={lease.id} value={lease.id}>
                {lease.id} · {lease.status}
              </option>
            ))}
          </SelectInput>
        </Field>
        <Field label="Method">
          <SelectInput value={method} onChange={(event) => setMethod(event.target.value as RpcMethod)}>
            {RPC_METHODS.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </SelectInput>
        </Field>
        <Field label="Request count" hint="The whole batch is accepted or rejected together.">
          <NumberInput min={1} max={100000} value={count} onChange={(event) => setCount(Number(event.target.value))} />
        </Field>
      </div>
      <Field label="Params" hint="JSON array or object. The same params are sent once per request in the batch.">
        <TextArea value={paramsText} onChange={(event) => setParamsText(event.target.value)} className="min-h-16 font-mono text-[12px]" />
      </Field>
      <label className="mt-5 flex items-center gap-3 text-sm">
        <input type="checkbox" checked={present} onChange={(event) => setPresent(event.target.checked)} />
        Present the credential held for this lease
      </label>
      {present ? null : (
        <div className="mt-4 max-w-md">
          <Field label="Credential secret">
            <TextInput value={pasted} onChange={(event) => setPasted(event.target.value)} autoComplete="off" />
          </Field>
        </div>
      )}
      <p className="mt-3 text-xs text-char">
        {scope === "examples"
          ? "Example view. A submission is metered here and is not sent to a network."
          : selected && state.resources.find((resource) => resource.id === selected.resourceId)?.endpointConfigured
            ? "This resource has an endpoint. An accepted batch is forwarded, then metered."
            : "This resource has no endpoint. An accepted batch is simulated on this server and metered. It is not sent to a provider."}
      </p>
      <p className="mt-2 text-xs text-char">
        {selected?.credential
          ? `Credential ${selected.credential.id} is ${selected.credential.status}.`
          : "This lease has no credential. Submission will be refused."}
      </p>
      {formError ? <p className="mt-3 text-sm text-wine">{formError}</p> : null}
      <Button
        className="mt-6"
        disabled={pending || !selected}
        onClick={() => {
          if (!selected) return;
          let params: unknown = [];
          try {
            params = JSON.parse(paramsText) as unknown;
          } catch {
            setFormError("Params must be JSON.");
            return;
          }
          setFormError(null);
          setPending(true);
          void submitRpc({
            leaseId: selected.id,
            agentId: selected.agentId,
            method,
            requestCount: count,
            credentialSecret: present ? "" : pasted,
            presentHeld: present,
            params,
            idempotencyKey: crypto.randomUUID(),
          }).then((response) => {
            setResult(response.result);
            setPending(false);
          });
        }}
      >
        {pending ? "Checking policy" : "Submit batch"}
      </Button>
      <div aria-live="polite" className="mt-8 min-h-16 border-t border-ink/10 pt-4">
        {!result ? <p className="text-sm text-mute">No operation yet.</p> : null}
        {result && !result.ok ? (
          <p className="border-l border-wine pl-3 text-sm">{result.reason}</p>
        ) : null}
        {result?.ok ? (
          <div>
            <p className="text-sm">
              Accepted {result.requestCount.toLocaleString("en-US")} · {formatUsd(result.costMicro)}
              {result.response?.execution === "example" ? " · example, not sent" : ""}
              {result.response?.execution === "simulated" ? " · simulated, not sent" : ""}
              {result.response?.execution === "provider" ? " · forwarded" : ""}
              {result.replayed ? " · replayed, no extra charge" : ""}
            </p>
            {result.response?.note ? <p className="mt-2 text-sm text-char">{result.response.note}</p> : null}
            <pre className="mt-4 overflow-x-auto text-[12px] leading-relaxed text-char">{JSON.stringify(result.response, null, 2)}</pre>
          </div>
        ) : null}
      </div>
    </div>
  );
}
