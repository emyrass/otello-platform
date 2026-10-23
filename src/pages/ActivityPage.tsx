import { useMemo, useState, type ReactNode } from "react";
import { ActivityList } from "../components/ActivityList.tsx";
import { PageHeader, Pill, SelectInput, TextInput, useTitle } from "../components/ui.tsx";
import { useLedger } from "../context/Store.tsx";
import { verifyAuditChain } from "../lib/audit.ts";
import { auditLabel, networkLabel } from "../lib/format.ts";
import { filterAudit } from "../lib/selectors.ts";
import { AUDIT_TYPES, NETWORKS, type AuditType, type Network } from "../lib/types.ts";

const RANGES = [
  { id: "all", label: "All time" },
  { id: "1h", label: "1 hour" },
  { id: "6h", label: "6 hours" },
  { id: "24h", label: "24 hours" },
  { id: "7d", label: "7 days" },
] as const;

export function ActivityPage() {
  const { state, now } = useLedger();
  useTitle("Activity");
  const [agentId, setAgentId] = useState("all");
  const [providerId, setProviderId] = useState("all");
  const [leaseId, setLeaseId] = useState("all");
  const [network, setNetwork] = useState<Network | "all">("all");
  const [type, setType] = useState<AuditType | "all">("all");
  const [range, setRange] = useState<(typeof RANGES)[number]["id"]>("all");
  const [fromText, setFromText] = useState("");
  const [toText, setToText] = useState("");
  const intact = useMemo(() => verifyAuditChain(state.audit), [state.audit]);

  const fromCustom = parseUtc(fromText);
  const toCustom = parseUtc(toText);
  const presetFrom = range === "all" ? undefined : now - rangeMs(range);
  const events = filterAudit(state.audit, {
    agentId: agentId === "all" ? undefined : agentId,
    providerId: providerId === "all" ? undefined : providerId,
    leaseId: leaseId === "all" ? undefined : leaseId,
    network,
    type,
    from: fromCustom ?? presetFrom,
    to: toCustom ?? undefined,
  })
    .slice()
    .reverse();

  return (
    <div>
      <PageHeader
        kicker="Protocol activity"
        title="The ledger."
        lede="Append-only. Each line carries a timestamp, the ids involved, and the reason when a call was refused. The hash chain links every record to the one before it."
      />
      <p className="mt-8 text-sm">
        {intact ? "Hash chain intact." : "Hash chain broken."} {events.length.toLocaleString("en-US")} matching{" "}
        {state.audit.length.toLocaleString("en-US")} recorded. Times are UTC.
      </p>
      <div className="mt-6 grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-3">
        <Select label="Agent" value={agentId} onChange={setAgentId}>
          <option value="all">All agents</option>
          {state.agents.map((agent) => (
            <option key={agent.id} value={agent.id}>
              {agent.name}
            </option>
          ))}
        </Select>
        <Select label="Provider" value={providerId} onChange={setProviderId}>
          <option value="all">All providers</option>
          {state.providers.map((provider) => (
            <option key={provider.id} value={provider.id}>
              {provider.name}
            </option>
          ))}
        </Select>
        <Select label="Lease" value={leaseId} onChange={setLeaseId}>
          <option value="all">All leases</option>
          {state.leases.map((lease) => (
            <option key={lease.id} value={lease.id}>
              {lease.id}
            </option>
          ))}
        </Select>
        <Select label="Network" value={network} onChange={(value) => setNetwork(value as Network | "all")}>
          <option value="all">All networks</option>
          {NETWORKS.map((item) => (
            <option key={item} value={item}>
              {networkLabel(item)}
            </option>
          ))}
        </Select>
        <Select label="Event" value={type} onChange={(value) => setType(value as AuditType | "all")}>
          <option value="all">All events</option>
          {AUDIT_TYPES.map((item) => (
            <option key={item} value={item}>
              {auditLabel(item)}
            </option>
          ))}
        </Select>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-[11px] uppercase tracking-[0.14em] text-mute">
            From UTC
            <TextInput value={fromText} placeholder="2026-10-22 18:00" onChange={(event) => setFromText(event.target.value)} />
          </label>
          <label className="block text-[11px] uppercase tracking-[0.14em] text-mute">
            To UTC
            <TextInput value={toText} placeholder="2026-10-22 19:00" onChange={(event) => setToText(event.target.value)} />
          </label>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {RANGES.map((item) => (
          <Pill key={item.id} active={range === item.id && !fromText && !toText} onClick={() => setRange(item.id)}>
            {item.label}
          </Pill>
        ))}
      </div>
      <div className="mt-8">
        <ActivityList events={events} empty={state.audit.length === 0 ? "No activity has been recorded." : "Nothing in the ledger matches those filters."} />
      </div>
    </div>
  );
}

function Select({ label, value, onChange, children }: { label: string; value: string; onChange: (value: string) => void; children: ReactNode }) {
  return (
    <label className="block text-[11px] uppercase tracking-[0.14em] text-mute">
      {label}
      <SelectInput value={value} onChange={(event) => onChange(event.target.value)} aria-label={label}>
        {children}
      </SelectInput>
    </label>
  );
}

function rangeMs(range: Exclude<(typeof RANGES)[number]["id"], "all">): number {
  const hour = 60 * 60 * 1000;
  if (range === "1h") return hour;
  if (range === "6h") return 6 * hour;
  if (range === "24h") return 24 * hour;
  return 7 * 24 * hour;
}

function parseUtc(value: string): number | undefined {
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/);
  if (!match) return undefined;
  const timestamp = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]));
  return Number.isNaN(timestamp) ? undefined : timestamp;
}
