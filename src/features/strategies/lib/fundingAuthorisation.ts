/**
 * @id PP-CORE-SEC-001 (POO-1050)
 * @name funding authorisation guard
 * @implements-rules-version v1
 * @hackathon POO-1022 (Universal Funding)
 *
 * Reads the two things a funding plan asks a user's wallet to authorise, before the wallet is
 * prompted: the ERC-20 approval that `/check_approval` returns as calldata, and the Permit2 EIP-712
 * struct that `/quote` returns as `permitData`.
 *
 * ## Why this exists
 *
 * The rail used to request an approval sized to the leg and then broadcast whatever came back. **The
 * request is not the authorisation, the calldata is.** Nothing in the path could tell
 * `approve(Permit2, 1e18)` from `approve(anyone, MAX_UINT256)`, or from a call to a contract that was
 * not the token at all: both are non-empty hex, which was the only thing checked. Uniswap's own
 * documentation describes the standard flow as "user approves Permit2 contract once (infinite
 * approval)", so the unbounded case is the EXPECTED response here, not a hypothetical one.
 *
 * ## What it does about it, and what it deliberately does not
 *
 * **The ERC-20 approval is capped to the plan** (POO-1050 [R3]). That is the one authorisation in the
 * chain we fully control, and capping it is what makes the rest safe: Permit2 can only ever move what
 * the token's allowance TO Permit2 permits, so an exact-sized ERC-20 approval bounds the whole
 * authorisation chain no matter what the permit above it says. The cost is one approval per leg
 * instead of one per token forever, which is the trade the security baseline asks for
 * (`frontend-security`: "never default to unlimited").
 *
 * **The spender is NOT pinned.** `/check_approval` returns the correct approval target for the
 * routing type (Permit2 for the permit flow, the Universal Router for the legacy flow, and a bridge
 * route's own spender is a separate allowance again), so a hard pin would refuse legitimate routes we
 * have not measured. What replaces the pin is the cap: an unexpected spender can move at most this
 * leg's amount of this leg's token, once. The decoded spender is returned so a surface can name it.
 *
 * **The Permit2 struct is verified, not rewritten.** Its verifying contract, its chain and its token
 * are checked against the leg, and an effectively infinite expiration is refused. Its AMOUNT is
 * reported rather than capped: rewriting a third-party EIP-712 struct that the same third party then
 * rebuilds server-side to validate the signature is an untested gamble, and the ERC-20 cap above
 * already bounds what an unbounded permit can reach. See the PR for the follow-up that surfaces the
 * reported figure in the plan card.
 *
 * Pure: no I/O, no viem, no React. Every amount is `bigint`, never a float.
 */
"use client";

import { permit2Address } from "@uniswap/permit2-sdk";
import { TransactionError } from "@/lib/tx/sendTransaction";
import type { UniswapTransactionRequest } from "@/lib/uniswap/schemas";

/** `approve(address,uint256)`. The only function this rail is ever willing to broadcast blind. */
export const ERC20_APPROVE_SELECTOR = "0x095ea7b3";

/**
 * How far ahead a Permit2 expiration or signature deadline may sit: 90 days.
 *
 * Uniswap's own default is 30 days, so this refuses only the pathological end of the range. The value
 * that matters is `MAX_UINT48` (year 8925921), the sentinel a standing, never-expiring drain
 * authorisation carries. Bounding it is the "prefer short Permit2 expirations over standing
 * allowances" rule from the security baseline, sized so a sane router is never refused.
 */
export const MAX_PERMIT_WINDOW_SECONDS = 90 * 24 * 60 * 60;

/** Typed codes, so the panel classifies these instead of rendering generic failure copy. */
const APPROVAL_CODE = "PROVISIONING_APPROVAL_UNSAFE";
const PERMIT_CODE = "PROVISIONING_PERMIT_UNSAFE";

/** What an `approve` call actually says, once read rather than assumed. */
export interface DecodedApproval {
  /** Lowercased. Who may spend. */
  spender: string;
  /** How much, in base units. */
  amount: bigint;
}

