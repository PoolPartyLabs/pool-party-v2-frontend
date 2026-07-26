"use server";

import { encodeFunctionData, erc20Abi } from "viem";
import { PARTY_VAULT_WRITE_ABI } from "@/lib/aqua/abis/partyVault";
import { arbitrumPublicClient } from "@/lib/aqua/chain/clients";
import { CHAIN_ID_ARBITRUM, TOKENS } from "@/lib/aqua/config/addresses";
import type { BuiltTx } from "@/lib/tx/builtTxSchema";

/**
 * @id PP-AQUA-ACT-001
 * @name Active Reserve invest / withdraw builds
 * @implements-rules-version v3
 *
 * SRV-R5: everything a wallet signs is returned by a server action as a BuiltTx payload. These
 * are thin by rule (SRV-R1): validation, then calldata. No key ever reaches this path, the
 * server never signs, and the wallet's own prompt stays the final guard.
 *
 * Three builds, because the vault takes a plain ERC-20 allowance rather than a Permit2
 * signature: approve USDC to the vault, deposit, redeem.
 *
 * PP-INTEGRATION-POINT: post-hackathon these move behind pool-party-api's build endpoints and
 * the call sites keep this shape.
 */

export type BuildResult = { ok: true; tx: BuiltTx } | { ok: false; code: string; message: string };

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
/** uint256 ceiling; a larger amount cannot be encoded and is a caller bug, not user input. */
const MAX_UINT256 = BigInt(2) ** BigInt(256) - BigInt(1);

/**
 * The vault these builds target.
 *
 * MUST use the same resolution order as `lib/aqua/api/vaultState.ts` and the client-side allowance
 * check in `useAquaLiquidity`, or the three disagree. That is not hypothetical: this function once
 * read only `AQUA_VAULT_ADDRESS` while the page and the allowance check read
 * `NEXT_PUBLIC_AQUA_VAULT_ADDRESS`, so an environment that set only the public variable rendered a
 * healthy page with a working Max button and then failed every deposit with "not deployed yet".
 *
 * Static `process.env.X` references, never a computed lookup: Next inlines only literals.
 */
function vaultAddress(): `0x${string}` | null {
  for (const raw of [process.env.NEXT_PUBLIC_AQUA_VAULT_ADDRESS, process.env.AQUA_VAULT_ADDRESS]) {
    if (raw && ADDRESS.test(raw.trim())) return raw.trim() as `0x${string}`;
  }
  return null;
}

/** Amounts cross the boundary as decimal STRINGS: a JS number loses WETH-scale precision. */
function parseAmount(raw: string): bigint | null {
  if (!/^\d+$/.test(raw)) return null;
  const value = BigInt(raw);
  if (value <= BigInt(0) || value > MAX_UINT256) return null;
  return value;
}

function fail(code: string, message: string): BuildResult {
  return { ok: false, code, message };
}

/**
 * Approve USDC to the vault, for the exact deposit amount.
 *
 * Deliberately NOT an infinite approval. This is an unaudited hackathon contract holding real
 * money; a per-deposit allowance means a bug in the vault can never pull more than the amount
 * the investor just agreed to.
 */
export async function buildAquaApproveTx(input: {
  owner: string;
  amountUsdc: string;
}): Promise<BuildResult> {
  const vault = vaultAddress();
  if (!vault) return fail("VAULT_NOT_CONFIGURED", "The vault is not deployed yet.");
  if (!ADDRESS.test(input.owner)) return fail("BAD_OWNER", "Invalid wallet address.");

  const amount = parseAmount(input.amountUsdc);
  if (amount === null) return fail("BAD_AMOUNT", "Enter an amount greater than zero.");

  return {
    ok: true,
    tx: {
      tx: {
        to: TOKENS.USDC,
        from: input.owner as `0x${string}`,
        data: encodeFunctionData({
          abi: erc20Abi,
          functionName: "approve",
          args: [vault, amount],
        }),
        value: "0",
      },
      chainId: CHAIN_ID_ARBITRUM,
    },
  };
}

/**
 * Deposit USDC into the vault.
 *
 * The preflight checks exist so an investor gets a sentence instead of a reverted transaction:
 * the vault refuses deposits before the manager has seeded (VLT-R2) and refuses anything that
 * would push TVL past `maxTvl` (VLT-R1).
 */
