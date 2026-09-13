/** @id PP-CP-LIB-009 @name Cash+ local operation preparation @implements-rules-version v1 */
import {
  type Address,
  erc20Abi,
  type PublicClient,
  parseEventLogs,
  type TransactionReceipt,
  zeroAddress,
} from "viem";
import type { Eip1193Provider } from "@/lib/tx/sendTransaction";
import { cashPlusAaveAdapterAbi } from "./abi/CashPlusAaveAdapter";
import { cashPlusOracleAbi } from "./abi/CashPlusOracle";
import { cashPlusVaultAbi } from "./abi/CashPlusVault";
import { minimumAfterSlippage, parseCashPlusAmount, sharesForAssets } from "./amounts";
import type { CashPlusDeployment } from "./config/deployments";
import type {
  CashPlusIntent,
  CashPlusOperationKind,
  CashPlusReceipt,
  CashPlusSnapshot,
  CashPlusTransaction,
} from "./types";

export async function assertCashPlusWallet(
  provider: Eip1193Provider,
  owner: Address,
  chainId: number,
): Promise<void> {
  const accounts = await provider.request({ method: "eth_accounts" });
  if (
    !Array.isArray(accounts) ||
    typeof accounts[0] !== "string" ||
    accounts[0].toLowerCase() !== owner.toLowerCase()
  )
    throw new Error("WALLET_CHANGED");
  const chain = await provider.request({ method: "eth_chainId" });
  if (typeof chain !== "string" || Number(BigInt(chain)) !== chainId)
    throw new Error("WRONG_CHAIN");
}

export async function prepareCashPlusIntent(
  client: PublicClient,
  deployment: CashPlusDeployment,
  snapshot: CashPlusSnapshot,
  owner: Address,
  balance: bigint | null,
  kind: CashPlusOperationKind,
  exactAmount: string,
): Promise<{ intent: CashPlusIntent; transaction: CashPlusTransaction }> {
  const vault = deployment.vault as Address,
    all = exactAmount === "all";
  if (kind === "deposit" && all) throw new Error("AMOUNT_INVALID");
  if (kind !== "proportional" && (!snapshot.oracleHealthy || snapshot.totalAssets === null))
    throw new Error("ORACLE_INVALID");
  const requested = all ? BigInt(0) : parseCashPlusAmount(exactAmount);
  const intent: CashPlusIntent = {
    version: 1,
    operationId: crypto.randomUUID(),
    kind,
    chainId: deployment.chainId,
    owner,
    vault,
    token: deployment.usdc.address as Address,
    amount: requested,
    minOutput: BigInt(0),
    deadline: BigInt(Math.max(snapshot.timestamp, Math.floor(snapshot.readAt / 1000)) + 120),
    policyVersion: snapshot.policyVersion,
    redeemAll: all,
    minimumComponents: [],
  };
  const transaction: CashPlusTransaction = {
    phase: "review",
    kind,
    deadline: Number(intent.deadline),
  };
  if (kind === "deposit") {
    if (snapshot.depositsPaused) throw new Error("DEPOSIT_PAUSED");
    if (balance === null || snapshot.capacityAssets === null) throw new Error("READ_UNAVAILABLE");
    if (requested > balance) throw new Error("INSUFFICIENT_USDC");
    if (requested > snapshot.capacityAssets) throw new Error("CAPACITY_FULL");
    if (requested < snapshot.minimumDepositAssets) throw new Error("AMOUNT_INVALID");
    const shares = await client.readContract({
      address: vault,
      abi: cashPlusVaultAbi,
      functionName: "previewDeposit",
      args: [requested],
      blockNumber: snapshot.blockNumber,
    });
    intent.minOutput = minimumAfterSlippage(shares);
    if (intent.minOutput <= BigInt(0)) throw new Error("MIN_OUTPUT_NOT_MET");
    transaction.amountAssets = requested;
    transaction.shares = shares;
    transaction.minShares = intent.minOutput;
  } else {
    if (snapshot.accountShares <= BigInt(0)) throw new Error("INSUFFICIENT_USDC");
    if (!all && (snapshot.totalAssets === null || snapshot.totalAssets <= BigInt(0)))
      throw new Error("ORACLE_INVALID");
    const shares = all
      ? snapshot.accountShares
      : sharesForAssets(requested, snapshot.totalAssets!, snapshot.totalShares);
    if (shares > snapshot.accountShares) throw new Error("INSUFFICIENT_USDC");
    intent.amount = shares;
    transaction.shares = shares;
    if (kind === "redeem") {
      const assets = await client.readContract({
        address: vault,
        abi: cashPlusVaultAbi,
        functionName: "previewRedeem",
        args: [shares],
        blockNumber: snapshot.blockNumber,
      });
      intent.minOutput = minimumAfterSlippage(assets);
      transaction.minAssets = intent.minOutput;
      transaction.amountAssets = assets;
    } else {
      const [amounts, tokens] = await Promise.all([
        client.readContract({
          address: vault,
          abi: cashPlusVaultAbi,
          functionName: "previewProportional",
          args: [shares],
          blockNumber: snapshot.blockNumber,
        }),
        client.readContract({
          address: vault,
          abi: cashPlusVaultAbi,
          functionName: "componentTokens",
          blockNumber: snapshot.blockNumber,
        }),
      ]);
      if (amounts.length !== 4 || tokens.length !== 4) throw new Error("DEPLOYMENT_MISMATCH");
      intent.minimumComponents = amounts.map((amount) => minimumAfterSlippage(amount));
      transaction.outputs = tokens.flatMap((address, index) =>
        address === zeroAddress
          ? []
          : [
              {
                address,
                symbol:
                  index === 0
                    ? deployment.usdc.symbol
                    : index === 1
                      ? deployment.secondary.symbol
                      : index === 2
                        ? `a${deployment.usdc.symbol}`
                        : `a${deployment.secondary.symbol}`,
                decimals:
                  index % 2 === 0 ? deployment.usdc.decimals : deployment.secondary.decimals,
                amount: intent.minimumComponents[index] ?? BigInt(0),
              },
            ],
      );
    }
    await simulateCashPlusIntent(client, intent);
  }
  return { intent, transaction };
}

