/**
 * @id PP-DEP-LIB-003 (POO-494, POO-520)
 * @name deposit invest-context params
 * @implements-rules-version v1 (POO-2217 V2 unavailable host/context); v1
 *
 * Parses the "Deposit & invest" deep-link params (`/deposit?strategy=<id>&amount=<shortfall>&invest=<chosen>`)
 * into a validated top-up context. The context is built from the URL alone (POO-494 R1) — the strategy
 * lookup only decorates the banner name — so a real-mode catalog miss can never silently drop the
 * received-fixed mode, the prefill, or the return deep link.
 *
 * POO-520: the ORIGIN of the flow travels in the context too (`&origin=manager` when the top-up was
 * launched from the manager console's Add-liquidity), so the post-deposit "Invest now" returns to the
 * console manage view (`/manager?manage=<id>&invest=<amount>`) instead of the investor detail (R1).
 * Only the exact value "manager" is accepted; anything else keeps the investor origin (R2).
 */

/** Raw Next.js searchParams shape. */
type SearchParams = Record<string, string | string[] | undefined>;

/** Where the Deposit & invest top-up was launched from (drives the post-deposit return, POO-520). */
export type InvestOrigin = "investor" | "manager";

/** The validated deep-link params (name-less; the page decorates the banner name separately). */
export interface ParsedInvestParams {
  family?: "v1";
  /** Strategy id to return to after a successful top-up. */
  strategyId: string;
  /** Shortfall to prefill; `0` when absent or invalid (no prefill, POO-494 R2). */
  shortfall: number;
  /** The full chosen amount; `undefined` when absent, invalid, or below the shortfall (POO-494 R2). */
  investAmount?: number;
  /** Launch surface: "manager" only for the exact `origin=manager` param, else "investor" (POO-520 R1/R2). */
  origin: InvestOrigin;
}

/** V2 top-ups retain the fund and account independently of the legacy strategy catalogue. */
export interface ParsedFundInvestParams {
  family: "v2";
  core: string;
  wallet: string;
  shortfall: number;
  investAmount?: number;
  origin: InvestOrigin;
  fromPortfolio: boolean;
}

export type InvestReturnContext = ParsedInvestParams | ParsedFundInvestParams;

function fundAmount(value: SearchParams[string]): number | undefined {
  if (typeof value !== "string" || !/^\d{1,9}(\.\d{1,6})?$/.test(value)) return;
  const amount = Number(value);
  return amount > 0 ? amount : undefined;
}

/** Parse + validate the top-up deep-link params; `null` when there is no strategy id. */
export function parseInvestParams(sp: SearchParams): InvestReturnContext | null {
  if (sp.family === "v2") {
    if (
      typeof sp.core !== "string" ||
      !/^0x[\da-fA-F]{40}$/.test(sp.core) ||
      typeof sp.account !== "string" ||
      !/^0x[\da-fA-F]{40}$/.test(sp.account)
    )
      return null;
    const shortfall = fundAmount(sp.amount) ?? 0;
    const chosen = fundAmount(sp.invest);
    return {
      family: "v2",
      core: sp.core,
      wallet: sp.account,
      shortfall,
      investAmount: chosen !== undefined && chosen >= shortfall ? chosen : undefined,
      origin: sp.origin === "manager" ? "manager" : "investor",
      fromPortfolio: sp.from === "portfolio",
    };
  }
  if (sp.family !== undefined && sp.family !== "v1") return null;
  const strategyId = typeof sp.strategy === "string" && sp.strategy.length > 0 ? sp.strategy : null;
  if (!strategyId) return null;

  const shortfallRaw = typeof sp.amount === "string" ? Number.parseFloat(sp.amount) : Number.NaN;
  const shortfall = Number.isFinite(shortfallRaw) && shortfallRaw > 0 ? shortfallRaw : 0;

  const investRaw = typeof sp.invest === "string" ? Number.parseFloat(sp.invest) : Number.NaN;
  const investAmount =
    Number.isFinite(investRaw) && investRaw > 0 && investRaw >= shortfall ? investRaw : undefined;

  // POO-520 R1/R2: only the exact "manager" value flips the return target; anything else (absent,
  // arrays, arbitrary strings) is the investor origin, keeping the current behavior.
  const origin: InvestOrigin = sp.origin === "manager" ? "manager" : "investor";

  return { strategyId, shortfall, investAmount, origin };
}

/** Locale is supplied by the existing next-intl Link/router. This URL never authorizes signing. */
export function buildInvestReturnHref(
  context:
    | (Omit<ParsedInvestParams, "origin"> & { origin?: InvestOrigin })
    | ParsedFundInvestParams
    | null
    | undefined,
  connectedWallet?: string | null,
): string | null {
  if (!context) return null;
  const hasAmount = Boolean(context.investAmount && context.investAmount > 0);
  if (context.family === "v2") {
    if (connectedWallet?.toLowerCase() !== context.wallet.toLowerCase()) return null;
    const params = new URLSearchParams();
    if (hasAmount) params.set("invest", String(context.investAmount));
    params.set("account", context.wallet);
    if (context.fromPortfolio) params.set("from", "portfolio");
    if (context.origin === "manager") params.set("origin", "manager");
    return `/funds/${context.core}?${params}`;
  }
  if (context.origin === "manager") {
    return `/manager?manage=${context.strategyId}${hasAmount ? `&invest=${context.investAmount}` : ""}`;
  }
  return `/strategies/${context.strategyId}${hasAmount ? `?invest=${context.investAmount}` : ""}`;
}