export async function buildAquaDepositTx(input: {
  owner: string;
  amountUsdc: string;
}): Promise<BuildResult> {
  const vault = vaultAddress();
  if (!vault) return fail("VAULT_NOT_CONFIGURED", "The vault is not deployed yet.");
  if (!ADDRESS.test(input.owner)) return fail("BAD_OWNER", "Invalid wallet address.");

  const amount = parseAmount(input.amountUsdc);
  if (amount === null) return fail("BAD_AMOUNT", "Enter an amount greater than zero.");

  const client = arbitrumPublicClient();
  const { PARTY_VAULT_VIEW_ABI } = await import("@/lib/aqua/abis/partyVault");

  const [seeded, totalAssets, maxTvl] = await Promise.all([
    client.readContract({ address: vault, abi: PARTY_VAULT_VIEW_ABI, functionName: "seeded" }),
    client.readContract({ address: vault, abi: PARTY_VAULT_VIEW_ABI, functionName: "totalAssets" }),
    client.readContract({ address: vault, abi: PARTY_VAULT_VIEW_ABI, functionName: "maxTvl" }),
  ]);

  if (!seeded) {
    return fail("NOT_SEEDED", "This reserve is not open for deposits yet.");
  }
  if (totalAssets + amount > maxTvl) {
    const room = maxTvl > totalAssets ? maxTvl - totalAssets : BigInt(0);
    return fail(
      "MAX_TVL_EXCEEDED",
      room === BigInt(0)
        ? "This reserve is at its deposit cap."
        : `This reserve has room for ${formatUsdc(room)} more.`,
    );
  }

  return {
    ok: true,
    tx: {
      tx: {
        to: vault,
        from: input.owner as `0x${string}`,
        data: encodeFunctionData({
          abi: PARTY_VAULT_WRITE_ABI,
          functionName: "deposit",
          args: [amount],
        }),
        value: "0",
      },
      chainId: CHAIN_ID_ARBITRUM,
    },
  };
}

/**
 * Redeem shares for USDC.
 *
 * VLT-R5 makes redemption USDC-only and reverts with `InsufficientLiquidUsdc` when the buffer
 * plus what Aave can return cannot cover it. FE-R5 says that state is explained honestly rather
 * than surfaced as a generic failure, so it is caught here and named.
 */
export async function buildAquaRedeemTx(input: {
  owner: string;
  shares: string;
}): Promise<BuildResult> {
  const vault = vaultAddress();
  if (!vault) return fail("VAULT_NOT_CONFIGURED", "The vault is not deployed yet.");
  if (!ADDRESS.test(input.owner)) return fail("BAD_OWNER", "Invalid wallet address.");

  const shares = parseAmount(input.shares);
  if (shares === null) return fail("BAD_AMOUNT", "Enter an amount greater than zero.");

  const client = arbitrumPublicClient();
  const { PARTY_VAULT_VIEW_ABI } = await import("@/lib/aqua/abis/partyVault");

  const [held, wanted, liquid] = await Promise.all([
    client.readContract({
      address: vault,
      abi: PARTY_VAULT_VIEW_ABI,
      functionName: "sharesOf",
      args: [input.owner as `0x${string}`],
    }),
    client.readContract({
      address: vault,
      abi: PARTY_VAULT_VIEW_ABI,
      functionName: "convertToAssets",
      args: [shares],
    }),
    client.readContract({ address: vault, abi: PARTY_VAULT_VIEW_ABI, functionName: "liquidUsdc" }),
  ]);

  if (shares > held) {
    return fail("INSUFFICIENT_SHARES", "You do not hold that many shares.");
  }
  if (wanted > liquid) {
    // FE-R5: name the real reason. The money is not lost, it is committed to a live band.
    return fail(
      "TEMPORARILY_ILLIQUID",
      `Only ${formatUsdc(liquid)} can be withdrawn right now. The rest is committed to a buy band until it settles or the manager closes it.`,
    );
  }

  return {
    ok: true,
    tx: {
      tx: {
        to: vault,
        from: input.owner as `0x${string}`,
        data: encodeFunctionData({
          abi: PARTY_VAULT_WRITE_ABI,
          functionName: "redeem",
          args: [shares],
        }),
        value: "0",
      },
      chainId: CHAIN_ID_ARBITRUM,
    },
  };
}

/** Exact 2dp USDC for an error sentence. Truncates, so a stated limit is never overstated. */
function formatUsdc(raw: bigint): string {
  const whole = raw / BigInt(1_000_000);
  const cents = ((raw % BigInt(1_000_000)) / BigInt(10_000)).toString().padStart(2, "0");
  return `$${whole}.${cents}`;
}
