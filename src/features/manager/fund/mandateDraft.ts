/**
 * @id PP-MGR-LIB-019
 * @name mandateDraft
 * @implements-rules-version v3 (POO-2121 rules v1, POO-2142 rules v2, POO-2143 rules v2,
 *   POO-2167 rules v3, POO-2151 rules v1)
 * @analytics-events none, a pure domain module. The builder shell (PP-MGR-SCR-002) owns every
 *   mandate event, and the steps raise a {@link StepBlock} that the shell turns into
 *   `builder_mandate_blocked`. Nothing here touches the dataLayer.
 *
 * The whole Mandate step of the fund-contracts strategy builder, as data: the draft shape, the
 * rules that keep a draft internally consistent, step visibility and reachability, per-step
 * validation, the Broad mandate derivation and the cap rows. The five screens (S3 to S6) hold no
 * mandate logic of their own; they render what this module computes and call these reducers.
 *
 * Two invariants drive almost everything here, and both come from the contracts
 * (PoolPartyLabs/smartcontract-v2, DEC-018, DEC-030, DEC-053):
 *
 * 1. A mandate is a CLOSED list. Networks, protocols, tokens and pools are fixed when the fund is
 *    created, so a reducer that drops a network must also drop everything downstream of it
 *    (its tokens, its pools, its cap rows) or the draft describes a fund that cannot exist.
 * 2. The hub (Arbitrum) and the two required protocols are never absent, and the deposit token is
 *    never removable. Those are locked rows in the UI and locked facts here.
 *
 * Every reducer is pure and immutable: it returns a NEW draft and leaves its input alone. That is
 * not a style preference. {@link useMandateDraft} keeps the previous draft when a reducer refuses
 * (returns `{ blocked }`), so a reducer that mutated on its way to a refusal would leave the screen
 * showing a change the store rejected. Reducers also never read a clock: the store stamps
 * `updatedAt` on write, so the same input always produces the same output.
 *
 * The catalog arrives as an ARGUMENT rather than an import (see mandateCatalog.ts). It no longer
 * depends on a feature flag (rules v2, POO-2142), but its source is still the seam that becomes the
 * fund contracts' own registries, and a reducer that imported it could not be handed another one.
 */
import { getUsdcAddress, networkToChainId, supportedChainMetas } from "@/lib/chains/config";
// Types only: the plan module imports this one's types back, so a runtime import would be a cycle.
import type { BuilderPhase, BuildPlan } from "./build/plan/buildPlan";
import type { MandateCatalog, MandateCatalogToken } from "./mandateCatalog";

// ---------------------------------------------------------------------------
// Identities and ordering
// ---------------------------------------------------------------------------

/**
 * A network a mandate can name. Only the hub and Robinhood Chain exist on chain today (DEC-018), and
 * they are the only two the buildathon scope offers (R16 v2).
 */
export type NetworkId =
  // PP-NOTE: buildathon scope (2026-10-03, POO-2142): commented out, restore when the fund contracts reach it.
  // "base" |
  // "polygon" |
  // "unichain" |
  "arbitrum" | "robinhood";

/**
 * A protocol a mandate can name. `uniswap-v3-swap` is the swap adapter, not the position protocol.
 * The buildathon scope operates Aave v3 and Uniswap v4 (R20 v3); Uniswap v3 positions stay listed
 * but unavailable ({@link UNAVAILABLE_PROTOCOLS}), and GMX is no longer named at all (R21 v2).
 */
export type ProtocolId =
  // PP-NOTE: buildathon scope (2026-10-03, POO-2143): commented out, restore when the fund contracts reach it.
  // "gmx" |
  "uniswap-v3-swap" | "across" | "aave-v3" | "uniswap-v3" | "uniswap-v4";

/** The protocols that make the Pools step meaningful: they hold liquidity positions. */
export type DexProtocolId = "uniswap-v3" | "uniswap-v4";

/** The five Mandate sub-steps. */
export type MandateStepKey = "networks" | "protocols" | "tokens" | "pools" | "limits";

/** Canonical step order. `visibleSteps` filters it; nothing else re-orders it. */
export const MANDATE_STEP_ORDER: readonly MandateStepKey[] = [
  "networks",
  "protocols",
  "tokens",
  "pools",
  "limits",
];

/** Catalog order for networks (R16: a selection renders in this order, not in click order). */
export const NETWORK_ORDER: readonly NetworkId[] = [
  "arbitrum",
  "robinhood",
  // PP-NOTE: buildathon scope (2026-10-03, POO-2142): commented out, restore when the fund contracts reach it.
  // "base",
  // "polygon",
  // "unichain",
];

/** Catalog order for protocols (R20), required two first. */
export const PROTOCOL_ORDER: readonly ProtocolId[] = [
  "uniswap-v3-swap",
  "across",
  "aave-v3",
  "uniswap-v3",
  "uniswap-v4",
  // PP-NOTE: buildathon scope (2026-10-03, POO-2143): commented out, restore when the fund contracts reach it.
  // "gmx",
];

/** The position protocols. A draft with none of these skips the Pools step (R29). */
export const DEX_PROTOCOL_IDS: readonly DexProtocolId[] = ["uniswap-v3", "uniswap-v4"];

/**
 * Protocols the product lists but cannot operate (R21). An id listed here renders disabled with
 * "Coming soon", no reducer accepts it, and a stored draft that still names it loses it on load
 * ({@link withoutUnavailableProtocols}).
 *
 * R20 v3 (2026-10-03, POO-2167): Uniswap v3 POSITIONS are here because the fund contracts have no
 * Uniswap v3 position adapter yet. The required `uniswap-v3-swap` is a different id and never here
 * (R19). In mock mode every piece of Uniswap v3 position code (the pool source's mock path, the
 * Pools tabs, the mapping) stays in place and unreachable through the UI, so restoring the protocol
 * there is removing it from this list. Real mode (POO-2133) has no Uniswap v3 path to restore:
 * `buildRealCatalog` pins it unavailable, `withProtocols` refuses it, `toV2MandateSelection`
 * allow-lists the other four ids and `searchReal` reads only the v4 catalog.
 */
export const UNAVAILABLE_PROTOCOLS: readonly ProtocolId[] = [
  "uniswap-v3",
  // PP-NOTE: buildathon scope (2026-10-03, POO-2143): commented out, restore when the fund contracts reach it.
  // "gmx",
];

