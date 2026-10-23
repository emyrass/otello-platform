import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { LeaseTable } from "../components/LeaseTable.tsx";
import { Button, ErrorList, Field, NumberInput, PageHeader, Pill, SectionTitle, SelectInput, TextArea, TextInput, useTitle } from "../components/ui.tsx";
import { useLedger } from "../context/Store.tsx";
import { formatNumber, formatUsd, networkLabel } from "../lib/format.ts";
import { formatUsdInput, parseUsdToMicro } from "../lib/money.ts";
import { providerRevenueMicro } from "../lib/selectors.ts";
import { NETWORKS, RPC_METHODS, type Availability, type Network, type Resource, type ResourceDraft, type RpcMethod } from "../lib/types.ts";

export function ProvidersPage() {
  const { state, account, scope, registerProvider } = useLedger();
  const [name, setName] = useState("");
  const [desk, setDesk] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  useTitle("Providers");
  return (
    <div>
      <PageHeader
        kicker="Providers"
        title="Operators."
        lede="Each desk publishes RPC offers and signs the leases it accepts. The amount shown is accrued from accepted usage. It has not been paid."
      />
      <div className="mt-12">
        {state.providers.length === 0 ? <p className="border-t border-ink/10 py-8 text-sm text-char">No providers yet.</p> : null}
        {state.providers.map((provider) => {
          const offers = state.resources.filter((resource) => resource.providerId === provider.id);
          const open = state.leases.filter((lease) => lease.providerId === provider.id && lease.status === "requested").length;
          return (
            <Link key={provider.id} to={`/providers/${provider.id}`} className="grid gap-3 border-t border-ink/10 py-6 md:grid-cols-12 md:items-baseline">
              <div className="md:col-span-4">
                <p className="text-2xl">{provider.name}</p>
                <p className="mt-1 text-sm text-char">{provider.desk}</p>
              </div>
              <p className="text-sm md:col-span-2">{provider.status}</p>
              <p className="text-sm md:col-span-2">{formatNumber(offers.length)} offers</p>
              <p className="text-sm md:col-span-2">{formatNumber(open)} waiting</p>
              <div className="md:col-span-2 md:text-right">
                <p className="font-serif text-3xl">{formatUsd(providerRevenueMicro(state, provider.id))}</p>
                <p className="text-[11px] uppercase tracking-[0.14em] text-mute">Accrued</p>
              </div>
            </Link>
          );
        })}
      </div>
      <form
        className="mt-12 max-w-lg border-t border-ink/10 pt-8"
        onSubmit={(event) => {
          event.preventDefault();
          void registerProvider(name, desk).then((result) => {
            if (result.errors.length > 0) {
              setErrors(result.errors);
              return;
            }
            setName("");
            setDesk("");
            setErrors([]);
          });
        }}
      >
        <h2 className="font-serif text-3xl">Register a provider</h2>
        <p className="mt-2 text-sm text-char">This desk will belong to {account.name}{scope === "examples" ? ". Example changes stay out of the workspace." : "."}</p>
        <div className="mt-6 grid gap-5">
          <Field label="Name">
            <TextInput value={name} onChange={(event) => setName(event.target.value)} />
          </Field>
          <Field label="Desk">
            <TextArea value={desk} onChange={(event) => setDesk(event.target.value)} />
          </Field>
          <ErrorList errors={errors} />
          <Button type="submit">Register provider</Button>
        </div>
      </form>
    </div>
  );
}

