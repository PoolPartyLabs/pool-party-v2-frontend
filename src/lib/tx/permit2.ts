/**
 * @id PP-TX (POO-303 / POO-1001)
 * @name Permit2 helpers
 * @implements-rules-version v1 · v1 (POO-1001: stringify typed-data uints for embedded-wallet signing)
 *
 * Permit2 spend-authorization for invest (add-liquidity). Reads the Permit2 nonce + the
 * USDC→Permit2 allowance on-chain (viem), builds a PermitSingle (via @uniswap/permit2-sdk), and
 * serializes it for the build-tx Server Action. The signing itself happens in the hook (Privy
 * useSignTypedData); the conditional USDC→Permit2 approval reuses the tx-execution layer. The
 * typed-data builders emit fully JSON-safe payloads (no native bigint) so Privy's embedded
 * social-login wallets can serialize + sign them (POO-1001).
 *
 * PP-INTEGRATION-POINT: Permit2 reads + spend authorization for add-liquidity (POO-303).
 */
"use client";

import type { SignTypedDataParams } from "@privy-io/react-auth";
import {
  AllowanceTransfer,
  type PermitBatch,
  type PermitSingle,
  permit2Address,
} from "@uniswap/permit2-sdk";
import { createPublicClient, encodeFunctionData, http, maxUint256 } from "viem";
import { supportedChainMetas } from "@/lib/chains/config";
import type { BuiltTx } from "./builtTxSchema";

/** Permit2 `allowance(user, token, spender) → (amount, expiration, nonce)`. */
const PERMIT2_ALLOWANCE_ABI = [
  {
    name: "allowance",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "user", type: "address" },
      { name: "token", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [
      { name: "amount", type: "uint160" },
      { name: "expiration", type: "uint48" },
      { name: "nonce", type: "uint48" },
    ],
  },
] as const;

