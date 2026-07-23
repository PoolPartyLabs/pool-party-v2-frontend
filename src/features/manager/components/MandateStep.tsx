/**
 * @id PP-MGR-SCR-002
 * @name MandateStep
 *
 * Step 1 of the V1 strategy builder: pick a network → a Uniswap v3 pool (search by pair OR token /
 * pool address). The mandate is the pool, nothing else — the price range belongs to the strategy
 * and is configured on the Build step's pool-node panel (picking a pool seeds a silent ±10%
 * default so Build always opens on a valid range), and the strategy identity (name / logo /
 * description) is set on Review & launch. Risk + category are DERIVED from the pool and range,
 * never set by the manager. "Next" (enabled once a pool is picked) advances to Build.
 *
 * POO-497 rules v1: the picker offers ONLY pools with a defined market price — no-price pools (the
 * `currentPrice <= Number.MIN_VALUE` sentinel) are hidden entirely (see `poolHasMarketPrice`).
 */
"use client";

import { Check } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { NetworkLogo } from "@/components/data-display/NetworkLogo";
import { ProtocolBadge } from "@/components/data-display/ProtocolBadge";
import { AprTooltip } from "@/components/ui/AprTooltip";
import { CtaWithMissing } from "@/components/ui/CtaWithMissing";
import { Input } from "@/components/ui/Input";
import type { UniswapPool } from "@/lib/schemas";
import { isMockMode } from "@/lib/services";
import { findToken, searchTokens, type TokenInfo, topTokens } from "@/lib/tokens/tokenList";
import { cn } from "@/lib/utils/cn";
import { formatPercent, formatUsdCompact } from "@/lib/utils/format";
import { NETWORKS } from "@/mocks/data/pools";
import { getDexPoolsAction } from "../actions";
import { type DerivedMandate, deriveMandate } from "../lib/deriveMandate";
import { snapPriceForPool } from "../lib/poolTickSnap";
import { roundPrice } from "../lib/priceFormat";

/** The ±% preset seeded into the selection when a pool is picked — edited on the Build step. */
const DEFAULT_PRESET = 10;

/** Pools shown before the "show more" button (then it reveals another page of this size). */
const INITIAL_VISIBLE = 6;