/** The contract ceiling on token entries (DEC-030). A token takes one slot per network it runs on. */
export const MAX_TOKEN_SLOTS = 16;

/** The hub. Deposits and withdrawals happen here, and it can never leave a mandate (R15). */
export const HUB_NETWORK: NetworkId = "arbitrum";

/** Every strategy needs a way to swap and a way to move money between its networks (R19). */
export const REQUIRED_PROTOCOLS: readonly ProtocolId[] = ["uniswap-v3-swap", "across"];

/**
 * The symbols the hub price source can price (R28), lowercased.
 *
 * PP-NOTE: assumption (coordinator default, handoff open point 2). The contracts require every
 * mandate token to be priced by the hub, and the real answer is a registry the fund contracts have
 * not shipped. This list is the conservative reading of "USDC, WETH, USDG today" widened to the
 * blue chips the static token lists already carry. A bridged `USDC.e` is deliberately ABSENT: it is
 * a different token from the chain's native stable and must not inherit its price feed.
 *
 * PP-INTEGRATION-POINT: becomes a read from the fund contracts' price-source registry (wiring issue
 * POO-2134). Until then a token outside this set renders disabled with "No price feed yet" and no
 * reducer accepts it.
 */
export const PRICED_SYMBOLS: ReadonlySet<string> = new Set([
  "usdc",
  "eth",
  "weth",
  "usdg",
  "wbtc",
  "cbbtc",
  "usdt",
  "dai",
  "arb",
  "link",
  "wsteth",
]);

/** Draft name bounds (R8), the same rule the create-pool API applies to the strategy name. */
export const DRAFT_NAME_MIN = 10;
export const DRAFT_NAME_MAX = 50;

/** Caps move in 5% steps (R39). */
export const CAP_STEP_PCT = 5;

// ---------------------------------------------------------------------------
// The draft
// ---------------------------------------------------------------------------

/** One token entry in a mandate. `locked` marks the deposit token row, one per selected network. */
export interface MandateTokenRef {
  address: string;
  symbol: string;
  name: string;
  network: NetworkId;
  logoUrl: string | null;
  /** The deposit token (R24). Never removable, and it never gets a cap row (R43). */
  locked: boolean;
}

/** One pool in a mandate. Shape mirrors what `mapDexPool` produces from the `/dex-pools` API. */
export interface MandatePoolRef {
  poolId?: string;
  poolKey?: {
    currency0: string;
    currency1: string;
    fee: number;
    tickSpacing: number;
    hooks: string;
  };
  id: string;
  address: string;
  network: NetworkId;
  protocol: DexProtocolId;
  token0: Pick<MandateTokenRef, "address" | "symbol" | "name" | "logoUrl">;
  token1: Pick<MandateTokenRef, "address" | "symbol" | "name" | "logoUrl">;
  feeBps: number;
  feeTier: number;
  tvlUsd: number | null;
  aprPct: number | null;
  /** Share of V1 managers who chose this tier, read from the API. Never invented; null when absent. */
  tierSharePct: number | null;
  /** Uniswap v4 hooks are not supported, so a pool with one cannot be added (R38). */
  hasHook: boolean;
}

/** A cap row. `pct` is a multiple of 5 within 0..100 and is ignored while `noCap` is true (R39). */
export interface MandateCap {
  noCap: boolean;
  pct: number;
}

/** Caps per scope. Token keys are {@link tokenKey} (`network:address`), never a bare address. */
export interface MandateCaps {
  networks: Partial<Record<NetworkId, MandateCap>>;
  protocols: Partial<Record<ProtocolId, MandateCap>>;
  tokens: Record<string, MandateCap>;
}

/** The one object the five Mandate screens read and write. */
export interface MandateDraft {
  review?: import("./launch/review").ReviewDraft;
  v2Selection?: {
    chains: { chainId: 42161 | 4663; tokens: string[]; uniswapV4PoolIds: string[] }[];
    aaveV3Reserves: string[];
    spokeCapPercent: number | null;
  };
  dataMode?: "real";
  catalogVersion?: "v2-catalog-v1";
  positionProtocolsByChain?: Partial<Record<NetworkId, ("uniswap-v4" | "aave-v3")[]>>;
  aaveV3Reserves?: string[];
  spokeCapPercent?: number | null;
  id: string;
  name: string | null;
  createdAt: string;
  updatedAt: string;
  /** When the draft last reached storage. Null means it exists only in memory (R7). */
  savedAt: string | null;
  lastStep: MandateStepKey;
  /** Append-only, set by the shell on Next (R9). Reachability derives from it. */
  passedSteps: MandateStepKey[];
  networks: NetworkId[];
  protocols: ProtocolId[];
  tokens: MandateTokenRef[];
  pools: MandatePoolRef[];
  caps: MandateCaps;
  completedAt: string | null;
  /**
   * How many pools the Pools step found with at least one mandate token on the selected networks
   * the last time it searched (R35), or null before any search. The Broad mandate flag (R13) is
   * derived against it ({@link isBroadMandate}); it is kept on the draft so a completed draft that
   * is resumed later can still raise the flag on Review without re-running the search.
   *
   * Published by the Pools step and written by the shell. Reducers here never SET it, but every
   * reducer that actually moves the networks, the protocols or the tokens clears it back to null,
   * because the number was measured over those three lists and describes nothing once they change.
   * A call that changes nothing keeps it; so does adding or removing a pool out of a universe that
   * is already known.
   */
  poolUniverseCount: number | null;
  /**
   * The Build canvas plan (POO-2151, PP-MGR-LIB-021). OPTIONAL, so every draft written before the
   * canvas existed, and every literal draft in a test, stays a valid draft: no plan reads as the
   * empty plan (`planOf`). When the stored plan cannot be read, the draft is kept WITHOUT a plan and
   * carries {@link planUnreadable}. Never part of {@link selectionFingerprint}, so a plan edit never
   * invalidates a completed mandate (D17); the unsaved fingerprint counts it instead.
   */
  plan?: BuildPlan;
  /**
   * True iff storage holds a plan for this draft that this build cannot read (for example one a
   * newer build wrote). Set by the draft store on READ, never stored. The draft then has no `plan`
   * (the app works with the empty plan, not a guess), and the store keeps the raw plan untouched on
   * every write, of this draft or any other, until a save of this draft with a new `plan` replaces it
   * (PR #31 review, F1: a plan is never deleted silently). Absent means false.
   */
  planUnreadable?: boolean;
  /**
   * The builder phase this draft was last saved in (coordinator default D16). OPTIONAL: no value
   * reads as "mandate". Bookkeeping, like `lastStep`, so it is in no fingerprint.
   */
  lastPhase?: BuilderPhase;
}

