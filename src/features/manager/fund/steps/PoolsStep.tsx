/**
 * @id PP-MGR-CMP-038
 * @name PoolsStep
 * @implements-rules-version v1
 * @analytics-events none, the shell emits
 *
 * POO-2125 [R11] / [R13] / [R29] to [R38], epic POO-2119. Mandate step 4: the pools this strategy
 * may ever provide liquidity to.
 *
 * ## The list loads before anything is typed
 *
 * V1's picker opens empty and waits for a token, because V1 chooses ONE pool and the manager already
 * knows which pair they want. A mandate is the opposite question: it is a closed list fixed at
 * launch (R34, DEC-030), so the manager needs to see what the choice even is. The step therefore
 * fans a search out over every mandate token on every selected network and dedupes by pool id, which
 * is the "pools with at least one of your tokens" universe R35 names.
 *
 * That universe size is not decoration. It is the denominator {@link isBroadMandate} divides by
 * (R13), so a step that under-counted it would raise a Broad-mandate flag an investor sees before
 * depositing, on a mandate that is not broad. It is published upward through `onUniverseCount` for
 * the same reason: Review asks the same question later and must not re-derive it differently.
 *
 * Three consequences follow, and all of them are load-bearing:
 *
 * 1. **The network filter is display only.** It narrows the rows, the tab counts and the results
 *    head, and it never narrows the universe. A filter that moved the denominator would raise the
 *    flag on a mandate holding none of the hub's pools: select the spoke, add all of ITS pools, and
 *    "every pool is selected" becomes true of a list the manager never saw. Same reason a token
 *    search does not move it either.
 * 2. **The universe counts only pools this mandate could ever add.** A hooked pool (R38) and a pool
 *    whose other side the hub cannot price (R28) are refusals no edit clears, so counting them would
 *    put R37 and the flag permanently out of reach and make "Add all N" name a number larger than
 *    what it adds. They stay listed and disabled; see {@link canEverAdd}.
 * 3. **A universe is only an answer about the mandate it was measured over**, so it carries that
 *    mandate with it ({@link universeSignatureOf}) and is disbelieved the moment the two differ.
 *    Adding a pool pulls its other side into the mandate (R32), which widens the universe, so the
 *    count measured a moment earlier is not a rough answer: it is a SMALLER one, which
 *    `draft.pools.length` then reaches. The re-measure runs in every view, including with a search
 *    or a pasted address on screen, and until it lands the size is unknown and nothing is drawn or
 *    published from the old one, flag and "All N pools are selected" alike.
 *
 * ## The address path asks each network once
 *
 * `findMandatePoolByAddress` is network-scoped but not silent: it answers `{ pool, foundOn }`, and
 * `foundOn` is the network the address really lives on. Real mode reads it from the endpoint's own
 * `foundOnNetwork` (POO-1430 [R9]); mock mode holds the universe locally and answers the same shape.
 * So this step asks the networks the mandate HOLDS, one read each, and stops: it does not sweep the
 * catalog, which cost up to five sequential server actions per paste and queried networks the fund
 * contracts do not operate on at all. A pool found inside the mandate's own networks is simply
 * fetched; found outside them it is an advisory (`mandate.poolWrongNetwork`), never an auto-switch,
 * because the networks were decided on step 1 and this screen does not get to revise them.
 *
 * ## Every refusal keeps its click
 *
 * A pool the mandate can never hold is listed and disabled: a Uniswap v4 hook (R38) and a side the
 * hub cannot price (R28). Its control carries `aria-disabled` rather than the native `disabled`,
 * because a native disabled control swallows the event and that click is the only evidence a manager
 * wanted the pool. A pool the mandate COULD hold but the reducer refuses on the press (the slot
 * budget, a protocol or network the mandate did not name) keeps its Add, and the press previews the
 * reducer so the refusal is reported rather than only drawn; see {@link handleAdd}.
 *
 * Both paths route to `onBlocked`, which the shell turns into `builder_mandate_blocked` (CLAUDE.md
 * premise 11). Nothing here reaches the dataLayer, and no refusal is counted twice: a reported
 * refusal never also writes.
 *
 * ## An error is not an empty list
 *
 * A failed read says "we could not ask"; an empty list says "your tokens have no pools". Conflating
 * them would send a manager looking for the wrong problem, so the failure gets its own state with a
 * retry, and reports itself through the optional `onError` prop the shell maps to
 * `builder_mandate_error`. Nothing here touches the dataLayer directly.
 *
 * Two codes, for the same reason: `POOLS_FETCH_FAILED` is the state that is DRAWN, with the Try
 * again under it, and `POOLS_UNIVERSE_FETCH_FAILED` is a measurement that failed beside a search
 * the manager is still reading. Which one a read reports is decided by whether it is also the list
 * when it lands, never by the view it started in.
 *
 * Pool catalog resolved by POO-2133: `mandatePoolSource` reads the real v4 catalog;
 * mock mode retains the existing fixtures.
 */
"use client";

import { Flag, Plus, Search, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ProtocolBadge } from "@/components/data-display/ProtocolBadge";
import { TokenLogo } from "@/components/data-display/TokenLogo";
import { AprTooltip } from "@/components/ui/AprTooltip";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { FilterDropdown } from "@/components/ui/FilterDropdown";
import { Input } from "@/components/ui/Input";
import { Skeleton } from "@/components/ui/Skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/Tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/Tooltip";
import { isMockMode } from "@/lib/services";
import { searchTokens } from "@/lib/tokens/tokenList";
import { cn } from "@/lib/utils/cn";
import { formatPercent, formatUsdCompact } from "@/lib/utils/format";
import { CopyAddressChip } from "../components/CopyAddressChip";
import { NetworkLogoWithName, useNetworkNames } from "../components/NetworkDots";
import type { MandateCatalog } from "../mandateCatalog";
import {
  addPool,
  clearPools,
  DEX_PROTOCOL_IDS,
  type DexProtocolId,
  hasDexProtocol,
  isBlocked,
  isBroadMandate,
  isPricedSymbol,
  MAX_TOKEN_SLOTS,
  type MandateBlockReason,
  type MandateDraft,
  type MandatePoolRef,
  type MandateTokenRef,
  type NetworkId,
  removePool,
  type StepBlock,
  slotsUsed,
  tokenKey,
} from "../mandateDraft";
import { findMandatePoolByAddress, searchMandatePools } from "../mandatePoolSource";
import type { MandateStepProps } from "./stepProps";

/** This step's key, spelled once. */
const STEP = "pools" as const;

/** The one network-filter value that is not a network. */
const ALL_NETWORKS = "all" as const;

/** The one tab value that is not a protocol. */
const ALL_PROTOCOLS = "all" as const;

/** Results drawn before "Show more pools (N)" reveals another page of the same size (R36). */
const PAGE_SIZE = 5;

/** Rows the right card draws before it falls back to "and N more" (R36). */
const YOURS_VISIBLE = 6;

/** Token suggestions offered under the search field, matching V1's cap. */
const MAX_SUGGESTIONS = 12;

/** Named placeholder rows, so the loading list has stable keys rather than array indices. */
const SKELETON_ROWS = ["first", "second", "third"] as const;

/** A trimmed value shaped like an on-chain address. Mirrors V1's `looksLikeAddress` (POO-1430). */
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const POOL_ID_RE = /^0x[0-9a-fA-F]{64}$/;

type NetworkFilter = NetworkId | typeof ALL_NETWORKS;
type ProtocolTab = DexProtocolId | typeof ALL_PROTOCOLS;

/** One pickable token in the search dropdown, from the mandate or from the static lists. */
interface TokenChoice {
  address: string;
  symbol: string;
  name: string;
  network: NetworkId;
  /** True when this token is already in the mandate, which is why it is offered first (R30). */
  mine: boolean;
}

