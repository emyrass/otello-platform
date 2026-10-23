import { useState } from "react";
import { Button, ErrorList, Field, PageHeader, TextArea, TextInput, useTitle } from "../components/ui.tsx";
import { useLedger } from "../context/Store.tsx";
import { formatNumber } from "../lib/format.ts";

export function AgentsPage() {
  const { state, account, scope, registerAgent, setAgentStatus } = useLedger();
  useTitle("Agents");
  const [name, setName] = useState("");
  const [mandate, setMandate] = useState("");
  const [errors, setErrors] = useState<string[]>([]);

  return (
    <div>
      <PageHeader
        kicker="Agents"
        title="Desks."
        lede="Agents request capacity and present a credential when they call. A disabled desk is refused at the policy check, even if a lease is still on the books."
      />
      <div className="mt-12 grid gap-14 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div>
          {state.agents.length === 0 ? <p className="border-t border-ink/10 py-8 text-sm text-char">No agents yet.</p> : null}
          {state.agents.map((agent) => {
            const leases = state.leases.filter((lease) => lease.agentId === agent.id);
            const active = leases.filter((lease) => lease.status === "active").length;
            return (
              <article key={agent.id} id={agent.id} className="grid gap-3 border-t border-ink/10 py-6 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                <div>
                  <div className="flex flex-wrap items-baseline gap-3">
                    <h2 className="text-2xl tracking-tight">{agent.name}</h2>
                    <span className="text-[11px] uppercase tracking-[0.16em] text-mute">{agent.status}</span>
                  </div>
                  <p className="mt-2 max-w-xl text-sm text-char">{agent.mandate}</p>
                  <p className="mt-2 text-xs text-mute">
                    {formatNumber(active)} active · {formatNumber(leases.length)} leases · {agent.id}
                  </p>
                </div>
                {scope === "examples" || agent.ownerId === account.id ? (
                  <Button
                    variant="line"
                    onClick={() => void setAgentStatus(agent.id, agent.status === "active" ? "disabled" : "active")}
                  >
                    {agent.status === "active" ? "Disable" : "Enable"}
                  </Button>
                ) : (
                  <span className="text-xs text-mute">Another account</span>
                )}
              </article>
            );
          })}
        </div>
        <form
          className="h-fit border-t border-ink/10 pt-6 lg:border-t-0 lg:pt-0"
          onSubmit={(event) => {
            event.preventDefault();
            void registerAgent(name, mandate).then((result) => {
              if (result.errors.length > 0) {
                setErrors(result.errors);
                return;
              }
              setName("");
              setMandate("");
              setErrors([]);
            });
          }}
        >
          <h2 className="font-serif text-3xl">Register a desk</h2>
          <div className="mt-6 grid gap-5">
            <Field label="Name">
              <TextInput value={name} onChange={(event) => setName(event.target.value)} />
            </Field>
            <Field label="Mandate">
              <TextArea value={mandate} onChange={(event) => setMandate(event.target.value)} />
            </Field>
            <ErrorList errors={errors} />
            <Button type="submit">Register agent</Button>
          </div>
        </form>
      </div>
    </div>
  );
}
