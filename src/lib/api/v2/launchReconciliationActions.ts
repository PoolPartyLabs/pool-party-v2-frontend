/**
 * @id PP-MGR-ACT-014
 * @name Launch submission candidate reads (POO-2222)
 * @implements-rules-version v1
 */
"use server";

import "server-only";
import { createPublicClient, http } from "viem";
import { z } from "zod";
import { apiFetch } from "@/lib/api/client";
import { getAuthHeader, getSessionWallet } from "@/lib/auth/session";
import { getChainById } from "@/lib/chains";
import { isFeatureEnabled } from "@/lib/features";
import { ApiError } from "../errors";
import { launchFetch } from "./launch";
import { addressSchema, chainIdSchema, poolIdSchema } from "./schemas";

const blockSchema = z.string().regex(/^\d{1,78}$/);
const inputSchema = z
  .object({
    chainId: chainIdSchema,
    address: addressSchema,
    fromBlock: blockSchema.optional(),
    mode: z.enum(["api", "rpc"]),
    preCreation: z.boolean().optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.mode === "rpc" && (!input.fromBlock || BigInt(input.fromBlock) === BigInt(0)))
      context.addIssue({ code: z.ZodIssueCode.custom, message: "RPC lower bound required" });
  });

export type LaunchSubmissionCandidatesInput = z.infer<typeof inputSchema>;

const version = { protocolVersion: z.literal("v2") };
const wireChainSchema = z.enum(["42161", "4663"]);
const legSchema = z.object({
  ...version,
  transactionHash: poolIdSchema,
  blockNumber: blockSchema,
  timestamp: z.string().datetime(),
});
const legNames = z.enum([
  "sent",
  "deposited",
  "filled",
  "credited",
  "acknowledged",
  "acknowledgementPublished",
  "expired",
  "refunded",
]);
const transitSchema = z.object({
  ...version,
  core: addressSchema,
  sourceChainId: wireChainSchema,
  destinationChainId: wireChainSchema,
  legs: z.record(legNames, legSchema.nullable()),
});
const pageSchema = z.object({
  ...version,
  items: z.array(transitSchema).max(50),
  coverage: z
    .array(
      z.object({
        ...version,
        chainId: wireChainSchema,
        nextBlock: blockSchema,
        headBlock: blockSchema,
        complete: z.boolean(),
      }),
    )
    .max(2)
    .default([]),
  nextCursor: z
    .string()
    .regex(/^\d{1,78}:0x[0-9a-f]{64}$/)
    .nullable(),
});

type BoundedRead = <Result>(read: () => Promise<Result>) => Promise<Result>;

function createBoundedRead(deadline: number): BoundedRead {
  return async (read) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0)
      throw new ApiError(503, "V2_RECONCILIATION_INCOMPLETE", "incomplete candidate scan");
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        read(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new ApiError(503, "V2_RECONCILIATION_INCOMPLETE", "incomplete candidate scan"),
              ),
            remaining,
          );
        }),
      ]);
      if (Date.now() >= deadline)
        throw new ApiError(503, "V2_RECONCILIATION_INCOMPLETE", "incomplete candidate scan");
      return result;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  };
}

async function authorize(core: string, preCreation: boolean, boundedRead: BoundedRead) {
  if (!isFeatureEnabled("fundContracts"))
    throw new ApiError(404, "V2_UNAVAILABLE", "not available");
  const wallet = await boundedRead(() => getSessionWallet());
  if (!wallet || !addressSchema.safeParse(wallet).success)
    throw new ApiError(401, "V2_UNAUTHORIZED", "unauthorized");
  const headers = await boundedRead(() => getAuthHeader());
  if (!headers.Authorization) throw new ApiError(401, "V2_UNAUTHORIZED", "unauthorized");
  try {
    const identity = await boundedRead(() =>
      apiFetch("users/me", {
        headers,
        schema: z.object({ walletAddress: addressSchema }),
      }),
    );
    if (!identity || identity.walletAddress.toLowerCase() !== wallet.toLowerCase())
      throw new Error("identity mismatch");
  } catch (error) {
    if (error instanceof ApiError && error.code === "V2_RECONCILIATION_INCOMPLETE") throw error;
    throw new ApiError(401, "V2_UNAUTHORIZED", "unauthorized");
  }
  if (preCreation) return;
  const fund = await boundedRead(() =>
    launchFetch(
      `/funds/${core}`,
      "GET",
      z.object({
        ...version,
        manager: addressSchema,
      }),
    ),
  );
  if (fund.manager.toLowerCase() !== wallet.toLowerCase())
    throw new ApiError(403, "V2_NOT_MANAGER", "not manager");
}

