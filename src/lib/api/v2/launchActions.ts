/**
 * @id PP-MGR-ACT-013 (POO-2177)
 * @name v2LaunchActions
 * @implements-rules-version v1
 * Session-authorized launch builders. No secrets or upstream errors cross this boundary.
 */
"use server";
import { z } from "zod";
import { apiFetch } from "@/lib/api/client";
import { getAuthHeader, getSessionWallet } from "@/lib/auth/session";
import { isFeatureEnabled } from "@/lib/features";
import { ApiError } from "../errors";
import { launchFetch } from "./launch";
import {
  balancesSchema,
  createRequestSchema,
  genericBuildSchema,
  openPositionSchema,
  swapRequestSchema,
  transactionsSchema,
  transitSchema,
  versionedRecordSchema,
} from "./launchSchemas";
import { addressSchema, poolIdSchema } from "./schemas";

const reportTriggers = new Map<string, number>();
async function result<ResponseData>(work: () => Promise<ResponseData>) {
  try {
    return { ok: true as const, data: await work() };
  } catch (error) {
    return {
      ok: false as const,
      error: {
        status: error instanceof ApiError ? error.status : 400,
        code: error instanceof ApiError ? error.code : "V2_INVALID_REQUEST",
      },
    };
  }
}
async function session(from?: string): Promise<string> {
  if (!isFeatureEnabled("fundContracts"))
    throw new ApiError(404, "V2_UNAVAILABLE", "not available");
  const wallet = await getSessionWallet();
  if (!wallet || (from && wallet !== from.toLowerCase()))
    throw new ApiError(401, "V2_UNAUTHORIZED", "unauthorized");
  const headers = await getAuthHeader();
  if (!headers.Authorization) throw new ApiError(401, "V2_UNAUTHORIZED", "unauthorized");
  try {
    const owner = await apiFetch("users/me", {
      headers,
      schema: z.object({ walletAddress: addressSchema }),
    });
    if (!owner || owner.walletAddress.toLowerCase() !== wallet)
      throw new Error("identity mismatch");
  } catch {
    throw new ApiError(401, "V2_UNAUTHORIZED", "unauthorized");
  }
  return wallet;
}
async function manager(core: string): Promise<string> {
  addressSchema.parse(core);
  const wallet = await session();
  const fund = await launchFetch(
    `/funds/${core}`,
    "GET",
    versionedRecordSchema.extend({ manager: addressSchema }),
  );
  if (fund.manager.toLowerCase() !== wallet)
    throw new ApiError(403, "V2_NOT_MANAGER", "not manager");
  return wallet;
}
function cleanMetadata(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cleanMetadata);
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => key !== "protocolVersion")
        .map(([key, entry]) => [key, cleanMetadata(entry)]),
    );
  return value;
}