/** Why the product said no. Maps 1:1 to the blocked-intent reason the shell reports. */
export type MandateBlockReason =
  | "nothing_selected"
  | "cap_missing"
  | "no_slots"
  | "has_hook"
  | "not_priced"
  | "coming_soon"
  | "name_length";

/**
 * A refusal a step renders inline. `rowId` is the `data-mandate-row` of the first offending row, so
 * the step can scroll it into view; null means the notice has no single row to point at.
 *
 * Row id conventions, so a step's `data-mandate-row` matches what a reducer reports:
 * - networks: the {@link NetworkId}
 * - protocols: the {@link ProtocolId}
 * - tokens: {@link tokenKey} of the catalog entry the step handed to {@link addToken}
 * - pools: the pool's `id`
 */
export interface StepBlock {
  step: MandateStepKey;
  reason: MandateBlockReason;
  rowId: string | null;
}

/** What every reducer that can refuse returns. */
export type MandateReducerResult = MandateDraft | { blocked: StepBlock };

/** Whether a reducer refused. The one narrowing every caller (steps, shell, hook) uses. */
export function isBlocked(result: unknown): result is { blocked: StepBlock } {
  return typeof result === "object" && result !== null && "blocked" in result;
}

// ---------------------------------------------------------------------------
// Small pure helpers
// ---------------------------------------------------------------------------

/** A token's identity inside a mandate: the same token on two networks is two entries. */
export function tokenKey(t: Pick<MandateTokenRef, "network" | "address">): string {
  return `${t.network}:${t.address.toLowerCase()}`;
}

/** Whether the hub price source can price this symbol (R28), case-insensitive. */
export function isPricedSymbol(symbol: string): boolean {
  return PRICED_SYMBOLS.has(symbol.toLowerCase());
}

/** Slots consumed: one per token ENTRY, so the locked deposit rows count too (R27). */
export function slotsUsed(draft: MandateDraft): number {
  return draft.tokens.length;
}

/** Whether the mandate can hold liquidity positions, which is what makes Pools exist (R29). */
export function hasDexProtocol(draft: MandateDraft): boolean {
  return draft.protocols.some((p) => (DEX_PROTOCOL_IDS as readonly ProtocolId[]).includes(p));
}

/** The counts the Save and exit dialog and the drafts list print. */
export function selectionCounts(draft: MandateDraft): {
  networks: number;
  protocols: number;
  tokens: number;
  pools: number;
} {
  return {
    networks: draft.networks.length,
    protocols: draft.protocols.length,
    tokens: draft.tokens.length,
    pools: draft.pools.length,
  };
}

/**
 * What the manager CHOSE, as one comparable string: networks, protocols, tokens, pools, caps.
 *
 * The bookkeeping is deliberately left out. `lastStep` and `passedSteps` say where the manager is
 * standing, `poolUniverseCount` is a denominator the Pools step publishes, and `updatedAt` is
 * stamped by the store on every write; none of them is an edit, and a comparison that counted them
 * would answer "yes, something changed" to a Next, a Back and a deep link into a saved draft.
 *
 * Two callers need exactly this answer, which is why it lives here rather than in either of them:
 * the leave-page prompt (`useMandateDraft`'s `isDirty`, which adds the name and the completion stamp
 * on top) and the builder shell, which invalidates a completion when a selection changes under it.
 */
export function selectionFingerprint(draft: MandateDraft): string {
  return JSON.stringify([
    draft.networks,
    draft.protocols,
    draft.tokens,
    draft.pools,
    draft.caps,
    ...(draft.dataMode === "real"
      ? [draft.positionProtocolsByChain, draft.aaveV3Reserves, draft.spokeCapPercent]
      : []),
  ]);
}

/** R8: the draft name rule, as the dialog's helper and its blocked click both read it. */
export function draftNameError(name: string): "empty" | "length" | null {
  const trimmed = name.trim();
  if (trimmed.length === 0) return "empty";
  if (trimmed.length < DRAFT_NAME_MIN || trimmed.length > DRAFT_NAME_MAX) return "length";
  return null;
}

/** Keep only the record entries whose key survives `keep`, as a new object. */
function retainKeys<T>(
  record: Record<string, T | undefined>,
  keep: (key: string) => boolean,
): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [key, value] of Object.entries(record)) {
    if (value !== undefined && keep(key)) out[key] = value;
  }
  return out;
}

/**
 * The deposit token row for a network (R18), or null when the chain config has no stable for it.
 *
 * PP-NOTE: R18, coordinator decision 2026-10-03 (handoff open point 3). The handoff says the screens
 * show "USDC" everywhere until the Robinhood spoke token is settled with Rafael, but the chain config
 * (POO-1779 [R1]) forbids printing the literal "USDC" beside the Robinhood stable, whose address IS
 * USDG. Mislabelling an address is a compliance defect, so the row reads the chain's own stable
 * symbol and name (USDC / USD Coin on the launch chains, USDG / Global Dollar on Robinhood Chain) and
 * keeps the "Deposit token" caption. Murilo can overturn this; it is the one place to change.
 */
export function depositTokenRefFor(network: NetworkId): MandateTokenRef | null {
  const chainId = networkToChainId(network);
  if (chainId == null) return null;
  const address = getUsdcAddress(chainId);
  if (!address) return null;
  const meta = supportedChainMetas.find((m) => m.apiNetworkId === network);
  return {
    address: address.toLowerCase(),
    symbol: meta?.usdc.symbol ?? "USDC",
    name: meta?.usdc.name ?? "USD Coin",
    network,
    logoUrl: meta?.usdc.logoUrl ?? null,
    locked: true,
  };
}

// ---------------------------------------------------------------------------
// Step visibility, order and reachability (R9, R29)
// ---------------------------------------------------------------------------

