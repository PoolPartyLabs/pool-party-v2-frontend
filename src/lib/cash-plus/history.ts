/** @id PP-CP-LIB-011 @name Cash+ bounded onchain history @implements-rules-version v1 */
import {
  type Address,
  type Log,
  type PublicClient,
  parseAbiItem,
  parseEventLogs,
  zeroAddress,
} from "viem";
import { cashPlusAaveAdapterAbi } from "./abi/CashPlusAaveAdapter";
import { cashPlusVaultAbi } from "./abi/CashPlusVault";
import type { CashPlusDeployment } from "./config/deployments";
import type { CashPlusActivity, CashPlusSnapshot } from "./types";

export function dedupeCashPlusLogs<
  T extends Pick<Log, "blockNumber" | "blockHash" | "transactionHash" | "logIndex" | "removed">,
>(logs: readonly T[]): T[] {
  const unique = new Map<string, T>();
  for (const log of logs)
    if (!log.removed) unique.set(`${log.blockHash}:${log.transactionHash}:${log.logIndex}`, log);
  return [...unique.values()].sort((a, b) =>
    a.blockNumber === b.blockNumber
      ? (a.logIndex ?? 0) - (b.logIndex ?? 0)
      : a.blockNumber! < b.blockNumber!
        ? -1
        : 1,
  );
}
export function accruedLendingAssets(
  current: bigint,
  supplied: bigint,
  withdrawn: bigint,
  receipts: bigint,
  donation: boolean,
  operations = 0,
): bigint | null {
  if (donation) return null;
  const earned = current + withdrawn + receipts - supplied;
  if (earned < -BigInt(operations * 2)) return null;
  return earned < BigInt(0) ? BigInt(0) : earned;
}
const transfer = parseAbiItem(
  "event Transfer(address indexed from,address indexed to,uint256 value)",
);
interface CachedHistory {
  from: bigint;
  to: bigint;
  hash: string;
  logs: Log[];
  donations: Log[];
}
const histories = new WeakMap<PublicClient, Map<string, CachedHistory>>();
const timestamps = new Map<string, number>();