/** What the result list is currently answering. */
type Query =
  | { kind: "universe" }
  | { kind: "token"; address: string; second: string | undefined }
  | { kind: "address"; address: string };

/**
 * The universe question, as one shared value.
 *
 * A fresh `{ kind: "universe" }` per render would be a new dependency identity per render, and the
 * fetch effect keys off the query, so every character typed into the search field re-asked a
 * question whose answer cannot have changed: in real mode one `/dex-pools` call per mandate token,
 * per keystroke. The question is the same object until something is actually picked.
 */
const UNIVERSE_QUERY: Query = { kind: "universe" };

/** What a resolved query produced, beyond the pools themselves. */
interface Resolution {
  pools: MandatePoolRef[];
  /** Set when a pasted address was found on a network the mandate does not hold (R30). */
  foundOn: NetworkId | null;
  /**
   * The mandate this list was measured over, when it is a universe read. Null for a search and for a
   * pasted address, which answer questions the mandate's own tokens do not define, and for the empty
   * list a failure leaves behind. See {@link universeSignatureOf}.
   */
  signature: string | null;
}

/** A measured universe, and the mandate it was measured over. Never one without the other. */
interface Universe {
  pools: MandatePoolRef[];
  signature: string;
}

/**
 * The mandate a pool universe is an answer about, as one comparable value.
 *
 * The universe is "the pools holding at least one of your tokens", over your networks and your
 * position protocols, so all three decide it, and the tokens can move on THIS step: adding a pool
 * pulls its other side into the mandate (R32). A count measured a moment before that is not a rough
 * answer to the same question, it is an answer to a question nobody is asking any more, and it is
 * SMALLER, which is the direction that hurts: `draft.pools.length` reaches it, and the Broad-mandate
 * flag an investor reads before depositing (R13) goes up on a mandate that could still add more.
 *
 * So the universe carries this value and is believed only while it still equals the draft's. One
 * function builds both sides, because two spellings of "the same mandate" drift apart eventually.
 * Order-sensitive, exactly as sensitive as the domain's own `poolUniverseCount` expiry: a reordering
 * with the same members costs one redundant read, and a change missed costs a false flag.
 */
function universeSignatureOf(
  networks: readonly NetworkId[],
  protocols: readonly DexProtocolId[],
  tokens: readonly MandateTokenRef[],
): string {
  return [networks.join(","), protocols.join(","), tokens.map(tokenKey).join(",")].join("|");
}

