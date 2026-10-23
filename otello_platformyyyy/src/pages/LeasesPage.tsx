import { Link, useSearchParams } from "react-router-dom";
import { LeaseTable } from "../components/LeaseTable.tsx";
import { PageHeader, Pill, useTitle } from "../components/ui.tsx";
import { useLedger } from "../context/Store.tsx";
import { statusLabel } from "../lib/format.ts";
import { LEASE_STATUSES, type LeaseStatus } from "../lib/types.ts";

export function LeasesPage() {
  const { state, now } = useLedger();
  useTitle("Leases");
  const [params, setParams] = useSearchParams();
  const status = params.get("status");
  const selected = LEASE_STATUSES.includes(status as LeaseStatus) ? (status as LeaseStatus) : "all";
  const soon = params.get("window") === "soon";
  const rows = state.leases
    .filter((lease) => selected === "all" || lease.status === selected)
    .filter((lease) => {
      if (!soon) return true;
      const left = lease.expiresAt - now;
      return lease.status === "active" && left > 0 && left <= 15 * 60 * 1000;
    })
    .sort((a, b) => b.createdAt - a.createdAt);

  function setStatus(value: LeaseStatus | "all") {
    const next = new URLSearchParams(params);
    if (value === "all") next.delete("status");
    else next.set("status", value);
    next.delete("window");
    setParams(next);
  }

  return (
    <div>
      <PageHeader
        kicker="Leases"
        title="Agreements."
        lede="A request stays pending until the provider signs. Access ends at expiry, exhaustion, or revocation — checked on every call, not only by the clock on screen."
      />
      <div className="mt-8 flex flex-wrap items-center gap-2">
        <Pill active={selected === "all" && !soon} onClick={() => setStatus("all")}>
          All
        </Pill>
        {LEASE_STATUSES.map((item) => (
          <Pill key={item} active={selected === item && !soon} onClick={() => setStatus(item)}>
            {statusLabel(item)}
          </Pill>
        ))}
        <Link to="/leases/new" className="ml-auto rounded-full bg-ink px-4 py-2 text-[13px] tracking-wide text-ivory">
          Request lease
        </Link>
      </div>
      <div className="mt-8">
        <LeaseTable leases={rows} empty={soon ? "Nothing active ends in the next fifteen minutes." : "No leases in this state."} />
      </div>
    </div>
  );
}