/** The steps this draft actually has. Pools disappears without a position protocol (R29). */
export function visibleSteps(draft: MandateDraft): MandateStepKey[] {
  const dex = hasDexProtocol(draft);
  return MANDATE_STEP_ORDER.filter((step) => step !== "pools" || dex);
}

/**
 * 1-based position for "MANDATE · STEP n OF count", counted over the VISIBLE steps, so Limits reads
 * "STEP 4 OF 4" when Pools is skipped. A hidden step reports index 0, which no header renders.
 */
export function stepIndex(
  draft: MandateDraft,
  step: MandateStepKey,
): { index: number; count: number } {
  const visible = visibleSteps(draft);
  return { index: visible.indexOf(step) + 1, count: visible.length };
}

/** The next visible step after `step`, or null at the end of the mandate. */
export function nextStep(draft: MandateDraft, step: MandateStepKey): MandateStepKey | null {
  const from = MANDATE_STEP_ORDER.indexOf(step);
  if (from < 0) return null;
  for (const candidate of visibleSteps(draft)) {
    if (MANDATE_STEP_ORDER.indexOf(candidate) > from) return candidate;
  }
  return null;
}

/** The previous visible step before `step`, or null on the first one. */
export function previousStep(draft: MandateDraft, step: MandateStepKey): MandateStepKey | null {
  const from = MANDATE_STEP_ORDER.indexOf(step);
  if (from < 0) return null;
  const earlier = visibleSteps(draft).filter(
    (candidate) => MANDATE_STEP_ORDER.indexOf(candidate) < from,
  );
  return earlier.at(-1) ?? null;
}

/** Where a resumed draft lands: the first visible step nobody passed, else the last one (R9). */
export function firstUnpassedStep(draft: MandateDraft): MandateStepKey {
  const passed = new Set(draft.passedSteps);
  return visibleSteps(draft).find((step) => !passed.has(step)) ?? "limits";
}

/** R9: a step title and a bar segment are navigation only for a passed step or the next one. */
export function isStepReachable(draft: MandateDraft, step: MandateStepKey): boolean {
  if (!visibleSteps(draft).includes(step)) return false;
  return draft.passedSteps.includes(step) || step === firstUnpassedStep(draft);
}

/**
 * R9: the step a draft is DISPLAYED or RESUMED on: `lastStep` while that step is visible, else the
 * first visible step nobody passed.
 *
 * `lastStep` can name a step the draft no longer has. A stored draft parked on Pools whose only
 * position protocol was Uniswap v3 loses that protocol on load (R20 v3, POO-2167, see
 * {@link withoutUnavailableProtocols}) and with it the Pools step, while `lastStep` still says
 * "pools". Read raw, that is "step 0 of 4" in the Console and a frame of a step the stepper does not
 * draw in the builder, so every place that shows or resumes a draft's step reads it through here.
 */
export function resumeStep(draft: MandateDraft): MandateStepKey {
  return visibleSteps(draft).includes(draft.lastStep) ? draft.lastStep : firstUnpassedStep(draft);
}

// ---------------------------------------------------------------------------
// Cap rows and validation (R6, R40, R43)
// ---------------------------------------------------------------------------

/**
 * R43: the Limits step's rows, derived from the earlier steps.
 *
 * The hub never appears (R40: its cap is implicit, it holds what is not sent elsewhere), the two
 * required protocols never appear (they are not a place capital sits), and the locked deposit rows
 * never appear. The catalog is consulted only to drop an id it does not know at all, which is what
 * an old draft carrying a retired network or protocol looks like; an id the catalog knows but has
 * turned unavailable KEEPS its row, because the Networks step still shows it as selected and a row
 * the manager cannot see is a cap they cannot satisfy.
 */
export function capRows(
  draft: MandateDraft,
  catalog: MandateCatalog,
): { networks: NetworkId[]; protocols: ProtocolId[]; tokens: MandateTokenRef[] } {
  const knownNetworks = new Set<string>(catalog.networks.map((n) => n.id));
  const knownProtocols = new Set<string>(catalog.protocols.map((p) => p.id));
  return {
    networks: draft.networks.filter((n) => n !== HUB_NETWORK && knownNetworks.has(n)),
    protocols: draft.protocols.filter(
      (p) => !REQUIRED_PROTOCOLS.includes(p) && knownProtocols.has(p),
    ),
    tokens: draft.tokens.filter((t) => !t.locked),
  };
}

/**
 * R6: what stops Next on this step, or null when nothing does.
 *
 * Networks, Protocols and Tokens never block: the hub alone is a valid mandate, the required two
 * are always present, and USDC alone is a valid token list. The slot ceiling is enforced when a
 * token is ADDED (R27), not when the step is left, so there is nothing left to check here.
 */
export function validateStep(
  draft: MandateDraft,
  step: MandateStepKey,
  catalog: MandateCatalog,
): StepBlock | null {
  if (catalog.dataMode === "real") {
    if (
      catalog.loading ||
      catalog.error ||
      draft.dataMode !== "real" ||
      draft.catalogVersion !== "v2-catalog-v1"
    ) {
      return { step, reason: "coming_soon", rowId: null };
    }
    if (
      step === "protocols" &&
      !draft.protocols.some((id) => id === "uniswap-v4" || id === "aave-v3")
    ) {
      return { step, reason: "nothing_selected", rowId: null };
    }
    if (
      step === "protocols" &&
      draft.protocols.some(
        (id) => !catalog.protocols.some((protocol) => protocol.id === id && protocol.available),
      )
    )
      return { step, reason: "coming_soon", rowId: null };
    if (step === "tokens") {
      const allowed = [
        ...catalog.tokensFor(draft.networks, draft.protocols),
        ...draft.networks.flatMap((network) => {
          const base = catalog.depositTokenFor(network);
          return base ? [base] : [];
        }),
      ];
      if (
        draft.tokens.length > MAX_TOKEN_SLOTS ||
        draft.tokens.some(
          (token) => !allowed.some((entry) => tokenKey(entry) === tokenKey(token) && entry.priced),
        ) ||
        draft.networks.some((network) => {
          const base = catalog.depositTokenFor(network);
          return !base || !draft.tokens.some((entry) => tokenKey(entry) === tokenKey(base));
        })
      )
        return { step, reason: "not_priced", rowId: null };
    }
    if (step === "pools") {
      for (const network of draft.networks) {
        const selected =
          draft.positionProtocolsByChain?.[network] ??
          (draft.protocols.includes("uniswap-v4") ? ["uniswap-v4"] : []);
        if (
          selected.includes("uniswap-v4") &&
          !draft.pools.some((pool) => pool.network === network && pool.protocol === "uniswap-v4")
        ) {
          return { step, reason: "nothing_selected", rowId: network };
        }
      }
    }
    if (step === "limits") {
      if (draft.networks.includes("robinhood") && !draft.caps.networks.robinhood)
        return { step, reason: "cap_missing", rowId: "robinhood" };
      if (catalog.validateDraft && !catalog.validateDraft(draft))
        return { step, reason: "nothing_selected", rowId: null };
      return null;
    }
  }
  if (step === "pools") {
    if (!visibleSteps(draft).includes("pools")) return null;
    if (draft.pools.length > 0) return null;
    return { step: "pools", reason: "nothing_selected", rowId: null };
  }
  if (step === "limits") {
    const rows = capRows(draft, catalog);
    for (const network of rows.networks) {
      if (!draft.caps.networks[network]) {
        return { step: "limits", reason: "cap_missing", rowId: network };
      }
    }
    for (const protocol of rows.protocols) {
      if (!draft.caps.protocols[protocol]) {
        return { step: "limits", reason: "cap_missing", rowId: protocol };
      }
    }
    for (const token of rows.tokens) {
      const key = tokenKey(token);
      if (!draft.caps.tokens[key]) {
        return { step: "limits", reason: "cap_missing", rowId: key };
      }
    }
    return null;
  }
  return null;
}