/** `0.30%`, the fee tier the way V1 prints it. */
function feeLabel(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`;
}

/** `WETH/USDC`, in the order the API returned the sides. Never inverted: there is no range here. */
function pairLabel(pool: MandatePoolRef): string {
  return `${pool.token0.symbol}/${pool.token1.symbol}`;
}

/** Whether a mandate already holds this side of a pool, on the pool's own network. */
function mandateHoldsSide(draft: MandateDraft, pool: MandatePoolRef, address: string): boolean {
  const key = tokenKey({ network: pool.network, address });
  return draft.tokens.some((token) => tokenKey(token) === key);
}

/** The symbols a pool would pull into the mandate if it were added (R32). */
function tokensItWouldAdd(draft: MandateDraft, pool: MandatePoolRef): string[] {
  return [pool.token0, pool.token1]
    .filter((side) => !mandateHoldsSide(draft, pool, side.address))
    .map((side) => side.symbol);
}

/**
 * Whether this pool could EVER enter this mandate.
 *
 * Three refusals are permanent properties of the pool rather than states a manager can clear: a
 * Uniswap v4 hook the fund contracts cannot hold (R38), a side the hub price source cannot price
 * (R28), and a network the mandate does not hold at all. Every count that answers "how many are
 * there" or "how many are left" runs through this, because a pool nobody can add is not part of
 * either answer: with one in the list, "every pool is selected" (R37) and the Broad-mandate flag
 * (R13) would be unreachable for ever, and "Add all N" would name a number larger than what it adds.
 *
 * The slot cap is deliberately NOT here. It is a budget, not a property: removing a token on step 3
 * frees a slot, so a denominator that moved with it would move while the manager edited a different
 * step. The slot refusal still stops an "Add all" batch, because that one IS the manager's to act on.
 */
function canEverAdd(draft: MandateDraft, pool: MandatePoolRef, catalog: MandateCatalog): boolean {
  if (pool.hasHook) return false;
  if (!draft.networks.includes(pool.network)) return false;
  if (
    draft.dataMode === "real" &&
    !draft.positionProtocolsByChain?.[pool.network]?.includes("uniswap-v4")
  )
    return false;
  return [pool.token0, pool.token1].every(
    (side) =>
      mandateHoldsSide(draft, pool, side.address) ||
      (catalog.dataMode === "real"
        ? catalog
            .tokensFor([pool.network], draft.protocols)
            .some(
              (token) => token.address.toLowerCase() === side.address.toLowerCase() && token.priced,
            )
        : isPricedSymbol(side.symbol)),
  );
}

/**
 * R31: add every pool in order, stop at the first refusal, keep what was added.
 *
 * Pure, so the caller can run it once to decide what to report and hand the same function to
 * `update` as a reducer; both runs see the same draft and therefore agree. A pool {@link canEverAdd}
 * rejects is skipped rather than attempted: `addPool` would refuse every one of them, and stopping
 * the whole batch on a pool the manager never singled out would be a refusal of our own making.
 */
function addAllPools(
  draft: MandateDraft,
  candidates: MandatePoolRef[],
  catalog: MandateCatalog,
): { next: MandateDraft; blocked: StepBlock | null } {
  let next = draft;
  for (const pool of candidates) {
    // Against the RUNNING draft, not the original: a pool added a moment ago may have brought in the
    // token that makes the next one addable.
    if (!canEverAdd(next, pool, catalog)) continue;
    const result = addPool(next, pool, catalog);
    if (isBlocked(result)) return { next, blocked: result.blocked };
    next = result;
  }
  return { next, blocked: null };
}

/** Public props: the shared step contract, plus two optional reporting channels for the shell. */
export interface PoolsStepProps extends MandateStepProps {
  /**
   * A failed read, for the shell to emit as `builder_mandate_error`. Optional because the step is
   * rendered on its own in Storybook and in its tests; absent, a failure is still shown and simply
   * not reported.
   */
  onError?: (error: { code: string }) => void;
  /**
   * The size of the pool universe this step resolved, which the Broad-mandate flag (R13) is measured
   * against. Published so Review asks the same question with the same number.
   */
  onUniverseCount?: (count: number) => void;
}

/** Mandate step 4: the pool catalog on the left, the mandate's own pools on the right. */
export function PoolsStep({
  draft,
  catalog,
  update,
  block,
  onBlocked,
  onError,
  onUniverseCount,
}: PoolsStepProps) {
  const t = useTranslations("manager");
  const networkNames = useNetworkNames();

  const [firstQuery, setFirstQuery] = useState("");
  const [firstToken, setFirstToken] = useState<TokenChoice | null>(null);
  const [firstFocused, setFirstFocused] = useState(false);
  const [secondQuery, setSecondQuery] = useState("");
  const [secondToken, setSecondToken] = useState<TokenChoice | null>(null);
  const [secondFocused, setSecondFocused] = useState(false);
  const [networkFilter, setNetworkFilter] = useState<NetworkFilter>(ALL_NETWORKS);
  const [tab, setTab] = useState<ProtocolTab>(ALL_PROTOCOLS);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [resolution, setResolution] = useState<Resolution>({
    pools: [],
    foundOn: null,
    signature: null,
  });
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  /**
   * The last universe that RESOLVED, with the mandate it was measured over. Null until one has, and
   * disbelieved once the mandate moves on, which together are what keep R13 honest.
   */
  const [universe, setUniverse] = useState<Universe | null>(null);
  /**
   * The same value, readable by the effect that writes it.
   *
   * A measurement decides whether to run by looking at what is already measured, so a dependency on
   * the state it sets would be a loop. It is read to answer "is this still needed", never to decide
   * WHAT to fetch, which is why a ref is the honest shape here.
   */
  const universeRef = useRef(universe);
  universeRef.current = universe;

  // The DEX protocols this mandate chose. An empty list cannot happen while the step renders (R29).
  const protocols = useMemo(
    () => DEX_PROTOCOL_IDS.filter((id) => draft.protocols.includes(id)) as DexProtocolId[],
    [draft.protocols],
  );

  // A network that left the draft cannot keep filtering a list it is no longer part of.
  const network =
    networkFilter !== ALL_NETWORKS && !draft.networks.includes(networkFilter)
      ? ALL_NETWORKS
      : networkFilter;

  /**
   * The networks the filter leaves on screen. DISPLAY ONLY: see point 1 of the file header.
   *
   * Everything measured (the universe, the published count) reads `draft.networks` instead.
   */
  const displayNetworks = useMemo(
    () => (network === ALL_NETWORKS ? draft.networks : [network]),
    [network, draft.networks],
  );

  const trimmed = firstQuery.trim();
  const isAddress = (isMockMode ? ADDRESS_RE : POOL_ID_RE).test(trimmed);

  /**
   * What the result list should be answering right now.
   *
   * An address-shaped value in field 1 wins over a locked token: a manager who pastes an address
   * after picking a token is asking about the address. Otherwise a locked token narrows the search,
   * and nothing locked means the universe (R30, R35).
   */
  const query: Query = useMemo(() => {
    if (isAddress) return { kind: "address", address: trimmed.toLowerCase() };
    if (firstToken) {
      return { kind: "token", address: firstToken.address, second: secondToken?.address };
    }
    return UNIVERSE_QUERY;
  }, [isAddress, trimmed, firstToken, secondToken]);

  /**
   * Every mandate token, which is the universe search's fan-out (R35), over every selected network.
   *
   * Filtered against the draft's own networks rather than trusted blindly: a stored draft can
   * outlive a network leaving it.
   */
  const mandateTokens = useMemo(
    () => draft.tokens.filter((token) => draft.networks.includes(token.network)),
    [draft.tokens, draft.networks],
  );

  /** The mandate a universe measured right now would be an answer about. */
  const universeSignature = useMemo(
    () => universeSignatureOf(draft.networks, protocols, mandateTokens),
    [draft.networks, protocols, mandateTokens],
  );

  // The mandate tokens the filter leaves visible, which is what the search suggestions offer.
  const shownTokens = useMemo(
    () => mandateTokens.filter((token) => displayNetworks.includes(token.network)),
    [mandateTokens, displayNetworks],
  );

  /**
   * The networks a pasted address is looked up on: every network the mandate holds that the catalog
   * can actually answer for.
   *
   * Not the filter. A pool on another SELECTED network is on a network you have selected, so it is
   * not a wrong-network fact and must not be reported as one. And never a network the catalog marks
   * unavailable: the fund contracts do not operate there, the API need not know the slug, and a 400
   * would turn a plain "not on your networks" into the error state plus a `POOLS_FETCH_FAILED`.
   */
  const pasteNetworks = useMemo(
    () =>
      draft.networks.filter((id) =>
        catalog.networks.some((entry) => entry.id === id && entry.available),
      ),
    [draft.networks, catalog.networks],
  );

  /**
   * The networks a SEARCH fans out over, which is the only read the display filter may move.
   *
   * A token search fans out over the DISPLAYED networks, because a row from outside them would be
   * filtered off the screen on arrival, so narrowing the filter really is a different question and
   * a refetch is the right answer to it. Nothing else follows the filter: a pasted address walks
   * the mandate's own networks ({@link pasteNetworks}) and the universe is measured over every
   * selected one, so neither answer can change when the filter does.
   *
   * Hence the memo rather than reading `displayNetworks` straight. `resolveSearch` keys the fetch
   * effect, so a dependency that moved with the filter re-asked an address lookup whose answer was
   * already on screen: the resolved card went away and the skeleton flashed over it, which told the
   * manager the filter had narrowed a list when it is display only.
   */
  const fetchNetworks = useMemo(
    () => (query.kind === "token" ? displayNetworks : draft.networks),
    [query.kind, displayNetworks, draft.networks],
  );

  // A monotonic ticket, as V1's `pairFetchSeq` is: a slow search must never land on top of a newer
  // one. The manager can change either field, the network or the tab while a request is in flight.
  // It covers the LIST, so the universe read takes one too whenever the universe is what is shown.
  const seq = useRef(0);

  /**
   * The measurement's own ticket.
   *
   * A background measurement outlives the view it started in, by design: the manager can clear the
   * search while it is in flight and the number it brings back is still the answer. So it cannot
   * share the list's ticket, which that very clear invalidates, and it needs one of its own so a
   * slow measurement cannot land on top of a newer one either.
   */
  const measureSeq = useRef(0);

  /**
   * The mandate a measurement is currently out for, so the same question is not asked twice.
   *
   * Picking a token while the opening universe read is still in flight used to start a second,
   * identical fan-out and throw the first away: up to sixteen `/dex-pools` calls in real mode for an
   * answer already on its way. The read in flight is the one that lands, in BOTH directions: the
   * universe view returning to a measurement another view started joins it ({@link measureClaim})
   * rather than asking again, which is what the sentence above claims and what it now does.
   */
  const measuringRef = useRef<string | null>(null);

  /**
   * The list's claim on the measurement in flight: which read it is, and under which list ticket.
   *
   * A measurement outlives the view it started in, so the view that WANTS its answer for the list
   * is not always the one that asked. The claim is how that handover travels from the effect run
   * that makes it to the `then` of a read that started earlier, and it carries the read's own
   * measure ticket so a claim cannot be picked up by a read that has since superseded it.
   *
   * Null means the read in flight is a measurement only: it fills the count and leaves the screen
   * alone. Which of the two a read is, is therefore decided when it LANDS rather than when it is
   * sent, because the manager is free to change the view in between.
   */
  const measureClaim = useRef<{ measureTicket: number; listTicket: number } | null>(null);

  /**
   * The two reporting callbacks, held in refs rather than read from the deps.
   *
   * A caller is free to pass an inline arrow (the Storybook harness does), which is a new identity
   * on every render. In the dependency array that is a fetch per render: the effect sets state, the
   * state re-renders, the render mints a new callback, the effect runs again. Refs break that loop
   * and cost nothing, since neither callback decides WHAT is fetched. Same reason the shell holds
   * `track` in a ref.
   */
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const onUniverseCountRef = useRef(onUniverseCount);
  onUniverseCountRef.current = onUniverseCount;

  /**
   * The universe read: one search per mandate token, on that token's own network (R35), deduped.
   *
   * Over `draft.networks` through the tokens themselves, never over the display filter, because its
   * size is the denominator R13 divides by and must not depend on what is on screen. Separate from
   * the search read below so that a token entering the mandate re-asks THIS question and leaves the
   * manager's own search alone.
   */
  const measureUniverse = useCallback(async (): Promise<MandatePoolRef[]> => {
    const answers = await Promise.all(
      mandateTokens.map((token) =>
        searchMandatePools({
          network: token.network,
          tokenAddress: token.address,
          secondTokenAddress: undefined,
          protocols,
        }),
      ),
    );
    // Deduped by pool id: a pool holding two mandate tokens comes back from both searches.
    const byId = new Map<string, MandatePoolRef>();
    for (const found of answers) {
      for (const pool of found) if (!byId.has(pool.id)) byId.set(pool.id, pool);
    }
    return [...byId.values()];
  }, [mandateTokens, protocols]);

  /**
   * The read behind a pasted address or a picked token: what is SHOWN, never what is measured.
   *
   * A token search fans out over {@link fetchNetworks}, the networks on screen, since a row from
   * outside them would be filtered off on arrival. It does not depend on the mandate's token list
   * at all, which is what lets a token arriving mid-search leave the results where they are, and it
   * reads the filter through that memo so an address lookup is not re-asked when the filter moves.
   */
  const resolveSearch = useCallback(async (): Promise<Resolution> => {
    if (query.kind === "address") {
      // One read per network the mandate holds, and no catalog sweep: the read reports where the
      // address lives, so there is nothing left to go looking for.
      for (const id of pasteNetworks) {
        // The mandate's protocols travel with the lookup: a v3 pool resolved by address into a
        // v4-only mandate is one `addPool` refuses, and counting it would break R13's arithmetic.
        const { pool, foundOn } = await findMandatePoolByAddress(id, query.address, protocols);
        if (pool) return { pools: [pool], foundOn: null, signature: null };
        // Inside the mandate's own networks that is not an advisory, it is a hint to keep walking:
        // the read for THAT network returns the pool itself. Outside them, we already know.
        if (foundOn && !pasteNetworks.includes(foundOn)) {
          return { pools: [], foundOn, signature: null };
        }
      }
      // Nowhere. No separate flag for it: an empty list renders `fundBuilder.pools.empty`, which is
      // the same sentence an empty search gets and the same one a manager needs here.
      return { pools: [], foundOn: null, signature: null };
    }
    // The universe is not asked here; the measurement below owns it in every view.
    if (query.kind !== "token") return { pools: [], foundOn: null, signature: null };

    const answers = await Promise.all(
      fetchNetworks.map((id) =>
        searchMandatePools({
          network: id,
          tokenAddress: query.address,
          secondTokenAddress: query.second,
          protocols,
        }),
      ),
    );
    // Deduped by pool id: a pair search run once per side of the pair returns the same rows twice.
    const byId = new Map<string, MandatePoolRef>();
    for (const found of answers) {
      for (const pool of found) if (!byId.has(pool.id)) byId.set(pool.id, pool);
    }
    return { pools: [...byId.values()], foundOn: null, signature: null };
  }, [query, fetchNetworks, protocols, pasteNetworks]);

  const dex = hasDexProtocol(draft);

  // `retryNonce` is read by nothing in the body on purpose: it IS the retry button. After a failure
  // every input is identical, so without a value that changes, "Try again" would re-render and
  // re-run nothing at all. Both effects below take it, because either read can be the failed one.
  // biome-ignore lint/correctness/useExhaustiveDependencies: retryNonce is the retry trigger, see above.
  useEffect(() => {
    if (!dex) return;
    // The universe view's list is the measurement's own result; see the effect below. Keeping the
    // two reads apart is what stops a token arriving mid-search from re-running the search.
    if (query.kind === "universe") return;
    const ticket = ++seq.current;
    setLoading(true);
    setFailed(false);
    resolveSearch()
      .then((next) => {
        if (ticket !== seq.current) return;
        setResolution(next);
        setVisibleCount(PAGE_SIZE);
      })
      .catch(() => {
        if (ticket !== seq.current) return;
        setFailed(true);
        setResolution({ pools: [], foundOn: null, signature: null });
        // PP-INTEGRATION-POINT: the shell maps this to `builder_mandate_error`
        // { step: "pools", error_code: "POOLS_FETCH_FAILED", error_origin: "upstream" }.
        onErrorRef.current?.({ code: "POOLS_FETCH_FAILED" });
      })
      .finally(() => {
        if (ticket === seq.current) setLoading(false);
      });
  }, [dex, resolveSearch, query.kind, retryNonce]);

  /**
   * The measurement, which in the universe view is also the list.
   *
   * It runs on every change of the signature, in EVERY view, because the flag is measured against
   * this number: with a search or a pasted address on screen, an Add that pulls a token in (R32) used
   * to leave the count where it was, since only a universe read ever wrote it. The manager's own
   * search is untouched by it, and nothing is fetched twice, because the universe view asks this one
   * question and shows its answer.
   *
   * A view showing something else only reads when what it holds was measured over another mandate, or
   * over none at all. The universe view otherwise always reads: it IS the list, so returning to it
   * from a search is also the retry a failed background measurement gets.
   *
   * What it does NOT do is ask a second time for a mandate a read is already out for. Returning to
   * the universe mid-measurement used to start an identical fan-out and drop the first answer; the
   * view claims the read in flight instead ({@link measureClaim}), and that one answer fills the
   * count and the list. One read per signature, whichever view sent it.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: retryNonce is the retry trigger (see above), and the stored universe is read through a ref, because depending on the state this effect writes would be a loop.
  useEffect(() => {
    if (!dex) return;
    const shows = query.kind === "universe";
    if (measuringRef.current === universeSignature) {
      // A view showing something else has nothing to do: the answer it needs is already on its way.
      if (!shows) return;
      // The universe view is the list, so it claims that read rather than asking again. The claim
      // takes a fresh list ticket, which also retires a search read still in flight: the field was
      // just cleared, so its answer is not the one on screen any more.
      measureClaim.current = { measureTicket: measureSeq.current, listTicket: ++seq.current };
      setLoading(true);
      setFailed(false);
      return;
    }
    if (!shows && universeRef.current?.signature === universeSignature) return;
    // Captured now rather than when the read lands: this is the mandate the request was built from,
    // whatever has happened to the draft by the time the answer arrives.
    const signature = universeSignature;
    const measureTicket = ++measureSeq.current;
    measuringRef.current = signature;
    measureClaim.current = shows ? { measureTicket, listTicket: ++seq.current } : null;
    if (shows) {
      setLoading(true);
      setFailed(false);
    }
    /** The list ticket this read serves AS IT LANDS, or null while it is a measurement only. */
    const listTicket = (): number | null => {
      const claim = measureClaim.current;
      return claim !== null && claim.measureTicket === measureTicket ? claim.listTicket : null;
    };
    measureUniverse()
      .then((pools) => {
        if (measureTicket !== measureSeq.current) return;
        setUniverse({ pools, signature });
        const ticket = listTicket();
        if (ticket !== null && ticket === seq.current) {
          setResolution({ pools, foundOn: null, signature });
          setVisibleCount(PAGE_SIZE);
        }
      })
      .catch(() => {
        // `universe` is deliberately left alone, in both views. A failure measured nothing, so it has
        // no count to publish and must not overwrite one a successful read left behind; the mandate
        // that moved on is simply still unmeasured, and the flag stays down.
        //
        // Whether this read is also the LIST decides the code it reports, because the two are
        // different facts about different screens. `POOLS_FETCH_FAILED` is the drawn, retryable
        // state: the manager is looking at the error panel below and its Try again. A measurement
        // running beside a search draws nothing, so reporting that code counted a state nobody was
        // shown, and while the universe was unknown one failed search emitted it twice, once per
        // read, then again on every retry. In the universe view one read serves both, so there is
        // exactly one event and it keeps the drawn code.
        if (measureTicket !== measureSeq.current) return;
        const ticket = listTicket();
        const serves = ticket !== null && ticket === seq.current;
        onErrorRef.current?.({
          code: serves ? "POOLS_FETCH_FAILED" : "POOLS_UNIVERSE_FETCH_FAILED",
        });
        // A background failure stops there: putting the error state over a search the manager is
        // reading would answer a question they did not ask. It is tried again on the next signature
        // change, when the view returns to the universe, and on "Try again".
        if (!serves) return;
        setFailed(true);
        setResolution({ pools: [], foundOn: null, signature: null });
      })
      .finally(() => {
        // Only the newest measurement may declare the question answered: a superseded one must not
        // clear the signature a later read is still out for, nor release a claim it does not hold.
        if (measureTicket !== measureSeq.current) return;
        measuringRef.current = null;
        const ticket = listTicket();
        measureClaim.current = null;
        if (ticket !== null && ticket === seq.current) setLoading(false);
      });
  }, [dex, measureUniverse, universeSignature, query.kind, retryNonce]);

  /**
   * The denominator R13 divides by. Null until a universe has resolved for the mandate as it stands.
   *
   * The signature check is the whole of the second half: a universe measured before an Add pulled a
   * token in is an answer about a narrower mandate (see {@link universeSignatureOf}), and publishing
   * it raised the flag an investor reads before depositing on a mandate that was not broad. Unknown
   * is the honest answer while the re-measure is out, and unknown raises nothing.
   *
   * Two terms, because `isBroadMandate` compares it against `draft.pools.length` and that comparison
   * has to be true ONLY when every addable pool of the universe is in the draft.
   *
   * The first term is the universe this mandate could actually add (see {@link canEverAdd}). The
   * second is the selected pools that are NOT in that universe, which a pasted address produces: it
   * resolves one pool directly, so it can sit in `draft.pools` without ever having been returned by
   * a universe search. Counting only the first term let those pools inflate the left side of the
   * comparison, and a mandate holding two of three universe pools plus one pasted outsider raised
   * the Broad-mandate flag an investor reads before depositing. Adding them to BOTH sides cancels
   * them out, which leaves the comparison measuring exactly what R13 asks about.
   */
  const universeCount = useMemo(() => {
    if (universe === null || universe.signature !== universeSignature) return null;
    const inUniverse = new Set(universe.pools.map((pool) => pool.id));
    return (
      universe.pools.filter((pool) => canEverAdd(draft, pool, catalog)).length +
      draft.pools.filter((pool) => !inUniverse.has(pool.id)).length
    );
  }, [universe, universeSignature, draft, catalog]);

  /**
   * Published whenever the draft is not already carrying it, so the shell and Review measure the
   * flag against one number.
   *
   * Never before a read has resolved and never after one has failed: the shell persists what it is
   * told, so publishing the initial zero would overwrite a stored denominator with a number nothing
   * measured, and mark the draft dirty just for opening the step.
   *
   * The guard is the STORED value rather than the previous render's, because the two can disagree in
   * one direction that matters: every reducer that changes the networks, the protocols or the tokens
   * answers `poolUniverseCount: null`, which a pool pulling its other token in does on this very
   * step. A guard on the computed number alone saw nothing move and left the draft holding null for
   * good, with the flag out of reach. There is no loop either: once the draft carries the number,
   * this is quiet.
   */
  useEffect(() => {
    if (universeCount === null) return;
    if (draft.poolUniverseCount === universeCount) return;
    onUniverseCountRef.current?.(universeCount);
  }, [universeCount, draft.poolUniverseCount]);

  const ownBlock = block?.step === STEP ? block : null;

  // Scroll the offending row into view when the shell points a block at this step.
  useEffect(() => {
    if (!ownBlock?.rowId) return;
    document
      .querySelector(`[data-mandate-row="${ownBlock.rowId}"]`)
      ?.scrollIntoView({ block: "center" });
  }, [ownBlock]);

  /**
   * The inline notice for a refusal this step raised.
   *
   * `not_priced` and `coming_soon` are here although the brief names only three: `addPool`
   * re-targets a token refusal to the pools step with its reason intact, so a pool whose other token
   * has no price feed arrives as `{ step: "pools", reason: "not_priced" }`. Leaving it unmapped
   * would make that pool's Add do nothing visible at all, which is the silent refusal premise 11
   * exists to prevent.
   */
  const notice = ownBlock
    ? ({
        nothing_selected: t("fundBuilder.common.nothingSelected"),
        has_hook: t("fundBuilder.pools.hasHook"),
        no_slots: t("fundBuilder.common.noSlots"),
        not_priced: t("fundBuilder.tokens.noPrice"),
        coming_soon: t("fundBuilder.common.comingSoon"),
        cap_missing: null,
        token_allowance_required: null,
        name_length: null,
      }[ownBlock.reason] ?? null)
    : null;

  // R32: a pool already in the mandate leaves the results; the two sides can never disagree.
  const chosen = useMemo(() => new Set(draft.pools.map((pool) => pool.id)), [draft.pools]);
  const available = useMemo(
    () => resolution.pools.filter((pool) => !chosen.has(pool.id)),
    [resolution.pools, chosen],
  );

  /**
   * The rows the network filter leaves on screen, which every visible count is taken over.
   *
   * An address resolution is exempt. It answers exactly one pool, on whichever network holds it, and
   * hiding it because the filter names a different one would turn a successful paste into "no pools
   * match your search".
   */
  const onScreen = useMemo(
    () =>
      query.kind === "address" || network === ALL_NETWORKS
        ? available
        : available.filter((pool) => pool.network === network),
    [available, network, query.kind],
  );

  // R31: counts are over what is left to add, which is why the all-selected state reads "· 0".
  const counts = useMemo(() => {
    const perProtocol = new Map<DexProtocolId, number>(protocols.map((id) => [id, 0]));
    for (const pool of onScreen) {
      perProtocol.set(pool.protocol, (perProtocol.get(pool.protocol) ?? 0) + 1);
    }
    return perProtocol;
  }, [onScreen, protocols]);

  const activeTab: ProtocolTab =
    tab !== ALL_PROTOCOLS && !protocols.includes(tab) ? ALL_PROTOCOLS : tab;
  const filtered = useMemo(
    () =>
      activeTab === ALL_PROTOCOLS
        ? onScreen
        : onScreen.filter((pool) => pool.protocol === activeTab),
    [onScreen, activeTab],
  );
  const visible = filtered.slice(0, visibleCount);
  const remaining = filtered.length - visible.length;

  // What "Add all" would actually add, and therefore the number it is allowed to print (R31).
  const addable = useMemo(
    () => filtered.filter((pool) => canEverAdd(draft, pool, catalog)),
    [filtered, draft, catalog],
  );

  /**
   * Whether the list on screen is an answer about the mandate as it stands.
   *
   * Only a universe read carries a signature, and only it can go out of date this way: a search
   * answers a question the mandate's tokens do not define, so it is current by construction and the
   * measurement running beside it leaves it alone.
   */
  const onScreenIsCurrent =
    resolution.signature === null || resolution.signature === universeSignature;

  /**
   * R37: every pool this read found that the mandate CAN hold is already in it.
   *
   * Four conditions, each for its own reason. "Found something" distinguishes this from an empty
   * search, which is "no pools match", a different sentence. "Something addable" keeps a universe of
   * nothing but hooked rows out of a state that would claim they are all chosen. "Nothing addable
   * left" is the state itself, and it is about addable pools rather than all of them, because one
   * hooked leftover used to keep this message away for good. And the list has to be about the mandate
   * the manager is holding: "All 8 pools are selected" over a universe measured before an Add widened
   * it is the same false claim the Broad flag used to make, with a number printed next to it.
   */
  const addableFound = resolution.pools.filter((pool) => canEverAdd(draft, pool, catalog)).length;
  const addableLeft = available.filter((pool) => canEverAdd(draft, pool, catalog)).length;
  const allSelected =
    !loading && !failed && onScreenIsCurrent && addableFound > 0 && addableLeft === 0;
  const broad = isBroadMandate(draft, catalog, universeCount ?? 0);

  const used = slotsUsed(draft);
  const protocolNames: Record<DexProtocolId, string> = {
    "uniswap-v3": t("fundBuilder.protocolNames.uniswapV3"),
    "uniswap-v4": t("fundBuilder.protocolNames.uniswapV4"),
  };

  /**
   * R30: up to twelve token matches, the mandate's own first.
   *
   * The mandate's tokens lead because they are the ones whose pools the manager is here to pick; the
   * static lists follow so a token that is not in the mandate yet is still reachable, and adding its
   * pool pulls it in (R34).
   */
  function suggestionsFor(value: string, exclude: string | null): TokenChoice[] {
    const q = value.trim().toLowerCase();
    if (q.length === 0) return [];
    const out: TokenChoice[] = [];
    const seen = new Set<string>();
    const push = (choice: TokenChoice) => {
      const key = `${choice.network}:${choice.address.toLowerCase()}`;
      if (seen.has(key) || choice.address.toLowerCase() === exclude) return;
      seen.add(key);
      out.push(choice);
    };

    for (const token of shownTokens) {
      const matches =
        token.symbol.toLowerCase().includes(q) ||
        token.name.toLowerCase().includes(q) ||
        token.address.toLowerCase().startsWith(q);
      if (matches) {
        push({
          address: token.address,
          symbol: token.symbol,
          name: token.name,
          network: token.network,
          mine: true,
        });
      }
    }
    for (const id of displayNetworks) {
      const candidates =
        catalog.dataMode === "real"
          ? catalog
              .tokensFor([id], draft.protocols)
              .filter(
                (token) =>
                  token.priced &&
                  (token.symbol.toLowerCase().includes(q) ||
                    token.name.toLowerCase().includes(q) ||
                    token.address.toLowerCase().startsWith(q)),
              )
          : searchTokens(id, q, MAX_SUGGESTIONS);
      for (const token of candidates) {
        push({
          address: token.address,
          symbol: token.symbol,
          name: token.name,
          network: id,
          mine: false,
        });
      }
    }
    return out.slice(0, MAX_SUGGESTIONS);
  }

  const firstSuggestions = firstToken || isAddress ? [] : suggestionsFor(firstQuery, null);
  const secondSuggestions =
    firstToken && !secondToken && secondFocused
      ? suggestionsFor(secondQuery, firstToken.address.toLowerCase())
      : [];

  function pickFirst(choice: TokenChoice) {
    setFirstToken(choice);
    setFirstQuery(choice.symbol);
    setSecondToken(null);
    setSecondQuery("");
  }

  function clearFirst() {
    // Bump the ticket so a request from before the clear cannot repopulate what was just dropped.
    seq.current++;
    setFirstToken(null);
    setFirstQuery("");
    setSecondToken(null);
    setSecondQuery("");
  }

  /** R31: add in order until one refuses, then report that one refusal. */
  function handleAddAll() {
    const preview = addAllPools(draft, addable, catalog);
    if (preview.next !== draft) {
      update((current) => addAllPools(current, addable, catalog).next);
    }
    if (preview.blocked) onBlocked(preview.blocked);
  }

  /**
   * R32: add one pool, and REPORT the refusal when the reducer raises one.
   *
   * The reducer is previewed rather than fired and forgotten. `update` records a refusal so the
   * notice appears, but only `onBlocked` emits `builder_mandate_blocked` (see `steps/stepProps.ts`),
   * so an Add the reducer turned down used to leave the manager a notice and the funnel nothing at
   * all: a blocked intent that no disabled control and no error could ever be counted from, which is
   * the silence CLAUDE.md premise 11 exists to remove. The two refusals that reach this path are the
   * slot budget and a pool outside what the mandate named (its network today, its protocol once the
   * domain guard lands), because both are states a manager can clear on another step, so the row
   * keeps its Add. The two that are properties of the POOL are drawn as refusals instead; see
   * {@link rowRefusal}.
   *
   * Same shape as {@link handleAddAll}: preview once, then exactly one of the two paths, so nothing
   * is written on a refusal and nothing is reported twice.
   */
  function handleAdd(pool: MandatePoolRef) {
    const preview = addPool(draft, pool, catalog);
    if (isBlocked(preview)) {
      onBlocked(preview.blocked);
      return;
    }
    update((current) => addPool(current, pool, catalog));
  }

  /**
   * The refusal a pool carries as a PROPERTY, with the sentence that names it.
   *
   * Two of {@link canEverAdd}'s three refusals are drawn on the row: a Uniswap v4 hook (R38) and a
   * side the hub price source cannot price (R28). Neither is a state a manager can clear from any
   * step, so the honest control says so before it is pressed rather than accepting a press and
   * refusing it. The third (a network the mandate does not hold) is left to {@link handleAdd}: it
   * cannot reach a result list, since every search is scoped to the draft's own networks, and the
   * only copy for it would be "Coming soon", which is not what happened.
   */
  function rowRefusal(pool: MandatePoolRef): { reason: MandateBlockReason; label: string } | null {
    if (pool.hasHook) return { reason: "has_hook", label: t("fundBuilder.pools.hasHook") };
    const unpriced = [pool.token0, pool.token1].some(
      (side) =>
        !mandateHoldsSide(draft, pool, side.address) &&
        (catalog.dataMode === "real"
          ? !catalog
              .tokensFor([pool.network], draft.protocols)
              .some(
                (token) =>
                  token.address.toLowerCase() === side.address.toLowerCase() && token.priced,
              )
          : !isPricedSymbol(side.symbol)),
    );
    if (unpriced) return { reason: "not_priced", label: t("fundBuilder.tokens.noPrice") };
    return null;
  }

  /** R29: the shell already skips this step; rendering null is the belt to that brace. */
  if (!dex) return null;

  /** One pickable token row under a search field. */
  function suggestionRow(choice: TokenChoice, onPick: (choice: TokenChoice) => void) {
    return (
      <button
        key={`${choice.network}:${choice.address}`}
        type="button"
        role="option"
        aria-selected="false"
        // Pick on mousedown-without-blur, so the focus-driven list does not unmount before the
        // click lands (the POO-347 fix V1 carries).
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => onPick(choice)}
        className="flex w-full items-center gap-2 rounded-lg border border-border bg-surface p-2 text-left transition-colors hover:border-muted-foreground/40"
      >
        <TokenLogo symbol={choice.symbol} network={choice.network} className="size-5 text-[10px]" />
        <span className="font-medium text-foreground text-sm">{choice.symbol}</span>
        <span className="min-w-0 flex-1 truncate text-muted-foreground text-xs">{choice.name}</span>
        <NetworkLogoWithName network={choice.network} catalog={catalog} size={14} />
      </button>
    );
  }

  /** The locked chip a picked token becomes, with the way back out. */
  function tokenChip(choice: TokenChoice, onClear: () => void, label: string) {
    return (
      <button
        type="button"
        onClick={onClear}
        className="flex w-full items-center justify-between gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-left transition-colors hover:border-muted-foreground/40"
      >
        <span className="flex items-center gap-2 font-medium text-foreground text-sm">
          <TokenLogo
            symbol={choice.symbol}
            network={choice.network}
            className="size-5 text-[10px]"
          />
          {choice.symbol}
        </span>
        <span className="text-muted-foreground text-xs">{label}</span>
      </button>
    );
  }

  /** The protocol mark + name. V1's badge is a v3 brand literal; v4 reuses its mark and layout. */
  function protocolBadge(protocol: DexProtocolId) {
    if (protocol === "uniswap-v3") {
      return <ProtocolBadge size={13} className="shrink-0 text-muted-foreground text-xs" />;
    }
    return (
      <span className="inline-flex shrink-0 items-center gap-1.5 text-muted-foreground text-xs">
        {/* Decorative; the "Uniswap v4" text carries the meaning, as in ProtocolBadge. */}
        {/* biome-ignore lint/performance/noImgElement: a 13 px committed SVG from our own origin, the exact call ProtocolBadge makes for v3 right above; next/image would add a loader round trip for no payload saving, and the two badges must render identically. */}
        <img
          src="/protocols/uniswap.svg"
          alt=""
          aria-hidden="true"
          width={13}
          height={13}
          className="shrink-0"
        />
        <span>{protocolNames["uniswap-v4"]}</span>
      </span>
    );
  }

  /** The overlapping pair of token logos every pool row leads with. */
  function pairLogos(pool: MandatePoolRef, size: "sm" | "md") {
    const cls = size === "md" ? "size-7 text-[10px]" : "size-5 text-[9px]";
    return (
      <span className="flex shrink-0 items-center">
        <TokenLogo
          symbol={pool.token0.symbol}
          network={pool.network}
          className={cn(cls, "ring-2 ring-surface")}
        />
        <TokenLogo
          symbol={pool.token1.symbol}
          network={pool.network}
          className={cn(cls, "-ml-2 ring-2 ring-surface")}
        />
      </span>
    );
  }

  /** One result card (R32), or the disabled variant a permanent refusal gets (R28, R38). */
  function resultCard(pool: MandatePoolRef) {
    const adds = tokensItWouldAdd(draft, pool);
    const refusal = rowRefusal(pool);
    return (
      <div
        key={pool.id}
        data-mandate-row={pool.id}
        className={cn(
          "flex items-center gap-4 rounded-xl border border-border bg-surface p-4",
          refusal && "opacity-60",
        )}
      >
        {pairLogos(pool, "md")}

        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate font-medium text-foreground text-sm">{pairLabel(pool)}</span>
            {protocolBadge(pool.protocol)}
            <NetworkLogoWithName network={pool.network} catalog={catalog} size={14} />
          </span>

          <span className="text-muted-foreground text-xs">
            {feeLabel(pool.feeBps)}
            {/* R32: an absent share says nothing. "0% selected" would read as a measured share of
                nothing, which is a figure we never had (POO-1469). */}
            {pool.tierSharePct === null
              ? null
              : ` · ${t("fundBuilder.pools.tierShare", { pct: pool.tierSharePct })}`}
            {adds.map((symbol) => (
              <span key={symbol}>{` · ${t("fundBuilder.pools.addsToken", { symbol })}`}</span>
            ))}
          </span>

          <span className="flex min-w-0 items-center gap-1">
            <CopyAddressChip address={pool.token0.address} />
            <span className="text-muted-foreground/60 text-xs" aria-hidden="true">
              /
            </span>
            <CopyAddressChip address={pool.token1.address} />
          </span>
        </div>

        <div className="flex shrink-0 flex-col items-end text-xs">
          {pool.tvlUsd !== null ? (
            <span className="text-foreground">
              <span className="text-muted-foreground">{t("mandate.poolTvl")}</span>{" "}
              {formatUsdCompact(pool.tvlUsd)}
            </span>
          ) : null}
          {pool.aprPct !== null ? (
            <span className="text-success">
              <AprTooltip className="text-muted-foreground">{t("mandate.poolApr")}</AprTooltip>{" "}
              {formatPercent(pool.aprPct)}
            </span>
          ) : null}
          {pool.tvlUsd === null && pool.aprPct === null ? (
            <span className="text-muted-foreground">{t("fundBuilder.real.metrics")}</span>
          ) : null}
        </div>

        {refusal ? (
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                {/* R28/R38: `aria-disabled`, never the native `disabled`. The click is the
                    evidence, and it is the only one a permanent refusal can leave. */}
                <button
                  type="button"
                  aria-disabled="true"
                  title={refusal.label}
                  onClick={() => onBlocked({ step: STEP, reason: refusal.reason, rowId: pool.id })}
                  className="shrink-0 cursor-not-allowed rounded-full border border-border px-3 py-1.5 text-muted-foreground text-xs"
                >
                  {refusal.label}
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" sideOffset={4}>
                {refusal.label}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ) : (
          <Button
            variant="secondary"
            size="sm"
            className="shrink-0"
            onClick={() => handleAdd(pool)}
          >
            <Plus className="size-4" aria-hidden="true" />
            {t("fundBuilder.common.add")}
          </Button>
        )}
      </div>
    );
  }

  /** One row of "Your pools" (R33): no address and no share, because neither is a choice here. */
  function mandateRow(pool: MandatePoolRef) {
    return (
      <div
        key={pool.id}
        data-mandate-row={`yours:${pool.id}`}
        className="flex items-center gap-3 rounded-xl border border-border/60 bg-surface-raised px-3 py-2"
      >
        {pairLogos(pool, "sm")}
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-medium text-foreground text-sm">{pairLabel(pool)}</span>
          <span className="flex min-w-0 items-center gap-2">
            {protocolBadge(pool.protocol)}
            <span className="truncate text-muted-foreground text-xs">
              {t("fundBuilder.pools.feeTier", { fee: feeLabel(pool.feeBps) })}
            </span>
          </span>
        </span>
        <button
          type="button"
          aria-label={t("fundBuilder.common.remove", { name: pairLabel(pool) })}
          onClick={() => update((current) => removePool(current, pool.id))}
          className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>
    );
  }

  /** What sits where the result cards go: loading, failure, nothing, all-chosen, or the list. */
  function results() {
    if (loading) {
      return (
        <div className="flex flex-col gap-2">
          <p className="text-muted-foreground text-sm">{t("fundBuilder.pools.loading")}</p>
          {SKELETON_ROWS.map((row) => (
            <Skeleton key={row} height={84} radius="0.75rem" />
          ))}
        </div>
      );
    }
    if (failed) {
      return (
        <ErrorState
          title={t("fundBuilder.pools.error")}
          onRetry={() => setRetryNonce((value) => value + 1)}
          retryLabel={t("fundBuilder.pools.retry")}
        />
      );
    }
    if (allSelected) {
      return (
        <EmptyState
          title={t("fundBuilder.pools.allSelectedTitle")}
          // The count this read found and the mandate could hold, which for a universe read IS the
          // denominator. Never the raw result length: that would count rows nobody can add.
          description={t("fundBuilder.pools.allSelectedBody", { count: addableFound })}
        />
      );
    }
    if (filtered.length === 0) return <EmptyState title={t("fundBuilder.pools.empty")} />;
    return (
      <div className="flex flex-col gap-2">
        {visible.map(resultCard)}
        {remaining > 0 ? (
          <button
            type="button"
            onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}
            className="self-start rounded-full border border-border px-4 py-1.5 font-medium text-muted-foreground text-sm transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t("fundBuilder.common.showMore", { count: remaining })}
          </button>
        ) : null}
      </div>
    );
  }

  return (
    // `pb-24`: the shell's action bar is sticky, and without this it covers the last card at the
    // viewport heights the Figma was drawn at.
    <section data-mandate-step={STEP} className="flex flex-col gap-6 pb-24">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        {/* The catalog (R30, R31, R32) */}
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              {firstToken ? (
                tokenChip(firstToken, clearFirst, t("mandate.logoChange"))
              ) : (
                <div className="relative min-w-0">
                  <Search
                    className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-3 size-4 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <Input
                    value={firstQuery}
                    onChange={(event) => setFirstQuery(event.target.value)}
                    onFocus={() => setFirstFocused(true)}
                    onBlur={() => setFirstFocused(false)}
                    placeholder={
                      isMockMode ? t("fundBuilder.pools.search") : t("fundBuilder.real.poolId")
                    }
                    aria-label={t("fundBuilder.pools.search")}
                    className="pl-9"
                  />
                </div>
              )}
              {firstFocused && firstSuggestions.length > 0 ? (
                <div
                  role="listbox"
                  aria-label={t("fundBuilder.pools.search")}
                  className="flex flex-col gap-1"
                >
                  {firstSuggestions.map((choice) => suggestionRow(choice, pickFirst))}
                </div>
              ) : null}
            </div>

            <div className="flex min-w-0 flex-1 flex-col gap-1">
              {secondToken ? (
                tokenChip(
                  secondToken,
                  () => {
                    setSecondToken(null);
                    setSecondQuery("");
                  },
                  t("mandate.logoRemove"),
                )
              ) : (
                <div className="relative min-w-0">
                  <Search
                    className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-3 size-4 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <Input
                    value={secondQuery}
                    onChange={(event) => setSecondQuery(event.target.value)}
                    onFocus={() => setSecondFocused(true)}
                    onBlur={() => setSecondFocused(false)}
                    placeholder={t("fundBuilder.pools.secondToken")}
                    aria-label={t("fundBuilder.pools.secondToken")}
                    disabled={!firstToken}
                    className="pl-9"
                  />
                </div>
              )}
              {secondSuggestions.length > 0 ? (
                <div
                  role="listbox"
                  aria-label={t("fundBuilder.pools.secondToken")}
                  className="flex flex-col gap-1"
                >
                  {secondSuggestions.map((choice) =>
                    suggestionRow(choice, (pick) => {
                      setSecondToken(pick);
                      setSecondQuery(pick.symbol);
                    }),
                  )}
                </div>
              ) : null}
            </div>

            <FilterDropdown<NetworkFilter>
              label={t("fundBuilder.common.networkFilter")}
              options={[
                { value: ALL_NETWORKS, label: t("fundBuilder.common.allNetworks") },
                ...draft.networks.map((id) => ({ value: id, label: networkNames[id] })),
              ]}
              value={network}
              onSelect={setNetworkFilter}
            />
          </div>

          <p className="text-muted-foreground text-xs">{t("fundBuilder.pools.caption")}</p>

          {/* R30: a pasted address found somewhere the mandate does not reach. An advisory, not an
              error, so a polite live region; the networks were decided on step 1. */}
          {resolution.foundOn ? (
            <p role="status" className="text-warning text-xs">
              {t("mandate.poolWrongNetwork", { network: networkNames[resolution.foundOn] })}
            </p>
          ) : null}

          {/* R31: the protocol tabs. `TabsContent` is deliberately absent; the results below are the
              panel for whichever tab is active, and a panel per protocol would duplicate them. */}
          <Tabs value={activeTab} onValueChange={(value) => setTab(value as ProtocolTab)}>
            <TabsList className="w-full justify-start gap-2 bg-transparent p-0">
              <TabsTrigger
                value={ALL_PROTOCOLS}
                className="rounded-none border-transparent border-b-2 px-1 pb-2 data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none"
              >
                {t("fundBuilder.pools.tabAll", { count: onScreen.length })}
              </TabsTrigger>
              {protocols.map((id) => (
                <TabsTrigger
                  key={id}
                  value={id}
                  className="rounded-none border-transparent border-b-2 px-1 pb-2 data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none"
                >
                  {t("fundBuilder.pools.tabProtocol", {
                    protocol: protocolNames[id],
                    count: counts.get(id) ?? 0,
                  })}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          <div className="flex flex-wrap items-center justify-between gap-3">
            {/* The count line steps aside once every pool is chosen: "0 pools with at least one of
                your tokens" would contradict the empty state right under it (R37). */}
            {allSelected ? (
              <span />
            ) : (
              <p className="text-muted-foreground text-sm">
                {t("fundBuilder.pools.results", { count: filtered.length })}
              </p>
            )}
            <div className="flex shrink-0 items-center gap-2">
              {/* R31: one option. TVL descending is the order the adapter already returns.

                  `label` is the SECTION name alone. FilterDropdown composes its accessible name as
                  "<label>: <selection>", so a label that already carried the selection was
                  announced as "Sort: TVL: TVL". The visible "Sort:" prefix R31 draws rides on the
                  option's adornment instead, which the trigger renders and `aria-label` replaces. */}
              <FilterDropdown<"tvl">
                label={t("fundBuilder.common.sortFilter")}
                options={[
                  {
                    value: "tvl",
                    label: t("fundBuilder.common.sortTvl"),
                    adornment: <span className="-mr-1">{t("fundBuilder.common.sortPrefix")}</span>,
                  },
                ]}
                value="tvl"
                onSelect={() => undefined}
              />
              {/* Only what it would really add. "Add all 3" over two addable pools and a hooked one
                  is a promise the button cannot keep, and "Add all 0" is not an offer. */}
              {addable.length > 0 ? (
                <Button variant="secondary" size="sm" onClick={handleAddAll}>
                  <Plus className="size-4" aria-hidden="true" />
                  {t("fundBuilder.common.addAll", { count: addable.length })}
                </Button>
              ) : null}
            </div>
          </div>

          {notice ? (
            <p
              role="alert"
              className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-destructive text-sm"
            >
              {notice}
            </p>
          ) : null}

          {results()}
        </div>

        {/* The mandate (R33, R34) */}
        <aside className="w-full shrink-0 rounded-xl border border-border bg-surface p-4 lg:sticky lg:top-6 lg:w-[340px]">
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-medium text-foreground text-sm">
              {t("fundBuilder.pools.yours", { count: draft.pools.length })}
            </h3>
            <button
              type="button"
              disabled={draft.pools.length === 0}
              onClick={() => update(clearPools)}
              className="shrink-0 rounded-md text-muted-foreground text-sm transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t("fundBuilder.common.clearAll")}
            </button>
          </div>

          <div className="mt-3 flex flex-col gap-2">
            {draft.pools.slice(0, YOURS_VISIBLE).map(mandateRow)}
          </div>
          {draft.pools.length > YOURS_VISIBLE ? (
            <p className="mt-2 text-muted-foreground text-xs">
              {t("fundBuilder.common.andMore", { count: draft.pools.length - YOURS_VISIBLE })}
            </p>
          ) : null}

          <div className="mt-4 border-border border-t pt-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground text-xs">
                {t("fundBuilder.common.slotsUsed")}
              </span>
              <span className="font-semibold text-foreground text-sm">
                {t("fundBuilder.common.slotsCount", { used, max: MAX_TOKEN_SLOTS })}
              </span>
            </div>
            <p className="mt-2 text-muted-foreground text-xs">{t("fundBuilder.pools.fixed")}</p>
          </div>
        </aside>
      </div>

      {/* R13 / R37: the flag an investor sees before depositing. Both halves have to be true, so it
          is measured by `isBroadMandate` against the universe this step resolved, never by this
          screen's own arithmetic. */}
      {broad ? (
        <div className="flex items-start gap-3 rounded-xl border border-primary/40 bg-primary/5 p-4">
          <Flag className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
          <div className="flex min-w-0 flex-col gap-1">
            <p className="font-medium text-primary text-sm">{t("fundBuilder.pools.broadTitle")}</p>
            <p className="text-muted-foreground text-sm">{t("fundBuilder.pools.broadBody")}</p>
          </div>
        </div>
      ) : null}
    </section>
  );
}
