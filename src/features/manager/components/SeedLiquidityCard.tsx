/**
 * @id PP-MGR-SCR-002 (POO-309, POO-878, POO-882)
 * @name SeedLiquidityCard
 * @implements-rules-version v1
 * POO-496 rules v1: the once-only zero-balance check waits for the resolved range (non-null ticks on
 * a price-known pool) and only names tokens the range actually needs.
 * POO-497 rules v1: no-price pools are filtered out of the picker, so the retired funded-token
 * heuristic is gone; a no-price pool reaching here is a blocked state (never seedable/launchable).
 * POO-878 rules v1: the pool's wrapped-native token (WETH/WPOL) can be seeded from the manager's
 * NATIVE coin (msg.value) OR the wrapped ERC-20 (Permit2). Its row shows an explicit native/wrapped
 * funding selector [R1]; the full leg comes from ONE source [R2]; the default is native, auto-
 * switching to the wrapped ERC-20 only when native alone can't cover the amount but the wrapped
 * balance can [R3]; balance display + validation follow the selected source [R4]; the zero-balance
 * prompt fires only when NEITHER source can cover the leg [R4]; Max on the native source reserves a
 * flat $1.50 of native for gas while Max on the wrapped ERC-20 is exact [R5]. The choice rides up as
 * `wrappedNativeFunding` so the API-built funding path matches what the FE shows.
 * POO-882 rules v1: Polygon's wrapped-native (POL/WPOL) uses the SAME selector, so the FE-displayed/
 * validated source and the API-built funding path always agree per chain [R1/R2].
 *
 * Real-mode-only card on the Review step where the manager deposits the initial liquidity for the
 * new pool. Reads each pool token's on-chain decimals + balance for the connected wallet (the
 * static token list has no decimals), accepts a decimal amount per token with a "Max", validates
 * each against the wallet balance, and reports the parsed wei amounts + overall validity up so the
 * Review step can gate Launch and feed {@link useCreatePool}. Mounted only in real mode, so the
 * balance reads never run in mock mode.
 *
 * PP-INTEGRATION-POINT: seed token decimals/balances ← on-chain ERC-20 reads (see readErc20).
 */
"use client";

import { useWallets } from "@privy-io/react-auth";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Input } from "@/components/ui/Input";
import {
  isWrappedNative,
  nativeSymbol,
  networkToChainId,
  wrappedNativeSymbol,
} from "@/lib/chains/config";
import { priceToTick } from "@/lib/manager/tickPrice";
import type { UniswapPool } from "@/lib/schemas";
import { readErc20Balance, readErc20Decimals, readNativeBalance } from "@/lib/tokens/readErc20";
import { findToken } from "@/lib/tokens/tokenList";
import { cn } from "@/lib/utils/cn";
import {
  autoWrappedFunding,
  formatTokenAmount,
  nativeMaxWithGasReserve,
  parseSeedAmount,
  seedTokensNeeded,
  seedValid,
  type WrappedNativeFunding,
  wrappedLegExhausted,
  wrappedSourceBalance,
} from "../lib/seedAmounts";
import { quotePairedSeedAmountAction } from "../operations/pairedAmountAction";
import { SeedZeroBalanceModal } from "./SeedZeroBalanceModal";

/** Parsed seed amounts (wei) + whether both are valid against the wallet balance. */
export interface SeedState {
  amount0: bigint | null;
  amount1: bigint | null;
  valid: boolean;
  /** On-chain token decimals, reported up so the Review step can derive the tick range from the
   *  manager's min/max price (null until the on-chain reads resolve). */
  decimals0: number | null;
  decimals1: number | null;
  /**
   * POO-878 [R5]: the funding source chosen for the pool's wrapped-native leg (WETH/WPOL). Undefined
   * when the pool has no wrapped-native token — the Review step forwards it to the create-pool build
   * so the API sets `tx.value` to match (native msg.value vs Permit2 wrapped-token pull).
   */
  wrappedNativeFunding?: WrappedNativeFunding;
}

/** On-chain metadata for one seed token. */
interface TokenMeta {
  decimals: number;
  /** The token's ERC-20 balance (wei). For the wrapped-native token this is the WETH/WPOL balance. */
  balance: bigint;
  /**
   * POO-878: the manager's NATIVE coin balance (wei) — present ONLY for the chain's wrapped-native
   * token (WETH/WPOL), which can be funded from native msg.value; null for every other token.
   */
  nativeBalance: bigint | null;
}