/**
 * R13: whether this mandate is so wide that investors get told about it before they deposit.
 *
 * Both halves have to be true. Every priced token the catalog offers for the chosen networks is in
 * the draft, AND every pool in the universe the Pools step searched is in the draft. Selecting every
 * network, or every protocol, widens what COULD be chosen without choosing it, so neither raises the
 * flag on its own.
 *
 * `poolUniverseCount` is the count the Pools step measured, which only the Pools step can produce:
 * it is a search result, not a derivation. 0 means no universe has been resolved (the shell passes
 * `draft.poolUniverseCount ?? 0`), and an unknown universe never raises a flag an investor will see.
 *
 * PP-NOTE: say the consequence plainly. Every reducer that moves the networks, the protocols or the
 * tokens clears the count, and the manager can then reach the Build canvas without walking through
 * Pools again, so a mandate completed that way shows NO Broad flag even when it is in fact broad.
 * That is the safe direction for this draft screen (a missing flag here misinforms nobody; a wrong
 * one would) but it is NOT safe at launch: the launch path has to re-measure the universe before an
 * investor can ever read the flag. Tracked as POO-2136.
 */
export function isBroadMandate(
  draft: MandateDraft,
  catalog: MandateCatalog,
  poolUniverseCount: number,
): boolean {
  if (poolUniverseCount <= 0) return false;
  if (draft.pools.length < poolUniverseCount) return false;
  const selected = new Set(draft.tokens.map(tokenKey));
  return catalog
    .tokensFor(draft.networks, draft.protocols)
    .filter((token) => token.priced)
    .every((token) => selected.has(tokenKey(token)));
}

// ---------------------------------------------------------------------------
// Reducers
// ---------------------------------------------------------------------------

/** A brand-new draft: the hub, the required protocols, the hub deposit token, the hub's no-cap. */
export function createEmptyDraft(now: string, id: string): MandateDraft {
  const deposit = depositTokenRefFor(HUB_NETWORK);
  return {
    id,
    name: null,
    createdAt: now,
    updatedAt: now,
    savedAt: null,
    lastStep: "networks",
    passedSteps: [],
    networks: [HUB_NETWORK],
    protocols: [...REQUIRED_PROTOCOLS],
    tokens: deposit ? [deposit] : [],
    pools: [],
    // R40: the hub's cap is implicit on chain, and it is written down anyway so that the Limits
    // step has no row whose absence means two different things.
    caps: { networks: { [HUB_NETWORK]: { noCap: true, pct: 0 } }, protocols: {}, tokens: {} },
    completedAt: null,
    poolUniverseCount: null,
  };
}

/** Whether two id lists hold the same ids in the same order. */
function sameIds(before: readonly string[], after: readonly string[]): boolean {
  return before.length === after.length && before.every((id, index) => id === after[index]);
}

/**
 * Expire the pool-universe count when a reducer actually moved what it was measured over.
 *
 * One helper rather than a line in each reducer, because the question is the same everywhere and it
 * is a question about the RESULT, not about the intent: `withNetworks` called with the networks the
 * draft already has, an `addToken` for a token already in it and an `addPool` out of a known
 * universe all leave the three lists alone and must keep the count. The comparison is on token KEYS
 * (`network:address`), which is exactly the identity the universe search is run over.
 *
 * See {@link MandateDraft.poolUniverseCount} and {@link isBroadMandate} for what expiry costs.
 */
function withUniverseExpiry(before: MandateDraft, after: MandateDraft): MandateDraft {
  if (after.poolUniverseCount === null) return after;
  const unchanged =
    sameIds(before.networks, after.networks) &&
    sameIds(before.protocols, after.protocols) &&
    sameIds(before.tokens.map(tokenKey), after.tokens.map(tokenKey));
  return unchanged ? after : { ...after, poolUniverseCount: null };
}

/** Re-derive everything that hangs off the network list. Assumes `networks` is already validated. */
function syncNetworks(draft: MandateDraft, networks: NetworkId[]): MandateDraft {
  const keep = new Set<NetworkId>(networks);

  // R24: exactly one locked deposit row per selected network, in network order, first in the list.
  const existingLocked = new Map(
    draft.tokens.filter((t) => t.locked).map((t) => [t.network, t] as const),
  );
  const locked: MandateTokenRef[] = [];
  for (const network of networks) {
    const current = existingLocked.get(network) ?? depositTokenRefFor(network);
    if (current) locked.push(current);
  }
  const unlocked = draft.tokens.filter((t) => !t.locked && keep.has(t.network));
  const tokens = [...locked, ...unlocked];
  const tokenKeys = new Set(tokens.map(tokenKey));

  const pools = draft.pools.filter((p) => keep.has(p.network));

  return {
    ...draft,
    networks,
    tokens,
    pools,
    caps: {
      ...draft.caps,
      networks: retainKeys(draft.caps.networks, (key) => keep.has(key as NetworkId)),
      tokens: retainKeys(draft.caps.tokens, (key) => tokenKeys.has(key)),
    },
  };
}

