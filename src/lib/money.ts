/** Integer micro-USD. $1.00 = 1_000_000. All lease math stays in integers. */

export function costForRequests(requestCount: number, pricePerThousandMicro: number): number {
  if (!Number.isInteger(requestCount) || requestCount < 0) {
    throw new Error("requestCount must be a non-negative integer");
  }
  if (!Number.isInteger(pricePerThousandMicro) || pricePerThousandMicro < 0) {
    throw new Error("pricePerThousandMicro must be a non-negative integer");
  }
  const product = BigInt(requestCount) * BigInt(pricePerThousandMicro);
  const cost = product / 1000n;
  if (cost > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("cost exceeds the safe integer range");
  }
  return Number(cost);
}

export function parseUsdToMicro(input: string): number | null {
  const trimmed = input.trim().replace(/^\$/, "").replaceAll(",", "");
  if (!/^\d+(\.\d{1,6})?$/.test(trimmed)) return null;
  const [whole, frac = ""] = trimmed.split(".");
  const micro = Number(whole) * 1_000_000 + Number((frac + "000000").slice(0, 6));
  if (!Number.isSafeInteger(micro)) return null;
  return micro;
}

export function formatUsd(micro: number): string {
  const sign = micro < 0 ? "-" : "";
  const abs = Math.abs(Math.trunc(micro));
  const dollars = Math.floor(abs / 1_000_000);
  const frac = abs % 1_000_000;
  const cents = Math.floor(frac / 10_000);
  if (frac % 10_000 === 0) {
    return `${sign}$${dollars.toLocaleString("en-US")}.${cents.toString().padStart(2, "0")}`;
  }
  const digits = frac.toString().padStart(6, "0").replace(/0+$/, "");
  return `${sign}$${dollars.toLocaleString("en-US")}.${digits.padEnd(2, "0")}`;
}

export function formatPerThousand(micro: number): string {
  return `${formatUsd(micro)} / 1,000`;
}

/** Plain decimal for form fields, without a currency symbol or thousands separators. */
export function formatUsdInput(micro: number): string {
  const abs = Math.abs(Math.trunc(micro));
  const dollars = Math.floor(abs / 1_000_000);
  const frac = (abs % 1_000_000).toString().padStart(6, "0").replace(/0+$/, "");
  return frac.length > 0 ? `${dollars}.${frac.padEnd(2, "0")}` : `${dollars}.00`;
}
