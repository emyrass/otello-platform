import { agreementCanonical } from "./canonical.ts";
import { sha256Hex } from "./hash.ts";
import { b64ToBytes, bytesToB64 } from "./ids.ts";
import type { AgreementPayload, SignedAgreement } from "./types.ts";

const ECDSA = { name: "ECDSA", namedCurve: "P-256" } as const;

export async function generateSigningKey(): Promise<{ publicJwk: JsonWebKey; privateJwk: JsonWebKey }> {
  const pair = await crypto.subtle.generateKey(ECDSA, true, ["sign", "verify"]);
  const publicJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const privateJwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  return { publicJwk, privateJwk };
}

export async function signCanonical(privateJwk: JsonWebKey, canonical: string): Promise<string> {
  const key = await crypto.subtle.importKey("jwk", privateJwk, ECDSA, false, ["sign"]);
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new TextEncoder().encode(canonical),
  );
  return bytesToB64(signature);
}

export async function verifySignature(
  publicJwk: JsonWebKey,
  canonical: string,
  signatureB64: string,
): Promise<boolean> {
  const key = await crypto.subtle.importKey("jwk", publicJwk, ECDSA, false, ["verify"]);
  return crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    b64ToBytes(signatureB64) as BufferSource,
    new TextEncoder().encode(canonical),
  );
}

export function samePublicKey(left: JsonWebKey, right: JsonWebKey): boolean {
  return left.kty === right.kty && left.crv === right.crv && left.x === right.x && left.y === right.y;
}

export function keyThumbprint(jwk: JsonWebKey): string {
  return sha256Hex(`${jwk.crv ?? ""}:${jwk.x ?? ""}:${jwk.y ?? ""}`).slice(0, 16);
}

export async function signAgreement(input: {
  privateJwk: JsonWebKey;
  publicJwk: JsonWebKey;
  signerId: string;
  payload: AgreementPayload;
  signedAt: number;
}): Promise<SignedAgreement> {
  const canonical = agreementCanonical(input.payload);
  const signatureB64 = await signCanonical(input.privateJwk, canonical);
  return {
    payload: input.payload,
    canonical,
    hashHex: sha256Hex(canonical),
    signatureB64,
    signerId: input.signerId,
    publicKeyJwk: input.publicJwk,
    signedAt: input.signedAt,
  };
}

/** Returns true only after a successful ECDSA verification of the recomputed canonical payload. */
export async function verifyAgreement(agreement: SignedAgreement | undefined): Promise<boolean> {
  if (!agreement) return false;
  try {
    const canonical = agreementCanonical(agreement.payload);
    if (canonical !== agreement.canonical) return false;
    if (sha256Hex(canonical) !== agreement.hashHex) return false;
    return await verifySignature(agreement.publicKeyJwk, canonical, agreement.signatureB64);
  } catch {
    return false;
  }
}
