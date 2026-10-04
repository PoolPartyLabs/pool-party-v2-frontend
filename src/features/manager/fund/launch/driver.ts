/**
 * @id PP-MGR-LIB-042 (POO-2177)
 * @name launchDriver
 * @implements-rules-version v3 (POO-2192)
 * @implements-rules-version v1 (POO-2208)
 * @implements-rules-version v1 (POO-2211)
 * Just-in-time API builders and receipt reconciliation. No wallet broadcast occurs on import.
 */

import Decimal from "decimal.js";
import { formatUnits, type TransactionReceipt } from "viem";
import { z } from "zod";
import { getCatalogPoolAction } from "@/lib/api/v2/actions";
import { V2DiscoveryPendingError } from "@/lib/api/v2/discovery";
import {
  buildCreateFundAction,
  buildLaunchCapitalAction,
  buildLaunchPositionAction,
  buildLaunchSwapAction,
  buildSpokeAction,
  discoverLaunchFundAction,
  putLaunchProfileAction,
  quoteLaunchBridgeAction,
  readLaunchBalancesAction,
  readLaunchFundAction,
  readLaunchPositionsAction,
  readLaunchProfileAction,
  readLaunchTransitAction,
} from "@/lib/api/v2/launchActions";
import {
  type CreateFundRequest,
  type LaunchTransaction,
  launchTransactionSchema,
} from "@/lib/api/v2/launchSchemas";
import { addressSchema, catalogPoolSchema } from "@/lib/api/v2/schemas";
import { positionAmounts } from "./composition";
import type { Checkpoint, LaunchDriver, LaunchJournal } from "./journal";
import { allocationRaw, type LaunchStep, validateTickAlignment } from "./plan";
import { canonicalProfile, type LaunchProfile, profileMessage } from "./profile";
import { decodeLaunchReceipt } from "./receipt";
import type { FundReview } from "./review";

export interface FrozenLaunch {
  request: CreateFundRequest;
  review: FundReview;
  plan?: import("./plan").CanvasPlan;
}
export interface LaunchWallet {
  send(transaction: LaunchTransaction): Promise<string>;
  receipt(chain: 42161 | 4663, hash: string): Promise<TransactionReceipt | null>;
  sign(message: string): Promise<string>;
}