/** ERC-20 allowance + approve. */
const ERC20_ABI = [
  {
    name: "allowance",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "approve",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

/** A PermitSingle with all bigints stringified, ready to send through a Server Action. */
export interface SerializedPermitSingle {
  details: { token: string; amount: string; expiration: string; nonce: string };
  spender: string;
  sigDeadline: string;
}

const THIRTY_DAYS_S = 30 * 24 * 60 * 60;
const THIRTY_MINUTES_S = 30 * 60;

/** A viem public client for a supported chain. */
function publicClientFor(chainId: number) {
  const meta = supportedChainMetas.find((m) => m.chain.id === chainId);
  if (!meta) throw new Error(`Unsupported chain: ${chainId}`);
  return createPublicClient({ chain: meta.chain, transport: http(meta.rpcUrl) });
}

/** Read the current Permit2 nonce for (owner, token, spender). */
export async function readPermit2Nonce(
  chainId: number,
  owner: `0x${string}`,
  token: `0x${string}`,
  spender: `0x${string}`,
): Promise<number> {
  const client = publicClientFor(chainId);
  const [, , nonce] = await client.readContract({
    address: permit2Address(chainId) as `0x${string}`,
    abi: PERMIT2_ALLOWANCE_ABI,
    functionName: "allowance",
    args: [owner, token, spender],
  });
  return Number(nonce);
}

/** Read how much of `token` the owner has approved to the Permit2 contract. */
export async function readPermit2TokenAllowance(
  chainId: number,
  owner: `0x${string}`,
  token: `0x${string}`,
): Promise<bigint> {
  const client = publicClientFor(chainId);
  return client.readContract({
    address: token,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: [owner, permit2Address(chainId) as `0x${string}`],
  });
}

/** Build the unlimited `approve(Permit2, max)` transaction for `token`. */
export function buildPermit2ApproveTx(chainId: number, token: `0x${string}`): BuiltTx {
  return {
    tx: {
      to: token,
      data: encodeFunctionData({
        abi: ERC20_ABI,
        functionName: "approve",
        args: [permit2Address(chainId) as `0x${string}`, maxUint256],
      }),
      value: "0",
    },
  };
}

/** Construct a PermitSingle (30-day expiry, 30-minute signature deadline). */
export function buildPermitSingle(
  token: `0x${string}`,
  spender: `0x${string}`,
  amount: bigint,
  nonce: number,
): PermitSingle {
  const now = Math.floor(Date.now() / 1000);
  return {
    details: {
      token,
      amount,
      expiration: BigInt(now + THIRTY_DAYS_S),
      nonce: BigInt(nonce),
    },
    spender,
    sigDeadline: BigInt(now + THIRTY_MINUTES_S),
  };
}

/**
 * The EIP-712 typed data for a PermitSingle, ready for Privy's signTypedData. The SDK domain
 * carries `chainId` as a BigNumberish (ethers); coerce it to a number for the viem-native signer.
 *
 * POO-1001 [R1/R2]: the `message` uints are emitted as decimal STRINGS, never native `bigint`.
 * Privy's embedded (social-login) wallet signer `JSON.stringify`s the payload, and `JSON.stringify`
 * throws "Do not know how to serialize a BigInt" on a raw bigint (external/injected wallets tolerate
 * it via a different path). Decimal strings are the canonical EIP-712 JSON encoding for uints and
 * hash identically to the bigint form, so the signature is unchanged and both wallet types sign.
 */
export function permitTypedData(permit: PermitSingle, chainId: number): SignTypedDataParams {
  const { domain, types, values } = AllowanceTransfer.getPermitData(
    permit,
    permit2Address(chainId) as `0x${string}`,
    chainId,
  );
  const details = values.details as {
    token: string;
    amount: bigint;
    expiration: bigint;
    nonce: bigint;
  };
  return {
    domain: { ...domain, chainId: Number(domain.chainId) },
    types,
    primaryType: "PermitSingle",
    message: {
      details: {
        token: details.token,
        amount: details.amount.toString(),
        expiration: details.expiration.toString(),
        nonce: details.nonce.toString(),
      },
      spender: values.spender,
      sigDeadline: values.sigDeadline.toString(),
    },
  } as unknown as SignTypedDataParams;
}

/** Stringify a PermitSingle's bigints for transport through a Server Action. */
export function serializePermit(permit: PermitSingle): SerializedPermitSingle {
  const details = permit.details as {
    token: string;
    amount: bigint;
    expiration: bigint;
    nonce: bigint;
  };
  return {
    details: {
      token: details.token,
      amount: details.amount.toString(),
      expiration: details.expiration.toString(),
      nonce: details.nonce.toString(),
    },
    spender: permit.spender,
    sigDeadline: permit.sigDeadline.toString(),
  };
}

// ---------------------------------------------------------------------------
// PermitBatch (two tokens) — for create-pool, which seeds both pool tokens.
// ---------------------------------------------------------------------------

/** A PermitBatch serialized for transport through a Server Action. */
export interface SerializedPermitBatch {
  details: { token: string; amount: string; expiration: number; nonce: number }[];
  spender: string;
  sigDeadline: string;
}

/** One token leg of a PermitBatch. */
export interface PermitLeg {
  token: `0x${string}`;
  amount: bigint;
  nonce: number;
}

/** Build a two-token PermitBatch (30-day expiry, 30-minute signature deadline). */
export function buildPermitBatch(
  token0: PermitLeg,
  token1: PermitLeg,
  spender: `0x${string}`,
): PermitBatch {
  const now = Math.floor(Date.now() / 1000);
  const expiration = BigInt(now + THIRTY_DAYS_S);
  return {
    details: [
      { token: token0.token, amount: token0.amount, expiration, nonce: BigInt(token0.nonce) },
      { token: token1.token, amount: token1.amount, expiration, nonce: BigInt(token1.nonce) },
    ],
    spender,
    sigDeadline: BigInt(now + THIRTY_MINUTES_S),
  };
}

/**
 * The EIP-712 typed data for a PermitBatch, ready for Privy's signTypedData. POO-1001 [R1/R2]:
 * every leg's uints are decimal STRINGS (never native `bigint`) so Privy's embedded-wallet signer
 * can `JSON.stringify` the payload — see {@link permitTypedData} for the full rationale.
 */
export function permitBatchTypedData(batch: PermitBatch, chainId: number): SignTypedDataParams {
  const { domain, types, values } = AllowanceTransfer.getPermitData(
    batch,
    permit2Address(chainId) as `0x${string}`,
    chainId,
  );
  const details = (
    values.details as { token: string; amount: bigint; expiration: bigint; nonce: bigint }[]
  ).map((leg) => ({
    token: leg.token,
    amount: leg.amount.toString(),
    expiration: leg.expiration.toString(),
    nonce: leg.nonce.toString(),
  }));
  return {
    domain: { ...domain, chainId: Number(domain.chainId) },
    types,
    primaryType: "PermitBatch",
    message: {
      details,
      spender: values.spender,
      sigDeadline: values.sigDeadline.toString(),
    },
  } as unknown as SignTypedDataParams;
}

/** Stringify a PermitBatch's bigints for transport through a Server Action. */
export function serializePermitBatch(batch: PermitBatch): SerializedPermitBatch {
  const details = (
    batch.details as { token: string; amount: bigint; expiration: bigint; nonce: bigint }[]
  ).map((leg) => ({
    token: leg.token,
    amount: leg.amount.toString(),
    expiration: Number(leg.expiration),
    nonce: Number(leg.nonce),
  }));
  return { details, spender: batch.spender, sigDeadline: batch.sigDeadline.toString() };
}