/**
 * R15/R16/R17: set the network list.
 *
 * The hub is always kept, whatever the argument says. A network the catalog marks unavailable is
 * ignored rather than rejected: the row is disabled in the UI, so arriving here means a stale draft,
 * and the right answer is a draft that stays valid. Removing a network
 * takes its tokens, its pools and its cap rows with it (invariant 1 in the file header).
 */
export function withNetworks(
  draft: MandateDraft,
  networks: NetworkId[],
  catalog: MandateCatalog,
): MandateDraft {
  const available = new Set<string>(catalog.networks.filter((n) => n.available).map((n) => n.id));
  const wanted = new Set<NetworkId>([HUB_NETWORK]);
  for (const id of networks) {
    if (available.has(id)) wanted.add(id);
  }
  const ordered = catalog.networks.filter((n) => wanted.has(n.id)).map((n) => n.id);
  const next = ordered.includes(HUB_NETWORK) ? ordered : [HUB_NETWORK, ...ordered];
  const synced = syncNetworks(draft, next);
  if (draft.dataMode === "real") {
    synced.protocols = synced.protocols.filter((id) => id !== "across");
    if (next.includes("robinhood"))
      synced.protocols = PROTOCOL_ORDER.filter(
        (id) => id === "across" || synced.protocols.includes(id),
      );
    if (synced.positionProtocolsByChain)
      synced.positionProtocolsByChain = retainKeys(synced.positionProtocolsByChain, (key) =>
        next.includes(key as NetworkId),
      );
    if (!next.includes("robinhood")) synced.spokeCapPercent = null;
  }
  return withUniverseExpiry(draft, synced);
}

/**
 * R19/R21/R29: set the protocol list.
 *
 * The required two are always kept and an unavailable id is ignored, for the same reasons as
 * `withNetworks`. Tokens are NOT touched, because a token can be held without a pool (R33 keeps the
 * two directions separate).
 *
 * Pools follow their own protocol, one by one: dropping Uniswap v3 takes the v3 positions out and
 * leaves the v4 ones alone (invariant 1 in the file header, a reducer drops what is downstream of
 * what it dropped). Keeping them was an invalid mandate, one naming positions on a protocol it did
 * not name, and it inflated the count the Broad mandate flag divides by. Dropping the LAST position
 * protocol therefore empties the pools, and it also un-passes the Pools step: the step no longer
 * exists, so a draft that still remembered passing it would resume into a step the stepper does not
 * draw.
 *
 * PP-NOTE: dropping one position protocol while another remains can leave the Pools step visible,
 * still marked passed, and empty, which `validateStep` refuses. Nothing un-passes the step here: the
 * shell validates EVERY visible step on the Next that completes the mandate (`firstRefusal` in
 * `FundStrategyBuilderScreen.tsx`) and takes the manager back to the first one that refuses, so an
 * empty Pools step cannot be completed over. The same holds when a token removed on step 3 took the
 * last pools with it.
 */
export function withProtocols(draft: MandateDraft, protocols: ProtocolId[]): MandateDraft {
  const unavailable = new Set<string>(UNAVAILABLE_PROTOCOLS);
  const known = new Set<string>(PROTOCOL_ORDER);
  const wanted = new Set<ProtocolId>(
    draft.dataMode === "real"
      ? draft.networks.includes("robinhood")
        ? REQUIRED_PROTOCOLS
        : ["uniswap-v3-swap"]
      : REQUIRED_PROTOCOLS,
  );
  for (const id of protocols) {
    if (
      known.has(id) &&
      !unavailable.has(id) &&
      !(
        draft.dataMode === "real" &&
        (id === "uniswap-v3" || (id === "across" && !draft.networks.includes("robinhood")))
      )
    )
      wanted.add(id);
  }
  const next = PROTOCOL_ORDER.filter((id) => wanted.has(id));
  const keptIds = new Set<string>(next);
  const dex = next.some((p) => (DEX_PROTOCOL_IDS as readonly ProtocolId[]).includes(p));
  return withUniverseExpiry(draft, {
    ...draft,
    protocols: next,
    ...(draft.dataMode === "real"
      ? {
          positionProtocolsByChain: Object.fromEntries(
            draft.networks.map((network) => [
              network,
              next.filter(
                (id) =>
                  (id === "uniswap-v4" &&
                    (!draft.protocols.includes("uniswap-v4") ||
                      draft.positionProtocolsByChain?.[network]?.includes("uniswap-v4"))) ||
                  (id === "aave-v3" && network === "arbitrum"),
              ),
            ]),
          ),
        }
      : {}),
    // A pool's protocol is always a position protocol, so losing every one of them empties this.
    pools: draft.pools.filter((p) => keptIds.has(p.protocol)),
    passedSteps: dex ? draft.passedSteps : draft.passedSteps.filter((s) => s !== "pools"),
    caps: {
      ...draft.caps,
      protocols: retainKeys(draft.caps.protocols, (key) => keptIds.has(key)),
    },
  });
}

/**
 * R20 v3: a STORED draft without the protocols the product can no longer operate.
 *
 * A draft saved while Uniswap v3 positions were offered can still name them, hold v3 pools and carry
 * a v3 cap row, and no reducer would ever let the manager take those out again (the row is disabled).
 * The draft store runs every entry through this on load, so both the builder's resume and the
 * Console's counts read the sanitised draft.
 *
 * It drops exactly three things: the unavailable ids, the pools on them, and their protocol cap rows.
 * Nothing else moves, deliberately, unlike {@link withProtocols}, which also un-passes Pools and
 * expires `poolUniverseCount`. That leaves two stale fields, and neither is harmless on its own:
 *
 * - `lastStep` can still say "pools" on a draft that no longer has a Pools step. Read raw it gives
 *   `stepIndex` 0 ("step 0 of 4" in the Console) and one frame of a hidden step in the builder, so
 *   every place that displays or resumes a draft's step reads it through {@link resumeStep}, which
 *   falls back to the first unpassed step. A stale "pools" in `passedSteps` is inert: the
 *   sub-step header and the reachability rules only ever ask about visible steps.
 * - `poolUniverseCount` can describe a wider universe than the draft now has. Fewer pools can only
 *   turn the Broad mandate flag OFF ({@link isBroadMandate} needs
 *   `pools.length >= poolUniverseCount`), the safe direction.
 *
 * Returns the SAME object when there is nothing to drop. Every pool is read defensively, because the
 * store validates the `pools` array but not its entries, and a throw here would cost the Console
 * every draft rather than the one malformed entry.
 */
