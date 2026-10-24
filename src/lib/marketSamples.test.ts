import { describe, expect, it } from "vitest";
import { emptyState } from "./engine.ts";
import { isSampleOffer, SAMPLE_RESOURCES, withMarketSamples } from "./marketSamples.ts";
import { NETWORKS } from "./types.ts";

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
});