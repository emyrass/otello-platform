import { useEffect, useState } from "react";
import { useLedger } from "../context/Store.tsx";
import { keyThumbprint, samePublicKey, verifyAgreement } from "../lib/crypto.ts";
import { formatNumber, formatPerThousand, formatTimestamp, formatUsd, networkLabel } from "../lib/format.ts";
import { nameOf } from "../lib/selectors.ts";
import type { Lease } from "../lib/types.ts";
import { Button, ErrorList } from "./ui.tsx";

export function AgreementPanel({ lease }: { lease: Lease }) {
  const { state, recordVerification } = useLedger();
  const agreement = lease.agreement;
  const [check, setCheck] = useState<{ hash: string; passed: boolean } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const provider = state.providers.find((item) => item.id === lease.providerId);

  useEffect(() => {
    if (!agreement) return;
    let cancel = false;
    const hash = agreement.hashHex;
    void verifyAgreement(agreement).then((passed) => {
      if (!cancel) setCheck({ hash, passed });
    });
    return () => {
      cancel = true;
    };
  }, [agreement]);

  const verified = agreement && check?.hash === agreement.hashHex ? check.passed : null;

  if (!agreement) {
    return <p className="text-sm text-char">No agreement has been signed. Approval creates version 1 and an ECDSA P-256 signature.</p>;
  }

  const signerMatches = Boolean(
    provider && agreement.signerId === provider.id && samePublicKey(agreement.publicKeyJwk, provider.publicKeyJwk),
  );
  const shown = verified === null ? "Checking signature" : verified && signerMatches ? "Verified" : "Invalid";

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[11px] uppercase tracking-[0.16em] text-mute">Signature</p>
          <p className="mt-2 font-serif text-4xl tracking-tight">{shown}</p>
        </div>
        <Button
          variant="line"
          onClick={() => {
            void recordVerification(lease.id).then((result) => {
              setNote(result.errors[0] ?? "Verification recorded in the audit log.");
            });
          }}
        >
          Record verification
        </Button>
      </div>
      <p className="mt-3 max-w-xl text-sm text-char">
        Status is shown only after Web Crypto verifies the signature over the canonical agreement. A changed term invalidates it and needs a new version.
      </p>
      {note ? <p className="mt-3 text-sm">{note}</p> : null}
      <ErrorList errors={verified === false || (verified && !signerMatches) ? ["This signature does not verify against the provider key and the current terms."] : []} />
      <dl className="mt-8 grid gap-y-3 text-sm md:grid-cols-[11rem_minmax(0,1fr)]">
        <Row label="Lease" value={agreement.payload.leaseId} mono />
        <Row label="Version" value={String(agreement.payload.agreementVersion)} />
        <Row label="Agent" value={nameOf(state.agents, agreement.payload.agentId)} />
        <Row label="Provider" value={nameOf(state.providers, agreement.payload.providerId)} />
        <Row label="Resource" value={nameOf(state.resources, agreement.payload.resourceId)} />
        <Row label="Network" value={networkLabel(agreement.payload.network)} />
        <Row label="Signer" value={`${nameOf(state.providers, agreement.signerId)} · ${keyThumbprint(agreement.publicKeyJwk)}`} />
        <Row label="Key match" value={signerMatches ? "Matches the provider record" : "Does not match the provider record"} />
        <Row label="Signed" value={formatTimestamp(agreement.signedAt)} />
        <Row label="Starts" value={formatTimestamp(agreement.payload.startAt)} />
        <Row label="Expires" value={formatTimestamp(agreement.payload.expiresAt)} />
        <Row label="Allowance" value={`${formatNumber(agreement.payload.usageAllowance)} requests`} />
        <Row label="Spending cap" value={formatUsd(agreement.payload.spendingCapMicro)} />
        <Row label="Rate" value={`${formatNumber(agreement.payload.requestRatePerMinute)} / minute`} />
        <Row label="Price" value={formatPerThousand(agreement.payload.pricePerThousandMicro)} />
        <Row label="Methods" value={agreement.payload.permittedMethods.join(", ")} />
        <Row label="Hash" value={agreement.hashHex} mono />
      </dl>
      <h3 className="mt-8 text-[11px] uppercase tracking-[0.16em] text-mute">Revocation conditions</h3>
      <ul className="mt-3 max-w-2xl space-y-2 text-sm leading-relaxed text-char">
        {agreement.payload.revocationConditions.map((condition) => (
          <li key={condition}>{condition}</li>
        ))}
      </ul>
    </div>
  );
}

function Row({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <>
      <dt className="text-mute">{label}</dt>
      <dd className={mono ? "break-all font-mono text-[12px] leading-relaxed" : ""}>{value}</dd>
    </>
  );
}