async function apiCandidates(
  core: string,
  input: LaunchSubmissionCandidatesInput,
  boundedRead: BoundedRead,
) {
  const hashes = new Set<string>();
  const cursors = new Set<string>();
  const fromBlock = input.fromBlock === undefined ? undefined : BigInt(input.fromBlock);
  let cursor: string | undefined;
  for (let pageIndex = 0; pageIndex < 5; pageIndex++) {
    const page = await boundedRead(() =>
      launchFetch(`/funds/${core}/transits`, "GET", pageSchema, undefined, false, {
        limit: "50",
        ...(cursor ? { cursor } : {}),
      }),
    );
    const coverage = (page.coverage ?? []).filter(
      (entry) => entry.chainId === String(input.chainId),
    );
    const relevantCoverage = coverage[0];
    if (
      coverage.length !== 1 ||
      !relevantCoverage ||
      !relevantCoverage.complete ||
      BigInt(relevantCoverage.nextBlock) <= BigInt(relevantCoverage.headBlock)
    )
      throw new ApiError(503, "V2_RECONCILIATION_INCOMPLETE", "incomplete candidate scan");
    for (const transit of page.items) {
      if (transit.core.toLowerCase() !== core.toLowerCase()) continue;
      for (const [name, leg] of Object.entries(transit.legs)) {
        if (!leg) continue;
        const chain = ["filled", "credited", "acknowledgementPublished"].includes(name)
          ? transit.destinationChainId
          : transit.sourceChainId;
        if (chain !== String(input.chainId)) continue;
        if (fromBlock !== undefined && BigInt(leg.blockNumber) < fromBlock) continue;
        hashes.add(leg.transactionHash.toLowerCase());
        if (hashes.size > 250)
          throw new ApiError(503, "V2_RECONCILIATION_INCOMPLETE", "incomplete candidate scan");
      }
    }
    if (!page.nextCursor) return { hashes: [...hashes] };
    if (cursors.has(page.nextCursor))
      throw new ApiError(503, "V2_RECONCILIATION_INCOMPLETE", "incomplete candidate scan");
    cursors.add(page.nextCursor);
    cursor = page.nextCursor;
  }
  throw new ApiError(503, "V2_RECONCILIATION_INCOMPLETE", "incomplete candidate scan");
}

async function rpcCandidates(input: LaunchSubmissionCandidatesInput) {
  const chain = getChainById(input.chainId);
  if (!chain) throw new ApiError(503, "V2_UNAVAILABLE", "unavailable");
  const controller = new AbortController();
  const deadline = Date.now() + 20_000;
  async function boundedRead<Result>(read: () => Promise<Result>): Promise<Result> {
    const remaining = deadline - Date.now();
    if (remaining <= 0)
      throw new ApiError(503, "V2_RECONCILIATION_INCOMPLETE", "incomplete candidate scan");
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        read(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            reject(new ApiError(503, "V2_RECONCILIATION_INCOMPLETE", "incomplete candidate scan"));
            controller.abort();
          }, remaining);
        }),
      ]);
      if (Date.now() >= deadline)
        throw new ApiError(503, "V2_RECONCILIATION_INCOMPLETE", "incomplete candidate scan");
      return result;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
  const client = createPublicClient({
    chain,
    transport: http(undefined, {
      timeout: 10_000,
      retryCount: 0,
      fetchOptions: { signal: controller.signal },
    }),
  });
  const hashes = new Set<string>();
  const fromBlock = BigInt(input.fromBlock as string);
  try {
    const head = await boundedRead(() => client.getBlockNumber({ cacheTime: 0 }));
    const maximum = fromBlock + BigInt(1999);
    if (head > maximum)
      throw new ApiError(503, "V2_RECONCILIATION_INCOMPLETE", "incomplete candidate scan");
    const toBlock = head < maximum ? head : maximum;
    for (let start = fromBlock; start <= toBlock; start += BigInt(10)) {
      const end = start + BigInt(9) < toBlock ? start + BigInt(9) : toBlock;
      const logs = await boundedRead(() =>
        client.getLogs({
          address: input.address as `0x${string}`,
          fromBlock: start,
          toBlock: end,
        }),
      );
      for (const log of logs) {
        if (log.removed || log.address.toLowerCase() !== input.address.toLowerCase()) continue;
        if (poolIdSchema.safeParse(log.transactionHash).success)
          hashes.add((log.transactionHash as string).toLowerCase());
        if (hashes.size > 250)
          throw new ApiError(503, "V2_RECONCILIATION_INCOMPLETE", "incomplete candidate scan");
      }
      if (Date.now() >= deadline)
        throw new ApiError(503, "V2_RECONCILIATION_INCOMPLETE", "incomplete candidate scan");
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(503, "V2_UNAVAILABLE", "unavailable");
  } finally {
    controller.abort();
  }
  return { hashes: [...hashes] };
}

export async function readLaunchSubmissionCandidatesAction(core: string, input: unknown) {
  const boundedRead = createBoundedRead(Date.now() + 20_000);
  try {
    addressSchema.parse(core);
    const request = inputSchema.parse(input);
    await authorize(core, request.preCreation === true, boundedRead);
    if (request.preCreation && request.mode === "api")
      return { ok: true as const, data: { hashes: [] as string[] } };
    const data =
      request.mode === "api"
        ? await apiCandidates(core, request, boundedRead)
        : await rpcCandidates(request);
    return { ok: true as const, data };
  } catch (error) {
    return {
      ok: false as const,
      error: {
        status: error instanceof ApiError ? error.status : error instanceof z.ZodError ? 400 : 503,
        code:
          error instanceof ApiError
            ? error.code
            : error instanceof z.ZodError
              ? "V2_INVALID_REQUEST"
              : "V2_UNAVAILABLE",
      },
    };
  }
}
