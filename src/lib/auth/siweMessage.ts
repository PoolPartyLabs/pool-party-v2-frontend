/**
 * @id PP-AUTH (POO-270, POO-376)
 * @name SIWE message
 * @implements-rules-version v1
 *
 * Builds the sign-in message the connected wallet signs to prove ownership. POO-376 replaces the
 * pre-4361 branded string with a real EIP-4361 (ERC-4361) message that binds the signature to the
 * app's `domain`/`uri`/`chainId` plus a short-lived, server-issued nonce, so a signature phished on
 * a look-alike origin cannot be replayed against the real app.
 *
 * Because the backend reconstructs/verifies the message, this is a coordinated cross-repo change:
 * the EIP-4361 path is gated by {@link isSiweEip4361Enabled} (default OFF) and only sends its full
 * message once the pool-party-api companion verifies EIP-4361 verbatim (domain binding, chainId,
 * expiry, single-use nonce, EIP-1271). While the gate is OFF, {@link buildLegacySiweMessage}
 * reproduces the exact string the current backend rebuilds, so login keeps working unchanged.
 *
 * PP-SECURITY (POO-376): message construction is a Frontend control; server-side verification is a
 * Backend control (docs/10_SECURITY.md). See the `frontend-security` skill, "SIWE" section.
 */
import { getAddress } from "viem";
import { createSiweMessage } from "viem/siwe";

/**
 * Expiration TTL applied to the signed message: 10 minutes. Within EIP-4361's 5-15 min guidance and
 * aligned with the backend nonce TTL (`NONCE_TTL = 10 min`), so the message and its nonce lapse
 * together. [R4]
 */
export const SIWE_EXPIRATION_TTL_MS = 10 * 60 * 1000;

/**
 * Gate for the EIP-4361 message format. OFF by default so this frontend change is safe to deploy
 * before the pool-party-api companion that verifies EIP-4361 verbatim; flip to `"true"` per
 * environment in lockstep with that backend deploy. Mirrors the `isMockMode` env-const pattern
 * (a build-time mode toggle, not a product feature flag, so it does not belong in the feature
 * registry). [R8]
 *
 * PP-SECURITY (POO-376): keep OFF until the backend verifies EIP-4361; ON without it breaks login.
 */
export const isSiweEip4361Enabled = process.env.NEXT_PUBLIC_SIWE_EIP4361 === "true";

/** Inputs for a Pool Party EIP-4361 sign-in message. */
export interface SiweMessageInput {
  /** RFC 3986 authority requesting the signing (host[:port]); the real origin, never a literal. */
  domain: string;
  /** RFC 3986 URI of the requesting resource (the app origin). */
  uri: string;
  /** The signing wallet address (any casing; checksummed on the way in). */
  address: string;
  /** EIP-155 chain id the session binds to. */
  chainId: number;
  /** The server-issued, single-use nonce (alphanumeric, >= 8 chars). */
  nonce: string;
  /** Human-readable, localized assertion shown in the wallet before signing (single line). */
  statement: string;
  /** When the message was issued. Defaults to now. */
  issuedAt?: Date;
  /** Validity window from `issuedAt`. Defaults to {@link SIWE_EXPIRATION_TTL_MS}. */
  expirationTtlMs?: number;
}

/**
 * Build a real EIP-4361 (ERC-4361) Sign-In with Ethereum message. Includes `domain`, `address`
 * (EIP-55 checksummed), `statement`, `uri`, `version` "1", `chainId`, `nonce`, `issuedAt`, and a
 * short `expirationTime`. [R1][R2][R4][R5][R6][R7]
 */
export function buildSiweMessage(input: SiweMessageInput): string {
  const issuedAt = input.issuedAt ?? new Date();
  const ttlMs = input.expirationTtlMs ?? SIWE_EXPIRATION_TTL_MS;
  return createSiweMessage({
    domain: input.domain,
    address: getAddress(input.address),
    statement: input.statement,
    uri: input.uri,
    version: "1",
    chainId: input.chainId,
    nonce: input.nonce,
    issuedAt,
    expirationTime: new Date(issuedAt.getTime() + ttlMs),
  });
}

/**
 * The LEGACY branded Pool Party sign-in message (pre-EIP-4361). Retained byte-for-byte because the
 * current backend (`pool-party-api` auth.controller `signIn`) reconstructs this exact string and
 * verifies against it. Used only while {@link isSiweEip4361Enabled} is OFF; remove once the
 * EIP-4361 backend companion is live and the gate is permanently ON.
 *
 * PP-INTEGRATION-POINT: legacy message <- pool-party-api /auth sign-in (POO-270).
 */
export function buildLegacySiweMessage(wallet: string, nonce: string): string {
  return `Welcome to Pool Party!\n\nSign this message to prove you have access to this wallet and we'll log you in. This won't cost you any gas fees.\n\nWallet address: ${wallet}\n\nNonce: ${nonce}`;
}