export async function buildCreateFundAction(input: unknown) {
  return result(async () => {
    const body = createRequestSchema.parse(input);
    await session(body.manager);
    const data = await launchFetch(
      "/funds/build-create",
      "POST",
      transactionsSchema.extend({
        creationNumber: z.string(),
        mandate: z.record(z.unknown()),
        mandateHash: poolIdSchema,
        predictedAddresses: z.record(z.unknown()),
        nextRequests: z.record(z.unknown()),
      }),
      body,
    );
    return {
      ...data,
      mandate: cleanMetadata(data.mandate),
      nextRequests: cleanMetadata(data.nextRequests),
    };
  });
}
export async function buildSpokeAction(input: unknown) {
  return result(async () => {
    const body = z
      .object({
        from: addressSchema,
        creationNumber: z.string().regex(/^[1-9]\d*$/),
        mandate: z.record(z.unknown()),
        mandateHash: poolIdSchema,
      })
      .strict()
      .parse(input);
    await session(body.from);
    return launchFetch("/funds/build-spoke", "POST", transactionsSchema, body);
  });
}
export async function discoverLaunchFundAction(input: unknown) {
  return result(async () => {
    const body = z
      .union([
        z.object({ txHash: poolIdSchema }).strict(),
        z.object({ core: addressSchema }).strict(),
      ])
      .parse(input);
    await session();
    return launchFetch("/funds/discover", "POST", versionedRecordSchema, body);
  });
}
export async function readLaunchFundAction(core: string) {
  return result(async () => {
    await manager(core);
    return launchFetch(`/funds/${core}`, "GET", versionedRecordSchema);
  });
}
export async function buildLaunchCapitalAction(core: string, input: unknown) {
  return result(async () => {
    const body = genericBuildSchema.parse(input);
    const wallet = await manager(core);
    if (body.from.toLowerCase() !== wallet)
      throw new ApiError(403, "V2_NOT_MANAGER", "not manager");
    return launchFetch(`/funds/${core}/build`, "POST", transactionsSchema, body);
  });
}
export async function buildLaunchPositionAction(core: string, input: unknown) {
  return result(async () => {
    const body = openPositionSchema.parse(input);
    const wallet = await manager(core);
    if (body.from.toLowerCase() !== wallet)
      throw new ApiError(403, "V2_NOT_MANAGER", "not manager");
    return launchFetch(`/funds/${core}/positions/build`, "POST", transactionsSchema, body);
  });
}
export async function buildLaunchSwapAction(input: unknown) {
  return result(async () => {
    const body = swapRequestSchema.parse(input);
    const from = await manager(body.core);
    return launchFetch(
      `/funds/${body.core}/build-swap`,
      "POST",
      transactionsSchema,
      {
        action: "swap",
        from,
        side: body.side,
        tokenIn: body.tokenIn,
        tokenOut: body.tokenOut,
        amount: body.amountIn,
        maxLossBps: body.maxLossBps,
      },
      true,
    );
  });
}
export async function quoteLaunchBridgeAction(core: string, amount: string) {
  return result(async () => {
    await manager(core);
    z.string()
      .regex(/^[1-9]\d{0,77}$/)
      .parse(amount);
    return launchFetch(`/funds/${core}/bridge-quote`, "POST", versionedRecordSchema, {
      direction: "hub-to-spoke",
      amount,
      bridgeRank: 0,
    });
  });
}
export async function quoteLaunchSwapAction(input: unknown) {
  return result(async () => {
    const body = swapRequestSchema.parse(input);
    await manager(body.core);
    return launchFetch(
      `/funds/${body.core}/swap/quote`,
      "GET",
      versionedRecordSchema,
      undefined,
      false,
      {
        side: body.side,
        tokenIn: body.tokenIn,
        tokenOut: body.tokenOut,
        amountIn: body.amountIn,
        maxLossBps: String(body.maxLossBps),
      },
    );
  });
}
export async function readLaunchBalancesAction(core: string, chain: 42161 | 4663) {
  return result(async () => {
    await manager(core);
    z.union([z.literal(42161), z.literal(4663)]).parse(chain);
    return launchFetch(`/funds/${core}/spokes/${chain}/balances`, "GET", balancesSchema);
  });
}
export async function readLaunchTransitAction(core: string, transitId: string) {
  return result(async () => {
    await manager(core);
    poolIdSchema.parse(transitId);
    return launchFetch(`/funds/${core}/transits/${transitId}`, "GET", transitSchema);
  });
}
export async function triggerLaunchReportAction(core: string) {
  return result(async () => {
    const wallet = await manager(core);
    const key = `${wallet}:${core.toLowerCase()}`;
    const now = Date.now();
    for (const [entry, timestamp] of reportTriggers)
      if (now - timestamp >= 60_000) reportTriggers.delete(entry);
    if (reportTriggers.has(key) || reportTriggers.size >= 1000)
      throw new ApiError(429, "V2_RATE_LIMITED", "rate limited");
    reportTriggers.set(key, now);
    return launchFetch(
      `/funds/${core}/report`,
      "POST",
      versionedRecordSchema.extend({ jobId: z.string().uuid() }),
      undefined,
      true,
    );
  });
}
export async function readLaunchReportAction(core: string, jobId: string) {
  return result(async () => {
    await manager(core);
    z.string().uuid().parse(jobId);
    const job = await launchFetch(
      `/report-jobs/${jobId}`,
      "GET",
      versionedRecordSchema.extend({
        core: addressSchema,
        status: z.enum(["pending", "delivered", "expired", "failed"]),
      }),
      undefined,
      true,
    );
    if (job.core.toLowerCase() !== core.toLowerCase())
      throw new ApiError(403, "V2_NOT_MANAGER", "not manager");
    return { status: job.status };
  });
}
export async function readLaunchProfileAction(core: string) {
  return result(async () => {
    await manager(core);
    return launchFetch(
      `/funds/${core}/profile`,
      "GET",
      versionedRecordSchema.extend({ profile: z.record(z.unknown()).nullable() }),
    );
  });
}
export async function putLaunchProfileAction(core: string, input: unknown) {
  return result(async () => {
    await manager(core);
    const body = z
      .object({
        chainId: z.literal(42161),
        profile: z.record(z.unknown()),
        nonce: z.string().min(8).max(128),
        expiresAt: z.string().regex(/^\d+$/),
        signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/),
      })
      .strict()
      .parse(input);
    return launchFetch(`/funds/${core}/profile`, "PUT", versionedRecordSchema, body);
  });
}
