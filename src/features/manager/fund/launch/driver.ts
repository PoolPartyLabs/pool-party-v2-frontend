/**
 * @id PP-MGR-LIB-031 (POO-2172)
 * @name launchDriver
 * @implements-rules-version v1
 * Just-in-time API builders and receipt reconciliation. No wallet broadcast occurs on import.
 */

import Decimal from "decimal.js";
import { formatUnits, type TransactionReceipt } from "viem";
import { z } from "zod";
import { getCatalogPoolAction } from "@/lib/api/v2/actions";
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
  readLaunchProfileAction,
  readLaunchReportAction,
  readLaunchTransitAction,
  triggerLaunchReportAction,
} from "@/lib/api/v2/launchActions";
import {
  type CreateFundRequest,
  type LaunchTransaction,
  launchTransactionSchema,
} from "@/lib/api/v2/launchSchemas";
import { addressSchema, catalogPoolSchema } from "@/lib/api/v2/schemas";
import { positionAmounts } from "./composition";
import type { Checkpoint, LaunchDriver, LaunchJournal } from "./journal";
import { allocationRaw, type LaunchStep } from "./plan";
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
  result: { ok: true; data: Data } | { ok: false; error: { code: string } },
): Data {
  if (!result.ok) throw new Error(result.error.code);
  return result.data;
}
function record(value: unknown): Record<string, unknown> {
  return z.record(z.unknown()).parse(value);
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
  return allocationRaw(BigInt(principal), step.sharePct ?? 0);
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

export function createLaunchDriver(wallet: LaunchWallet): LaunchDriver {
  const driver: LaunchDriver = {
    async build(step, journal) {
      const frozen = journal.frozen as FrozenLaunch;
      if (step.kind === "approve" || step.kind === "create") {
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
        const jobId = journal.checkpoints[step.id]?.data?.jobId;
        if (typeof jobId === "string") {
          const job = unwrap(await readLaunchReportAction(core, jobId));
          if (job.status === "failed" || job.status === "expired") {
            const checkpoint = journal.checkpoints[step.id];
            if (checkpoint?.data) delete checkpoint.data.jobId;
            throw new Error("REPORT_FAILED");
          }
          return { data: { jobId } };
        }
        const job = unwrap(await triggerLaunchReportAction(core));
        return { data: { jobId: job.jobId } };
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
      const available = await balances(core, step.chain);
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
        const amount = budget(step, journal);
        if ((available[base.toLowerCase()] ?? BigInt(0)) < amount)
          throw new Error("BALANCE_CHANGED");
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
      if (
        !pool.eligible ||
        pool.chainId !== String(step.chain) ||
        !frozen.request.chains
          .find((entry) => entry.chainId === step.chain)
          ?.uniswapV4PoolIds.includes(pool.poolId)
      )
        throw new Error("POOL_UNAVAILABLE");
      const amounts = positionAmounts(
        pool,
        available,
        budget(step, journal),
        base,
        z.string().parse(step.config?.priceLower),
        z.string().parse(step.config?.priceUpper),
      );
      if (step.kind === "swap") {
        if (amounts.swapRaw === BigInt(0)) return { complete: true };
        if ((available[base.toLowerCase()] ?? BigInt(0)) < amounts.swapRaw)
          throw new Error("BALANCE_CHANGED");
        const built = unwrap(
          await buildLaunchSwapAction({
            core,
            side,
            tokenIn: base,
            tokenOut: amounts.otherToken,
            amountIn: amounts.swapRaw.toString(),
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
      return wallet.send(built);
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
