import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AvailabilityMark, FeaturePanel, PageHeader, Pill, TextInput, useTitle } from "../components/ui.tsx";
import { useLedger } from "../context/Store.tsx";
import { availabilityLabel, formatNumber, formatPerThousand, formatDuration, networkLabel } from "../lib/format.ts";
import { filterResources, nameOf } from "../lib/selectors.ts";
import { NETWORKS, type Availability, type Network } from "../lib/types.ts";

const AVAILABILITY = ["available", "limited", "unavailable"] as const;

export function ResourcesPage() {
  const { state, scope } = useLedger();
  useTitle("Resources");
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState("");
  const network = (params.get("network") ?? "all") as Network | "all";
  const availability = (params.get("availability") ?? "all") as Availability | "all";
  const sort = (params.get("sort") ?? "price-asc") as "price-asc" | "price-desc" | "name" | "rate";

  const rows = useMemo(
    () => filterResources(state, { search, network, availability, sort }),
    [availability, network, search, sort, state],
  );
  const [featured, ...rest] = rows;

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value === "all" || value === "price-asc") next.delete(key);
    else next.set(key, value);
    if (key === "sort" && value !== "price-asc") next.set("sort", value);
    if (key === "sort" && value === "price-asc") next.delete("sort");
    setParams(next);
  }

  return (
    <div>
      <PageHeader
        kicker="Resource market"
        title="RPC, on offer."
        lede={
          scope === "examples"
            ? "Example offers, kept apart from the workspace. None of them has an endpoint."
            : "Offers published in this workspace. A price is what the provider set. Without an endpoint, accepted calls are simulated here. Latency is shown only after a connected endpoint answers."
        }
      />
      <div className="mt-10 flex flex-col gap-4 border-y border-ink/10 py-5">
        <TextInput value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, provider, region, method" aria-label="Search resources" />
        <div className="flex flex-wrap items-center gap-2">
          <Pill active={network === "all"} onClick={() => setParam("network", "all")}>
            All networks
          </Pill>
          {NETWORKS.map((item) => (
            <Pill key={item} active={network === item} onClick={() => setParam("network", item)}>
              {networkLabel(item)}
            </Pill>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Pill active={availability === "all"} onClick={() => setParam("availability", "all")}>
            Any availability
          </Pill>
          {AVAILABILITY.map((item) => (
            <Pill key={item} active={availability === item} onClick={() => setParam("availability", item)}>
              {availabilityLabel(item)}
            </Pill>
          ))}
          <label className="ml-auto flex items-center gap-2 text-[12px] text-char">
            Sort
            <select
              className="bg-transparent text-ink"
              value={sort}
              onChange={(event) => setParam("sort", event.target.value)}
              aria-label="Sort resources"
            >
              <option value="price-asc">Price, low to high</option>
              <option value="price-desc">Price, high to low</option>
              <option value="rate">Request rate</option>
              <option value="name">Name</option>
            </select>
          </label>
        </div>
      </div>

      {state.resources.length === 0 ? (
        <p className="mt-12 border-t border-ink/10 py-8 text-sm text-char">No resources have been published.</p>
      ) : featured ? (
        <div className="mt-12">
          <FeaturePanel>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-[10px] uppercase tracking-[0.16em] text-mute">{featured.endpointConfigured ? "Endpoint connected" : "No endpoint"}</span>
              <AvailabilityMark availability={featured.availability} label={availabilityLabel(featured.availability)} />
            </div>
            <h2 className="mt-4 font-serif text-5xl tracking-tight">
              <Link to={`/resources/${featured.id}`}>{featured.name}</Link>
            </h2>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-char">{featured.summary}</p>
            <dl className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="Provider" value={nameOf(state.providers, featured.providerId)} />
              <Stat label="Network" value={networkLabel(featured.network)} />
              <Stat label="Price" value={formatPerThousand(featured.pricing.pricePerThousandMicro)} />
              <Stat label="Rate limit" value={`${formatNumber(featured.requestRateLimit)} / min`} />
              <Stat label="Max duration" value={formatDuration(featured.maxLeaseDurationMs)} />
              <Stat label="Region" value={featured.region} />
              <Stat label="Endpoint" value={featured.endpointConfigured ? "Connected" : "Not configured"} />
              <Stat label="Methods" value={String(featured.supportedMethods.length)} />
            </dl>
            <Link to={`/resources/${featured.id}`} className="mt-8 inline-block text-sm underline underline-offset-4">
              View specifications
            </Link>
          </FeaturePanel>
        </div>
      ) : (
        <p className="mt-12 border-t border-ink/10 py-8 text-sm text-char">No offers match that filter.</p>
      )}

      <div className="mt-8">
        {rest.map((resource) => (
          <Link key={resource.id} to={`/resources/${resource.id}`} className="grid gap-3 border-t border-ink/10 py-6 md:grid-cols-12 md:items-baseline">
            <div className="md:col-span-4">
              <p className="text-lg">{resource.name}</p>
              <p className="mt-1 text-xs text-mute">
                {nameOf(state.providers, resource.providerId)} · {resource.region}
              </p>
            </div>
            <p className="text-sm md:col-span-2">{networkLabel(resource.network)}</p>
            <p className="text-sm tabular-nums md:col-span-2">{formatPerThousand(resource.pricing.pricePerThousandMicro)}</p>
            <p className="text-sm md:col-span-2">{formatNumber(resource.requestRateLimit)} / min</p>
            <div className="md:col-span-2 md:text-right">
              <AvailabilityMark availability={resource.availability} label={availabilityLabel(resource.availability)} />
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="font-serif text-2xl tracking-tight">{value}</p>
      <p className="mt-1 text-[11px] uppercase tracking-[0.14em] text-mute">{label}</p>
    </div>
  );
}
