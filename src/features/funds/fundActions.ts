/**
 * @id PP-STR-LIB-028 (POO-2175)
 * @name fundActions
 * @implements-rules-version v2
 * PP-INTEGRATION-POINT: serializable fund reads, simulations and report polling.
 */
"use server";
import { z } from "zod";
import { apiFetch } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import {
  fundBuildSchema,
  reportJobSchema,
  reportStartSchema,
  uint,
} from "@/lib/api/v2/fundSchemas";
import {
  readBalances,
  readFund,
  readFunds,
  readHolder,
  readPosition,
  readTransit,
  readTransits,
} from "@/lib/api/v2/funds";
import { fundRequest } from "@/lib/api/v2/fundTransport";
import { addressSchema } from "@/lib/api/v2/schemas";
import { getAuthHeader, getSessionWallet } from "@/lib/auth/session";
import { isFeatureEnabled } from "@/lib/features";
import { isMockMode } from "@/lib/services";
import {
  mockFund,
  mockFundBuild,
  mockHolder,
  mockPositionDetail,
  mockSpokeBalances,
  mockTransits,
  mockWallet,
} from "@/mocks/data/v2Funds";

async function resultOf<ResponseData>(read: () => Promise<ResponseData>) {
  try {
    if (!isFeatureEnabled("fundContracts"))
      throw new ApiError(404, "V2_UNAVAILABLE", "unavailable");
    return { ok: true as const, data: await read() };
  } catch (error) {
    return {
      ok: false as const,
      error: {
        status: error instanceof ApiError ? error.status : 502,
        code: error instanceof ApiError ? error.code : "V2_INVALID_RESPONSE",
      },
    };
  }
}
async function walletIdentity() {
  if (isMockMode) return mockWallet;
  const wallet = await getSessionWallet();
  if (!wallet || !addressSchema.safeParse(wallet).success)
    throw new ApiError(401, "V2_SESSION", "sign in");
  const owner = await apiFetch("users/me", {
    schema: z.object({ walletAddress: addressSchema }),
    headers: await getAuthHeader(),
  });
  if (!owner || owner.walletAddress.toLowerCase() !== wallet.toLowerCase())
    throw new ApiError(401, "V2_SESSION", "unverified session");
  return wallet;
}
export async function loadFundsAction(view: "explore" | "holder" | "manager") {
  return resultOf(async () => {
    z.enum(["explore", "holder", "manager"]).parse(view);
    const wallet = view === "explore" ? null : await walletIdentity();
    const funds = isMockMode ? [mockFund] : (await readFunds()).funds;
    if (view === "manager")
      return {
        funds: funds.filter((fund) => fund.manager.toLowerCase() === wallet?.toLowerCase()),
        holders: {},
        wallet,
      };
    const holders: Record<string, typeof mockHolder> = {};
    if (view === "holder" && wallet)
      for (const fund of funds) {
        const holder = isMockMode ? mockHolder : await readHolder(fund.coreVault, wallet);
        if (
          BigInt(holder.shares) > BigInt(0) ||
          BigInt(holder.incomeOwed) > BigInt(0) ||
          holder.payout.open
        )
          holders[fund.coreVault] = holder;
      }
    return {
      funds: view === "holder" ? funds.filter((fund) => fund.coreVault in holders) : funds,
      holders,
      wallet,
    };
  });
}
export async function loadFundAction(core: string) {
  return resultOf(async () => {
    addressSchema.parse(core);
    const session = isMockMode ? mockWallet : await getSessionWallet();
    const wallet = session ? await walletIdentity() : null;
    const fund = isMockMode ? mockFund : await readFund(core);
    const holder = wallet ? (isMockMode ? mockHolder : await readHolder(core, wallet)) : null;
    return { fund, holder, wallet };
  });
}
export async function loadFundPositionAction(core: string, chain: number, key: string) {
  return resultOf(() =>
    isMockMode ? Promise.resolve(mockPositionDetail) : readPosition(core, chain, key),
  );
}
export async function loadFundManagerAction(core: string, cursor?: string) {
  return resultOf(async () => {
    const wallet = await walletIdentity();
    const fund = isMockMode ? mockFund : await readFund(core);
    if (fund.manager.toLowerCase() !== wallet.toLowerCase())
      throw new ApiError(403, "V2_SESSION", "not manager");
    if (isMockMode)
      return {
        transits: {
          protocolVersion: "v2" as const,
          items: mockTransits,
          nextCursor: null,
          coverage: [],
        },
        balances: mockSpokeBalances,
      };
    const transits = await readTransits(core, cursor);
    const balances = [];
    for (const chain of fund.chains) balances.push(await readBalances(core, Number(chain.chainId)));
    return { transits, balances };
  });
}
export async function loadFundTransitAction(core: string, id: string) {
  return resultOf(async () => {
    const wallet = await walletIdentity();
    const fund = isMockMode ? mockFund : await readFund(core);
    if (fund.manager.toLowerCase() !== wallet.toLowerCase())
      throw new ApiError(403, "V2_SESSION", "not manager");
    if (isMockMode) {
      const transit = mockTransits.find((transit) => transit.transitId === id);
      if (!transit) throw new ApiError(404, "V2_NOT_FOUND", "missing transit");
      return transit;
    }
    return readTransit(core, id);
  });
}
const intentSchema = z.object({
  action: z.enum([
    "deposit",
    "request-payout",
    "claim-payout",
    "request-income-withdrawal",
    "settle-income-withdrawal",
    "exit-closed-fund",
  ]),
  amount: uint.optional(),
  minShares: uint.optional(),
  mode: z.enum(["Instant", "Standard"]).optional(),
  maxLossBps: z.number().int().min(0).max(10_000).optional(),
});
export type FundIntent = z.infer<typeof intentSchema>;
export async function buildFundAction(core: string, input: FundIntent) {
  return resultOf(async () => {
    const wallet = await walletIdentity();
    const intent = intentSchema.parse(input);
    addressSchema.parse(core);
    if (
      (intent.action === "deposit" || intent.action === "request-payout") &&
      (!intent.amount || BigInt(intent.amount) <= BigInt(0))
    )
      throw new ApiError(400, "V2_INVALID_AMOUNT", "amount");
    if (isMockMode) return mockFundBuild(intent);
    const built = await fundRequest(`/funds/${core}/build`, fundBuildSchema, {
      ...intent,
      from: wallet,
      holder: wallet,
      side: "hub",
    });
    if (built.transactions.some((tx) => tx.from.toLowerCase() !== wallet.toLowerCase()))
      throw new ApiError(502, "V2_SESSION", "wrong sender");
    return built;
  });
}
const starts = new Map<string, { at: number; jobId?: string }>();
const polls = new Map<string, { at: number; job: Awaited<ReturnType<typeof pollReport>> }>();
async function pollReport(jobId: string) {
  return fundRequest(`/report-jobs/${jobId}`, reportJobSchema, undefined, true);
}
async function verifiedReportWallet() {
  return walletIdentity();
}
export async function startFundReportAction(core: string) {
  return resultOf(async () => {
    await verifiedReportWallet();
    addressSchema.parse(core);
    if (isMockMode)
      return { protocolVersion: "v2" as const, jobId: "00000000-0000-4000-8000-000000000001" };
    const key = core.toLowerCase();
    const previous = starts.get(key);
    if (previous && Date.now() - previous.at < 60_000) {
      if (previous.jobId) return { protocolVersion: "v2" as const, jobId: previous.jobId };
      throw new ApiError(429, "V2_UNAVAILABLE", "rate limited");
    }
    for (const [entry, value] of starts) if (Date.now() - value.at > 60_000) starts.delete(entry);
    if (starts.size >= 100) throw new ApiError(429, "V2_UNAVAILABLE", "rate limited");
    starts.set(key, { at: Date.now() });
    const started = await fundRequest(`/funds/${core}/report`, reportStartSchema, {}, true);
    starts.set(key, { at: Date.now(), jobId: started.jobId });
    return started;
  });
}
export async function pollFundReportAction(core: string, jobId: string) {
  return resultOf(async () => {
    await verifiedReportWallet();
    addressSchema.parse(core);
    z.string().uuid().parse(jobId);
    if (isMockMode)
      return { protocolVersion: "v2" as const, core, jobId, status: "delivered" as const };
    for (const [key, value] of polls) if (Date.now() - value.at > 15_000) polls.delete(key);
    const cached = polls.get(jobId);
    if (!cached && polls.size >= 100) throw new ApiError(429, "V2_UNAVAILABLE", "rate limited");
    const job = cached ? cached.job : await pollReport(jobId);
    if (job.core.toLowerCase() !== core.toLowerCase())
      throw new ApiError(403, "V2_SESSION", "wrong fund");
    if (!cached) polls.set(jobId, { at: Date.now(), job });
    return job;
  });
}