/** Public props for {@link SeedLiquidityCard}. */
export interface SeedLiquidityCardProps {
  /** The pool being created — supplies token symbols, addresses and network. */
  pool: UniswapPool;
  /**
   * The position's tick bounds (from the Review step's range). When both are set, editing one token
   * auto-derives the other for that range at the pool's current price. Null disables the auto-calc
   * (both inputs stay independent) until the range resolves.
   */
  tickLower: number | null;
  tickUpper: number | null;
  /** Reports the parsed amounts + validity up to the Review step (should be a stable callback). */
  onChange: (state: SeedState) => void;
}

/** Keep only digits and a single decimal point. */
function numericOnly(value: string): string {
  const cleaned = value.replace(/[^\d.]/g, "");
  const dot = cleaned.indexOf(".");
  if (dot === -1) return cleaned;
  return cleaned.slice(0, dot + 1) + cleaned.slice(dot + 1).replace(/\./g, "");
}

/**
 * The native/wrapped funding-source toggle for the wrapped-native leg (POO-878 [R1]). The option
 * labels are token symbols (ETH/WETH, POL/WPOL) — product nouns kept verbatim across locales.
 */
function FundingSourceToggle({
  funding,
  nativeLabel,
  wrappedLabel,
  onChange,
  groupLabel,
}: {
  funding: WrappedNativeFunding;
  nativeLabel: string;
  wrappedLabel: string;
  onChange: (next: WrappedNativeFunding) => void;
  groupLabel: string;
}) {
  const option = (source: WrappedNativeFunding, label: string, first: boolean) => (
    <button
      type="button"
      aria-pressed={funding === source}
      onClick={() => onChange(source)}
      className={cn(
        "px-2 py-0.5 font-medium text-xs transition-colors",
        first ? "" : "border-border border-l",
        funding === source ? "bg-surface-raised text-foreground" : "text-muted-foreground",
      )}
    >
      {label}
    </button>
  );
  // PP-A11Y: the visible "Fund with" caption labels the pair; each option is a toggle button with
  // aria-pressed reflecting the active source (no role="group" — the caption + aria-pressed suffice).
  return (
    <div className="flex items-center gap-2">
      <span className="text-muted-foreground text-xs">{groupLabel}</span>
      <div className="inline-flex overflow-hidden rounded-md border border-border">
        {option("native", nativeLabel, true)}
        {option("erc20", wrappedLabel, false)}
      </div>
    </div>
  );
}

/**
 * One token row: symbol + balance/Max + amount input + inline insufficient-balance error. `balance`
 * is the SELECTED-source balance (POO-878 [R4]) — for the wrapped-native token it flips between the
 * native and wrapped ERC-20 balance as the funding source changes; every other token uses its ERC-20
 * balance. When `funding` + `onFundingChange` are provided the row is the wrapped-native leg and
 * renders the native/wrapped selector.
 */
function SeedTokenRow({
  network,
  symbol,
  address,
  decimals,
  balance,
  value,
  onChange,
  onMax,
  funding,
  onFundingChange,
  nativeLabel,
  wrappedLabel,
}: {
  network: string;
  symbol: string;
  address: string;
  decimals: number | null;
  balance: bigint | null;
  value: string;
  onChange: (next: string) => void;
  onMax: () => void;
  funding?: WrappedNativeFunding;
  onFundingChange?: (next: WrappedNativeFunding) => void;
  nativeLabel?: string;
  wrappedLabel?: string;
}) {
  const t = useTranslations("manager");
  const iconUrl = findToken(network, address)?.iconUrl;
  const loaded = decimals != null && balance != null;
  const amount = decimals != null ? parseSeedAmount(value, decimals) : null;
  const overBalance = balance != null && amount != null && amount > balance;
  const showSelector = funding != null && onFundingChange != null;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 font-medium text-foreground text-sm">
          {iconUrl ? <img src={iconUrl} alt="" className="size-5 rounded-full" /> : null}
          {symbol}
        </span>
        <span className="flex items-center gap-2 text-muted-foreground text-xs">
          {loaded
            ? t("review.seed.balance", { amount: formatTokenAmount(balance, decimals) })
            : "—"}
          <button
            type="button"
            disabled={!loaded}
            onClick={onMax}
            className="font-medium text-primary hover:underline disabled:opacity-50"
          >
            {t("review.seed.max")}
          </button>
        </span>
      </div>
      {showSelector && nativeLabel && wrappedLabel ? (
        <FundingSourceToggle
          funding={funding}
          nativeLabel={nativeLabel}
          wrappedLabel={wrappedLabel}
          onChange={onFundingChange}
          groupLabel={t("review.seed.fundWith")}
        />
      ) : null}
      <Input
        value={value}
        inputMode="decimal"
        placeholder="0.00"
        aria-label={symbol}
        disabled={!loaded}
        className={cn("text-right", overBalance && "border-destructive")}
        onChange={(event) => onChange(numericOnly(event.target.value))}
      />
      {overBalance ? (
        <p className="text-destructive text-xs">{t("review.seed.insufficient")}</p>
      ) : null}
    </div>
  );
}

