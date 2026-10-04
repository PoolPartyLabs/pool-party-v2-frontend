/**
 * @id PP-MGR-LIB-056 (POO-2228)
 * @name manageActions
 * @implements-rules-version v1
 * @implements-rules-version v1 (POO-2226 manager-only fund reads)
 * @analytics-events none, server read boundary; Manage owns the blocked-intent event.
 * Review remains unavailable until principal provenance, costs and continuation are served.
 */
"use server";
import { z } from "zod";
import { apiFetch } from "@/lib/api/client";
import { getAuthHeader, getSessionWallet } from "@/lib/auth/session";
import { isFeatureEnabled } from "@/lib/features";
import { isMockMode } from "@/lib/services";
import { mockFund, mockSpokeBalances, mockWallet } from "@/mocks/data/v2Funds";
import { ApiError, ApiParseError } from "../errors";
import { v2Fetch } from "./client";
import {
  balancesSchema,
  type FundBalances,
  type FundView,
  fundViewSchema,
  positionsSchema,
} from "./fundSchemas";
import { readBalances, readFund, readPositions } from "./funds";
import {
  MANAGE_MOVE_RANGE_MISSING,
  type ManageActionResult,
  type ManageMoveRangeReview,
  type ManagePosition,
  manageMoveRangeDraftSchema,
  managePositionDetailSchema,
} from "./manageSchemas";
import { addressSchema, chainIdSchema, poolIdSchema } from "./schemas";

const fundSchema = z.object({
  protocolVersion: z.literal("v2"),
  coreVault: addressSchema,
  manager: addressSchema,
  chains: z.array(
    z.object({
      protocolVersion: z.literal("v2"),
      chainId: z.enum(["42161", "4663"]),
      spokeVault: addressSchema,
      status: z.enum(["created", "pending"]),
    }),
  ),
});
const same = (left: string, right: string) => left.toLowerCase() === right.toLowerCase();

/** Stable action errors never expose RPC details, tokens or upstream error text/codes. */
async function result<T>(read: () => Promise<T>): Promise<ManageActionResult<T>> {
  try {
    return { ok: true, data: await read() };
  } catch (error) {
    if (error instanceof ApiParseError)
      return { ok: false, error: { status: 502, code: "V2_INVALID_RESPONSE" } };
    if (error instanceof z.ZodError)
      return { ok: false, error: { status: 400, code: "V2_INVALID_REQUEST" } };
    const status = error instanceof ApiError ? error.status || 503 : 502;
    const allowed = new Set([
      "V2_INVALID_REQUEST",
      "V2_INVALID_RESPONSE",
      "V2_UNAUTHORIZED",
      "V2_NOT_MANAGER",
      "V2_POSITION_UNAVAILABLE",
      "V2_RANGE_INVALID",
      "V2_RANGE_UNCHANGED",
    ]);
    const code =
      error instanceof ApiError && allowed.has(error.code)
        ? error.code
        : status === 409
          ? "V2_CONFLICT"
          : status === 429
            ? "V2_RATE_LIMITED"
            : status === 401
              ? "V2_UNAUTHORIZED"
              : status === 404
                ? "V2_UNAVAILABLE"
                : status >= 500 || status === 408
                  ? "V2_UNAVAILABLE"
                  : "V2_INVALID_RESPONSE";
    return { ok: false, error: { status, code } };
  }
}

async function verifiedManagerWallet(): Promise<string> {
  if (!isFeatureEnabled("fundContracts")) throw new ApiError(404, "V2_UNAVAILABLE", "unavailable");
  const wallet = await getSessionWallet();
  if (!wallet || !addressSchema.safeParse(wallet).success)
    throw new ApiError(401, "V2_UNAUTHORIZED", "unauthorized");
  const headers = await getAuthHeader();
  if (!headers.Authorization) throw new ApiError(401, "V2_UNAUTHORIZED", "unauthorized");
  try {
    const owner = await apiFetch("users/me", {
      headers,
      schema: z.object({ walletAddress: addressSchema }),
    });
    if (!owner || !same(owner.walletAddress, wallet)) throw new Error("identity mismatch");
  } catch {
    throw new ApiError(401, "V2_UNAUTHORIZED", "unauthorized");
  }
  return wallet;
}

function assertFundOwner(
  fund: { coreVault: string; manager: string },
  core: string,
  wallet: string,
): void {
  if (!same(fund.coreVault, core)) throw new ApiError(502, "V2_INVALID_RESPONSE", "invalid fund");
  if (!same(fund.manager, wallet)) throw new ApiError(403, "V2_NOT_MANAGER", "not manager");
}