export function withoutUnavailableProtocols(draft: MandateDraft): MandateDraft {
  const unavailable = new Set<string>(UNAVAILABLE_PROTOCOLS);
  const onUnavailable = (pool: MandatePoolRef | null | undefined) =>
    unavailable.has(pool?.protocol ?? "");
  const holds =
    draft.protocols.some((id) => unavailable.has(id)) ||
    draft.pools.some(onUnavailable) ||
    Object.keys(draft.caps.protocols).some((key) => unavailable.has(key));
  if (!holds) return draft;
  return {
    ...draft,
    protocols: draft.protocols.filter((id) => !unavailable.has(id)),
    pools: draft.pools.filter((pool) => !onUnavailable(pool)),
    caps: {
      ...draft.caps,
      protocols: retainKeys(draft.caps.protocols, (key) => !unavailable.has(key)),
    },
  };
}

/** Append token entries under the slot ceiling (R27), or refuse without changing anything. */
function addTokenRefs(
  draft: MandateDraft,
  refs: MandateTokenRef[],
  rowId: string | null,
): MandateReducerResult {
  const present = new Set(draft.tokens.map(tokenKey));
  const added: MandateTokenRef[] = [];
  for (const ref of refs) {
    const key = tokenKey(ref);
    if (present.has(key)) continue;
    present.add(key);
    added.push(ref);
  }
  if (added.length === 0) return draft;
  if (draft.tokens.length + added.length > MAX_TOKEN_SLOTS) {
    return { blocked: { step: "tokens", reason: "no_slots", rowId } };
  }
  return { ...draft, tokens: [...draft.tokens, ...added] };
}

function refFromCatalog(token: MandateCatalogToken): MandateTokenRef {
  return {
    address: token.address.toLowerCase(),
    symbol: token.symbol,
    name: token.name,
    network: token.network,
    logoUrl: token.logoUrl,
    locked: false,
  };
}

/**
 * R27/R28: put a token in the mandate.
 *
 * One entry per SELECTED network where the catalog carries the same symbol.
 *
 * PP-NOTE: assumption (coordinator default, handoff open point 4). A manager cannot keep a token off
 * one of its networks to free slots; a token always enters every selected network where it exists.
 * That is the reading that matches the Figma (one card per token with network dots, one Add) and it
 * is the conservative one for slots, since it can only consume more of the 16 than the alternative.
 * {@link removeToken} takes a single entry back out, and {@link removeTokenSymbol} takes the whole
 * row out, so the UI can offer either without this function changing.
 *
 * Refuses an unpriced token (R28) and refuses to pass the slot ceiling (R27), changing nothing in
 * either case. Adding a token already in the draft is a no-op, not a refusal.
 */
export function addToken(
  draft: MandateDraft,
  token: MandateCatalogToken,
  catalog: MandateCatalog,
): MandateReducerResult {
  const rowId = tokenKey(token);
  if (catalog.dataMode === "real" ? !token.priced : !isPricedSymbol(token.symbol)) {
    return { blocked: { step: "tokens", reason: "not_priced", rowId } };
  }
  const wanted = token.symbol.toLowerCase();
  const refs = catalog
    .tokensFor(draft.networks, draft.protocols)
    .filter((t) => t.priced && t.symbol.toLowerCase() === wanted)
    .map(refFromCatalog);
  const result = addTokenRefs(draft, refs, rowId);
  return isBlocked(result) ? result : withUniverseExpiry(draft, result);
}

function poolHoldsToken(pool: MandatePoolRef, token: MandateTokenRef): boolean {
  if (pool.network !== token.network) return false;
  const address = token.address.toLowerCase();
  return (
    pool.token0.address.toLowerCase() === address || pool.token1.address.toLowerCase() === address
  );
}

/**
 * R24/R33: take ONE token entry out, with the pools on that network that held it and its cap row.
 *
 * A locked deposit row is never removed. Pools go because both pool tokens must be mandate tokens
 * (DEC-053), so a pool that lost one describes a position the fund cannot hold.
 */
export function removeToken(draft: MandateDraft, key: string): MandateDraft {
  const entry = draft.tokens.find((t) => tokenKey(t) === key);
  if (!entry || entry.locked) return draft;
  return withUniverseExpiry(draft, {
    ...draft,
    tokens: draft.tokens.filter((t) => tokenKey(t) !== key),
    pools: draft.pools.filter((p) => !poolHoldsToken(p, entry)),
    caps: {
      ...draft.caps,
      tokens: retainKeys(draft.caps.tokens, (capKey) => capKey !== key),
    },
  });
}

/** Take every network entry of a symbol out, which is what one remove X on the right card means. */
export function removeTokenSymbol(draft: MandateDraft, symbol: string): MandateDraft {
  const wanted = symbol.toLowerCase();
  const keys = draft.tokens
    .filter((t) => !t.locked && t.symbol.toLowerCase() === wanted)
    .map(tokenKey);
  return keys.reduce(removeToken, draft);
}

/** R24: "Clear all" empties the token card without touching the locked deposit rows. */
export function clearTokens(draft: MandateDraft): MandateDraft {
  const keys = draft.tokens.filter((t) => !t.locked).map(tokenKey);
  return keys.reduce(removeToken, draft);
}

