/**
 * @id PP-CP-MCK-002
 * @name Cash+ interactive demo accounting
 * @implements-rules-version v1
 * PP-MOCK: local illustrative accounting only. No wallet, RPC or contract execution.
 */
import { parseCashPlusAmount, sharesForAssets } from "@/lib/cash-plus/amounts";
import type {
  CashPlusOperationKind,
  CashPlusReceipt,
  CashPlusSnapshot,
  CashPlusTransaction,
} from "@/lib/cash-plus/types";
import { CASH_PLUS_PREVIEW_OWNER, createCashPlusPreviewSnapshot } from "../data/cashPlus";

const B = BigInt;
type Token = CashPlusReceipt["tokens"][number];
export const CASH_PLUS_DEMO_STORAGE_KEY = "pool-party:cash-plus:preview-demo:v1";
export interface CashPlusDemoState {
  version: 1;
  revision: number;
  snapshot: CashPlusSnapshot & {
    totalAssets: bigint;
    accountAssets: bigint;
    resultAssets: bigint;
    withdrawnAssets: bigint;
    interestAssets: bigint;
    conversionAssets: bigint;
  };
  walletBalance: bigint;
  walletTokens: Token[];
}
export interface CashPlusDemoReview {
  revision: number;
  kind: CashPlusOperationKind;
  assets: bigint;
  shares: bigint;
  tokens: Token[];
  transaction: CashPlusTransaction;
}
export function createCashPlusDemoState(): CashPlusDemoState {
  return {
    version: 1,
    revision: 0,
    snapshot: createCashPlusPreviewSnapshot() as CashPlusDemoState["snapshot"],
    walletBalance: B("25000000000"),
    walletTokens: [],
  };
}
function sync(state: CashPlusDemoState): void {
  const s = state.snapshot;
  s.totalAssets = s.composition.reduce((sum, c) => sum + c.walletRaw + c.lendingRaw, B(0));
  s.accountAssets = (s.accountShares * s.totalAssets) / s.totalShares;
  s.resultAssets = s.accountAssets + s.withdrawnAssets - s.investedAssets;
  s.withdrawableAssets = s.accountAssets;
  s.capacityAssets = s.depositCapAssets > s.totalAssets ? s.depositCapAssets - s.totalAssets : B(0);
  for (const c of s.composition) {
    c.valueAssets = c.walletRaw + c.lendingRaw;
    c.weightBps = Number((c.valueAssets * B(10000)) / s.totalAssets);
  }
  s.readAt = s.timestamp * 1000;
}
function componentOutputs(state: CashPlusDemoState, shares: bigint): Token[] {
  const s = state.snapshot;
  return s.composition.flatMap((c, index) => [
    {
      address: c.token,
      symbol: c.symbol,
      decimals: c.decimals,
      amount: (c.walletRaw * shares) / s.totalShares,
    },
    {
      address: (index === 0
        ? "0x724dc807b04555b71ed48a6896b6F41593b8C637"
        : "0x6ab707Aca953eDAeFBc4fD23bA73294241490620") as Token["address"],
      symbol: `a${c.symbol}`,
      decimals: c.decimals,
      amount: (c.lendingRaw * shares) / s.totalShares,
    },
  ]);
}
export function prepareCashPlusDemo(
  state: CashPlusDemoState,
  kind: CashPlusOperationKind,
  amount: string,
): CashPlusDemoReview {
  const s = state.snapshot;
  let assets = B(0),
    shares = B(0),
    tokens: Token[] = [];
  if (kind === "deposit") {
    assets = parseCashPlusAmount(amount);
    if (s.depositsPaused) throw new Error("DEPOSIT_PAUSED");
    if (assets < s.minimumDepositAssets) throw new Error("AMOUNT_INVALID");
    if (assets > state.walletBalance) throw new Error("INSUFFICIENT_USDC");
    if (s.capacityAssets === null || assets > s.capacityAssets) throw new Error("CAPACITY_FULL");
    shares = (assets * s.totalShares) / s.totalAssets;
    if (shares === B(0)) throw new Error("AMOUNT_INVALID");
  } else {
    if (s.accountShares === B(0)) throw new Error("INSUFFICIENT_USDC");
    shares =
      amount === "all"
        ? s.accountShares
        : sharesForAssets(parseCashPlusAmount(amount), s.totalAssets, s.totalShares);
    if (shares > s.accountShares) throw new Error("INSUFFICIENT_USDC");
    assets = (shares * s.totalAssets) / s.totalShares;
    if (kind === "proportional") {
      tokens = componentOutputs(state, shares);
      assets = tokens.reduce((sum, t) => sum + t.amount, B(0));
    } else {
      const usdc = s.composition[0];
      if (!usdc || assets > usdc.walletRaw + usdc.lendingRaw)
        throw new Error("LIQUIDITY_INSUFFICIENT");
      tokens = [{ address: usdc.token, symbol: usdc.symbol, decimals: 6, amount: assets }];
    }
  }
  return {
    revision: state.revision,
    kind,
    assets,
    shares,
    tokens,
    transaction: {
      phase: "review",
      kind,
      amountAssets: assets,
      shares,
      ...(kind === "deposit" ? { minShares: shares } : { minAssets: assets }),
      ...(kind === "proportional" ? { outputs: tokens } : {}),
    },
  };
}
export function executeCashPlusDemo(
  before: CashPlusDemoState,
  review: CashPlusDemoReview,
): { state: CashPlusDemoState; receipt: CashPlusReceipt } {
  if (review.revision !== before.revision) throw new Error("QUOTE_EXPIRED");
  const state = structuredClone(before),
    s = state.snapshot;
  const usdc = s.composition[0];
  if (!usdc) throw new Error("READ_UNAVAILABLE");
  if (review.kind === "deposit") {
    state.walletBalance -= review.assets;
    usdc.walletRaw += review.assets;
    s.totalShares += review.shares;
    s.accountShares += review.shares;
    s.investedAssets += review.assets;
  } else {
    if (review.kind === "proportional") {
      for (let index = 0; index < s.composition.length; index += 1) {
        const c = s.composition[index],
          wallet = review.tokens[index * 2],
          lending = review.tokens[index * 2 + 1];
        if (!c || !wallet || !lending) throw new Error("READ_UNAVAILABLE");
        c.walletRaw -= wallet.amount;
        c.lendingRaw -= lending.amount;
        for (const token of [wallet, lending]) {
          if (token.symbol === "USDC") state.walletBalance += token.amount;
          else {
            const existing = state.walletTokens.find((t) => t.address === token.address);
            if (existing) existing.amount += token.amount;
            else if (token.amount > B(0)) state.walletTokens.push({ ...token });
          }
        }
      }
    } else {
      const idle = usdc.walletRaw < review.assets ? usdc.walletRaw : review.assets;
      usdc.walletRaw -= idle;
      usdc.lendingRaw -= review.assets - idle;
      state.walletBalance += review.assets;
    }
    s.totalShares -= review.shares;
    s.accountShares -= review.shares;
    s.withdrawnAssets += review.assets;
  }
  state.revision += 1;
  sync(state);
  s.activity.unshift({
    id: `mock-action-${state.revision}`,
    kind: review.kind,
    timestamp: s.timestamp,
    blockNumber: B(0),
    amountAssets: review.assets,
    tokenSymbol: review.kind === "proportional" ? "USD" : "USDC",
    owner: CASH_PLUS_PREVIEW_OWNER,
  });
  return {
    state,
    receipt: {
      simulated: true,
      blockNumber: B(0),
      kind: review.kind,
      assets: review.assets,
      shares: review.shares,
      tokens: review.tokens,
    },
  };
}
export function advanceCashPlusDemoDay(before: CashPlusDemoState): CashPlusDemoState {
  const state = structuredClone(before),
    s = state.snapshot,
    nav = s.totalAssets;
  // Disclosed gross assumptions: 95% lending at 4% yearly, 40x annual NAV turnover, 5 bps spread.
  const interest = (nav * B(95) * B(4)) / B(10000 * 365),
    conversion = (nav * B(40) * B(5)) / B(10000 * 365);
  const usdc = s.composition[0],
    secondary = s.composition[1];
  if (!usdc || !secondary) throw new Error("READ_UNAVAILABLE");
  const secondaryInterest = (secondary.lendingRaw * B(4)) / B(100 * 365);
  usdc.lendingRaw += interest - secondaryInterest;
  secondary.lendingRaw += secondaryInterest;
  usdc.walletRaw += conversion;
  // Model the keeper maintaining the illustrative 5% cash buffer, only on this explicit action.
  const target = ((nav + interest + conversion) * B(5)) / B(100);
  usdc.lendingRaw += usdc.walletRaw - target;
  usdc.walletRaw = target;
  s.interestAssets += interest;
  s.conversionAssets += conversion;
  s.timestamp += 86400;
  state.revision += 1;
  sync(state);
  s.history.push({
    timestamp: s.timestamp,
    shareValueAssets: (s.totalAssets * B("100000000000000000000")) / s.totalShares,
  });
  s.activity.unshift({
    id: `mock-day-${state.revision}`,
    kind: "conversion",
    timestamp: s.timestamp,
    blockNumber: B(0),
    amountAssets: (nav * B(40)) / B(365),
    tokenSymbol: "USDC",
    amountIn: (nav * B(40)) / B(365),
    amountOut: (nav * B(40)) / B(365) - conversion,
  });
  return state;
}
export function serializeCashPlusDemo(state: CashPlusDemoState): string {
  return JSON.stringify(state, (_, v) =>
    typeof v === "bigint" ? { $cashPlusBigInt: String(v) } : v,
  );
}
export function restoreCashPlusDemo(value: string | null): CashPlusDemoState | null {
  if (!value) return null;
  try {
    const state = JSON.parse(value, (_, v) =>
      v && typeof v === "object" && typeof v.$cashPlusBigInt === "string"
        ? B(v.$cashPlusBigInt)
        : v,
    ) as CashPlusDemoState;
    if (
      state.version !== 1 ||
      !Number.isSafeInteger(state.revision) ||
      state.revision < 0 ||
      state.snapshot.mode !== "preview" ||
      state.snapshot.vault !== null ||
      state.snapshot.blockHash !== null ||
      state.snapshot.explorerUrl !== null ||
      typeof state.walletBalance !== "bigint" ||
      state.walletBalance < B(0) ||
      state.snapshot.totalShares <= B(0) ||
      state.snapshot.accountShares > state.snapshot.totalShares ||
      !Array.isArray(state.walletTokens) ||
      !Array.isArray(state.snapshot.history) ||
      !Array.isArray(state.snapshot.activity)
    )
      return null;
    sync(state);
    return state;
  } catch {
    return null;
  }
}