async function authorizedPosition(
  core: string,
  chain: number,
  key: string,
): Promise<ManagePosition> {
  addressSchema.parse(core);
  chainIdSchema.parse(chain);
  poolIdSchema.parse(key);
  const wallet = await verifiedManagerWallet();
  // PP-INTEGRATION-POINT: exact v2 fund identity and chain-vault ownership, no mock metadata fallback.
  const fund = await v2Fetch(`/funds/${core}`, fundSchema);
  assertFundOwner(fund, core, wallet);
  const vault = fund.chains.find((entry) => entry.chainId === String(chain));
  if (vault?.status !== "created")
    throw new ApiError(409, "V2_POSITION_UNAVAILABLE", "position unavailable");
  // PP-INTEGRATION-POINT: served position DTO carries canonical pool metadata and holdings.
  let detail: z.infer<typeof managePositionDetailSchema>;
  try {
    detail = await v2Fetch(`/funds/${core}/positions/${chain}/${key}`, managePositionDetailSchema);
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof ApiParseError)
      throw new ApiError(502, "V2_INVALID_RESPONSE", "invalid position");
    throw error;
  }
  const position = detail.position;
  if (!position) throw new ApiError(404, "V2_POSITION_UNAVAILABLE", "position unavailable");
  if (
    !same(position.positionKey, key) ||
    position.chainId !== String(chain) ||
    !same(position.spokeVault, vault.spokeVault)
  )
    throw new ApiError(502, "V2_INVALID_RESPONSE", "invalid position identity");
  return position;
}

export async function loadManagePositionAction(
  core: string,
  chain: number,
  key: string,
): Promise<ManageActionResult<{ position: ManagePosition }>> {
  return result(async () => ({ position: await authorizedPosition(core, chain, key) }));
}

export async function loadManageFundAction(
  core: string,
): Promise<ManageActionResult<{ fund: FundView; wallet: string; balances: FundBalances[] }>> {
  return result(async () => {
    addressSchema.parse(core);
    if (!isFeatureEnabled("fundContracts"))
      throw new ApiError(404, "V2_UNAVAILABLE", "unavailable");
    if (isMockMode) {
      assertFundOwner(mockFund, core, mockWallet);
      return {
        fund: fundViewSchema.parse(mockFund),
        wallet: mockWallet,
        balances: mockSpokeBalances.map((balance) => balancesSchema.parse(balance)),
      };
    }
    const wallet = await verifiedManagerWallet();
    // PP-INTEGRATION-POINT: manager fund view never depends on a holder read or transit availability.
    let fund: FundView;
    try {
      fund = fundViewSchema.parse(await readFund(core));
    } catch (error) {
      if (error instanceof z.ZodError)
        throw new ApiError(502, "V2_INVALID_RESPONSE", "invalid fund");
      throw error;
    }
    assertFundOwner(fund, core, wallet);
    if (fund.positionsSummary === undefined) {
      try {
        fund = { ...fund, positionsSummary: positionsSchema.parse(await readPositions(core)) };
      } catch (error) {
        if (error instanceof z.ZodError)
          throw new ApiError(502, "V2_INVALID_RESPONSE", "invalid positions");
        throw error;
      }
    }
    // PP-INTEGRATION-POINT: a chain's missing balance cannot erase valid fund positions.
    const results = await Promise.allSettled(
      fund.chains
        .filter((chain) => chain.status === "created")
        .map(async (chain) => {
          const balance = balancesSchema.parse(await readBalances(core, Number(chain.chainId)));
          if (balance.chainId !== chain.chainId)
            throw new ApiError(502, "V2_INVALID_RESPONSE", "invalid balance chain");
          return balance;
        }),
    );
    const balances = results.flatMap((entry) =>
      entry.status === "fulfilled" ? [entry.value] : [],
    );
    return { fund, wallet, balances };
  });
}

export async function reviewManageMoveRangeAction(
  core: string,
  input: unknown,
): Promise<ManageActionResult<ManageMoveRangeReview>> {
  return result(async () => {
    const draft = manageMoveRangeDraftSchema.parse(input);
    const position = await authorizedPosition(core, draft.chainId, draft.positionKey);
    const pool = position.uniswap;
    if (
      position.status !== "open" ||
      position.adapterKind !== "uniswap-v4" ||
      !pool ||
      BigInt(pool.liquidity) === BigInt(0)
    )
      throw new ApiError(409, "V2_POSITION_UNAVAILABLE", "position unavailable");
    if (draft.tickLower % pool.tickSpacing || draft.tickUpper % pool.tickSpacing)
      throw new ApiError(400, "V2_RANGE_INVALID", "invalid range");
    if (draft.tickLower === pool.tickLower && draft.tickUpper === pool.tickUpper)
      throw new ApiError(409, "V2_RANGE_UNCHANGED", "range unchanged");
    // PP-INTEGRATION-POINT: positions/build supplies only calldata. Missing post-close budgets,
    // costs/impact and continuation prohibit any executable review or signing payload here.
    return {
      status: "unavailable",
      canConfirm: false,
      position,
      draft,
      missing: [...MANAGE_MOVE_RANGE_MISSING],
    };
  });
}