function unwrap<Data>(
  result:
    | { ok: true; data: Data }
    | {
        ok: false;
        error: {
          code: string;
          status?: number;
          retryAfterSeconds?: number;
          progress?: import("@/lib/api/v2/discovery").DiscoveryProgress;
        };
      },
): Data {
  if (!result.ok) {
    if (result.error.code === "V2_DISCOVERY_PENDING")
      throw new V2DiscoveryPendingError(
        result.error.status,
        result.error.retryAfterSeconds,
        result.error.progress,
      );
    throw new Error(result.error.code);
  }
  return result.data;
}
function record(value: unknown): Record<string, unknown> {
  return z.record(z.unknown()).parse(value);
}
function tickPrice(
  tick: number | undefined,
  pool: import("@/lib/api/v2/schemas").CatalogPool,
): string {
  if (tick === undefined || !Number.isInteger(tick)) throw new Error("BUILD_EXECUTION_GAP");
  return new Decimal("1.0001")
    .pow(tick)
    .mul(new Decimal(10).pow((pool.tokens[0]?.decimals ?? 0) - (pool.tokens[1]?.decimals ?? 0)))
    .toFixed();
}
function coreOf(journal: LaunchJournal): string {
  return addressSchema.parse(journal.addresses.coreVault);
}
function createData(journal: LaunchJournal): Record<string, unknown> {
  return record(journal.checkpoints.create?.data?.provision);
}
function transaction(
  data: { transactions: LaunchTransaction[] },
  chain: 42161 | 4663,
  manager: string,
) {
  if (data.transactions.length !== 1) throw new Error("UNEXPECTED_TRANSACTIONS");
  const built = launchTransactionSchema.parse(data.transactions[0]);
  if (built.chainId !== chain || built.from.toLowerCase() !== manager || built.value !== "0")
    throw new Error("UNSAFE_TRANSACTION");
  return built;
}
function budget(step: LaunchStep, journal: LaunchJournal): bigint {
  const principal = step.group && step.kind !== "bridge" ? journal.arrival : journal.principal;
  if (!principal) throw new Error("PRINCIPAL_UNAVAILABLE");
  if (step.group && step.kind !== "bridge")
    return (BigInt(principal) * BigInt(step.sharePct ?? 0)) / BigInt(step.shareDenominator ?? 100);
  const allocate = journal.steps.find((entry) => entry.kind === "allocate");
  if (allocate && step.chain === 42161 && ["swap", "open"].includes(step.kind)) {
    const receipt = journal.checkpoints[allocate.id]?.data?.receipt;
    const allocated = receipt && record(receipt).allocated;
    if (typeof allocated !== "string" || !/^\d+$/.test(allocated))
      throw new Error("BALANCES_UNAVAILABLE");
    const net = BigInt(allocated);
    const share = allocate.sharePct ?? 0;
    if (share <= 0 || net !== allocationRaw(BigInt(principal), share))
      throw new Error("BALANCE_CHANGED");
    return (net * BigInt(step.sharePct ?? 0)) / BigInt(share);
  }
  return allocationRaw(BigInt(principal), step.sharePct ?? 0);
}
function swapOf(step: LaunchStep, journal: LaunchJournal) {
  return journal.steps.find(
    (entry) =>
      entry.kind === "swap" &&
      entry.chain === step.chain &&
      (entry.id === step.id ||
        (step.blockId ? entry.blockId === step.blockId : step.dependencies.includes(entry.id))),
  );
}
function conversion(step: LaunchStep, journal: LaunchJournal) {
  const swap = swapOf(step, journal);
  const checkpoint = swap && journal.checkpoints[swap.id];
  const data = checkpoint?.status === "confirmed" ? checkpoint.data?.receipt : undefined;
  if (!data || !record(data).swapped) return null;
  return z
    .object({
      tokenIn: addressSchema,
      tokenOut: addressSchema,
      amountIn: z.string().regex(/^\d+$/),
      amountOut: z.string().regex(/^\d+$/),
    })
    .parse(record(data).swapped);
}
function leafBalances(
  step: LaunchStep,
  journal: LaunchJournal,
  available: Record<string, bigint>,
  base: string,
) {
  const scoped = { ...available };
  const baseKey = base.toLowerCase();
  let reserved = BigInt(0);
  for (const sibling of journal.steps.filter(
    (entry) =>
      entry.kind === "open" &&
      entry.chain === step.chain &&
      entry.group === step.group &&
      entry.id !== step.id &&
      (!step.blockId || entry.blockId !== step.blockId) &&
      swapOf(entry, journal)?.id !== step.id &&
      !step.dependencies.includes(entry.id) &&
      journal.checkpoints[entry.id]?.status !== "confirmed",
  )) {
    const swapped = conversion(sibling, journal);
    const spent = swapped?.tokenIn.toLowerCase() === baseKey ? BigInt(swapped.amountIn) : BigInt(0);
    const planned = budget(sibling, journal);
    if (spent > planned) throw new Error("BALANCE_CHANGED");
    reserved += planned - spent;
    if (swapped) {
      if (swapped.tokenIn.toLowerCase() !== baseKey) throw new Error("BALANCE_CHANGED");
      const token = swapped.tokenOut.toLowerCase();
      scoped[token] = (scoped[token] ?? BigInt(0)) - BigInt(swapped.amountOut);
      if (scoped[token]! < BigInt(0)) throw new Error("BALANCE_CHANGED");
    }
  }
  scoped[baseKey] = (scoped[baseKey] ?? BigInt(0)) - reserved;
  if (scoped[baseKey]! < BigInt(0)) throw new Error("BALANCE_CHANGED");
  return scoped;
}
function remainderAmount(planned: bigint, available: bigint, step: LaunchStep): bigint {
  const toleranceBps = BigInt(Math.min(500, Math.max(step.config?.maxLossBps ?? 100, 100)));
  if (
    available <= BigInt(0) ||
    available * BigInt(10_000) < planned * (BigInt(10_000) - toleranceBps)
  )
    throw new Error("BALANCE_CHANGED");
  return available < planned ? available : planned;
}
async function balances(core: string, chain: 42161 | 4663): Promise<Record<string, bigint>> {
  const response = unwrap(await readLaunchBalancesAction(core, chain));
  if (response.balancesStatus !== "available") throw new Error("BALANCES_UNAVAILABLE");
  return Object.fromEntries(
    response.tokens.map((token) => {
      if (token.unallocatedBalance === null) throw new Error("BALANCES_UNAVAILABLE");
      return [token.token.toLowerCase(), BigInt(token.unallocatedBalance)];
    }),
  );
}
function launchProfile(journal: LaunchJournal): LaunchProfile {
  const frozen = journal.frozen as FrozenLaunch;
  const provision = createData(journal);
  const requests = record(provision.nextRequests);
  const fields = record(record(requests.profile).profileFields);
  const intent = z
    .object({
      broadMandate: z.boolean(),
      spokeCapPercent: z.number().nullable(),
      launchSnapshotId: z.string(),
    })
    .parse(fields);
  return {
    name: frozen.review.name,
    description: frozen.review.description,
    managerDisplayName: "",
    imageUrl: frozen.review.imageUrl,
    websiteUrl: "",
    socialLinks: {},
    tags: [],
    ...intent,
  };
}

