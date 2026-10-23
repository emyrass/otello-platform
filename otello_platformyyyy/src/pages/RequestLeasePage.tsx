import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Button, ErrorList, Field, NumberInput, PageHeader, Pill, SelectInput, TextArea, TextInput, useTitle } from "../components/ui.tsx";
import { useLedger } from "../context/Store.tsx";
import { formatDuration, formatPerThousand, formatTimestamp, formatUsd, networkLabel } from "../lib/format.ts";
import { costForRequests, formatUsdInput, parseUsdToMicro } from "../lib/money.ts";
import { nameOf } from "../lib/selectors.ts";
import { RPC_METHODS, type RpcMethod } from "../lib/types.ts";

const PRESETS = [
  { id: "60s", label: "60 seconds", ms: 60_000 },
  { id: "15m", label: "15 minutes", ms: 15 * 60_000 },
  { id: "1h", label: "1 hour", ms: 60 * 60_000 },
  { id: "6h", label: "6 hours", ms: 6 * 60 * 60_000 },
  { id: "24h", label: "24 hours", ms: 24 * 60 * 60_000 },
];

export function RequestLeasePage() {
  const { state, now, account, scope, requestLease } = useLedger();
  useTitle("Request lease");
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const initialResource = params.get("resource") ?? state.resources.find((resource) => resource.availability !== "unavailable")?.id ?? state.resources[0]?.id ?? "";
  const initialOffer = state.resources.find((resource) => resource.id === initialResource);
  const [agentId, setAgentId] = useState(state.agents.find((agent) => agent.status === "active")?.id ?? state.agents[0]?.id ?? "");
  const [resourceId, setResourceId] = useState(initialResource);
  const [task, setTask] = useState("Read blocks for the length of this lease.");
  const [startsIn, setStartsIn] = useState(0);
  const [preset, setPreset] = useState("1h");
  const [customMinutes, setCustomMinutes] = useState(30);
  const [maxRequests, setMaxRequests] = useState(10_000);
  const [rate, setRate] = useState(initialOffer ? Math.min(initialOffer.requestRateLimit, 120) : 120);
  const [methods, setMethods] = useState<RpcMethod[]>(initialOffer?.supportedMethods ?? []);
  const [capText, setCapText] = useState("");
  const [capDirty, setCapDirty] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [pending, setPending] = useState(false);

  const resource = state.resources.find((item) => item.id === resourceId);
  const mine = state.agents.filter((agent) => scope === "examples" || agent.ownerId === account.id);
  const chosenAgent = mine.some((agent) => agent.id === agentId) ? agentId : (mine[0]?.id ?? "");
  const durationMs = preset === "custom" ? Math.round(customMinutes * 60_000) : (PRESETS.find((item) => item.id === preset)?.ms ?? 60_000);
  const estimate = resource && Number.isInteger(maxRequests) && maxRequests > 0 ? costForRequests(maxRequests, resource.pricing.pricePerThousandMicro) : null;
  const capShown = !capDirty && estimate !== null ? formatUsdInput(estimate) : capText;
  const startAt = now + startsIn * 60_000;
  const spendingCapMicro = parseUsdToMicro(capShown);
  const summary = {
    agent: nameOf(state.agents, chosenAgent),
    provider: resource ? nameOf(state.providers, resource.providerId) : "—",
    resource: resource?.name ?? "—",
    network: resource ? networkLabel(resource.network) : "—",
    price: resource ? formatPerThousand(resource.pricing.pricePerThousandMicro) : "—",
  };

  function chooseResource(id: string) {
    setResourceId(id);
    const next = state.resources.find((item) => item.id === id);
    if (!next) return;
    setMethods(next.supportedMethods);
    setRate(Math.min(next.requestRateLimit, 120));
    setCapDirty(false);
  }

  return (
    <div>
      <PageHeader
        kicker="Request"
        title="State the terms."
        lede="The provider has to approve before anything is signed. A 60-second duration lets the lease expire while you stay on the page."
      />
      {mine.length === 0 || state.resources.length === 0 ? (
        <p className="mt-12 border-t border-ink/10 py-8 text-sm text-char">
          {mine.length === 0 ? "Register an agent before requesting a lease." : "Publish a resource before requesting a lease."}
        </p>
      ) : null}
      <form
        className={`mt-12 grid items-start gap-14 lg:grid-cols-[minmax(0,1.05fr)_minmax(18rem,0.8fr)] ${mine.length === 0 || state.resources.length === 0 ? "hidden" : ""}`}
        onSubmit={(event) => {
          event.preventDefault();
          if (!resource || spendingCapMicro === null) {
            setErrors(spendingCapMicro === null ? ["Enter the spending cap as a dollar amount."] : ["Select a resource."]);
            return;
          }
          setPending(true);
          void requestLease({
            agentId: chosenAgent,
            resourceId,
            task,
            startAt: now + startsIn * 60_000,
            durationMs,
            maxRequests,
            spendingCapMicro,
            maxRequestRate: rate,
            permittedMethods: methods,
          }).then((result) => {
            setPending(false);
            if (result.errors.length > 0 || !result.leaseId) {
              setErrors(result.errors);
              return;
            }
            navigate(`/leases/${result.leaseId}`);
          });
        }}
      >
        <div className="grid gap-6">
          <Field label="Requesting agent">
            <SelectInput value={chosenAgent} onChange={(event) => setAgentId(event.target.value)}>
              {mine.map((agent) => (
                <option key={agent.id} value={agent.id} disabled={agent.status !== "active"}>
                  {agent.name}
                  {agent.status === "disabled" ? " · disabled" : ""}
                </option>
              ))}
            </SelectInput>
          </Field>
          <Field label="RPC resource">
            <SelectInput value={resourceId} onChange={(event) => chooseResource(event.target.value)}>
              {state.resources.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} · {networkLabel(item.network)} · {item.availability}
                </option>
              ))}
            </SelectInput>
          </Field>
          <Field label="Task">
            <TextArea value={task} maxLength={280} onChange={(event) => setTask(event.target.value)} />
          </Field>
          <Field label="Starts in" hint="Zero means the lease can activate as soon as it is approved.">
            <NumberInput min={0} max={10080} value={startsIn} onChange={(event) => setStartsIn(Number(event.target.value))} />
          </Field>
          <div>
            <p className="text-[11px] uppercase tracking-[0.16em] text-mute">Duration</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {PRESETS.map((item) => (
                <Pill
                  key={item.id}
                  active={preset === item.id}
                  disabled={Boolean(resource && item.ms > resource.maxLeaseDurationMs)}
                  onClick={() => setPreset(item.id)}
                >
                  {item.label}
                </Pill>
              ))}
              <Pill active={preset === "custom"} onClick={() => setPreset("custom")}>
                Custom
              </Pill>
            </div>
            {preset === "custom" ? (
              <div className="mt-4 max-w-xs">
                <Field label="Minutes">
                  <NumberInput min={1} value={customMinutes} onChange={(event) => setCustomMinutes(Number(event.target.value))} />
                </Field>
              </div>
            ) : null}
          </div>
          <div className="grid gap-6 md:grid-cols-2">
            <Field label="Maximum requests">
              <NumberInput min={1} value={maxRequests} onChange={(event) => setMaxRequests(Number(event.target.value))} />
            </Field>
            <Field label="Maximum request rate" hint={resource ? `Endpoint ceiling ${resource.requestRateLimit} / min` : undefined}>
              <NumberInput min={1} value={rate} onChange={(event) => setRate(Number(event.target.value))} />
            </Field>
          </div>
          <Field label="Spending cap (USD)" hint={estimate !== null ? `Full allowance would cost ${formatUsd(estimate)}.` : undefined}>
            <TextInput
              value={capShown}
              inputMode="decimal"
              onChange={(event) => {
                setCapDirty(true);
                setCapText(event.target.value);
              }}
            />
          </Field>
          <button
            type="button"
            className="w-fit text-[12px] underline underline-offset-4"
            onClick={() => {
              setCapDirty(false);
            }}
          >
            Match the full allowance
          </button>
          <fieldset>
            <legend className="text-[11px] uppercase tracking-[0.16em] text-mute">Permitted methods</legend>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {RPC_METHODS.map((method) => {
                const supported = resource?.supportedMethods.includes(method) ?? false;
                return (
                  <label key={method} className={`flex items-center gap-3 text-sm ${supported ? "" : "text-mute"}`}>
                    <input
                      type="checkbox"
                      disabled={!supported}
                      checked={methods.includes(method)}
                      onChange={(event) => {
                        setMethods((current) =>
                          event.target.checked ? [...current, method] : current.filter((item) => item !== method),
                        );
                      }}
                    />
                    {method}
                    {supported ? "" : " · not offered"}
                  </label>
                );
              })}
            </div>
          </fieldset>
          <ErrorList errors={errors} />
          <div className="flex gap-3">
            <Button type="submit" disabled={pending}>
              {pending ? "Submitting" : "Submit request"}
            </Button>
            <Link to="/resources" className="rounded-full border border-ink/20 px-4 py-2 text-[13px]">
              Back to market
            </Link>
          </div>
        </div>
        <aside className="border-t border-ink/10 pt-6 lg:sticky lg:top-24 lg:border-t-0 lg:pt-0">
          <p className="text-[11px] uppercase tracking-[0.16em] text-mute">Agreement summary</p>
          <h2 className="mt-3 font-serif text-4xl tracking-tight">Before it is signed</h2>
          <dl className="mt-6 grid grid-cols-[8rem_1fr] gap-y-3 text-sm">
            <dt className="text-mute">Agent</dt>
            <dd>{summary.agent}</dd>
            <dt className="text-mute">Provider</dt>
            <dd>{summary.provider}</dd>
            <dt className="text-mute">Resource</dt>
            <dd>{summary.resource}</dd>
            <dt className="text-mute">Network</dt>
            <dd>{summary.network}</dd>
            <dt className="text-mute">Price</dt>
            <dd>{summary.price}</dd>
            <dt className="text-mute">Starts</dt>
            <dd>{startsIn === 0 ? "On approval" : formatTimestamp(startAt)}</dd>
            <dt className="text-mute">Duration</dt>
            <dd>{formatDuration(durationMs)}</dd>
            <dt className="text-mute">Allowance</dt>
            <dd>{Number.isFinite(maxRequests) ? maxRequests.toLocaleString("en-US") : "—"} requests</dd>
            <dt className="text-mute">Cap</dt>
            <dd>{spendingCapMicro === null ? "—" : formatUsd(spendingCapMicro)}</dd>
            <dt className="text-mute">Rate</dt>
            <dd>{rate} / minute</dd>
            <dt className="text-mute">Methods</dt>
            <dd>{methods.length ? methods.join(", ") : "None selected"}</dd>
            <dt className="text-mute">Estimated max</dt>
            <dd>{estimate === null ? "—" : formatUsd(estimate)}</dd>
          </dl>
        </aside>
      </form>
    </div>
  );
}