/** Real-mode seed-liquidity card (two token amount inputs with on-chain balances). */
export function SeedLiquidityCard({
  pool,
  tickLower,
  tickUpper,
  onChange,
}: SeedLiquidityCardProps) {
  const t = useTranslations("manager");
  const { wallets } = useWallets();
  const owner = wallets[0]?.address as `0x${string}` | undefined;
  const chainId = networkToChainId(pool.network);

  const [meta0, setMeta0] = useState<TokenMeta | null>(null);
  const [meta1, setMeta1] = useState<TokenMeta | null>(null);
  const [input0, setInput0] = useState("");
  const [input1, setInput1] = useState("");
  // POO-878 [R3]: the manager's explicit funding-source pick for the wrapped-native leg. Null = auto
  // (default native, switching to the wrapped ERC-20 only when native can't cover the amount but it
  // can). A manual pick always wins, so the manager can switch back at will.
  const [manualFunding, setManualFunding] = useState<WrappedNativeFunding | null>(null);
  // Which input the manager last edited; the other is derived from the range + current price.
  const [independentField, setIndependentField] = useState<0 | 1 | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  // Zero-balance prompt (POO-309): shown once when the NEEDED side is FINAL and a needed token's
  // balance is 0, so the manager cannot seed it; offers Deposit / Swap. POO-496 R2/R3: on a price-
  // known pool the needed side is not final until the range ticks resolve, so the check waits for
  // non-null tickLower/tickUpper before running (see the effect below).
  const [zeroOpen, setZeroOpen] = useState(false);
  const [zeroTokens, setZeroTokens] = useState<string[]>([]);
  const [zeroChecked, setZeroChecked] = useState(false);

  // Load each token's decimals + balance for the connected wallet.
  useEffect(() => {
    if (!owner || !chainId) return;
    let cancelled = false;
    setPhase("loading");
    const token0 = pool.token0Address as `0x${string}`;
    const token1 = pool.token1Address as `0x${string}`;
    // POO-878: read a token's balances. For the chain's wrapped-native token (WETH/WPOL) read BOTH
    // the wrapped ERC-20 balance AND the manager's native coin balance — the seed can come from either
    // source (native msg.value or a Permit2 wrapped-token pull). Every other token has only its ERC-20
    // balance. The native balance is read once (chain-level), reused for whichever side is wrapped.
    const balancesOf = async (
      token: `0x${string}`,
    ): Promise<Pick<TokenMeta, "balance" | "nativeBalance">> => {
      if (isWrappedNative(chainId, token)) {
        const [erc20, native] = await Promise.all([
          readErc20Balance(token, owner, chainId),
          readNativeBalance(owner, chainId),
        ]);
        return { balance: erc20, nativeBalance: native };
      }
      return { balance: await readErc20Balance(token, owner, chainId), nativeBalance: null };
    };
    (async () => {
      try {
        const [d0, d1, b0, b1] = await Promise.all([
          readErc20Decimals(token0, chainId),
          readErc20Decimals(token1, chainId),
          balancesOf(token0),
          balancesOf(token1),
        ]);
        if (cancelled) return;
        setMeta0({ decimals: d0, ...b0 });
        setMeta1({ decimals: d1, ...b1 });
        setPhase("ready");
      } catch {
        if (!cancelled) setPhase("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [owner, chainId, pool.token0Address, pool.token1Address]);

  const amount0 = meta0 ? parseSeedAmount(input0, meta0.decimals) : null;
  const amount1 = meta1 ? parseSeedAmount(input1, meta1.decimals) : null;

  // POO-878/882: which side (if any) is the chain's wrapped-native token (WETH/WPOL). Derived from
  // the addresses so it's known before balances load; at most one side is wrapped (USDC never is).
  const wrapped0 = chainId != null && isWrappedNative(chainId, pool.token0Address);
  const wrapped1 = chainId != null && isWrappedNative(chainId, pool.token1Address);
  const hasWrappedLeg = wrapped0 || wrapped1;
  const wrappedMeta = wrapped0 ? meta0 : wrapped1 ? meta1 : null;
  const wrappedAmount = wrapped0 ? amount0 : wrapped1 ? amount1 : null;
  // POO-878 [R3]: resolve the active funding source — a manual pick wins, else auto (default native;
  // switch to the wrapped ERC-20 only when native can't cover the typed amount but the wrapped can).
  const autoFunding: WrappedNativeFunding =
    wrappedMeta && wrappedMeta.nativeBalance != null
      ? autoWrappedFunding(wrappedAmount, wrappedMeta.nativeBalance, wrappedMeta.balance)
      : "native";
  const funding: WrappedNativeFunding = manualFunding ?? autoFunding;
  // PP-TODO: live-verify Polygon WPOL/native funding path end-to-end (POO-882). The FE now displays +
  // validates the selected source and sends the explicit `wrappedNativeFunding`, but the Polygon fix
  // depends on the API honoring it over the broken `getWETHContract('polygon')` sentinel; confirm with
  // one dev-chain create-pool on Polygon (POL-only and WPOL-only wallets) once the BE half lands.
  // POO-878 [R4]: the balance backing each leg for validation / display / Max — the SELECTED source
  // for the wrapped-native token, the plain ERC-20 balance for every other token.
  const effectiveBalance = (meta: TokenMeta | null, isWrapped: boolean): bigint | null => {
    if (!meta) return null;
    if (isWrapped && meta.nativeBalance != null) {
      return wrappedSourceBalance(funding, meta.nativeBalance, meta.balance);
    }
    return meta.balance;
  };
  const balance0 = effectiveBalance(meta0, wrapped0);
  const balance1 = effectiveBalance(meta1, wrapped1);

  // A one-sided Uniswap v3 range (entirely above/below the pool's current price) is seeded with a
  // single token, so only that row is shown and only its amount is required; a straddling/full range
  // needs both. Decimals come from the on-chain reads, so this stays "both" until they load (which
  // preserves the previous always-dual behavior during loading).
  //
  // POO-497 [R3]: a no-price pool (the `currentPrice <= Number.MIN_VALUE` sentinel) is filtered out of
  // the picker (POO-497 [R1]), so it should never reach this card. If one ever slips through, treat it
  // as a blocked/invalid state — never seedable, never launchable — rather than running the retired
  // funded-token heuristic. `needs0/needs1` both stay false (no seedable row) and `valid` is forced
  // false, so ReviewStep's Launch gate (which also guards on the price) cannot proceed on it.
  const priceKnown = pool.currentPrice > Number.MIN_VALUE;
  const currentTick =
    priceKnown && meta0 && meta1
      ? priceToTick(pool.currentPrice, meta0.decimals, meta1.decimals)
      : null;
  const { needs0, needs1 } = priceKnown
    ? seedTokensNeeded(currentTick, tickLower, tickUpper)
    : { needs0: false, needs1: false };

  // POO-878 [R4]: validate each needed leg against its SELECTED-source balance (native vs wrapped).
  const valid =
    priceKnown &&
    (needs0 ? (balance0 != null ? seedValid(amount0, balance0) : false) : true) &&
    (needs1 ? (balance1 != null ? seedValid(amount1, balance1) : false) : true);

  // Report parsed amounts + validity up. Deps are primitives (bigints/strings compare by value), so
  // this only fires when a value actually changes; the parent's setter is stable + guards re-renders.
  useEffect(() => {
    onChange({
      // Report 0 for a token this range doesn't need, so the create-pool tx mints one-sided.
      amount0: needs0 ? amount0 : BigInt(0),
      amount1: needs1 ? amount1 : BigInt(0),
      valid,
      decimals0: meta0?.decimals ?? null,
      decimals1: meta1?.decimals ?? null,
      // POO-878 [R5]: the wrapped-native funding choice (undefined when the pool has no such token, so
      // the API keeps its native default).
      wrappedNativeFunding: hasWrappedLeg ? funding : undefined,
    });
  }, [
    amount0,
    amount1,
    valid,
    needs0,
    needs1,
    meta0?.decimals,
    meta1?.decimals,
    hasWrappedLeg,
    funding,
    onChange,
  ]);

  // Once the NEEDED side is FINAL, prompt to Deposit/Swap if a needed token has no balance (once).
  // POO-496 R2: on a price-known pool the needed side (needs0/needs1) is only correct after the range
  // ticks resolve; while tickLower/tickUpper are null, seedTokensNeeded defaults to BOTH, so firing
  // now could name a token the resolved range never needs. Wait for non-null ticks WITHOUT marking
  // zeroChecked, so the check still fires later when they resolve.
  // POO-496 R3: while the range is degenerate (createPoolTicks stays null: min/max missing, inverted,
  // or collapsing after snapping) the ticks never resolve, so this never fires; the Launch gate's
  // missing-range chip is the sole blocker there. POO-497: a no-price pool (priceKnown false) needs no
  // token (needs0/needs1 both false), so the zero-balance check finds nothing and never fires either.
  useEffect(() => {
    if (phase !== "ready" || zeroChecked) return;
    if (priceKnown && (tickLower == null || tickUpper == null)) return;
    // POO-878 [R4]: the wrapped-native leg is only "zero" when NEITHER source can cover it (both the
    // native and the wrapped ERC-20 balance are 0); every other token is zero when its ERC-20 is 0.
    const legZero = (meta: TokenMeta, isWrapped: boolean): boolean =>
      isWrapped && meta.nativeBalance != null
        ? wrappedLegExhausted(meta.nativeBalance, meta.balance)
        : meta.balance === BigInt(0);
    const zeros: string[] = [];
    if (needs0 && meta0 && legZero(meta0, wrapped0)) zeros.push(pool.token0);
    if (needs1 && meta1 && legZero(meta1, wrapped1)) zeros.push(pool.token1);
    if (zeros.length > 0) {
      setZeroTokens(zeros);
      setZeroOpen(true);
    }
    setZeroChecked(true);
  }, [
    phase,
    zeroChecked,
    priceKnown,
    tickLower,
    tickUpper,
    needs0,
    needs1,
    meta0,
    meta1,
    wrapped0,
    wrapped1,
    pool.token0,
    pool.token1,
  ]);

  // The amount the manager typed (the independent side). Keyed on this alone so deriving the OTHER
  // input never re-triggers the calc (bigints compare by value, so an unchanged value is a no-op).
  const independentAmount =
    independentField === 0 ? amount0 : independentField === 1 ? amount1 : null;

  // Auto-derive the paired amount for the chosen range at the pool's current price (debounced; the
  // v3-SDK math runs in a Server Action). Mirrors the v1 interface's linked deposit inputs.
  useEffect(() => {
    // Only the dual-asset case links the inputs; a one-sided range has a single (hidden) token row.
    // A new pool has no on-chain state to quote the paired amount against, so skip the link there.
    if (
      !priceKnown ||
      independentField === null ||
      tickLower == null ||
      tickUpper == null ||
      !meta0 ||
      !meta1 ||
      !needs0 ||
      !needs1
    ) {
      return;
    }
    // Clearing the edited input resets the paired one too.
    if (independentAmount == null) {
      if (independentField === 0) setInput1("");
      else setInput0("");
      return;
    }
    let cancelled = false;
    const handle = setTimeout(async () => {
      const result = await quotePairedSeedAmountAction({
        network: pool.network,
        currency0: pool.token0Address,
        currency1: pool.token1Address,
        // Raw fee tier when present, else derive it from bps (matches useCreatePool / the state path).
        feeTier: pool.feeTier ?? pool.feeBps * 100,
        tickLower,
        tickUpper,
        independentField,
        independentAmount: independentAmount.toString(),
      });
      if (cancelled || !result) return;
      // Set the paired input WITHOUT touching `independentField`, so it stays the derived side.
      if (independentField === 0)
        setInput1(formatTokenAmount(BigInt(result.amount1), meta1.decimals));
      else setInput0(formatTokenAmount(BigInt(result.amount0), meta0.decimals));
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [
    priceKnown,
    independentField,
    independentAmount,
    tickLower,
    tickUpper,
    meta0,
    meta1,
    needs0,
    needs1,
    pool.network,
    pool.token0Address,
    pool.token1Address,
    pool.feeTier,
    pool.feeBps,
  ]);

  // POO-878 [R1]: funding-selector option labels (product-noun token symbols, verbatim per locale).
  const nativeFundingLabel = nativeSymbol(pool.network);
  const wrappedFundingLabel = wrappedNativeSymbol(pool.network);
  // A manual pick pins the source (wins over the auto-default) so the manager can switch at will.
  const onFundingChange = (next: WrappedNativeFunding) => setManualFunding(next);

  const cardClass = "flex flex-col gap-3 rounded-xl border border-border bg-surface p-4";

  return (
    <div className={cardClass}>
      <div className="flex flex-col gap-0.5">
        <p className="font-medium text-foreground text-sm">{t("review.seed.title")}</p>
        <p className="text-muted-foreground text-xs">
          {needs0 && needs1
            ? t("review.seed.subtitle")
            : t("review.seed.subtitleSingle", { symbol: needs0 ? pool.token0 : pool.token1 })}
        </p>
      </div>
      {phase === "error" ? (
        <p className="text-destructive text-sm">{t("review.seed.error")}</p>
      ) : (
        <>
          {phase === "loading" ? (
            <p className="text-muted-foreground text-xs">{t("review.seed.loading")}</p>
          ) : null}
          {/* POO-354: two needed tokens render side by side (2-col on >= sm, stacked on mobile); a
              single needed token stays full-width. */}
          <div
            className={
              needs0 && needs1 ? "grid grid-cols-1 gap-3 sm:grid-cols-2" : "flex flex-col gap-3"
            }
          >
            {needs0 ? (
              <SeedTokenRow
                network={pool.network}
                symbol={pool.token0}
                address={pool.token0Address}
                decimals={meta0?.decimals ?? null}
                balance={balance0}
                value={input0}
                onChange={(next) => {
                  setInput0(next);
                  setIndependentField(0);
                }}
                onMax={() => {
                  if (!meta0 || balance0 == null) return;
                  // POO-878 [R5]: reserve a fixed $1.50 of native for gas when the NATIVE source is
                  // selected (the wrapped-native token's USD price ≈ the native price); Max on the
                  // wrapped ERC-20 / any other token is exact (gas is paid in native, not the token).
                  const maxWei =
                    wrapped0 && funding === "native"
                      ? nativeMaxWithGasReserve(balance0, meta0.decimals, pool.token0PriceUsd)
                      : balance0;
                  setInput0(formatTokenAmount(maxWei, meta0.decimals));
                  setIndependentField(0);
                }}
                funding={wrapped0 ? funding : undefined}
                onFundingChange={wrapped0 ? onFundingChange : undefined}
                nativeLabel={wrapped0 ? nativeFundingLabel : undefined}
                wrappedLabel={wrapped0 ? wrappedFundingLabel : undefined}
              />
            ) : null}
            {needs1 ? (
              <SeedTokenRow
                network={pool.network}
                symbol={pool.token1}
                address={pool.token1Address}
                decimals={meta1?.decimals ?? null}
                balance={balance1}
                value={input1}
                onChange={(next) => {
                  setInput1(next);
                  setIndependentField(1);
                }}
                onMax={() => {
                  if (!meta1 || balance1 == null) return;
                  // POO-878 [R5]: reserve a fixed $1.50 of native for gas when the NATIVE source is
                  // selected (the wrapped-native token's USD price ≈ the native price); Max on the
                  // wrapped ERC-20 / any other token is exact (gas is paid in native, not the token).
                  const maxWei =
                    wrapped1 && funding === "native"
                      ? nativeMaxWithGasReserve(balance1, meta1.decimals, pool.token1PriceUsd)
                      : balance1;
                  setInput1(formatTokenAmount(maxWei, meta1.decimals));
                  setIndependentField(1);
                }}
                funding={wrapped1 ? funding : undefined}
                onFundingChange={wrapped1 ? onFundingChange : undefined}
                nativeLabel={wrapped1 ? nativeFundingLabel : undefined}
                wrappedLabel={wrapped1 ? wrappedFundingLabel : undefined}
              />
            ) : null}
          </div>
        </>
      )}
      {zeroTokens.length > 0 ? (
        <SeedZeroBalanceModal open={zeroOpen} onOpenChange={setZeroOpen} tokens={zeroTokens} />
      ) : null}
    </div>
  );
}
