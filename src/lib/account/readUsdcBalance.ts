/**
 * @id PP-ACCOUNT (POO-197)
 * @name readUsdcBalance
 * @implements-rules-version v1
 *
 * Reads the USDC balance of a wallet on a given chain via a direct viem publicClient call.
 * Returns a human-readable number (e.g. 1500000 raw -> 1.5 USDC). Returns 0 when the wallet
 * holds no USDC (does not throw). Throws a typed RpcError on network failure.
 */
import { createPublicClient, formatUnits, http } from "viem";
import { supportedChainMetas } from "@/lib/chains/config";

/** Minimal ERC-20 ABI: only the balanceOf view we need. */
const ERC20_BALANCE_ABI = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

/** Typed error for RPC / contract-read failures. */
export class RpcError extends Error {
  constructor(
    message: string,
    public readonly chainId: number,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "RpcError";
  }
}

/**
 * Read the USDC balance for `address` on `chainId`.
 *
 * @returns The balance as a human-readable number (USDC has 6 decimals).
 * @throws {RpcError} On network or contract-read failure.
 */
export async function readUsdcBalance(address: `0x${string}`, chainId: number): Promise<number> {
  const meta = supportedChainMetas.find((m) => m.chain.id === chainId);
  if (!meta) {
    throw new RpcError(`Unsupported chain: ${chainId}`, chainId);
  }

  const client = createPublicClient({
    chain: meta.chain,
    transport: http(meta.rpcUrl),
  });

  try {
    const raw = await client.readContract({
      address: meta.usdc.address,
      abi: ERC20_BALANCE_ABI,
      functionName: "balanceOf",
      args: [address],
    });

    return Number(formatUnits(raw, meta.usdc.decimals));
  } catch (err) {
    throw new RpcError(`Failed to read USDC balance on chain ${chainId}`, chainId, err);
  }
}

// PP-NOTE: the cross-network aggregate (readUsdcBalanceAllNetworks) was removed (POO-303). An invest
// settles on a single chain, so signing a Permit2 for the summed balance authorized more than the
// wallet holds on the strategy's network. The spendable balance is now read per-network on the
// operation's chain; a bridge step will reintroduce cross-network funds later.