/** Make sure one side of a pool is already a mandate token, adding it when it is not (R33). */
function ensurePoolToken(
  draft: MandateDraft,
  pool: MandatePoolRef,
  side: MandatePoolRef["token0"],
  catalog: MandateCatalog,
): MandateReducerResult {
  const key = tokenKey({ network: pool.network, address: side.address });
  if (draft.tokens.some((t) => tokenKey(t) === key)) return draft;

  const address = side.address.toLowerCase();
  const fromCatalog = catalog
    .tokensFor(draft.networks, draft.protocols)
    .find((t) => t.network === pool.network && t.address.toLowerCase() === address);
  if (fromCatalog) return addToken(draft, fromCatalog, catalog);

  if (catalog.dataMode === "real")
    return { blocked: { step: "tokens", reason: "not_priced", rowId: key } };

  // Not in the static list. The pool came from the API, which knows tokens the bundled lists do
  // not, so the pool's own token data is used rather than refusing a real pool. The price rule
  // still applies, and the entry lands on the POOL's network only: there is no catalog row to tell
  // us where else that address exists.
  if (!isPricedSymbol(side.symbol)) {
    return { blocked: { step: "tokens", reason: "not_priced", rowId: key } };
  }
  return addTokenRefs(
    draft,
    [
      {
        address,
        symbol: side.symbol,
        name: side.name,
        logoUrl: side.logoUrl,
        network: pool.network,
        locked: false,
      },
    ],
    key,
  );
}

/**
 * R33/R34/R38: put a pool in the mandate, pulling in whichever of its tokens is missing.
 *
 * Refusals, in order: a Uniswap v4 hook (not supported), a pool on a network the mandate does not
 * name, a pool on a PROTOCOL the mandate does not name or the product cannot operate (R20 v3), then
 * whatever adding its tokens refuses (no price feed, no slots left). The protocol check exists
 * because a pasted address reaches this function without passing a protocol filter first, and a
 * mandate holding a position on a protocol it never named is exactly as invalid as one on a network
 * it never named. The unavailable check reads the catalog, as `withNetworks` does, and covers a draft
 * that still names such a protocol because it reached a step without passing through the store's
 * load (see {@link withoutUnavailableProtocols}).
 *
 * PP-NOTE: assumption (coordinator default). The brief says a token block "propagates"; the REASON
 * propagates while `step` and `rowId` are re-targeted to the Pools step and the pool's own row. A
 * step renders its notice only when `block.step` is its own key, so a `tokens` block raised by a
 * click on the Pools step would scroll nowhere and show nothing. The reason is what the
 * blocked-intent event reports, and it is preserved exactly.
 */
export function addPool(
  draft: MandateDraft,
  pool: MandatePoolRef,
  catalog: MandateCatalog,
): MandateReducerResult {
  if (pool.hasHook) {
    return { blocked: { step: "pools", reason: "has_hook", rowId: pool.id } };
  }
  if (draft.pools.some((p) => p.id === pool.id)) return draft;
  if (!draft.networks.includes(pool.network)) {
    return { blocked: { step: "pools", reason: "coming_soon", rowId: pool.id } };
  }
  if (
    !draft.protocols.includes(pool.protocol) ||
    catalog.protocols.some((p) => p.id === pool.protocol && !p.available)
  ) {
    return { blocked: { step: "pools", reason: "coming_soon", rowId: pool.id } };
  }
  if (
    draft.dataMode === "real" &&
    !draft.positionProtocolsByChain?.[pool.network]?.includes("uniswap-v4")
  )
    return { blocked: { step: "pools", reason: "coming_soon", rowId: pool.id } };

  let next = draft;
  for (const side of [pool.token0, pool.token1]) {
    const result = ensurePoolToken(next, pool, side, catalog);
    if (isBlocked(result)) {
      return { blocked: { step: "pools", reason: result.blocked.reason, rowId: pool.id } };
    }
    next = result;
  }
  // Against the ORIGINAL draft: a pool taken out of a universe that is already known changes
  // nothing the universe was measured over, but one that pulled a token in does.
  return withUniverseExpiry(draft, { ...next, pools: [...next.pools, pool] });
}

/** R33: take a pool out. Tokens stay: a token can be held without a pool. */
export function removePool(draft: MandateDraft, id: string): MandateDraft {
  return { ...draft, pools: draft.pools.filter((p) => p.id !== id) };
}

/** R33: "Clear all" on the pools card. Tokens stay, for the same reason. */
export function clearPools(draft: MandateDraft): MandateDraft {
  return { ...draft, pools: [] };
}

/** Round to the nearest 5% and clamp to 0..100 (R39). */
function clampCapPct(pct: number): number {
  if (!Number.isFinite(pct)) return 0;
  const stepped = Math.round(pct / CAP_STEP_PCT) * CAP_STEP_PCT;
  return Math.min(100, Math.max(0, stepped));
}

/**
 * R39: write one cap row. The slider is a 5% control, so a value off the grid is snapped rather
 * than rejected: there is no way for a manager to type one, and a stored draft that carries one
 * must not block the step forever.
 */
export function setCap(
  draft: MandateDraft,
  scope: "networks" | "protocols" | "tokens",
  key: string,
  cap: MandateCap,
): MandateDraft {
  const normalized: MandateCap = { noCap: cap.noCap, pct: clampCapPct(cap.pct) };
  const current = draft.caps[scope] as Record<string, MandateCap>;
  return {
    ...draft,
    ...(draft.dataMode === "real" && scope === "networks" && key === "robinhood"
      ? { spokeCapPercent: normalized.noCap ? null : normalized.pct }
      : {}),
    caps: { ...draft.caps, [scope]: { ...current, [key]: normalized } } as MandateCaps,
  };
}

/**
 * R39: take one row back to UNSET, which is a state `setCap` cannot express.
 *
 * "No record yet" is a third state beside "capped at n%" and "no cap", and the only reducer that can
 * reach it. The Limits step needs it for one move: a manager ticks "No cap" on a row they never gave
 * a share to, then unticks it. Writing `{ noCap: false, pct: 0 }` there would leave a 0% ceiling
 * `validateStep` accepts, so Next would pass on a cap nobody chose, against this module's own rule
 * that unset is not zero.
 *
 * It prunes NOTHING else. A cap row is a limit on a selection, never the selection itself, so
 * clearing one must not drop the network, protocol or token it belongs to; the only reducers that
 * drop a cap row are the ones that drop what it caps (`withNetworks`, `withProtocols`,
 * `removeToken`).
 */
export function clearCap(
  draft: MandateDraft,
  scope: "networks" | "protocols" | "tokens",
  key: string,
): MandateDraft {
  const current = draft.caps[scope] as Record<string, MandateCap>;
  if (!(key in current)) return draft;
  const next = { ...current };
  delete next[key];
  return { ...draft, caps: { ...draft.caps, [scope]: next } as MandateCaps };
}
