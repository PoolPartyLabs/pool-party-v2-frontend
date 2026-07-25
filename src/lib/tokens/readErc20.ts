/**
 * @id PP-MGR (POO-309)
 * @name readErc20
 * @implements-rules-version v1
 *
 * Generic ERC-20 reads (decimals + raw balance) for an arbitrary token, used by the strategy
 * builder's seed-liquidity step where the two pool tokens are not USDC and their decimals are not
 * in the static token list. Mirrors {@link readUsdcBalance} (direct viem publicClient call) but for
 * any token address. Balances are returned RAW (wei); the caller formats with the decimals.
 *
 * PP-INTEGRATION-POINT: on-chain ERC-20 decimals/balanceOf for the seed tokens (no indexer hop).
 */
import { createPublicClient, http } from "viem";
import { RpcError } from "@/lib/account/readUsdcBalance";
import { supportedChainMetas } from "@/lib/chains/config";

/** Minimal ERC-20 ABI: the views the seed step + the POO-810 token-meta resolution need. */
const ERC20_ABI = [
  {
    name: "decimals",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    name: "symbol",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

/** Build a viem public client for a supported chain, or throw a typed {@link RpcError}. */
function clientFor(chainId: number) {
  const meta = supportedChainMetas.find((m) => m.chain.id === chainId);
  if (!meta) throw new RpcError(`Unsupported chain: ${chainId}`, chainId);
  return createPublicClient({ chain: meta.chain, transport: http(meta.rpcUrl) });
}

/**
 * Read an ERC-20 token's decimals on `chainId`.
 *
 * @throws {RpcError} On network or contract-read failure.
 */
export async function readErc20Decimals(token: `0x${string}`, chainId: number): Promise<number> {
  const client = clientFor(chainId);
  try {
    const decimals = await client.readContract({
      address: token,
      abi: ERC20_ABI,
      functionName: "decimals",
    });
    return Number(decimals);
  } catch (err) {
    throw new RpcError(`Failed to read decimals for ${token} on chain ${chainId}`, chainId, err);
  }
}

/**
 * Read an ERC-20 token's `symbol()` on `chainId` (POO-810 R7: the non-USDC receipt leg's display
 * symbol when the position's `currency0/1` didn't carry it). Mirrors {@link readErc20Decimals}.
 *
 * @throws {RpcError} On network or contract-read failure.
 */
export async function readErc20Symbol(token: `0x${string}`, chainId: number): Promise<string> {
  const client = clientFor(chainId);
  try {
    return await client.readContract({
      address: token,
      abi: ERC20_ABI,
      functionName: "symbol",
    });
  } catch (err) {
    throw new RpcError(`Failed to read symbol for ${token} on chain ${chainId}`, chainId, err);
  }
}

/**
 * Read an ERC-20 token's `{ symbol, decimals }` in one call (POO-810 R7): the concrete on-chain
 * `ReadTokenMeta` the invest/collect/withdraw executors inject into `resolveTokenMeta` when the
 * position's `currency0/1` didn't carry the non-USDC leg's metadata. Reads both views in parallel;
 * either failing rejects with a {@link RpcError}, which `resolveTokenMeta` turns into the R9 fallback.
 *
 * PP-INTEGRATION-POINT: on-chain ERC-20 decimals()/symbol() for a receipt-decoded token address.
 */
export async function readErc20Meta(
  token: `0x${string}`,
  chainId: number,
): Promise<{ symbol: string; decimals: number }> {
  const [symbol, decimals] = await Promise.all([
    readErc20Symbol(token, chainId),
    readErc20Decimals(token, chainId),
  ]);
  return { symbol, decimals };
}

/**
 * Read the RAW (wei) balance of `token` held by `owner` on `chainId`.
 *
 * @returns The balance as a raw `bigint` (caller formats with the token's decimals).
 * @throws {RpcError} On network or contract-read failure.
 */
export async function readErc20Balance(
  token: `0x${string}`,
  owner: `0x${string}`,
  chainId: number,
): Promise<bigint> {
  const client = clientFor(chainId);
  try {
    return await client.readContract({
      address: token,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [owner],
    });
  } catch (err) {
    throw new RpcError(`Failed to read balance for ${token} on chain ${chainId}`, chainId, err);
  }
}

/**
 * Read `owner`'s RAW (wei, 18-decimal) NATIVE coin balance (ETH / POL) on `chainId`. Used for the
 * seed step when a pool token is the chain's wrapped-native (WETH/WPOL): the manager holds the
 * native coin, and the create-pool tx wraps it via `tx.value`.
 *
 * @throws {RpcError} On network failure.
 */
export async function readNativeBalance(owner: `0x${string}`, chainId: number): Promise<bigint> {
  const client = clientFor(chainId);
  try {
    return await client.getBalance({ address: owner });
  } catch (err) {
    throw new RpcError(`Failed to read native balance on chain ${chainId}`, chainId, err);
  }
}

/**
 * Read `owner`'s confirmed transaction count on `chainId`, i.e. `eth_getTransactionCount(…, "latest")`.
 *
 * POO-1043 [R7]: the funding recovery journal records this immediately BEFORE a leg prompts the
 * wallet (`docs/_hackathon/02_BRIDGE_ARCHITECTURE.md` §3.4 step 1). On a later session it is the only
 * evidence that distinguishes "the wallet broadcast and we never learned the hash" from "nothing was
 * ever sent", and the two resolve to opposite actions.
 *
 * Deliberately NOT read through the wallet provider: a route spans chains and the provider answers
 * for whichever one it is currently on, so a leg's baseline would silently be another chain's nonce.
 * Sits beside {@link readNativeBalance}, which is the same shape of chain read for the same reason.
 *
 * @throws {RpcError} On network failure.
 */
export async function readTransactionCount(owner: `0x${string}`, chainId: number): Promise<number> {
  const client = clientFor(chainId);
  try {
    return await client.getTransactionCount({ address: owner, blockTag: "latest" });
  } catch (err) {
    throw new RpcError(`Failed to read the transaction count on chain ${chainId}`, chainId, err);
  }
}

/**
 * Read a transaction's receipt status on `chainId`, or `null` when the node has none yet.
 *
 * POO-1055: the recovery surface reconciles a funding journal against the chain
 * (`docs/_hackathon/02_BRIDGE_ARCHITECTURE.md` §3.5), and the difference between "no receipt yet"
 * and "the read failed" decides between waiting and treating the leg as ambiguous. So the raw
 * `eth_getTransactionReceipt` is used rather than viem's `getTransactionReceipt`, which throws
 * `TransactionReceiptNotFoundError` for the pending case and would collapse the two into one.
 *
 * Per-chain like {@link readTransactionCount} and for the same reason: a funding route spans chains,
 * and the wallet provider only ever answers for the one it is currently on.
 *
 * @throws {RpcError} On network failure, which the reconciler reads as a degraded read, never as
 *   evidence that a transaction did or did not happen.
 */
export async function readTransactionReceiptStatus(
  hash: `0x${string}`,
  chainId: number,
): Promise<{ status: "success" | "reverted" } | null> {
  const client = clientFor(chainId);
  try {
    const receipt = await client.request({
      method: "eth_getTransactionReceipt",
      params: [hash],
    });
    // A receipt with no status is a pre-Byzantium shape we can draw no conclusion from; treat it as
    // "not answered yet" rather than inventing a verdict.
    if (!receipt?.status) return null;
    return { status: receipt.status === "0x1" ? "success" : "reverted" };
  } catch (err) {
    throw new RpcError(`Failed to read the receipt for ${hash} on chain ${chainId}`, chainId, err);
  }
}
