/**
 * @id PP-AUTH-LIB-001 (POO-637 R4)
 * @name signedWrite
 * @implements-rules-version v1
 *
 * FE counterpart of the pool-party-api signed-write guard (POO-637). Every authenticated write
 * (starting with the investor profile PATCH, POO-232/POO-233) must prove wallet ownership: the client
 * signs a canonical, domain-separated message binding {action, wallet, sha256(body), nonce, timestamp}
 * and sends the signature envelope as headers; the API reconstructs the SAME message and verifies the
 * signature (recovered address == wallet). The message format here MIRRORS the guard byte-for-byte
 * (`src/auth/signed-write/canonical-message.ts` + `signed-write.constants.ts` in pool-party-api) — any
 * drift makes verification recover the wrong address and 401 the write. The functions are isomorphic
 * (used client-side to sign and server-side to forward), so no `server-only`/`use client` boundary.
 *
 * Replay protection: the nonce is client-generated + single-use (the guard remembers consumed nonces
 * per wallet with a TTL) and the timestamp is validated against a +/- 5 min window server-side, so no
 * nonce round-trip is needed. `signWrite` defaults both.
 *
 * PP-INTEGRATION-POINT (POO-637): the signed-write envelope headers are consumed by the pool-party-api
 * `@SignedWrite()` guard; the wallet signature is produced client-side (Privy embedded / external).
 */
import { sha256, stringToBytes } from "viem";

/**
 * Domain-separation tag: the first line of every signed-write message (mirrors
 * `SIGNED_WRITE_DOMAIN`). A signature over one domain can never be replayed against another; the
 * `v1` suffix lets the format rotate without ambiguity.
 */
export const SIGNED_WRITE_DOMAIN = "Pool Party Signed Write v1";

/**
 * Transport headers carrying the signature envelope (mirrors the guard's `SIGNED_WRITE_HEADERS`). The
 * request body stays the pure payload; its sha256 is bound into the signed message instead.
 */
export const SIGNED_WRITE_HEADERS = {
  WALLET: "x-pp-wallet",
  SIGNATURE: "x-pp-signature",
  NONCE: "x-pp-nonce",
  TIMESTAMP: "x-pp-timestamp",
  NETWORK: "x-pp-network",
} as const;

/**
 * Recursively sort object keys so that logically-equal payloads serialize identically regardless of
 * key insertion order. Arrays keep their order (order is semantically meaningful); primitives pass
 * through. Mirrors the backend `canonicalize`.
 */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === "object") {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = canonicalize((value as Record<string, unknown>)[key]);
        return acc;
      }, {});
  }
  return value;
}

/**
 * Deterministic JSON of a request body. A `null`/`undefined` body canonicalizes to `{}` so an empty
 * write still hashes to a stable value. Mirrors the backend `canonicalJson`.
 */
export function canonicalJson(body: unknown): string {
  return JSON.stringify(canonicalize(body ?? {}));
}

/**
 * Lowercase sha256 hex (no `0x` prefix) of the canonical JSON payload. Byte-identical to the backend
 * `hashPayload` (`createHash('sha256').update(canonicalJson).digest('hex')`).
 */
export function hashPayload(body: unknown): string {
  return sha256(stringToBytes(canonicalJson(body))).slice(2);
}

/** The parts bound into the signed message (mirrors the backend `SignedWriteMessageParts`). */
export interface SignedWriteMessageParts {
  /** Server-declared action (e.g. `profile.update`); never client-chosen at the endpoint. */
  action: string;
  /** Target wallet; lowercased in the message for determinism. */
  wallet: string;
  /** `hashPayload(body)` — binds the exact payload into the signature. */
  payloadHash: string;
  /** Single-use, per-wallet nonce (replay protection). */
  nonce: string;
  /** Unix milliseconds; validated against a +/- 5 min window server-side. */
  timestamp: number;
}

/**
 * Build the human-readable, domain-separated message the wallet signs. Multi-line so a clear-signing
 * wallet shows exactly which action/payload is authorized. Mirrors `buildSignedWriteMessage`.
 */
export function buildSignedWriteMessage(parts: SignedWriteMessageParts): string {
  return [
    SIGNED_WRITE_DOMAIN,
    "",
    `Action: ${parts.action}`,
    `Wallet: ${parts.wallet.toLowerCase()}`,
    `Payload SHA-256: ${parts.payloadHash}`,
    `Nonce: ${parts.nonce}`,
    `Timestamp: ${parts.timestamp}`,
  ].join("\n");
}

/** A fresh single-use nonce. `crypto.randomUUID` is available in modern browsers and Node 18+. */
function randomNonce(): string {
  return globalThis.crypto.randomUUID();
}

/** Input to {@link signWrite}. */
export interface SignWriteParams {
  /** The endpoint's declared action (must match the `@SignedWrite('...')` on the API route). */
  action: string;
  /** The connected wallet address (the API recovers this from the signature and requires a match). */
  wallet: string;
  /** The API network slug (lowercased); must be one of pool-party-api's SUPPORTED_NETWORKS. */
  network: string;
  /** The exact write payload; its canonical sha256 is bound into the signature. */
  body: unknown;
  /** Override the generated nonce (tests / deterministic callers). */
  nonce?: string;
  /** Override the generated timestamp in unix ms (tests / deterministic callers). */
  timestamp?: number;
  /** Signs the canonical message with the connected wallet (e.g. provider `personal_sign`). */
  signMessage: (message: string) => Promise<string>;
}

/** The signed envelope: the pass-through body plus the headers the guard verifies. */
export interface SignedWriteEnvelope {
  /** The unchanged body — its bytes still hash to the signed payloadHash. */
  body: unknown;
  /** The five signed-write transport headers. */
  headers: Record<string, string>;
}

/**
 * Sign a write: hash the body, build the canonical message, sign it with the wallet, and assemble the
 * signature-envelope headers. The body is returned untouched so the caller sends the exact bytes that
 * were hashed. Throws if `signMessage` rejects (e.g. the user declines) — callers surface an error.
 */
export async function signWrite(params: SignWriteParams): Promise<SignedWriteEnvelope> {
  const nonce = params.nonce ?? randomNonce();
  const timestamp = params.timestamp ?? Date.now();
  const payloadHash = hashPayload(params.body);
  const message = buildSignedWriteMessage({
    action: params.action,
    wallet: params.wallet,
    payloadHash,
    nonce,
    timestamp,
  });
  const signature = await params.signMessage(message);
  return {
    body: params.body,
    headers: {
      [SIGNED_WRITE_HEADERS.WALLET]: params.wallet,
      [SIGNED_WRITE_HEADERS.SIGNATURE]: signature,
      [SIGNED_WRITE_HEADERS.NONCE]: nonce,
      [SIGNED_WRITE_HEADERS.TIMESTAMP]: String(timestamp),
      [SIGNED_WRITE_HEADERS.NETWORK]: params.network.toLowerCase(),
    },
  };
}