export function ProviderPortalPage() {
  const { id } = useParams();
  const { state, account, scope, setProviderStatus, publishResource, updateResource, approveLease, rejectLease, revokeLease } = useLedger();
  const provider = state.providers.find((item) => item.id === id);
  useTitle(provider?.name ?? "Provider");
  const [notice, setNotice] = useState<string[]>([]);
  const [issuedSecret, setIssuedSecret] = useState<string | null>(null);
  if (!provider) return <p className="text-sm">That provider is not registered.</p>;
  const canManage = scope === "examples" || provider.ownerId === account.id;

  const offers = state.resources.filter((resource) => resource.providerId === provider.id);
  const incoming = state.leases.filter((lease) => lease.providerId === provider.id && lease.status === "requested");
  const leases = state.leases.filter((lease) => lease.providerId === provider.id).sort((a, b) => b.createdAt - a.createdAt);
  const usage = state.usageEvents.filter((event) => event.providerId === provider.id).slice(-8).reverse();

  return (
    <div>
      <Link to="/providers" className="text-[12px] uppercase tracking-[0.16em] text-mute">
        Providers
      </Link>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <span className="text-[11px] uppercase tracking-[0.16em] text-mute">{provider.status}</span>
      </div>
      <h1 className="mt-3 font-serif text-[clamp(3rem,6vw,5.4rem)] leading-[0.92] tracking-[-0.04em]">{provider.name}</h1>
      <p className="mt-4 max-w-xl text-sm leading-relaxed text-char">{provider.desk}</p>
      <div className="mt-8 flex flex-wrap items-end justify-between gap-6 border-y border-ink/10 py-6">
        <div>
          <p className="font-serif text-6xl tracking-tight">{formatUsd(providerRevenueMicro(state, provider.id))}</p>
          <p className="mt-2 text-[11px] uppercase tracking-[0.16em] text-mute">Accrued from accepted usage</p>
          <p className="mt-2 max-w-sm text-sm text-char">Settled amount: unavailable. No payment rail is connected.</p>
        </div>
        {canManage ? (
          <Button variant="line" onClick={() => void setProviderStatus(provider.id, provider.status === "active" ? "disabled" : "active")}>
            {provider.status === "active" ? "Disable provider" : "Enable provider"}
          </Button>
        ) : (
          <p className="text-sm text-char">This desk is operated by another account.</p>
        )}
      </div>
      <ErrorList errors={notice} />

      <section className="mt-14">
        <SectionTitle title="Offers" />
        {offers.map((resource) => (
          <OfferEditor
            key={resource.id}
            resource={resource}
            locked={!canManage}
            onSave={async (draft) => {
              const result = await updateResource(resource.id, draft);
              setNotice(result.errors);
            }}
          />
        ))}
        {canManage ? (
          <div className="mt-8 border-t border-ink/10 pt-6">
            <h3 className="font-serif text-3xl">Publish an RPC offer</h3>
            <OfferDraft
              submitLabel="Publish offer"
              initial={{
                name: "",
                summary: "",
                region: "",
                network: "ethereum",
                availability: "available",
                pricePerThousandMicro: 200_000,
                requestRateLimit: 200,
                maxLeaseDurationMs: 6 * 60 * 60 * 1000,
                supportedMethods: [...RPC_METHODS],
                capacityRequests: 100_000,
                endpointUrl: "",
              }}
              onSubmit={async (draft) => {
                const result = await publishResource(provider.id, draft);
                setNotice(result.errors);
                return result.errors.length === 0;
              }}
            />
          </div>
        ) : null}
      </section>

      <section className="mt-14">
        <SectionTitle title="Incoming requests" meta={String(incoming.length)} />
        {incoming.length === 0 ? <p className="text-sm text-char">No request is waiting.</p> : null}
        {issuedSecret ? (
          <p className="mt-4 break-all border-l border-ink/20 pl-3 font-mono text-sm">Credential issued. Copy it now: {issuedSecret}</p>
        ) : null}
        {!canManage && incoming.length > 0 ? <p className="mt-4 text-sm text-char">Only the provider account can approve or reject these requests.</p> : null}
        <div className="space-y-8">
          {incoming.map((lease) => (
            <Incoming
              key={lease.id}
              leaseId={lease.id}
              canManage={canManage}
              onApprove={() =>
                void approveLease(lease.id, provider.id).then((result) => {
                  setNotice(result.errors);
                  if (result.issuedSecret) setIssuedSecret(result.issuedSecret);
                })
              }
              onReject={(reason) => void rejectLease(lease.id, provider.id, reason).then((result) => setNotice(result.errors))}
            />
          ))}
        </div>
      </section>

      <section className="mt-14">
        <SectionTitle title="Leases" />
        <LeaseTable leases={leases} empty="This provider has no leases." />
        {canManage ? (
          <div className="mt-6 space-y-4">
            {leases
              .filter((lease) => lease.status === "active" || lease.status === "approved")
              .map((lease) => (
                <RevokeRow key={lease.id} leaseId={lease.id} onRevoke={(reason) => void revokeLease(lease.id, reason).then((result) => setNotice(result.errors))} />
              ))}
          </div>
        ) : null}
      </section>

      <section className="mt-14">
        <SectionTitle title="Recent meter" />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-left text-sm">
            <thead className="text-[11px] uppercase tracking-[0.14em] text-mute">
              <tr className="border-b border-ink/15">
                {["When", "Lease", "Method", "Requests", "Cost", "Outcome"].map((heading) => (
                  <th key={heading} className="py-3 pr-4 font-normal">
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {usage.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-6 text-sm text-char">
                    No usage has been recorded for this provider.
                  </td>
                </tr>
              ) : null}
              {usage.map((event) => (
                <tr key={event.id} className="border-b border-ink/10">
                  <td className="py-3 pr-4 text-mute">{new Date(event.timestamp).toISOString().slice(11, 19)} UTC</td>
                  <td className="py-3 pr-4 font-mono text-[12px]">
                    <Link to={`/leases/${event.leaseId}`}>{event.leaseId}</Link>
                  </td>
                  <td className="py-3 pr-4">{event.method}</td>
                  <td className="py-3 pr-4 tabular-nums">{formatNumber(event.requestCount)}</td>
                  <td className="py-3 pr-4 tabular-nums">{formatUsd(event.costMicro)}</td>
                  <td className="py-3">{event.outcome === "accepted" ? "Accepted" : event.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Incoming({
  leaseId,
  canManage,
  onApprove,
  onReject,
}: {
  leaseId: string;
  canManage: boolean;
  onApprove: () => void;
  onReject: (reason: string) => void;
}) {
  const { state } = useLedger();
  const [reason, setReason] = useState("");
  const lease = state.leases.find((item) => item.id === leaseId);
  if (!lease) return null;
  return (
    <article className="border-t border-ink/10 py-5">
      <Link to={`/leases/${lease.id}`} className="font-mono text-[12px] underline-offset-4 hover:underline">
        {lease.id}
      </Link>
      <p className="mt-2 text-sm">{lease.task}</p>
      <p className="mt-2 text-xs text-char">
        {formatNumber(lease.maxRequests)} requests · {formatUsd(lease.spendingCapMicro)} cap · {lease.permittedMethods.join(", ")}
      </p>
      {canManage ? (
        <>
          <div className="mt-4 flex flex-wrap gap-3">
            <Button onClick={onApprove}>Approve and sign</Button>
          </div>
          <div className="mt-4 max-w-lg">
            <Field label="Rejection reason">
              <TextArea value={reason} onChange={(event) => setReason(event.target.value)} />
            </Field>
            <Button variant="line" className="mt-3" onClick={() => onReject(reason)}>
              Reject
            </Button>
          </div>
        </>
      ) : null}
    </article>
  );
}

function RevokeRow({ leaseId, onRevoke }: { leaseId: string; onRevoke: (reason: string) => void }) {
  const [reason, setReason] = useState("");
  return (
    <div className="flex flex-col gap-3 border-t border-ink/10 py-4 md:flex-row md:items-end">
      <p className="font-mono text-[12px] md:w-48">{leaseId}</p>
      <div className="flex-1">
        <Field label="Revocation reason">
          <TextInput value={reason} onChange={(event) => setReason(event.target.value)} />
        </Field>
      </div>
      <Button variant="line" onClick={() => onRevoke(reason)}>
        Revoke
      </Button>
    </div>
  );
}

function OfferEditor({ resource, locked, onSave }: { resource: Resource; locked: boolean; onSave: (draft: ResourceDraft) => Promise<void> }) {
  return (
    <details className="border-t border-ink/10 py-4">
      <summary className="cursor-pointer text-lg">
        {resource.name}{" "}
        <span className="text-sm text-mute">
          · {networkLabel(resource.network)} · {resource.availability} · {resource.endpointConfigured ? "endpoint connected" : "no endpoint"}
        </span>
      </summary>
      {locked ? <p className="mt-3 text-sm text-char">Only the provider account can edit this offer.</p> : null}
      {locked ? null : (
        <OfferDraft
          submitLabel="Save offer"
          lockNetwork
          keepEndpoint
          initial={{
            name: resource.name,
            summary: resource.summary,
            region: resource.region,
            network: resource.network,
            availability: resource.availability,
            pricePerThousandMicro: resource.pricing.pricePerThousandMicro,
            requestRateLimit: resource.requestRateLimit,
            maxLeaseDurationMs: resource.maxLeaseDurationMs,
            supportedMethods: resource.supportedMethods,
            capacityRequests: resource.capacityRequests,
          }}
          onSubmit={async (draft) => {
            await onSave(draft);
            return false;
          }}
        />
      )}
    </details>
  );
}

function OfferDraft({
  initial,
  submitLabel,
  lockNetwork = false,
  keepEndpoint = false,
  onSubmit,
}: {
  initial: ResourceDraft;
  submitLabel: string;
  lockNetwork?: boolean;
  keepEndpoint?: boolean;
  onSubmit: (draft: ResourceDraft) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState(initial);
  const [price, setPrice] = useState(formatUsdInput(initial.pricePerThousandMicro));
  const [hours, setHours] = useState(Math.max(1, Math.round(initial.maxLeaseDurationMs / 3_600_000)));
  const [endpoint, setEndpoint] = useState("");
  const [removeEndpoint, setRemoveEndpoint] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="mt-5 grid gap-4 md:grid-cols-2"
      onSubmit={(event) => {
        event.preventDefault();
        const pricePerThousandMicro = parseUsdToMicro(price);
        if (pricePerThousandMicro === null) {
          setError("Enter the price per thousand as a dollar amount.");
          return;
        }
        const next: ResourceDraft = {
          ...draft,
          pricePerThousandMicro,
          maxLeaseDurationMs: Math.round(hours * 3_600_000),
        };
        if (keepEndpoint) {
          if (removeEndpoint) next.endpointUrl = null;
          else if (endpoint.trim()) next.endpointUrl = endpoint.trim();
          else delete next.endpointUrl;
        } else {
          next.endpointUrl = endpoint.trim();
        }
        void onSubmit(next).then((clear) => {
          setError(null);
          if (clear) {
            setDraft(initial);
            setPrice(formatUsdInput(initial.pricePerThousandMicro));
          }
        });
      }}
    >
      <Field label="Name">
        <TextInput value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
      </Field>
      <Field label="Region">
        <TextInput value={draft.region} onChange={(event) => setDraft({ ...draft, region: event.target.value })} />
      </Field>
      <div className="md:col-span-2">
        <Field label="Summary">
          <TextArea value={draft.summary} onChange={(event) => setDraft({ ...draft, summary: event.target.value })} />
        </Field>
      </div>
      <Field label="Network">
        <SelectInput
          disabled={lockNetwork}
          value={draft.network}
          onChange={(event) => setDraft({ ...draft, network: event.target.value as Network })}
        >
          {NETWORKS.map((network) => (
            <option key={network} value={network}>
              {networkLabel(network)}
            </option>
          ))}
        </SelectInput>
      </Field>
      <Field label="Availability">
        <SelectInput
          value={draft.availability}
          onChange={(event) => setDraft({ ...draft, availability: event.target.value as Availability })}
        >
          <option value="available">Available</option>
          <option value="limited">Limited</option>
          <option value="unavailable">Unavailable</option>
        </SelectInput>
      </Field>
      <Field label="Price per 1,000 (USD)">
        <TextInput value={price} onChange={(event) => setPrice(event.target.value)} />
      </Field>
      <Field label="Request rate / minute">
        <NumberInput value={draft.requestRateLimit} onChange={(event) => setDraft({ ...draft, requestRateLimit: Number(event.target.value) })} />
      </Field>
      <Field label="Max duration (hours)">
        <NumberInput value={hours} min={1} onChange={(event) => setHours(Number(event.target.value))} />
      </Field>
      <Field label="Offered ceiling (requests)">
        <NumberInput value={draft.capacityRequests} onChange={(event) => setDraft({ ...draft, capacityRequests: Number(event.target.value) })} />
      </Field>
      <div className="md:col-span-2">
        <Field label="RPC endpoint" hint={keepEndpoint ? "Leave blank to keep the current endpoint. The URL is not shown again." : "Optional. Without one, calls are refused and not sent."}>
          <TextInput value={endpoint} onChange={(event) => setEndpoint(event.target.value)} placeholder="https://" autoComplete="off" />
        </Field>
        {keepEndpoint ? (
          <label className="mt-3 flex items-center gap-3 text-sm">
            <input type="checkbox" checked={removeEndpoint} onChange={(event) => setRemoveEndpoint(event.target.checked)} />
            Remove the endpoint
          </label>
        ) : null}
      </div>
      <div className="md:col-span-2">
        <p className="text-[11px] uppercase tracking-[0.16em] text-mute">Methods</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {RPC_METHODS.map((method) => (
            <Pill
              key={method}
              active={draft.supportedMethods.includes(method)}
              onClick={() => {
                const supported = draft.supportedMethods.includes(method)
                  ? draft.supportedMethods.filter((item) => item !== method)
                  : [...draft.supportedMethods, method];
                setDraft({ ...draft, supportedMethods: supported as RpcMethod[] });
              }}
            >
              {method}
            </Pill>
          ))}
        </div>
      </div>
      {error ? <p className="text-sm text-wine md:col-span-2">{error}</p> : null}
      <div>
        <Button type="submit">{submitLabel}</Button>
      </div>
    </form>
  );
}
