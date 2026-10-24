import { Link, useParams } from "react-router-dom";
import { AvailabilityMark, useTitle } from "../components/ui.tsx";
import { useLedger } from "../context/Store.tsx";
import { availabilityLabel, formatDuration, formatNumber, formatPerThousand, formatUsd, networkLabel } from "../lib/format.ts";
import { isSampleOffer, withMarketSamples } from "../lib/marketSamples.ts";
import { costForRequests } from "../lib/money.ts";
import { measuredLatencyMs, nameOf } from "../lib/selectors.ts";

export function ResourceDetailPage() {
  const { id } = useParams();
  const { state: ledger, scope } = useLedger();
  const state = scope === "examples" ? ledger : withMarketSamples(ledger);
  const resource = state.resources.find((item) => item.id === id);
  const sample = isSampleOffer(resource?.id);
  useTitle(resource?.name ?? "Resource");
  if (!resource) return <p className="text-sm">That resource is not on the market.</p>;
  const provider = state.providers.find((item) => item.id === resource.providerId);
  const illustration = costForRequests(2_500, resource.pricing.pricePerThousandMicro);
  const closed = resource.availability === "unavailable" || provider?.status !== "active";
  const latency = measuredLatencyMs(state, resource.id);
  const measured = state.usageEvents.filter(
    (event) => event.resourceId === resource.id && event.outcome === "accepted" && event.execution === "provider" && typeof event.latencyMs === "number",
  ).length;

  return (
    <article>
      <Link to="/resources" className="text-[12px] uppercase tracking-[0.16em] text-mute">
        Market
      </Link>
      <div className="mt-4 flex flex-wrap items-center gap-4">
        <span className="text-[10px] uppercase tracking-[0.16em] text-mute">
          {sample ? "Sample · " : ""}
          {resource.endpointConfigured ? "Endpoint connected" : "No endpoint"}
        </span>
        <AvailabilityMark availability={resource.availability} label={availabilityLabel(resource.availability)} />
      </div>
      <h1 className="mt-3 max-w-4xl font-serif text-[clamp(3rem,6vw,5.4rem)] leading-[0.92] tracking-[-0.04em]">{resource.name}</h1>
      <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-char">{resource.summary}</p>
      <p className="mt-3 text-sm">
        <Link to={`/providers/${resource.providerId}`} className="underline underline-offset-4">
          {nameOf(state.providers, resource.providerId)}
        </Link>
        {provider?.status === "disabled" ? " · provider disabled" : ""} · {networkLabel(resource.network)} · {resource.region}
      </p>

      <div className="mt-10 grid gap-10 border-y border-ink/10 py-8 md:grid-cols-[0.8fr_1.2fr]">
        <div>
          <p className="font-serif text-6xl tracking-tight">{formatPerThousand(resource.pricing.pricePerThousandMicro)}</p>
          <p className="mt-2 text-[11px] uppercase tracking-[0.16em] text-mute">Per accepted thousand</p>
          <p className="mt-6 max-w-sm text-sm leading-relaxed text-char">
            At this price, 2,500 accepted requests would cost {formatUsd(illustration)}. That is a price illustration, not usage recorded for this offer.
          </p>
          {sample ? (
            <p className="mt-6 max-w-sm text-sm leading-relaxed text-char">
              Sample offer. The provider, price, rate limit, and availability above are listed for the market. It is not registered to an account, so it cannot be leased.
            </p>
          ) : closed ? (
            <p className="mt-6 text-sm">This offer cannot be requested while it is withdrawn or the provider is disabled.</p>
          ) : (
            <Link to={`/leases/new?resource=${resource.id}`} className="mt-6 inline-flex rounded-full bg-ink px-4 py-2 text-[13px] tracking-wide text-ivory">
              Request lease
            </Link>
          )}
          {sample || resource.endpointConfigured ? null : (
            <p className="mt-6 max-w-sm text-sm leading-relaxed text-char">
              No endpoint is saved. An accepted batch is simulated on this server, labeled as simulated, and metered from the signed price. It is not sent to a provider.
            </p>
          )}
        </div>
        <dl className="grid content-start gap-y-3 text-sm sm:grid-cols-[10rem_1fr]">
          <Spec k="Kind" v="RPC endpoint" />
          <Spec k="Network" v={networkLabel(resource.network)} />
          <Spec k="Rate ceiling" v={`${formatNumber(resource.requestRateLimit)} requests / minute`} />
          <Spec k="Max duration" v={formatDuration(resource.maxLeaseDurationMs)} />
          <Spec k="Offered ceiling" v={`${formatNumber(resource.capacityRequests)} requests`} />
          <Spec k="Endpoint" v={resource.endpointConfigured ? "Connected" : "Not configured"} />
          <Spec k="Measured latency" v={latency === null ? "Unavailable" : `${formatNumber(latency)} ms median`} />
          <Spec k="Uptime" v="Unavailable" />
          <Spec k="Methods" v={resource.supportedMethods.join(", ")} />
        </dl>
      </div>

      <section className="mt-12 grid gap-12 lg:grid-cols-2">
        <div>
          <h2 className="font-serif text-3xl">Provider conditions</h2>
          <ul className="mt-4 space-y-3 text-sm leading-relaxed text-char">
            <li>Leases stay inside the duration, rate, method list, and offered ceiling printed here.</li>
            <li>The provider must approve a request before any credential is issued.</li>
            <li>Price changes after publication do not rewrite agreements already signed.</li>
            <li>{provider?.desk}</li>
          </ul>
        </div>
        <div>
          <h2 className="font-serif text-3xl">Measured latency</h2>
          <p className="mt-3 text-sm leading-relaxed text-char">
            {latency === null
              ? "Unavailable. Latency is recorded only after a connected endpoint answers a request."
              : `Median of ${formatNumber(measured)} forwarded ${measured === 1 ? "batch" : "batches"}: ${formatNumber(latency)} ms.`}
          </p>
        </div>
      </section>
    </article>
  );
}

function Spec({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt className="text-mute">{k}</dt>
      <dd>{v}</dd>
    </>
  );
}