/** The leg an authorisation is being checked against: one token, one chain, one amount. */
export interface LegAuthorisation {
  chainId: number;
  /** The token being spent, `leg.tokenIn.address`. */
  token: string;
  /** Base units this leg really spends, decimal string, as resolved at execution time. */
  amount: string;
}

/** What a Permit2 struct authorises, per permitted token. */
export interface PermitAuthorisation {
  /** Lowercased token address. */
  token: string;
  /** Base units, decimal string. May be Permit2's unbounded sentinel: that is reported, not hidden. */
  amount: string;
  /** Lowercased spender. */
  spender: string;
  expiration?: string;
  sigDeadline?: string;
}

const ZERO_WORD = "0".repeat(24);

/** 32-byte left-padded hex word, no `0x`. */
function word(value: string): string {
  return value.replace(/^0x/, "").toLowerCase().padStart(64, "0");
}

const sameAddress = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

/** `approve(spender, amount)` calldata. */
export function encodeErc20Approval(spender: string, amount: bigint): string {
  return `${ERC20_APPROVE_SELECTOR}${word(spender)}${word(amount.toString(16))}`;
}

/**
 * Read `approve(spender, amount)` calldata, or `null` when it is not exactly that.
 *
 * Strict about length on purpose: a truncated `approve` decodes to a completely different amount than
 * it reads like (the EVM zero-pads missing argument bytes), so a short body is refused rather than
 * interpreted. The address word's upper 12 bytes must be zero for the same reason.
 */
export function decodeErc20Approval(data: string): DecodedApproval | null {
  if (typeof data !== "string") return null;
  const body = data.toLowerCase();
  if (!body.startsWith(ERC20_APPROVE_SELECTOR)) return null;

  const args = body.slice(ERC20_APPROVE_SELECTOR.length);
  if (args.length !== 128 || !/^[0-9a-f]+$/.test(args)) return null;
  const spenderWord = args.slice(0, 64);
  if (spenderWord.slice(0, 24) !== ZERO_WORD) return null;

  return { spender: `0x${spenderWord.slice(24)}`, amount: BigInt(`0x${args.slice(64)}`) };
}

/** The canonical Permit2 deployment for a chain, the one trust anchor in the signing surface. */
export function permit2For(chainId: number): string {
  return permit2Address(chainId).toLowerCase();
}

/**
 * Check an approval against the plan and, if it is unbounded, cap it ([R3]).
 *
 * The shape checks first, because they are the ones that catch calldata which is not an approval at
 * all: a `to` that is not the token means the endpoint handed us an arbitrary contract call, and a
 * non-zero `value` means it also moves native funds. Both are refused rather than capped, because
 * there is no safe version of them.
 *
 * An approval SMALLER than the plan is left alone: it is not a risk, and rewriting it upwards would
 * grant more than the provider asked for. The leg simply reverts, loudly, which is the right outcome.
 */
export function boundApprovalToPlan(
  request: UniswapTransactionRequest,
  leg: LegAuthorisation,
): { request: UniswapTransactionRequest; decoded: DecodedApproval; capped: boolean } {
  const decoded = assertApprovalShape(request, leg);
  const planned = BigInt(leg.amount);
  if (decoded.amount <= planned) return { request, decoded, capped: false };

  // Keep the provider's spender, replace only the amount. See the header for why the spender is
  // trusted here and the amount is not.
  const capped = encodeErc20Approval(decoded.spender, planned);
  return {
    request: { ...request, data: capped },
    decoded: { spender: decoded.spender, amount: planned },
    capped: true,
  };
}

/**
 * Check the USDT-class zeroing transaction. It must approve EXACTLY zero: a "cancel" that grants an
 * allowance is the inverse of what the field claims to be, and it would be broadcast before the user
 * ever sees the approval it is supposed to precede.
 */
export function assertZeroingApproval(
  request: UniswapTransactionRequest,
  leg: LegAuthorisation,
): DecodedApproval {
  const decoded = assertApprovalShape(request, leg);
  if (decoded.amount !== BigInt(0)) {
    throw approvalError("The allowance reset does not set the allowance to zero");
  }
  return decoded;
}

