/** @id PP-CP-LIB-008 @name Cash+ snapshot mapping @implements-rules-version v1 */
import { type Address, erc20Abi, type PublicClient, zeroAddress } from "viem";
import { cashPlusVaultAbi } from "./abi/CashPlusVault";
import type { CashPlusDeployment } from "./config/deployments";
import type { CashPlusSnapshot } from "./types";

export async function readCashPlusSnapshot(
  client: PublicClient,
  deployment: CashPlusDeployment,
  owner?: Address,
): Promise<{ snapshot: CashPlusSnapshot; walletBalanceAssets: bigint | null }> {
  const block = await client.getBlock();
  const vault = deployment.vault as Address;
  const blockNumber = block.number;
  if (blockNumber === null || !block.hash) throw new Error("READ_UNAVAILABLE");
  const results = await client.multicall({
    blockNumber,
    allowFailure: true,
    contracts: [
      { address: vault, abi: cashPlusVaultAbi, functionName: "status" },
      { address: vault, abi: cashPlusVaultAbi, functionName: "inventory" },
      {
        address: vault,
        abi: cashPlusVaultAbi,
        functionName: "sharesOf",
        args: [owner ?? zeroAddress],
      },
      {
        address: vault,
        abi: cashPlusVaultAbi,
        functionName: "accountCashflows",
        args: [owner ?? zeroAddress],
      },
      {
        address: deployment.usdc.address as Address,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [owner ?? zeroAddress],
      },
    ],
  });
  const [statusResult, inventoryResult, sharesResult, cashflowResult, balanceResult] = results;
  if (
    statusResult.status !== "success" ||
    (owner && (sharesResult.status !== "success" || cashflowResult.status !== "success"))
  )
    throw new Error("READ_UNAVAILABLE");
  const state = statusResult.result;
  const totalAssets = state.valuationAvailable ? state.assetsUsdc : null;
  const accountShares =
    owner && sharesResult.status === "success" ? sharesResult.result : BigInt("0");
  const cashflows =
    owner && cashflowResult.status === "success"
      ? cashflowResult.result
      : ([BigInt("0"), BigInt("0"), false] as const);
  const claim =
    totalAssets !== null && state.shares > BigInt("0")
      ? (accountShares * totalAssets) / state.shares
      : null;
  const walletBalanceAssets =
    owner && balanceResult.status === "success" ? balanceResult.result : null;
  let withdrawableAssets: bigint | null = accountShares === BigInt("0") ? BigInt("0") : null;
  if (owner && accountShares > BigInt("0") && totalAssets !== null) {
    try {
      const simulation = await client.simulateContract({
        address: vault,
        abi: cashPlusVaultAbi,
        functionName: "redeemAll",
        args: [BigInt("0"), block.timestamp + BigInt("120"), state.policyVersion],
        account: owner,
        blockNumber,
      });
      withdrawableAssets = simulation.result;
    } catch {
      // Unavailable simulation is not an observed zero balance or a guaranteed partial maximum.
    }
  }
  const snapshot: CashPlusSnapshot = {
    mode: deployment.mode,
    deploymentId: deployment.id,
    runId: deployment.runId,
    chainId: deployment.chainId,
    networkName: deployment.networkName,
    vault,
    blockNumber,
    blockHash: block.hash,
    timestamp: Number(block.timestamp),
    readAt: Date.now(),
    totalAssets,
    totalShares: state.shares,
    accountShares,
    accountAssets: claim,
    investedAssets: cashflows[0],
    withdrawnAssets: cashflows[2] ? null : cashflows[1],
    resultAssets: claim === null || cashflows[2] ? null : claim + cashflows[1] - cashflows[0],
    withdrawableAssets,
    capacityAssets:
      totalAssets === null
        ? null
        : state.depositCap > totalAssets
          ? state.depositCap - totalAssets
          : BigInt("0"),
    depositCapAssets: state.depositCap,
    minimumDepositAssets: state.minDeposit,
    interestAssets: null,
    conversionAssets: null,
    attributionComplete: false,
    depositsPaused: state.depositsPaused || !state.initialized,
    tradingPaused: state.tradingPaused,
    oracleHealthy: state.valuationAvailable,
    policyVersion: state.policyVersion,
    composition:
      inventoryResult.status === "success"
        ? inventoryResult.result.map((item) => ({
            token: item.token,
            symbol:
              item.token.toLowerCase() === deployment.usdc.address.toLowerCase()
                ? deployment.usdc.symbol
                : deployment.secondary.symbol,
            decimals: item.decimals,
            walletRaw: item.walletBalance + item.adapterIdleBalance,
            lendingRaw: item.lendingBalance,
            valueAssets: state.valuationAvailable ? item.valueUsdc : null,
            weightBps:
              totalAssets !== null && totalAssets > BigInt("0")
                ? Number((item.valueUsdc * BigInt("10000")) / totalAssets)
                : null,
          }))
        : [],
    history: [],
    activity: [],
    historyPartial: false,
    explorerUrl: deployment.explorerUrl,
  };
  return { snapshot, walletBalanceAssets };
}
