import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ActivityList } from "../components/ActivityList.tsx";
import { AgreementPanel } from "../components/AgreementPanel.tsx";
import { Console } from "../components/Console.tsx";
import { CredentialPanel } from "../components/CredentialPanel.tsx";
import { Button, ErrorList, FeaturePanel, Field, Meter, SectionTitle, StatusMark, TextArea, useTitle } from "../components/ui.tsx";
import { useLedger } from "../context/Store.tsx";
import { formatNumber, formatPerThousand, formatRemaining, formatTimestamp, formatUsd, networkLabel, statusLabel } from "../lib/format.ts";
import { isSampleProvider } from "../lib/marketSamples.ts";
import { leaseAccepted, nameOf } from "../lib/selectors.ts";

export function LeaseDetailPage() {
  const { id } = useParams();
  const { state, now, account, scope, approveLease, rejectLease, revokeLease, revealCredential } = useLedger();
  const lease = state.leases.find((item) => item.id === id);
  useTitle(lease ? lease.id : "Lease");
  const [rejectReason, setRejectReason] = useState("");
  const [revokeReason, setRevokeReason] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [issuedSecret, setIssuedSecret] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!lease) return <p className="text-sm">That lease is not in the ledger.</p>;
  const provider = state.providers.find((item) => item.id === lease.providerId);
  const canManage = scope === "examples" || provider?.ownerId === account.id || isSampleProvider(provider?.id);

  const totals = leaseAccepted(state, lease.id);
  const settlement = state.settlements.find((item) => item.leaseId === lease.id);
  const events = state.audit.filter((event) => event.leaseId === lease.id).slice(-8).reverse();

  return (
    <article>
      <Link to="/leases" className="text-[12px] uppercase tracking-[0.16em] text-mute">
        Leases
      </Link>
      <div className="mt-4 flex flex-wrap items-center gap-4">
        <StatusMark status={lease.status} label={statusLabel(lease.status)} />
        <span className="text-[12px] uppercase tracking-[0.16em] text-mute">{networkLabel(lease.network)}</span>
      </div>
      <h1 className="mt-3 font-mono text-[clamp(1.4rem,3vw,2rem)] tracking-tight">{lease.id}</h1>
      <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-char">{lease.task}</p>
      <p className="mt-3 text-sm">
        <Link to={`/agents#${lease.agentId}`} className="underline underline-offset-4">
          {nameOf(state.agents, lease.agentId)}
        </Link>
        {" · "}
        <Link to={`/providers/${lease.providerId}`} className="underline underline-offset-4">
          {nameOf(state.providers, lease.providerId)}
        </Link>
        {" · "}
        <Link to={`/resources/${lease.resourceId}`} className="underline underline-offset-4">
          {nameOf(state.resources, lease.resourceId)}
        </Link>
      </p>

      <div className="mt-10">
        <FeaturePanel>
          <div className="grid gap-8 md:grid-cols-4">
            <Figure label="Time remaining" value={lease.status === "approved" ? "Not started" : formatRemaining(lease.expiresAt, now)} />
            <Figure label="Consumed" value={formatNumber(lease.usage.requests)} />
            <Figure label="Accrued" value={formatUsd(lease.usage.costMicro)} />
            <Figure label="Budget left" value={formatUsd(Math.max(0, lease.spendingCapMicro - lease.usage.costMicro))} />
          </div>
          <div className="mt-8 grid gap-5 md:grid-cols-2">
            <Meter label="Allowance" value={lease.usage.requests} total={lease.maxRequests} />
            <Meter label="Spending cap" value={lease.usage.costMicro} total={lease.spendingCapMicro} />
          </div>
          <p className="mt-6 text-sm text-char">
            {formatPerThousand(lease.pricing.pricePerThousandMicro)} · {formatNumber(lease.maxRequestRate)} requests / minute · {lease.permittedMethods.join(", ")}
          </p>
        </FeaturePanel>
      </div>

      {lease.status === "requested" ? (
        <section className="mt-12 border-t border-ink/10 pt-8">
          <SectionTitle title="Provider decision" meta="Recorded as a provider action" />
          <p className="max-w-xl text-sm text-char">
            Approval signs agreement version 1. If the start time has arrived, the lease activates and a temporary credential is issued.
          </p>
          {canManage ? (
          <>
          <div className="mt-6 flex flex-wrap gap-3">
            <Button
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void approveLease(lease.id, lease.providerId).then((result) => {
                  setErrors(result.errors);
                  if (result.issuedSecret) setIssuedSecret(result.issuedSecret);
                  setBusy(false);
                });
              }}
            >
              Approve and sign
            </Button>
            <Link to={`/providers/${lease.providerId}`} className="rounded-full border border-ink/20 px-4 py-2 text-[13px]">
              Open provider portal
            </Link>
          </div>
          <div className="mt-6 max-w-xl">
            <Field label="Rejection reason">
              <TextArea value={rejectReason} onChange={(event) => setRejectReason(event.target.value)} />
            </Field>
            <Button
              variant="line"
              className="mt-4"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void rejectLease(lease.id, lease.providerId, rejectReason).then((result) => {
                  setErrors(result.errors);
                  setBusy(false);
                });
              }}
            >
              Reject request
            </Button>
          </div>
          </>
          ) : (
            <p className="mt-6 text-sm text-char">Only the provider account can approve or reject this request.</p>
          )}
          {issuedSecret ? <p className="mt-4 break-all font-mono text-sm">Credential issued. Copy it now: {issuedSecret}</p> : null}
          <div className="mt-4">
            <ErrorList errors={errors} />
          </div>
        </section>
      ) : null}

      {canManage && (lease.status === "active" || lease.status === "approved") ? (
        <section className="mt-12 border-t border-ink/10 pt-8">
          <SectionTitle title="Revoke access" />
          <div className="max-w-xl">
            <Field label="Reason">
              <TextArea value={revokeReason} onChange={(event) => setRevokeReason(event.target.value)} />
            </Field>
            <Button
              variant="line"
              className="mt-4"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void revokeLease(lease.id, revokeReason).then((result) => {
                  setErrors(result.errors);
                  setBusy(false);
                });
              }}
            >
              Revoke lease
            </Button>
            <div className="mt-4">
              <ErrorList errors={errors} />
            </div>
          </div>
        </section>
      ) : null}

      {lease.rejectionReason ? <p className="mt-8 text-sm">Rejected: {lease.rejectionReason}</p> : null}
      {lease.revocationReason ? <p className="mt-8 text-sm">Revoked: {lease.revocationReason}</p> : null}

      <section className="mt-14 border-t border-ink/10 pt-8">
        <SectionTitle title="Timeline" />
        <ol>
          {lease.timeline.map((entry) => (
            <li key={`${entry.at}-${entry.status}-${entry.note}`} className="grid gap-2 border-b border-ink/10 py-4 md:grid-cols-[12rem_8rem_1fr]">
              <time className="text-[12px] text-mute">{formatTimestamp(entry.at)}</time>
              <StatusMark status={entry.status} label={statusLabel(entry.status)} />
              <p className="text-sm text-char">{entry.note}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-14 grid gap-12 border-t border-ink/10 pt-8 lg:grid-cols-2">
        <div>
          <SectionTitle title="Signed agreement" />
          <AgreementPanel lease={lease} />
        </div>
        <div>
          <SectionTitle title="Credential" />
          <CredentialPanel
            credential={lease.credential}
            onReveal={async () => {
              const result = await revealCredential(lease.id);
              if (!result.secret) throw new Error(result.errors[0] ?? "The credential could not be read.");
              return result.secret;
            }}
          />
        </div>
      </section>

      <section className="mt-14 border-t border-ink/10 pt-8">
        <SectionTitle title="Accrued usage" meta="Separate from access" />
        <div className="grid gap-8 md:grid-cols-[1fr_1fr]">
          <div>
            <p className="text-[11px] uppercase tracking-[0.16em] text-mute">Access</p>
            <p className="mt-2 font-serif text-4xl">{statusLabel(lease.status)}</p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-[0.16em] text-mute">Accrued</p>
            <p className="mt-2 font-serif text-4xl">{formatUsd(totals.costMicro)}</p>
            <p className="mt-2 text-sm text-char">{formatNumber(totals.requests)} accepted requests. Settled amount: unavailable. No payment rail is connected.</p>
          </div>
        </div>
        {settlement ? <p className="mt-4 text-sm text-char">{settlement.note}</p> : null}
      </section>

      <section className="mt-14 border-t border-ink/10 pt-8">
        <SectionTitle title="RPC console" meta="One policy check for every batch" />
        <Console key={lease.id} initialAgentId={lease.agentId} initialLeaseId={lease.id} />
      </section>

      <section className="mt-14 border-t border-ink/10 pt-8">
        <SectionTitle title="Lease activity" />
        <ActivityList events={events} empty="No audit events for this lease yet." />
      </section>
    </article>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="font-serif text-4xl tracking-tight md:text-5xl">{value}</p>
      <p className="mt-2 text-[11px] uppercase tracking-[0.14em] text-mute">{label}</p>
    </div>
  );
}
