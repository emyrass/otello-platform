import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Console } from "../components/Console.tsx";
import { PageHeader, SectionTitle, SelectInput, useTitle } from "../components/ui.tsx";
import { UsageChart } from "../components/UsageChart.tsx";
import { useLedger } from "../context/Store.tsx";
import { formatNumber, formatTimestamp, formatUsd } from "../lib/format.ts";
import { leaseAccepted, nameOf, usageSeries } from "../lib/selectors.ts";

export function UsagePage() {
  const { state, now } = useLedger();
  useTitle("Usage");
  const [params] = useSearchParams();
  const [leaseId, setLeaseId] = useState(params.get("lease") ?? "all");
  const selected = leaseId === "all" ? undefined : state.leases.find((lease) => lease.id === leaseId);
  const events = useMemo(() => {
    const rows = state.usageEvents.filter((event) => leaseId === "all" || event.leaseId === leaseId);
    return [...rows].reverse().slice(0, 40);
  }, [leaseId, state.usageEvents]);
  const totals = selected
    ? leaseAccepted(state, selected.id)
    : state.usageEvents.reduce(
        (sum, event) =>
          event.outcome === "accepted"
            ? { requests: sum.requests + event.requestCount, costMicro: sum.costMicro + event.costMicro }
            : sum,
        { requests: 0, costMicro: 0 },
      );
  const series = usageSeries(state, leaseId === "all" ? "all" : leaseId, now, 60 * 60 * 1000, 12);
  const remainingRequests = selected ? Math.max(0, selected.maxRequests - selected.usage.requests) : null;
  const remainingBudget = selected ? Math.max(0, selected.spendingCapMicro - selected.usage.costMicro) : null;

  return (
    <div>
      <PageHeader
        kicker="Usage"
        title="The meter."
        lede="Every accepted call adds an integer cost. A refused batch leaves the allowance and the budget where they were."
      />
      <div className="mt-8 max-w-md">
        <p className="text-[11px] uppercase tracking-[0.16em] text-mute">Lease</p>
        <SelectInput value={selected?.id ?? "all"} onChange={(event) => setLeaseId(event.target.value)} aria-label="Lease">
          <option value="all">All leases</option>
          {state.leases.map((lease) => (
            <option key={lease.id} value={lease.id}>
              {lease.id} · {nameOf(state.agents, lease.agentId)} · {lease.status}
            </option>
          ))}
        </SelectInput>
      </div>
      <section className="mt-10 grid grid-cols-2 gap-8 border-y border-ink/10 py-8 md:grid-cols-4">
        <Figure label="Accepted requests" value={formatNumber(totals.requests)} />
        <Figure label="Accrued cost" value={formatUsd(totals.costMicro)} />
        <Figure label="Remaining allowance" value={remainingRequests === null ? "—" : formatNumber(remainingRequests)} />
        <Figure label="Remaining budget" value={remainingBudget === null ? "—" : formatUsd(remainingBudget)} />
      </section>
      <section className="mt-12">
        <SectionTitle title="Accepted usage" meta="Twelve hours" />
        <UsageChart points={series} />
      </section>
      <section className="mt-14 border-t border-ink/10 pt-8">
        <SectionTitle title="Console" />
        <Console key={`${selected?.agentId ?? "all"}-${selected?.id ?? "all"}`} initialLeaseId={selected?.id} initialAgentId={selected?.agentId} />
      </section>
      <section className="mt-14">
        <SectionTitle title="Events" />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead className="text-[11px] uppercase tracking-[0.14em] text-mute">
              <tr className="border-b border-ink/15">
                {["Time", "Lease", "Agent", "Provider", "Method", "Count", "Unit", "Cost", "Outcome"].map((heading) => (
                  <th key={heading} className="py-3 pr-3 font-normal">
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {events.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-6 text-sm text-char">
                    No usage has been recorded for this selection.
                  </td>
                </tr>
              ) : null}
              {events.map((event) => (
                <tr key={event.id} className="border-b border-ink/10 align-top">
                  <td className="py-3 pr-3 text-[12px] text-mute">{formatTimestamp(event.timestamp)}</td>
                  <td className="py-3 pr-3 font-mono text-[12px]">
                    <Link to={`/leases/${event.leaseId}`}>{event.leaseId}</Link>
                  </td>
                  <td className="py-3 pr-3">{nameOf(state.agents, event.agentId)}</td>
                  <td className="py-3 pr-3">{nameOf(state.providers, event.providerId)}</td>
                  <td className="py-3 pr-3">{event.method}</td>
                  <td className="py-3 pr-3 tabular-nums">{formatNumber(event.requestCount)}</td>
                  <td className="py-3 pr-3 tabular-nums">{formatUsd(event.unitPriceMicroPerThousand)}</td>
                  <td className="py-3 pr-3 tabular-nums">{formatUsd(event.costMicro)}</td>
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

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="font-serif text-4xl tracking-tight">{value}</p>
      <p className="mt-2 text-[11px] uppercase tracking-[0.14em] text-mute">{label}</p>
    </div>
  );
}