export async function simulateCashPlusIntent(client: PublicClient, intent: CashPlusIntent) {
  const base = {
    address: intent.vault,
    abi: [
      ...cashPlusVaultAbi,
      ...cashPlusOracleAbi.filter((item) => item.type === "error"),
      ...cashPlusAaveAdapterAbi.filter((item) => item.type === "error"),
    ],
    account: intent.owner,
  };
  if (intent.kind === "deposit")
    return client.simulateContract({
      ...base,
      functionName: "deposit",
      args: [intent.amount, intent.minOutput, intent.deadline, intent.policyVersion],
    });
  if (intent.kind === "redeem")
    return intent.redeemAll
      ? client.simulateContract({
          ...base,
          functionName: "redeemAll",
          args: [intent.minOutput, intent.deadline, intent.policyVersion],
        })
      : client.simulateContract({
          ...base,
          functionName: "redeem",
          args: [intent.amount, intent.minOutput, intent.deadline, intent.policyVersion],
        });
  if (intent.kind === "proportional")
    return client.simulateContract({
      ...base,
      functionName: "redeemProportional",
      args: [intent.amount, intent.minimumComponents, intent.deadline],
    });
  return client.simulateContract({
    address: intent.token,
    abi: erc20Abi,
    functionName: "approve",
    args: [intent.vault, intent.amount],
    account: intent.owner,
  });
}

export function decodeCashPlusReceipt(
  receipt: TransactionReceipt,
  deployment: CashPlusDeployment,
  owner: Address,
  kind: CashPlusOperationKind,
): CashPlusReceipt {
  if (receipt.status !== "success") throw new Error("TX_REVERTED");
  const logs = parseEventLogs({
    abi: cashPlusVaultAbi,
    logs: receipt.logs.filter(
      (log) => log.address.toLowerCase() === deployment.vault.toLowerCase(),
    ),
    strict: true,
  });
  for (const log of logs) {
    if (!("owner" in log.args) || log.args.owner.toLowerCase() !== owner.toLowerCase()) continue;
    const base = {
      hash: receipt.transactionHash,
      blockNumber: receipt.blockNumber,
      kind,
      tokens: [],
    };
    if (kind === "deposit" && log.eventName === "Deposited")
      return { ...base, assets: log.args.assets, shares: log.args.shares };
    if (kind === "redeem" && log.eventName === "Redeemed")
      return { ...base, assets: log.args.usdcOut, shares: log.args.shares };
    if (kind === "proportional" && log.eventName === "ProportionalExit") {
      const transfers = parseEventLogs({
        abi: erc20Abi,
        logs: receipt.logs,
        eventName: "Transfer",
        strict: true,
      });
      const sources = [deployment.vault, deployment.usdcAdapter, deployment.secondaryAdapter]
        .filter(Boolean)
        .map((a) => a!.toLowerCase());
      const tokens = log.args.tokens.flatMap((address, index) =>
        address === zeroAddress
          ? []
          : [
              {
                address,
                symbol:
                  index === 0
                    ? deployment.usdc.symbol
                    : index === 1
                      ? deployment.secondary.symbol
                      : index === 2
                        ? `a${deployment.usdc.symbol}`
                        : `a${deployment.secondary.symbol}`,
                decimals:
                  index % 2 === 0 ? deployment.usdc.decimals : deployment.secondary.decimals,
                amount: transfers
                  .filter(
                    (t) =>
                      t.address.toLowerCase() === address.toLowerCase() &&
                      t.args.to.toLowerCase() === owner.toLowerCase() &&
                      sources.includes(t.args.from.toLowerCase()),
                  )
                  .reduce((sum, t) => sum + t.args.value, BigInt(0)),
              },
            ],
      );
      return {
        ...base,
        assets: log.args.valuationAvailable ? log.args.valueUsdc : null,
        shares: log.args.shares,
        tokens,
      };
    }
  }
  throw new Error("RECEIPT_UNAVAILABLE");
}