export function createLaunchDriver(
  wallet: LaunchWallet,
  onSignature: (step: LaunchStep) => void = () => {},
): LaunchDriver {
  const driver: LaunchDriver = {
    async build(step, journal) {
      const frozen = journal.frozen as FrozenLaunch;
      if (step.kind === "approve" || step.kind === "create") {
        if (step.kind === "create") {
          for (const position of journal.steps.filter(
            (entry) => entry.protocol === "uniswap-v4" && entry.kind === "open",
          )) {
            const pool = catalogPoolSchema.parse(
              unwrap(
                await getCatalogPoolAction(
                  position.chain,
                  z.string().parse(position.config?.poolId),
                ),
              ),
            );
            validateTickAlignment(position.config ?? {}, pool.poolKey.tickSpacing);
          }
        }
        const provision = unwrap(await buildCreateFundAction(frozen.request));
        const approval = typeof provision.nextAction === "string";
        if (step.kind === "approve" && !approval) return { complete: true };
        if (step.kind === "create" && approval) throw new Error("ALLOWANCE_CHANGED");
        return { transaction: transaction(provision, 42161, journal.manager), data: { provision } };
      }
      const core = coreOf(journal);
      const from = journal.manager;
      const side = step.chain === 42161 ? ("hub" as const) : ("spoke" as const);
      if (step.kind === "discover") {
        const discovered = unwrap(await discoverLaunchFundAction({ core }));
        const identity = z
          .object({
            coreVault: addressSchema,
            manager: addressSchema,
            mandateHash: z.string(),
            chains: z.array(z.object({ chainId: z.string(), status: z.string() }).passthrough()),
          })
          .passthrough()
          .parse(discovered);
        if (
          identity.manager.toLowerCase() !== from ||
          identity.mandateHash.toLowerCase() !==
            String(createData(journal).mandateHash).toLowerCase()
        )
          throw new Error("DISCOVERY_MISMATCH");
        if (
          step.chain === 4663 &&
          !identity.chains.some((chain) => chain.chainId === "4663" && chain.status === "created")
        )
          return {};
        return { complete: true, data: { discovered } };
      }
      if (step.kind === "spoke") {
        const provision = createData(journal);
        const built = unwrap(
          await buildSpokeAction({
            from,
            creationNumber: provision.creationNumber,
            mandate: provision.mandate,
            mandateHash: provision.mandateHash,
          }),
        );
        return { transaction: transaction(built, 4663, from) };
      }
      if (step.kind === "profile") {
        const profile = launchProfile(journal);
        const current = unwrap(await readLaunchProfileAction(core));
        if (
          current.profile &&
          canonicalProfile(current.profile as unknown as LaunchProfile) ===
            canonicalProfile(profile)
        )
          return { complete: true };
        const nonce = crypto.randomUUID();
        const expiresAt = String(Math.floor(Date.now() / 1000) + 900);
        const signature = await wallet.sign(profileMessage(core, profile, nonce, expiresAt));
        onSignature(step);
        unwrap(
          await putLaunchProfileAction(core, {
            chainId: 42161,
            profile,
            nonce,
            expiresAt,
            signature,
          }),
        );
        return { complete: true };
      }
      if (step.kind === "report") {
        const fund = unwrap(await readLaunchFundAction(core));
        if (fund.lastReport !== null && fund.lastReport !== undefined) return { complete: true };
        return {};
      }
      if (step.kind === "arrival") {
        const transitId = z.string().parse(journal.checkpoints.bridge?.data?.transitId);
        const transit = unwrap(await readLaunchTransitAction(core, transitId));
        if (["expired", "refunded"].includes(transit.stage))
          throw new Error("BRIDGE_RECONCILIATION_REQUIRED");
        if (!transit.readyForNextStep || !transit.credited) return {};
        await balances(core, 4663);
        return { complete: true, data: { arrival: transit.credited } };
      }
      if (step.kind === "allocate" || step.kind === "bridge") {
        const amount = budget(step, journal).toString();
        if (step.kind === "bridge") unwrap(await quoteLaunchBridgeAction(core, amount));
        const built = unwrap(
          await buildLaunchCapitalAction(core, {
            action: step.kind === "allocate" ? "allocate-to-hub" : "send-to-spoke",
            from,
            side: "hub",
            amount,
            ...(step.kind === "bridge" ? { spokeIndex: 0, bridgeRank: 0, bridgeData: "0x" } : {}),
          }),
        );
        return { transaction: transaction(built, 42161, from) };
      }
      for (const entry of journal.steps.filter(
        (entry) =>
          (entry.kind === "allocate" && step.chain === 42161) ||
          (entry.kind === "swap" &&
            entry.chain === step.chain &&
            (entry.id === swapOf(step, journal)?.id ||
              journal.steps.some(
                (leaf) =>
                  leaf.kind === "open" &&
                  leaf.chain === step.chain &&
                  leaf.group === step.group &&
                  journal.checkpoints[leaf.id]?.status !== "confirmed" &&
                  swapOf(leaf, journal)?.id === entry.id,
              ))),
      )) {
        const checkpoint = journal.checkpoints[entry.id];
        const receipt = checkpoint?.data?.receipt;
        const field = entry.kind === "allocate" ? "allocated" : "swapped";
        if (
          checkpoint?.status === "confirmed" &&
          checkpoint.txHash &&
          (!receipt || !record(receipt)[field])
        ) {
          const mined = await wallet.receipt(entry.chain, checkpoint.txHash);
          if (!mined || mined.status !== "success") throw new Error("BALANCES_UNAVAILABLE");
          checkpoint.data = {
            ...checkpoint.data,
            receipt: { ...(receipt ? record(receipt) : {}), ...decodeLaunchReceipt(mined) },
          };
          if (!record(checkpoint.data.receipt)[field]) throw new Error("BALANCES_UNAVAILABLE");
        }
      }
      const actual = await balances(core, step.chain);
      const fund = unwrap(await readLaunchFundAction(core));
      const chains = z
        .array(
          z
            .object({
              chainId: z.string(),
              uniswapV4Adapter: addressSchema,
              aaveV3Adapter: addressSchema,
              spokeVault: addressSchema,
            })
            .passthrough(),
        )
        .parse(fund.chains);
      const chain = chains.find((entry) => entry.chainId === String(step.chain));
      if (!chain) throw new Error("CHAIN_UNAVAILABLE");
      const base = frozen.request.chains.find((entry) => entry.chainId === step.chain)?.tokens[0];
      if (!base) throw new Error("BASE_TOKEN_UNAVAILABLE");
      if (step.protocol === "aave-v3") {
        const asset = step.config?.assetKey?.split(":")[1];
        if (!asset || asset.toLowerCase() !== base.toLowerCase())
          throw new Error("UNSUPPORTED_AAVE_ASSET");
        const available = leafBalances(step, journal, actual, base);
        const amount = remainderAmount(
          budget(step, journal),
          available[base.toLowerCase()] ?? BigInt(0),
          step,
        );
        const built = unwrap(
          await buildLaunchPositionAction(core, {
            action: "open",
            from,
            side,
            adapter: chain.aaveV3Adapter,
            poolKey: `0x${asset.slice(2).padStart(64, "0")}`,
            amount: formatUnits(amount, 6),
          }),
        );
        return { transaction: transaction(built, step.chain, from) };
      }
      const pool = catalogPoolSchema.parse(
        unwrap(await getCatalogPoolAction(step.chain, z.string().parse(step.config?.poolId))),
      );
      validateTickAlignment(step.config ?? {}, pool.poolKey.tickSpacing);
      if (
        !pool.eligible ||
        pool.chainId !== String(step.chain) ||
        !frozen.request.chains
          .find((entry) => entry.chainId === step.chain)
          ?.uniswapV4PoolIds.includes(pool.poolId)
      )
        throw new Error("POOL_UNAVAILABLE");
      const available = leafBalances(step, journal, actual, base);
      const swapped = conversion(step, journal);
      if (
        swapped &&
        (swapped.tokenIn.toLowerCase() !== base.toLowerCase() ||
          swapped.tokenOut.toLowerCase() === base.toLowerCase() ||
          !pool.tokens.some(
            (token) => token.address.toLowerCase() === swapped.tokenOut.toLowerCase(),
          ))
      )
        throw new Error("BALANCE_CHANGED");
      if (swapped && BigInt(swapped.amountIn) > budget(step, journal))
        throw new Error("BALANCE_CHANGED");
      if (step.kind === "swap" && swapped) return { complete: true };
      const amounts = positionAmounts(
        pool,
        available,
        budget(step, journal),
        base,
        step.config?.priceLower ?? tickPrice(step.config?.tickLower, pool),
        step.config?.priceUpper ?? tickPrice(step.config?.tickUpper, pool),
        BigInt(swapped?.amountIn ?? "0"),
      );
      if (step.kind === "swap") {
        if (amounts.swapRaw === BigInt(0)) return { complete: true };
        const swapRaw = remainderAmount(
          amounts.swapRaw,
          available[base.toLowerCase()] ?? BigInt(0),
          step,
        );
        const built = unwrap(
          await buildLaunchSwapAction({
            core,
            side,
            tokenIn: base,
            tokenOut: amounts.otherToken,
            amountIn: swapRaw.toString(),
            maxLossBps: step.config?.maxLossBps,
          }),
        );
        return { transaction: transaction(built, step.chain, from) };
      }
      if (new Decimal(amounts.amount0).isZero() && new Decimal(amounts.amount1).isZero())
        throw new Error("BALANCE_CHANGED");
      const loss = new Decimal(10_000 - (step.config?.maxLossBps ?? 100)).div(10_000);
      const built = unwrap(
        await buildLaunchPositionAction(core, {
          action: "open",
          from,
          side,
          adapter: chain.uniswapV4Adapter,
          poolKey: pool.poolId,
          amount0: amounts.amount0,
          amount1: amounts.amount1,
          priceLower: step.config?.priceLower,
          priceUpper: step.config?.priceUpper,
          tickLower: step.config?.tickLower,
          tickUpper: step.config?.tickUpper,
          amount0Min: new Decimal(amounts.amount0)
            .mul(loss)
            .toFixed(pool.tokens[0]?.decimals ?? 6, Decimal.ROUND_DOWN),
          amount1Min: new Decimal(amounts.amount1)
            .mul(loss)
            .toFixed(pool.tokens[1]?.decimals ?? 6, Decimal.ROUND_DOWN),
        }),
      );
      return { transaction: transaction(built, step.chain, from) };
    },
    async send(step, input) {
      const built = launchTransactionSchema.parse(input);
      if (built.chainId !== step.chain) throw new Error("UNSAFE_TRANSACTION");
      const hash = await wallet.send(built);
      onSignature(step);
      return hash;
    },
    async receipt(chain, hash) {
      const receipt = await wallet.receipt(chain, hash);
      if (!receipt) return { status: "unknown" };
      return { status: receipt.status, data: { receipt: decodeLaunchReceipt(receipt) } };
    },
    async reconcile(step, checkpoint, journal) {
      if (step.kind === "profile") {
        const current = unwrap(await readLaunchProfileAction(coreOf(journal)));
        return (
          current.profile !== null &&
          canonicalProfile(current.profile as unknown as LaunchProfile) ===
            canonicalProfile(launchProfile(journal))
        );
      }
      if (
        step.kind === "create" &&
        !checkpoint.txHash &&
        (checkpoint.status === "signing" ||
          checkpoint.error === "SUBMISSION_RECONCILIATION_REQUIRED")
      )
        throw new Error("SUBMISSION_RECONCILIATION_REQUIRED");
      return false;
    },
    async complete(step, checkpoint, journal) {
      if (step.kind === "open") {
        const positionKey = z
          .object({ positionKey: z.string().regex(/^0x[0-9a-fA-F]{64}$/) })
          .parse(checkpoint.data?.receipt).positionKey;
        const positions = unwrap(await readLaunchPositionsAction(coreOf(journal)));
        if (
          !positions.positions.some(
            (position) =>
              String(position.chainId) === String(step.chain) &&
              position.positionKey.toLowerCase() === positionKey.toLowerCase() &&
              !["closed", "exited"].includes(position.status.toLowerCase()),
          )
        )
          throw new V2DiscoveryPendingError(409, 2);
      }
      if (step.kind === "create") {
        const provision = record(checkpoint.data?.provision);
        const receipt = z
          .object({
            seeded: z.object({
              core: addressSchema,
              manager: addressSchema,
              principal: z.string(),
            }),
          })
          .parse(checkpoint.data?.receipt);
        const predicted = record(provision.predictedAddresses);
        if (
          receipt.seeded.core.toLowerCase() !== String(predicted.coreVault).toLowerCase() ||
          receipt.seeded.manager.toLowerCase() !== journal.manager
        )
          throw new Error("CREATION_RECEIPT_MISMATCH");
        journal.principal = receipt.seeded.principal;
        journal.addresses.coreVault = receipt.seeded.core;
      }
      if (step.kind === "bridge") {
        const receipt = z.object({ transitId: z.string() }).parse(checkpoint.data?.receipt);
        checkpoint.data = { ...checkpoint.data, transitId: receipt.transitId };
      }
      if (step.kind === "arrival") journal.arrival = z.string().parse(checkpoint.data?.arrival);
    },
  };
  return driver;
}