/** Rechecks the last 64 blocks and the stable anchor on every refresh; at most two concurrent reads. */
export async function readCashPlusHistory(
  client: PublicClient,
  deployment: CashPlusDeployment,
  snapshot: CashPlusSnapshot,
  windowBlocks = 20000,
): Promise<CashPlusSnapshot> {
  const to = snapshot.blockNumber,
    deployed = BigInt(deployment.deploymentBlock),
    windowStart = to - BigInt(windowBlocks) + BigInt(1),
    from = windowStart > deployed ? windowStart : deployed;
  if (to < deployed) throw new Error("DEPLOYMENT_MISMATCH");
  const key = `${deployment.runId}:${deployment.vault}:${from}`;
  let cache = histories.get(client);
  if (!cache) {
    cache = new Map();
    histories.set(client, cache);
  }
  let previous = cache.get(key);
  if (
    previous &&
    (previous.to > to ||
      (await client.getBlock({ blockNumber: previous.to })).hash !== previous.hash)
  ) {
    cache.delete(key);
    previous = undefined;
  }
  const queryFrom = previous ? previous.to + BigInt(1) : from;
  const addresses = [
    deployment.vault,
    deployment.usdcAdapter,
    ...(deployment.secondaryAdapter ? [deployment.secondaryAdapter] : []),
  ] as Address[];
  const logs: Log[] = [...(previous?.logs ?? [])],
    donations: Log[] = [...(previous?.donations ?? [])];
  for (let start = queryFrom; start <= to; start += BigInt(2000)) {
    const end = start + BigInt(1999) < to ? start + BigInt(1999) : to;
    logs.push(...(await client.getLogs({ address: addresses, fromBlock: start, toBlock: end })));
    const pairs = [
      [deployment.usdcAToken, deployment.usdcAdapter],
      [deployment.secondaryAToken, deployment.secondaryAdapter],
    ] as const;
    const results = await Promise.all(
      pairs
        .filter((pair) => pair[0] && pair[1])
        .map(async (pair) =>
          client.getLogs({
            address: pair[0] as Address,
            event: transfer,
            args: { to: pair[1] as Address },
            fromBlock: start,
            toBlock: end,
          }),
        ),
    );
    for (const result of results)
      donations.push(...result.filter((log) => log.args.from !== zeroAddress));
  }
  const stable = to - BigInt(64);
  if (stable >= from) {
    const anchor = await client.getBlock({ blockNumber: stable });
    cache.set(key, {
      from,
      to: stable,
      hash: anchor.hash!,
      logs: logs.filter((log) => log.blockNumber! <= stable),
      donations: donations.filter((log) => log.blockNumber! <= stable),
    });
    if (cache.size > 4) cache.delete(cache.keys().next().value!);
  }
  const sorted = dedupeCashPlusLogs(logs);
  const vaultLogs = parseEventLogs({
    abi: cashPlusVaultAbi,
    logs: sorted.filter((log) => log.address.toLowerCase() === deployment.vault.toLowerCase()),
    strict: true,
  });
  // Bound rendered history to 120 events; completed financial attribution still uses all queried logs.
  const eventLimit = Math.min(1200, Math.ceil(windowBlocks / 20000) * 120);
  const visible = vaultLogs.slice(-eventLimit);
  const missing = [
    ...new Map(
      visible
        .filter((log) => !timestamps.has(log.blockHash!))
        .map((log) => [log.blockHash!, log.blockNumber!]),
    ).entries(),
  ];
  for (let index = 0; index < missing.length; index += 2)
    await Promise.all(
      missing.slice(index, index + 2).map(async ([hash, blockNumber]) => {
        const block = await client.getBlock({ blockNumber });
        if (block.hash !== hash) throw new Error("READ_UNAVAILABLE");
        timestamps.set(hash, Number(block.timestamp));
      }),
    );
  if (timestamps.size > 1000) timestamps.clear();
  const activity: CashPlusActivity[] = [],
    history: CashPlusSnapshot["history"] = [];
  let conversion = BigInt(0);
  const firstInvestment = vaultLogs.find((log) => log.eventName === "Deposited");
  const valued = vaultLogs.filter(
    (log) =>
      log.eventName === "StateCheckpoint" &&
      firstInvestment !== undefined &&
      log.blockNumber !== null &&
      firstInvestment.blockNumber !== null &&
      log.blockNumber >= firstInvestment.blockNumber &&
      log.args.valuationAvailable &&
      log.args.totalShares > BigInt(0),
  );
  const first = valued[0];
  for (const log of vaultLogs)
    if (log.eventName === "ConversionSettled")
      conversion += log.args.inputValueUsdc - log.args.outputValueUsdc;
  for (const log of visible) {
    const timestamp = timestamps.get(log.blockHash!) ?? snapshot.timestamp;
    const base = {
      id: `${log.blockHash}:${log.transactionHash}:${log.logIndex}`,
      timestamp,
      transactionHash: log.transactionHash!,
      blockNumber: log.blockNumber!,
      tokenSymbol: deployment.usdc.symbol,
    };
    if (
      log.eventName === "StateCheckpoint" &&
      log.args.valuationAvailable &&
      log.args.totalShares > BigInt(0) &&
      first?.eventName === "StateCheckpoint" &&
      first.args.totalAssetsUsdc > BigInt(0) &&
      log.blockNumber !== null &&
      first.blockNumber !== null &&
      log.blockNumber >= first.blockNumber
    )
      history.push({
        timestamp,
        shareValueAssets:
          (log.args.totalAssetsUsdc * first.args.totalShares * BigInt(100000000)) /
          (log.args.totalShares * first.args.totalAssetsUsdc),
      });
    if (log.eventName === "Deposited")
      activity.push({
        ...base,
        kind: "deposit",
        amountAssets: log.args.assets,
        owner: log.args.owner,
      });
    if (log.eventName === "Redeemed")
      activity.push({
        ...base,
        kind: "redeem",
        amountAssets: log.args.usdcOut,
        owner: log.args.owner,
      });
    if (log.eventName === "ProportionalExit")
      activity.push({
        ...base,
        kind: "proportional",
        amountAssets: log.args.valuationAvailable ? log.args.valueUsdc : null,
        owner: log.args.owner,
      });
    if (log.eventName === "ConversionSettled")
      activity.push({
        ...base,
        kind: "conversion",
        amountAssets: log.args.inputValueUsdc,
        tokenIn: log.args.tokenIn,
        tokenOut: log.args.tokenOut,
        amountIn: log.args.amountIn,
        amountOut: log.args.amountOut,
      });
    if (
      log.eventName === "Parked" ||
      log.eventName === "Unparked" ||
      log.eventName === "JitUnparked"
    )
      activity.push({
        ...base,
        kind: log.eventName === "Parked" ? "park" : "unpark",
        amountAssets:
          log.args.token.toLowerCase() === deployment.usdc.address.toLowerCase()
            ? log.args.amount
            : null,
        tokenSymbol:
          log.args.token.toLowerCase() === deployment.usdc.address.toLowerCase()
            ? deployment.usdc.symbol
            : deployment.secondary.symbol,
      });
  }
  const partial = from > deployed;
  let interest: bigint | null = partial || snapshot.composition.length !== 2 ? null : BigInt(0);
  for (const [index, item] of snapshot.composition.entries()) {
    const adapter = index === 0 ? deployment.usdcAdapter : deployment.secondaryAdapter;
    if (!adapter) continue;
    const events = parseEventLogs({
      abi: cashPlusAaveAdapterAbi,
      logs: sorted.filter((log) => log.address.toLowerCase() === adapter.toLowerCase()),
      strict: true,
    });
    let supplied = BigInt(0),
      withdrawn = BigInt(0),
      receipts = BigInt(0);
    for (const event of events) {
      if (event.eventName === "Supplied") supplied += event.args.amount;
      if (event.eventName === "Withdrawn") withdrawn += event.args.amount;
      if (event.eventName === "ReceiptTransferred") receipts += event.args.amount;
    }
    const receiptAddress = index === 0 ? deployment.usdcAToken : deployment.secondaryAToken;
    const raw = accruedLendingAssets(
      item.lendingRaw,
      supplied,
      withdrawn,
      receipts,
      donations.some((log) => log.address.toLowerCase() === receiptAddress?.toLowerCase()),
      events.length,
    );
    const holdings = item.walletRaw + item.lendingRaw;
    if (interest !== null && raw !== null) {
      if (index === 0) interest += raw;
      else if (raw === BigInt(0)) {
      } else if (item.valueAssets !== null && holdings > BigInt(0))
        interest += (raw * item.valueAssets) / holdings;
      else interest = null;
    } else interest = null;
  }
  return {
    ...snapshot,
    history: partial ? [] : history,
    activity: activity.reverse(),
    historyPartial: partial || vaultLogs.length > eventLimit,
    interestAssets: interest,
    conversionAssets: partial ? null : conversion,
    attributionComplete: !partial && interest !== null,
  };
}