/** The checks both approval paths share: right contract, right function, no native value. */
function assertApprovalShape(
  request: UniswapTransactionRequest,
  leg: LegAuthorisation,
): DecodedApproval {
  if (!sameAddress(request.to, leg.token)) {
    throw approvalError(
      `The approval targets ${request.to}, which is not the token this step spends`,
    );
  }
  if (BigInt(request.value === "" ? "0" : (request.value ?? "0")) !== BigInt(0)) {
    throw approvalError("The approval also moves native value, which an ERC-20 approve never does");
  }
  const decoded = decodeErc20Approval(request.data);
  if (!decoded) throw approvalError("The approval calldata is not an ERC-20 approve");
  return decoded;
}

/**
 * Verify that a Permit2 struct authorises this leg and nothing wider ([R4]).
 *
 * Returns what it authorises, per permitted token, so a surface can render it in clear text instead
 * of asking the user to sign an opaque blob. Handles `PermitSingle` and `PermitBatch`, since a batch
 * with one good entry and one foreign one is exactly the shape a check on `details[0]` would miss.
 */
export function assertPermitAuthorisesLeg(
  permitData: { domain: Record<string, unknown>; types: Record<string, unknown>; values: unknown },
  leg: LegAuthorisation,
  now: number = Date.now(),
): PermitAuthorisation[] {
  const verifying = permitData.domain.verifyingContract;
  if (typeof verifying !== "string" || !sameAddress(verifying, permit2For(leg.chainId))) {
    throw permitError(
      `The permit is verified by ${String(verifying)}, which is not Permit2 on chain ${leg.chainId}`,
    );
  }
  const domainChainId = toNumber(permitData.domain.chainId);
  if (domainChainId !== leg.chainId) {
    // A permit scoped to another chain is either a mistake or a replay, and a wallet will sign it
    // happily: the domain separator is the only thing that binds a signature to a network.
    throw permitError(`The permit is scoped to chain ${String(domainChainId)}, not ${leg.chainId}`);
  }

  const values = (permitData.values ?? {}) as Record<string, unknown>;
  const spender = typeof values.spender === "string" ? values.spender.toLowerCase() : "";
  const sigDeadline = optionalUint(values.sigDeadline);
  const entries = Array.isArray(values.details)
    ? values.details
    : values.details === undefined
      ? []
      : [values.details];
  if (entries.length === 0) throw permitError("The permit carries no details to check");

  const ceiling = Math.floor(now / 1000) + MAX_PERMIT_WINDOW_SECONDS;
  return entries.map((entry) => {
    const detail = (entry ?? {}) as Record<string, unknown>;
    const token = typeof detail.token === "string" ? detail.token.toLowerCase() : "";
    if (!sameAddress(token, leg.token)) {
      throw permitError(
        `The permit authorises ${token || "an unnamed token"}, not this step's token`,
      );
    }
    const expiration = optionalUint(detail.expiration);
    if (expiration !== undefined && Number(expiration) > ceiling) {
      throw permitError("The permit expires too far in the future to be a per-swap authorisation");
    }
    if (sigDeadline !== undefined && Number(sigDeadline) > ceiling) {
      throw permitError("The permit's signature deadline is too far in the future");
    }
    return {
      token,
      amount: optionalUint(detail.amount) ?? "0",
      spender,
      ...(expiration === undefined ? {} : { expiration }),
      ...(sigDeadline === undefined ? {} : { sigDeadline }),
    };
  });
}

/** A uint from the wire, which arrives as a number, a decimal string or a native bigint. */
function optionalUint(value: unknown): string | undefined {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string" && /^\d+$/.test(value)) return value;
  return undefined;
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === "number") return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return undefined;
}

function approvalError(message: string): TransactionError {
  return new TransactionError(message, { code: APPROVAL_CODE });
}

function permitError(message: string): TransactionError {
  return new TransactionError(message, { code: PERMIT_CODE });
}
