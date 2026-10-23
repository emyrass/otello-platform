import { Link } from "react-router-dom";
import { ActivityList } from "../components/ActivityList.tsx";
import { LeaseTable } from "../components/LeaseTable.tsx";
import { FeaturePanel, Meter, PageHeader, SectionTitle, StatusMark, useTitle } from "../components/ui.tsx";
import { UsageChart } from "../components/UsageChart.tsx";
import { useLedger } from "../context/Store.tsx";
import { formatNumber, formatRemaining, formatUsd, networkLabel, statusLabel } from "../lib/format.ts";
import { metrics, nameOf, usageSeries } from "../lib/selectors.ts";

export function OverviewPage() {
  const { state, now } = useLedger();
  useTitle("otello");
  const figures = metrics(state, now);
  const active = state.leases.filter((lease) => lease.status === "active").sort((a, b) => a.expiresAt - b.expiresAt);
  const featured = active[0];
  const series = usageSeries(state, "all", now, 60 * 60 * 1000, 12);
  const recent = [...state.audit].slice(-6).reverse();
  const lede =
    figures.activeLeases === 0
      ? "No lease is drawing capacity. Pending requests are waiting on a provider."
      : `${figures.activeLeases} active ${figures.activeLeases === 1 ? "lease" : "leases"}, ${figures.pendingRequests} awaiting a provider, ${figures.expiringSoon} ending within fifteen minutes.`;

  const cards = [
    { label: "Active leases", value: formatNumber(figures.activeLeases), to: "/leases?status=active" },
    { label: "Pending requests", value: formatNumber(figures.pendingRequests), to: "/leases?status=requested" },
    { label: "Available RPC", value: formatNumber(figures.availableResources), to: "/resources?availability=available" },
    { label: "Registered agents", value: formatNumber(figures.registeredAgents), to: "/agents" },
    { label: "Accepted requests", value: formatNumber(figures.consumedRequests), to: "/usage" },
    { label: "Accrued usage", value: formatUsd(figures.spendingMicro), to: "/usage" },
    { label: "Ending soon", value: formatNumber(figures.expiringSoon), to: "/leases?status=active&window=soon" },
  ];

  return (
    <div>
      <PageHeader kicker="Overview" title={figures.activeLeases === 0 ? "Nothing is on loan." : "What is on loan."} lede={lede} />
      <section className="mt-12 grid grid-cols-2 gap-x-6 gap-y-8 border-y border-ink/15 py-8 md:grid-cols-4 xl:grid-cols-7">
        {cards.map((card) => (
          <Link key={card.label} to={card.to} className="group block">
            <p className="font-serif text-[2.4rem] leading-none tracking-[-0.04em]">{card.value}</p>
            <p className="mt-3 text-[11px] uppercase tracking-[0.16em] text-char group-hover:text-ink">{card.label}</p>
          </Link>
        ))}
      </section>

      {featured ? (
        <section className="mt-14">
          <FeaturePanel>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <p className="text-[11px] uppercase tracking-[0.16em] text-mute">Featured active lease</p>
              <StatusMark status={featured.status} label={statusLabel(featured.status)} />
            </div>
            <h2 className="mt-4 font-serif text-4xl tracking-tight md:text-5xl">
              <Link to={`/leases/${featured.id}`} className="hover:underline">
                {nameOf(state.agents, featured.agentId)}
              </Link>
            </h2>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-char">{featured.task}</p>
            <p className="mt-2 text-sm">
              {nameOf(state.providers, featured.providerId)} · {networkLabel(featured.network)}
            </p>
            <div className="mt-8 grid gap-8 md:grid-cols-3">
              <div>
                <p className="font-serif text-5xl tracking-tight">{formatRemaining(featured.expiresAt, now)}</p>
                <p className="mt-2 text-[11px] uppercase tracking-[0.16em] text-mute">Time remaining</p>
              </div>
              <div>
                <p className="font-serif text-5xl tracking-tight">{formatNumber(featured.usage.requests)}</p>
                <p className="mt-2 text-[11px] uppercase tracking-[0.16em] text-mute">Requests consumed</p>
              </div>
              <div>
                <p className="font-serif text-5xl tracking-tight">{formatUsd(featured.usage.costMicro)}</p>
                <p className="mt-2 text-[11px] uppercase tracking-[0.16em] text-mute">Accrued cost</p>
              </div>
            </div>
            <div className="mt-8 grid gap-5 md:grid-cols-2">
              <Meter label="Allowance" value={featured.usage.requests} total={featured.maxRequests} />
              <Meter label="Budget" value={featured.usage.costMicro} total={featured.spendingCapMicro} />
            </div>
          </FeaturePanel>
        </section>
      ) : null}

      <section className="mt-16">
        <SectionTitle title="Active leases" meta="Open a row for the agreement" />
        <LeaseTable leases={active} empty="No lease is active. Approve a request or wait for a start time." />
      </section>

      <section className="mt-16 grid grid-cols-[minmax(0,1fr)] gap-14 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
        <div>
          <SectionTitle title="Usage" meta="Accepted requests, twelve hours" />
          <UsageChart points={series} />
        </div>
        <div>
          <SectionTitle title="Recent activity" meta="Newest first" />
          <ActivityList events={recent} empty="The audit log is empty." />
          <Link to="/activity" className="mt-4 inline-block text-sm underline underline-offset-4">
            Open the ledger
          </Link>
        </div>
      </section>
    </div>
  );
}