function feeLabel(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`;
}

/** Short contract address for the muted per-token line, e.g. 0x1234…5678. */
function truncAddr(address: string): string {
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}

/**
 * True when the pool has a defined market price. A pool with no market price carries the no-price
 * sentinel `currentPrice <= Number.MIN_VALUE` (set in {@link mapDexPool}); managers do not set an
 * initial price and only open positions in existing pools with defined prices, so such pools are not
 * offered in the picker (POO-497 [R1]). Kept pure + exported so the predicate is unit-tested directly.
 */
export function poolHasMarketPrice(pool: UniswapPool): boolean {
  return pool.currentPrice > Number.MIN_VALUE;
}

/**
 * True when `tokenAddress` (any case) is one of the pool's two token addresses. Compares
 * case-insensitively on BOTH sides: the token list stores checksum-cased addresses while pool
 * addresses come back lowercased, so a raw `===` would silently drop every matching pool.
 */
export function poolHasToken(pool: UniswapPool, tokenAddress: string): boolean {
  const target = tokenAddress.toLowerCase();
  return pool.token0Address.toLowerCase() === target || pool.token1Address.toLowerCase() === target;
}

/** A single token avatar (icon, or an initials fallback) used for the paired pool logos. */
function TokenAvatar({
  network,
  address,
  className,
}: {
  network: string;
  address: string;
  className?: string;
}) {
  const token = findToken(network, address);
  if (token?.iconUrl) {
    return (
      <img
        src={token.iconUrl}
        alt=""
        className={cn("rounded-full ring-2 ring-surface", className)}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex items-center justify-center rounded-full bg-surface-raised font-semibold text-[8px] text-muted-foreground ring-2 ring-surface",
        className,
      )}
    >
      {(token?.symbol[0] ?? "?").toUpperCase()}
    </span>
  );
}

/** The manager's in-progress Mandate selection — lifted so it persists across Mandate ↔ Review. */
export interface MandateSelection {
  /** Strategy display name — edited on Review & launch (required to launch/save). */
  name: string;
  /** Optional plain-language description of the strategy's thesis (max 280 chars). */
  description: string;
  /** Optional manager-uploaded logo (object/data URL), or null. */
  logoUrl: string | null;
  /** Selected network id. */
  network: string;
  /** Pool search query. */
  query: string;
  /** Selected pool id, or null. */
  poolId: string | null;
  /** Full-range toggle. */
  full: boolean;
  /** Active range preset (±%), "full", or null for a manual range. */
  activePreset: number | "full" | null;
  /** Manual min price (string, from the input). */
  minPrice: string;
  /** Manual max price (string, from the input). */
  maxPrice: string;
  /**
   * Whether the manager last edited the range in the inverted display orientation (the reciprocal
   * pair, e.g. USDC-per-ETH). Display-only: `minPrice`/`maxPrice` are ALWAYS canonical token1/token0.
   * Review reads this to echo the range in the orientation the manager chose; the create-pool DTO and
   * tick math ignore it. Defaults to false/undefined (canonical).
   */
  displayInverted?: boolean;
}

/** The resolved Mandate handed onward once a pool is picked. */
export interface MandateResult {
  /** The raw selection, so re-entering the step restores every input. */
  selection: MandateSelection;
  /** The chosen pool. */
  pool: UniswapPool;
  /** Auto-derived risk + category. */
  derived: DerivedMandate;
  /** Range half-width in percent (null = full range), for downstream display/create. */
  rangeWidthPct: number | null;
}

/** Public props for {@link MandateStep}. */
export interface MandateStepProps {
  /** The Uniswap v3 pool catalog to pick from. */
  pools: UniswapPool[];
  /** Initial selection to restore (e.g. when stepping back from Review). */
  initial?: MandateSelection;
  /** Advance to the Review step with the resolved mandate. */
  onNext: (result: MandateResult) => void;
}

/** Mandate step: network + pool (identity lives on Review; range + derived live on Build). */
export function MandateStep({ pools, initial, onNext }: MandateStepProps) {
  const t = useTranslations("manager");
  const [network, setNetwork] = useState(initial?.network ?? NETWORKS[0]?.id ?? "");
  const [query, setQuery] = useState(initial?.query ?? "");
  // Whether each token search is focused — drives the top-tokens list before the manager types
  // (POO-347). Empty + focused → top tokens; typing → searchTokens. The second field excludes the
  // already-picked first token so a pair can't be a duplicate (no USDC/USDC).
  const [tokenFocused, setTokenFocused] = useState(false);
  const [secondFocused, setSecondFocused] = useState(false);
  const [poolId, setPoolId] = useState<string | null>(initial?.poolId ?? null);
  const [full, setFull] = useState(initial?.full ?? false);
  const [activePreset, setActivePreset] = useState<number | "full" | null>(
    initial?.activePreset ?? 10,
  );
  const [minPrice, setMinPrice] = useState(initial?.minPrice ?? "");
  const [maxPrice, setMaxPrice] = useState(initial?.maxPrice ?? "");

  // Real mode: pools come from /dex-pools for a picked token (the endpoint is pair-keyed, so the
  // manager picks a token from the static list first). Mock mode: free-text search over the catalog.
  const realMode = !isMockMode;
  const [selectedToken, setSelectedToken] = useState<TokenInfo | null>(null);
  const [fetchedPools, setFetchedPools] = useState<UniswapPool[]>([]);
  const [loadingPools, setLoadingPools] = useState(false);
  // POO-452: a monotonically-increasing id so a slow pool fetch can't clobber a newer one (the
  // manager may change either token before the previous request resolves).
  const pairFetchSeq = useRef(0);
  // Optional second token to narrow the fetched pools to a specific pair (real mode).
  const [secondToken, setSecondToken] = useState<TokenInfo | null>(null);
  const [secondQuery, setSecondQuery] = useState("");
  // How many pools are currently shown (the "show more" button reveals more).
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE);

  const q = query.trim().toLowerCase();
  const visible = pools.filter((candidate) => {
    if (candidate.network !== network) return false;
    if (q.length === 0) return true;
    const pair = `${candidate.token0}/${candidate.token1}`.toLowerCase();
    return (
      pair.includes(q) ||
      candidate.address.toLowerCase().includes(q) ||
      candidate.token0Address.toLowerCase().includes(q) ||
      candidate.token1Address.toLowerCase().includes(q)
    );
  });
  // POO-497 [R1]: offer only pools with a DEFINED market price. Filtering here — the single point
  // where the mock (`visible`) and real (`fetchedPools`) entry paths merge — hides no-price pools
  // entirely from the initial list, the search results and the "show more" pages at once (everything
  // below derives from `poolOptions`). Managers do not set an initial price; they only open positions
  // in existing, priced pools.
  const poolOptions = (realMode ? fetchedPools : visible).filter(poolHasMarketPrice);
  const pool = poolOptions.find((candidate) => candidate.id === poolId) ?? null;

  // Narrow to a specific pair when a second token is chosen (its address must be one of the pool's).
  const filteredPools =
    realMode && secondToken
      ? poolOptions.filter((candidate) => poolHasToken(candidate, secondToken.address))
      : poolOptions;
  const visiblePools = filteredPools.slice(0, visibleCount);
  const hasMore = filteredPools.length > visibleCount;

  // Fee-tier share (#14): a pool's TVL among all fetched pools of the SAME pair, so each tier row
  // shows what % of the pair's liquidity sits in that tier ("% selected"). Picking a different tier
  // row is how the manager changes the fee tier.
  const pairTvl = new Map<string, number>();
  for (const candidate of poolOptions) {
    const key = `${candidate.token0Address.toLowerCase()}-${candidate.token1Address.toLowerCase()}`;
    pairTvl.set(key, (pairTvl.get(key) ?? 0) + candidate.tvlUsd);
  }
  const tierSharePct = (candidate: UniswapPool) => {
    const key = `${candidate.token0Address.toLowerCase()}-${candidate.token1Address.toLowerCase()}`;
    const total = pairTvl.get(key) ?? 0;
    return total > 0 ? Math.round((candidate.tvlUsd / total) * 100) : 0;
  };

  // Real-mode token suggestions from the static list, shown while searching before a token is
  // picked. Relevance-ranked (canonical WETH/WBTC/USDC… first), then capped — so "eth" surfaces
  // WETH instead of the alphabetical Aave-wrapper junk (aBasWETH, EBULL, …).
  // Only while the search is focused: blurring (clicking away) closes the dropdown whether the field
  // is empty (top tokens) or has a typed query (POO-347 — previously a typed query kept the list open
  // after blur). The suggestion buttons preventDefault on mousedown so picking one keeps focus and the
  // click still lands before the list unmounts.
  const tokenSuggestions =
    realMode && !selectedToken && tokenFocused
      ? q.length > 0
        ? searchTokens(network, q, 12)
        : topTokens(network, 12)
      : [];
  // Suggestions for the optional second token: top tokens on focus, search results while typing —
  // both excluding the already-picked first token so the pair can't be a duplicate (no USDC/USDC).
  // Same focus gate as the first field so blur closes it too.
  const secondSuggestions =
    realMode && selectedToken && !secondToken && secondFocused
      ? (secondQuery.trim().length > 0
          ? searchTokens(network, secondQuery.trim(), 8)
          : topTokens(network, 12)
        ).filter((tok) => tok.address !== selectedToken.address)
      : [];

  function selectPool(target: UniswapPool) {
    setPoolId(target.id);
    // Seed the default range (silently — no range UI here): Build opens on a valid ±10%, already
    // snapped onto the pool's usable-tick grid so the pre-set bounds are valid ticks (POO-408 R3).
    setFull(false);
    setActivePreset(DEFAULT_PRESET);
    const grid = {
      currentPrice: target.currentPrice,
      feeBps: target.feeBps,
      decimals0: target.decimals0,
      decimals1: target.decimals1,
    };
    const lo = snapPriceForPool(target.currentPrice * (1 - DEFAULT_PRESET / 100), grid);
    const hi = snapPriceForPool(target.currentPrice * (1 + DEFAULT_PRESET / 100), grid);
    setMinPrice(roundPrice(lo, target.currentPrice));
    setMaxPrice(roundPrice(hi, target.currentPrice));
  }

  async function selectToken(token: TokenInfo) {
    setSelectedToken(token);
    setQuery(token.symbol);
    setPoolId(null);
    setSecondToken(null);
    setSecondQuery("");
    setVisibleCount(INITIAL_VISIBLE);
    const seq = ++pairFetchSeq.current;
    setLoadingPools(true);
    try {
      const pools = await getDexPoolsAction(network, token.address);
      if (seq === pairFetchSeq.current) setFetchedPools(pools);
    } catch {
      if (seq === pairFetchSeq.current) setFetchedPools([]);
    } finally {
      if (seq === pairFetchSeq.current) setLoadingPools(false);
    }
  }

  function clearToken() {
    setSelectedToken(null);
    setFetchedPools([]);
    setQuery("");
    setPoolId(null);
    setSecondToken(null);
    setSecondQuery("");
    setVisibleCount(INITIAL_VISIBLE);
  }

  async function selectSecondToken(token: TokenInfo) {
    setSecondToken(token);
    setSecondQuery(token.symbol);
    setPoolId(null);
    setVisibleCount(INITIAL_VISIBLE);
    // POO-452 R1: re-fetch the pool universe with BOTH tokens (currency0 + currency1) so discovery
    // is independent of the order the manager picked them. The single-token backend search is
    // asymmetric (keyed on a common token like ETH it misses the pair), so the second token alone
    // could only narrow, never surface, the pool. A newer selection wins (R3).
    // PP-INTEGRATION-POINT (POO-452 / POO-305): the currency0+currency1 path is the backend's
    // deterministic on-chain pair lookup; confirm it returns all fee-tier pools for the pair.
    if (!selectedToken) return;
    const seq = ++pairFetchSeq.current;
    setLoadingPools(true);
    try {
      const pools = await getDexPoolsAction(network, selectedToken.address, token.address);
      if (seq === pairFetchSeq.current) setFetchedPools(pools);
    } catch {
      if (seq === pairFetchSeq.current) setFetchedPools([]);
    } finally {
      if (seq === pairFetchSeq.current) setLoadingPools(false);
    }
  }

  function clearSecondToken() {
    setSecondToken(null);
    setSecondQuery("");
    setPoolId(null);
    setVisibleCount(INITIAL_VISIBLE);
  }

  function selectNetwork(id: string) {
    setNetwork(id);
    if (pool && pool.network !== id) setPoolId(null);
    if (realMode) clearToken();
  }

  // Range half-width %, used by the derivation (null = full range).
  let widthPct: number | null = null;
  if (pool && !full) {
    const lo = Number.parseFloat(minPrice);
    const hi = Number.parseFloat(maxPrice);
    if (Number.isFinite(lo) && Number.isFinite(hi) && hi > lo) {
      widthPct = ((hi - lo) / 2 / pool.currentPrice) * 100;
    }
  }
  const derived: DerivedMandate | null = pool ? deriveMandate(pool, full ? null : widthPct) : null;
  // The only requirement to advance is a picked pool (identity + fees are set on Review); surfaced
  // on the CTA so tapping it while empty says what's missing.
  const missing = pool ? [] : [t("mandate.poolLabel")];

  const chip = (selected: boolean) =>
    cn(
      "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 font-medium text-sm transition-colors",
      selected
        ? "border-primary bg-primary/10 text-foreground"
        : "border-border text-muted-foreground hover:text-foreground",
    );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 className="font-semibold text-foreground text-lg">{t("mandate.title")}</h2>
        <p className="text-muted-foreground text-sm">{t("mandate.subtitle")}</p>
      </div>

      {/* Network */}
      <div className="flex flex-col gap-2">
        <p className="font-medium text-foreground text-sm">{t("mandate.networkLabel")}</p>
        <div className="flex flex-wrap gap-2">
          {NETWORKS.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => selectNetwork(option.id)}
              aria-pressed={network === option.id}
              className={chip(network === option.id)}
            >
              <NetworkLogo
                network={option.id}
                name={option.name}
                fallbackColor={option.brandColor}
              />
              {option.name}
            </button>
          ))}
        </div>
      </div>

      {/* Tokens — pick a token (real mode fetches its pools); add a second to narrow to a pair. */}
      <div className="flex flex-col gap-2">
        <p className="font-medium text-foreground text-sm">{t("mandate.tokensLabel")}</p>

        {realMode && selectedToken ? (
          <div className="flex flex-col gap-2">
            {/* The whole row is the change affordance (not just the "Change" text). */}
            <button
              type="button"
              onClick={clearToken}
              className="flex w-full items-center justify-between gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-left transition-colors hover:border-muted-foreground/40"
            >
              <span className="flex items-center gap-2 font-medium text-foreground text-sm">
                {selectedToken.iconUrl ? (
                  <img src={selectedToken.iconUrl} alt="" className="size-5 rounded-full" />
                ) : null}
                {selectedToken.symbol}
              </span>
              <span className="text-muted-foreground text-xs">{t("mandate.logoChange")}</span>
            </button>

            {/* Optional second token to narrow the fetched pools to a specific pair. */}
            {secondToken ? (
              <button
                type="button"
                onClick={clearSecondToken}
                className="flex w-full items-center justify-between gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-left transition-colors hover:border-muted-foreground/40"
              >
                <span className="flex items-center gap-2 font-medium text-foreground text-sm">
                  {secondToken.iconUrl ? (
                    <img src={secondToken.iconUrl} alt="" className="size-5 rounded-full" />
                  ) : null}
                  {secondToken.symbol}
                </span>
                <span className="text-muted-foreground text-xs">{t("mandate.logoRemove")}</span>
              </button>
            ) : (
              <>
                <Input
                  value={secondQuery}
                  onChange={(event) => {
                    setSecondQuery(event.target.value);
                    setVisibleCount(INITIAL_VISIBLE);
                  }}
                  onFocus={() => setSecondFocused(true)}
                  onBlur={() => setSecondFocused(false)}
                  placeholder={t("mandate.secondTokenSearch")}
                  aria-label={t("mandate.secondTokenSearch")}
                />
                {secondSuggestions.length > 0 ? (
                  <ul className="flex flex-col gap-1">
                    {secondSuggestions.map((tok) => (
                      <li key={tok.address}>
                        <button
                          type="button"
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => selectSecondToken(tok)}
                          className="flex w-full items-center gap-2 rounded-lg border border-border bg-surface p-2 text-left transition-colors hover:border-muted-foreground/40"
                        >
                          {tok.iconUrl ? (
                            <img
                              src={tok.iconUrl}
                              alt=""
                              className="size-5 shrink-0 rounded-full"
                            />
                          ) : null}
                          <span className="font-medium text-foreground text-sm">{tok.symbol}</span>
                          <span className="truncate text-muted-foreground text-xs">{tok.name}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </>
            )}
          </div>
        ) : (
          <Input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setVisibleCount(INITIAL_VISIBLE);
            }}
            onFocus={() => setTokenFocused(true)}
            onBlur={() => setTokenFocused(false)}
            placeholder={t("mandate.poolSearch")}
            aria-label={t("mandate.poolSearch")}
          />
        )}

        {/* Real-mode token suggestions while searching (before a token is picked). */}
        {tokenSuggestions.length > 0 ? (
          <ul className="flex flex-col gap-1">
            {tokenSuggestions.map((tok) => (
              <li key={tok.address}>
                <button
                  type="button"
                  // Select on mousedown-without-blur: keep the input focused so the focus-driven list
                  // (empty query) doesn't unmount before the click lands (POO-347).
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => selectToken(tok)}
                  className="flex w-full items-center gap-2 rounded-lg border border-border bg-surface p-2 text-left transition-colors hover:border-muted-foreground/40"
                >
                  {tok.iconUrl ? (
                    <img src={tok.iconUrl} alt="" className="size-5 shrink-0 rounded-full" />
                  ) : null}
                  <span className="font-medium text-foreground text-sm">{tok.symbol}</span>
                  <span className="truncate text-muted-foreground text-xs">{tok.name}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {/* Pools */}
      <div className="flex flex-col gap-2">
        <p className="font-medium text-foreground text-sm">{t("mandate.poolsLabel")}</p>
        {realMode && loadingPools ? (
          <p className="py-4 text-center text-muted-foreground text-sm">
            {t("mandate.poolsLoading")}
          </p>
        ) : realMode && !selectedToken ? (
          tokenSuggestions.length === 0 ? (
            <p className="py-4 text-center text-muted-foreground text-sm">
              {t("mandate.tokenHint")}
            </p>
          ) : null
        ) : filteredPools.length === 0 ? (
          <p className="py-4 text-center text-muted-foreground text-sm">{t("mandate.poolEmpty")}</p>
        ) : (
          <>
            <ul className="flex flex-col gap-2">
              {visiblePools.map((option) => {
                const selected = option.id === poolId;
                return (
                  <li key={option.id}>
                    <button
                      type="button"
                      onClick={() => selectPool(option)}
                      aria-pressed={selected}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors",
                        selected
                          ? "border-primary bg-primary/5"
                          : "border-border bg-surface hover:border-muted-foreground/40",
                      )}
                    >
                      {/* Both token logos before the pair name (overlapping pair convention). */}
                      <span className="flex shrink-0 items-center">
                        <TokenAvatar
                          network={option.network}
                          address={option.token0Address}
                          className="size-6"
                        />
                        <TokenAvatar
                          network={option.network}
                          address={option.token1Address}
                          className="-ml-2 size-6"
                        />
                      </span>
                      <div className="flex min-w-0 flex-1 flex-col">
                        <span className="flex items-center gap-2">
                          <span className="font-medium text-foreground text-sm">
                            {option.token0}/{option.token1}
                          </span>
                          {/* Protocol the pool runs on. V1 is Uniswap-only; this becomes per-pool
                              once the backend exposes `dex` (POO-325). */}
                          <ProtocolBadge
                            size={13}
                            className="shrink-0 text-[10px] text-muted-foreground"
                          />
                        </span>
                        <span className="text-muted-foreground text-xs">
                          {feeLabel(option.feeBps)} ·{" "}
                          {t("mandate.tierShare", { pct: tierSharePct(option) })}
                        </span>
                        {/* Contract addresses, de-emphasized. */}
                        <span className="truncate text-[10px] text-muted-foreground/60">
                          {truncAddr(option.token0Address)} / {truncAddr(option.token1Address)}
                        </span>
                      </div>
                      <div className="flex flex-col items-end text-xs">
                        <span className="text-foreground">
                          {t("mandate.poolTvl")} {formatUsdCompact(option.tvlUsd)}
                        </span>
                        <span className="text-success">
                          <AprTooltip>{t("mandate.poolApr")}</AprTooltip>{" "}
                          {formatPercent(option.aprPct)}
                        </span>
                      </div>
                      {selected ? (
                        <Check className="size-5 shrink-0 text-primary" aria-hidden="true" />
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
            {hasMore ? (
              <button
                type="button"
                onClick={() => setVisibleCount((count) => count + INITIAL_VISIBLE)}
                className="self-center rounded-full border border-border px-4 py-1.5 font-medium text-muted-foreground text-sm transition-colors hover:text-foreground"
              >
                {t("mandate.showMore")}
              </button>
            ) : null}
          </>
        )}
      </div>

      {/* Wizard convention: "Next" always sits on the right. */}
      <CtaWithMissing
        size="lg"
        wrapperClassName="self-end items-end"
        missing={missing}
        missingTitle={t("missing.title")}
        onClick={() => {
          if (!pool || !derived) return;
          onNext({
            selection: {
              // Identity passes through untouched — it's edited on Review & launch.
              name: initial?.name ?? "",
              description: initial?.description ?? "",
              logoUrl: initial?.logoUrl ?? null,
              network,
              query,
              poolId,
              full,
              activePreset,
              minPrice,
              maxPrice,
            },
            pool,
            derived,
            rangeWidthPct: full ? null : widthPct,
          });
        }}
      >
        {t("builder.nextBuild")}
      </CtaWithMissing>
    </div>
  );
}
