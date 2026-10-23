import { useState } from "react";
import { formatTimestamp } from "../lib/format.ts";
import type { Credential } from "../lib/types.ts";

export function CredentialPanel({
  credential,
  onReveal,
}: {
  credential: Credential | undefined;
  onReveal?: () => Promise<string>;
}) {
  const [revealed, setRevealed] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!credential) {
    return <p className="text-sm text-char">A credential is issued when the lease becomes active. Nothing has been issued yet.</p>;
  }
  return (
    <div>
      <p className="text-[11px] uppercase tracking-[0.16em] text-mute">Temporary credential</p>
      <p className="mt-3 break-all font-mono text-sm">{revealed ?? "••••••••"}</p>
      <div className="mt-4 flex flex-wrap gap-3 text-[12px]">
        <button
          type="button"
          className="underline underline-offset-4"
          onClick={() => {
            if (revealed) {
              setRevealed(null);
              return;
            }
            if (!onReveal) return;
            setError(null);
            void onReveal()
              .then((secret) => setRevealed(secret))
              .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "The credential could not be read."));
          }}
        >
          {revealed ? "Mask secret" : "Reveal secret"}
        </button>
        <button
          type="button"
          className="underline underline-offset-4"
          disabled={!revealed}
          onClick={() => {
            if (!revealed) return;
            void navigator.clipboard?.writeText(revealed).then(() => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1500);
            });
          }}
        >
          {copied ? "Copied" : "Copy secret"}
        </button>
      </div>
      {error ? <p className="mt-3 text-sm text-wine">{error}</p> : null}
      <dl className="mt-6 grid gap-y-2 text-sm md:grid-cols-[8rem_1fr]">
        <dt className="text-mute">Identifier</dt>
        <dd className="font-mono text-[12px]">{credential.id}</dd>
        <dt className="text-mute">Issued</dt>
        <dd>{formatTimestamp(credential.issuedAt)}</dd>
        <dt className="text-mute">Expires</dt>
        <dd>{formatTimestamp(credential.expiresAt)}</dd>
        <dt className="text-mute">Validity</dt>
        <dd>{credential.status === "valid" ? "Valid" : `Invalid. ${credential.invalidReason ?? ""}`}</dd>
        <dt className="text-mute">Scope</dt>
        <dd>
          {credential.agentId} · {credential.network} · {credential.permittedMethods.join(", ")}
        </dd>
      </dl>
      <p className="mt-5 max-w-md text-xs leading-relaxed text-char">The secret is stored on the server. It is not written to the activity log.</p>
    </div>
  );
}
