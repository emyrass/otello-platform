import { sha256Hex } from "./hash.ts";
import type { AgreementPayload, RpcMethod } from "./types.ts";

export function stableStringify(value: unknown): string {
  if (value === null) return "null";
  const kind = typeof value;
  if (kind === "string" || kind === "boolean") return JSON.stringify(value);
  if (kind === "number") {
    if (!Number.isFinite(value as number) || !Number.isInteger(value as number)) {
      throw new Error("Canonical JSON only accepts integers");
    }
    return JSON.stringify(value);
  }
  if (kind !== "object") throw new Error("Unsupported canonical value");
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys
    .map((key) => {
      if (record[key] === undefined) throw new Error(`Cannot canonicalize undefined at ${key}`);
      return `${JSON.stringify(key)}:${stableStringify(record[key])}`;
    })
    .join(",")}}`;
}

export function sortMethods(methods: readonly RpcMethod[]): RpcMethod[] {
  return [...methods].sort((a, b) => a.localeCompare(b));
}

export function sameMethods(left: readonly RpcMethod[], right: readonly RpcMethod[]): boolean {
  const a = sortMethods(left);
  const b = sortMethods(right);
  return a.length === b.length && a.every((method, index) => method === b[index]);
}

export function agreementCanonical(payload: AgreementPayload): string {
  return stableStringify({
    ...payload,
    permittedMethods: sortMethods(payload.permittedMethods),
  });
}

export function agreementHash(payload: AgreementPayload): string {
  return sha256Hex(agreementCanonical(payload));
}
