import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useLedger } from "../context/Store.tsx";
import { formatNumber, formatRemaining, formatUsd, networkLabel, statusLabel } from "../lib/format.ts";
import { nameOf } from "../lib/selectors.ts";
import type { Lease } from "../lib/types.ts";
import { Button, StatusMark } from "./ui.tsx";

export function LeaseTable({
  leases,
  empty,
  onApprove,
}: {
  leases: Lease[];
  empty: string;
  onApprove?: (leaseId: string, providerId: string) => Promise<string[]>;
}) {
  const { state, now } = useLedger();
  const navigate = useNavigate();
  if (leases.length === 0) return <p className="border-t border-ink/10 py-8 text-sm text-char">{empty}</p>;
  return (
    <div className="overflow-x-auto">
      <p className="mb-2 text-[11px] uppercase tracking-[0.14em] text-mute md:hidden">Scroll sideways for the full row</p>
      <table className="w-full min-w-[920px] border-collapse text-left">
        <thead className="text-[11px] uppercase tracking-[0.14em] text-mute">
          <tr className="border-b border-ink/15">
            {["Lease", "Agent", "Provider", "Network", "Usage", "Spending", "Remaining", "Status"].map((heading) => (
              <th key={heading} className="py-3 pr-4 font-normal">
                {heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {leases.map((lease) => (
            <tr
              key={lease.id}
              onClick={() => navigate(`/leases/${lease.id}`)}
              className="cursor-pointer border-b border-ink/10 align-top transition-colors hover:bg-ink/[0.03]"
            >
              <td className="py-4 pr-4">
                <Link to={`/leases/${lease.id}`} className="font-mono text-[12px] underline-offset-4 hover:underline" onClick={(event) => event.stopPropagation()}>
                  {lease.id}
                </Link>
                <p className="mt-1 max-w-[16rem] text-xs text-char">{lease.task}</p>
              </td>
              <td className="py-4 pr-4 text-sm">
                <Link to={`/agents#${lease.agentId}`} className="hover:underline" onClick={(event) => event.stopPropagation()}>
                  {nameOf(state.agents, lease.agentId)}
                </Link>
              </td>
              <td className="py-4 pr-4 text-sm">
                <Link to={`/providers/${lease.providerId}`} className="hover:underline" onClick={(event) => event.stopPropagation()}>
                  {nameOf(state.providers, lease.providerId)}
                </Link>
              </td>
              <td className="py-4 pr-4 text-sm">{networkLabel(lease.network)}</td>
              <td className="py-4 pr-4 text-sm tabular-nums">
                {formatNumber(lease.usage.requests)}
                <span className="text-mute"> / {formatNumber(lease.maxRequests)}</span>
              </td>
              <td className="py-4 pr-4 text-sm tabular-nums">
                {formatUsd(lease.usage.costMicro)}
                <span className="text-mute"> / {formatUsd(lease.spendingCapMicro)}</span>
              </td>
              <td className="py-4 pr-4 text-sm tabular-nums">{formatRemaining(lease.expiresAt, now)}</td>
              <td className="py-4">
                <div className="flex flex-col items-start gap-2">
                  <StatusMark status={lease.status} label={statusLabel(lease.status)} />
                  {lease.status === "requested" && onApprove ? (
                    <ApproveButton lease={lease} onApprove={onApprove} />
                  ) : null}
                  {lease.credential?.status === "valid" ? <p className="text-[11px] text-mute">Credential {lease.credential.id}</p> : null}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ApproveButton({
  lease,
  onApprove,
}: {
  lease: Lease;
  onApprove: (leaseId: string, providerId: string) => Promise<string[]>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div onClick={(event) => event.stopPropagation()}>
      <Button
        disabled={busy}
        onClick={(event) => {
          event.stopPropagation();
          setBusy(true);
          setError(null);
          void onApprove(lease.id, lease.providerId)
            .then((errors) => setError(errors[0] ?? null))
            .catch((error: unknown) => setError(error instanceof Error ? error.message : "The approval did not complete."))
            .finally(() => setBusy(false));
        }}
      >
        {busy ? "Signing" : "Approve"}
      </Button>
      {error ? <p className="mt-2 max-w-[14rem] text-xs text-wine">{error}</p> : null}
    </div>
  );
}
