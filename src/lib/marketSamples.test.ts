import { describe, expect, it } from "vitest";
import { verifyAgreement } from "./crypto.ts";
import { approveLease, emptyState, requestLease } from "./engine.ts";
import { costForRequests } from "./money.ts";
import { ensureSampleMarket, isSampleOffer, SAMPLE_RESOURCES, withMarketSamples } from "./marketSamples.ts";
import { NETWORKS, RPC_METHODS, type Agent } from "./types.ts";

describe("sample market", () => {
  it("lists Ethereum, Base, Arbitrum, and Polygon with a provider, price, rate, and availability", () => {
    const state = withMarketSamples(emptyState(1_700_000_000_000));
    for (const network of NETWORKS) {
      const rows = state.resources.filter((resource) => resource.network === network);
      expect(rows.length).toBeGreaterThan(0);
      for (const resource of rows) {
        const provider = state.providers.find((item) => item.id === resource.providerId);
        expect(provider?.name.length).toBeGreaterThan(0);
        expect(resource.pricing.pricePerThousandMicro).toBeGreaterThan(0);
        expect(resource.requestRateLimit).toBeGreaterThan(0);
        expect(["available", "limited", "unavailable"]).toContain(resource.availability);
        expect(isSampleOffer(resource.id)).toBe(true);
      }
    }
    expect(SAMPLE_RESOURCES.map((resource) => resource.network).sort()).toEqual(
      ["arbitrum", "base", "ethereum", "polygon", "polygon"].sort(),
    );
  });

  it("leaves an example ledger unchanged", () => {
    const example = { ...emptyState(1), origin: "example" as const };
    expect(withMarketSamples(example).resources).toEqual([]);
  });

  it("records a pending lease on a sample offer and approves it", async () => {
    const now = 1_700_000_000_000;
    const seeded = await ensureSampleMarket(emptyState(now));
    const again = await ensureSampleMarket(seeded);
    expect(again).toBe(seeded);
    expect(seeded.keystore.sample_prv_northline).toBeTruthy();
    const agent: Agent = {
      id: "agt_test",
      name: "Test Desk",
      mandate: "Read blocks",
      status: "active",
      ownerId: "acct_test",
      createdAt: now,
    };
    const state = { ...seeded, agents: [agent] };
    const requested = requestLease(
      state,
      {
        agentId: agent.id,
        resourceId: "sample_res_northline_eth",
        task: "Read blocks for the length of this lease.",
        startAt: now,
        durationMs: 60 * 60 * 1000,
        maxRequests: 1_000,
        spendingCapMicro: costForRequests(1_000, 200_000),
        maxRequestRate: 100,
        permittedMethods: [...RPC_METHODS],
      },
      now,
    );
    expect(requested.errors).toEqual([]);
    expect(requested.state.leases[0]?.status).toBe("requested");
    const approved = await approveLease(requested.state, requested.leaseId!, "sample_prv_northline", now);
    expect(approved.errors).toEqual([]);
    expect(approved.state.leases[0]?.status).toBe("active");
    expect(await verifyAgreement(approved.state.leases[0]!.agreement!)).toBe(true);
    const withdrawn = requestLease(
      state,
      {
        agentId: agent.id,
        resourceId: "sample_res_sable_pol",
        task: "Read blocks for the length of this lease.",
        startAt: now,
        durationMs: 60 * 60 * 1000,
        maxRequests: 100,
        spendingCapMicro: costForRequests(100, 250_000),
        maxRequestRate: 50,
        permittedMethods: [...RPC_METHODS],
      },
      now,
    );
    expect(withdrawn.errors[0]).toContain("unavailable");
  });
});