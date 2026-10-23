import { Link } from "react-router-dom";
import { useLedger } from "../context/Store.tsx";
import { auditLabel, formatDetailValue, formatTimestamp, humanizeKey, networkLabel } from "../lib/format.ts";
import { nameOf } from "../lib/selectors.ts";
import type { AuditEvent } from "../lib/types.ts";

export function ActivityList({ events, empty }: { events: AuditEvent[]; empty: string }) {
  const { state } = useLedger();
  if (events.length === 0) return <p className="border-t border-ink/10 py-8 text-sm text-char">{empty}</p>;
  return (
    <ol>
      {events.map((event) => {
        const reason = typeof event.details.reason === "string" ? event.details.reason : null;
        return (
          <li key={event.id} className="grid gap-3 border-t border-ink/10 py-4 md:grid-cols-[11rem_minmax(0,1fr)]">
            <time className="text-[12px] text-mute" dateTime={new Date(event.timestamp).toISOString()}>
              {formatTimestamp(event.timestamp)}
            </time>
            <div>
              <p className="text-sm">{auditLabel(event.type)}</p>
              <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-char">
                {event.leaseId ? (
                  <Link to={`/leases/${event.leaseId}`} className="font-mono hover:underline">
                    {event.leaseId}
                  </Link>
                ) : null}
                {event.agentId ? <Link to={`/agents#${event.agentId}`}>{nameOf(state.agents, event.agentId)}</Link> : null}
                {event.providerId ? <Link to={`/providers/${event.providerId}`}>{nameOf(state.providers, event.providerId)}</Link> : null}
                {event.network ? <span>{networkLabel(event.network)}</span> : null}
                <span className="font-mono text-mute">{event.type}</span>
              </p>
              {reason ? <p className="mt-2 text-sm text-ink">{reason}</p> : null}
              <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[12px] text-mute">
                {Object.entries(event.details)
                  .filter(([key]) => key !== "reason")
                  .map(([key, value]) => (
                    <div key={key}>
                      <dt className="inline">{humanizeKey(key)} </dt>
                      <dd className="inline break-all text-char">{formatDetailValue(key, value)}</dd>
                    </div>
                  ))}
              </dl>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
