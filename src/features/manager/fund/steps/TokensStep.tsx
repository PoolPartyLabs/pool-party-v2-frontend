/**
 * @id PP-MGR-CMP-037
 * @name TokensStep
 * @implements-rules-version v1
 * @implements-rules-version v1 (POO-2301 shared local runtime extension)
 * @implements-rules-version v1 (POO-2332)
 * @analytics-events none, the shell emits
 *
 * POO-2124 [R13] / [R23] / [R24] / [R25] / [R26] / [R27] / [R28], epic POO-2119. Mandate step 3:
 * the tokens this strategy may ever hold.
 *
 * Two columns (R23): the catalog on the left, the mandate on the right. A token added leaves the
 * catalog and appears in "Your tokens"; removing it sends it back. That is one list split in two,
 * not two lists, so the catalog is always `catalog.tokensFor(…)` minus what the draft already holds
 * and the two sides can never disagree about where a token is.
 *
 * **The default list is priced only.** `tokensFor(["arbitrum"], …)` returns 374 entries today and 7
 * of them are priced (R28), so rendering the catalog as it comes would bury the seven addable tokens
 * under 367 cards whose only possible answer is "No price feed yet". An unpriced token is still
 * reachable: a search that names it shows it, disabled, with its reason. The manager who goes
 * looking for it gets an answer instead of silence, and the manager who does not goes no further
 * than seven cards. PP-NOTE: assumption (coordinator default); the day the price-source registry
 * ships (`PRICED_SYMBOLS` in PP-MGR-LIB-019) this list grows by data, not by code.
 *
 * **A token costs one slot per network it runs on** (R27), which is the whole reason the catalog is
 * grouped by SYMBOL rather than listed per entry. One card means one decision: `addToken` puts the
 * token on every selected network where it exists, so ETH on a hub-and-spoke mandate costs two
 * slots. "Does this fit" is therefore `used + entries(symbol) <= ceiling`, never `used < ceiling`,
 * and the card's own entry count is what the Add button weighs. The ceiling is 100 in mock mode and
 * 16 in real mode (POO-2332 R2, R14).
 *
 * **Both refusals keep their click.** The Add of a token that does not fit, and the card of a token
 * with no price feed, carry `aria-disabled` rather than the native `disabled`: a native disabled
 * control swallows the event, and that click is the only evidence that someone wanted this token.
 * Both route it to `onBlocked`, which is the step's only reporting channel; the shell turns it into
 * `builder_mandate_blocked` (CLAUDE.md premise 11, blocked intent). "Add all" follows the same rule
 * from the other side: it adds in order, stops at the first refusal, keeps everything it managed to
 * add, and reports that one refusal. It raises no warning of its own (R13): a wide token list is not
 * a Broad mandate until the pools are wide too, and that flag belongs to step 4.
 *
 * **Token access (POO-2332).** In mock data mode a "Token access" control sits on top of the step
 * (R1). Selected mode is the list above, with 100 slots (R2, R3). All mode lets the strategy trade
 * any token: the right column shows the info card, the locked tokens, "Every other token" and a
 * "No limit" footer (R4). The catalog stays on the left in both modes, and Add still changes the
 * kept list, so a return to Selected mode gives the same list (R5). The mock catalog also has a
 * loading state, an error state with "Try again" (R6) and a full basket state (R7). The view models
 * in PP-MGR-LIB-079 decide what shows. Real data mode keeps its 16 slots and has no control (R14).
 */
"use client";

import { Lock, Plus, Search, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { TokenLogo } from "@/components/data-display/TokenLogo";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { FilterDropdown } from "@/components/ui/FilterDropdown";
import { Input } from "@/components/ui/Input";
import { Skeleton } from "@/components/ui/Skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/Tooltip";
import { cn } from "@/lib/utils/cn";
import { safeHttpUrl } from "@/lib/utils/sanitize";
import { MandateCatalogStatus } from "../components/MandateCatalogStatus";
import { NetworkDots, useNetworkNames } from "../components/NetworkDots";
import { TokenAccessControl } from "../components/TokenAccessControl";
import type { MandateCatalog, MandateCatalogToken } from "../mandateCatalog";
import {
  addToken,
  clearTokens,
  HUB_NETWORK,
  isBlocked,
  type MandateDraft,
  type MandateTokenRef,
  type NetworkId,
  removeTokenSymbol,
  type StepBlock,
  setTokenMode,
  tokenKey,
} from "../mandateDraft";
import { catalogCardAction, tokenAccessPanel, tokenCatalogState } from "../mandateTokenAccess";
import type { MandateStepProps } from "./stepProps";

/** This step's key, spelled once. */
const STEP = "tokens" as const;

/** R6: the number of skeleton cards the loading state shows, as stable keys. */
const SKELETON_CARDS = ["s1", "s2", "s3", "s4", "s5", "s6"] as const;

/** The one network-filter value that is not a network. */
const ALL_NETWORKS = "all" as const;

type NetworkFilter = NetworkId | typeof ALL_NETWORKS;

/** One catalog card: a symbol, and every entry of it the draft has not taken yet. */
interface CatalogGroup {
  /** `tokenKey` of {@link first}: the card's row id, and what a `StepBlock` points back at. */
  id: string;
  symbol: string;
  name: string;
  priced: boolean;
  /** The entry handed to {@link addToken}, which then adds every network's entry of this symbol. */
  first: MandateCatalogToken;
  /** The networks this card's dots show, and the slots an Add would cost. */
  networks: NetworkId[];
  entries: MandateCatalogToken[];
}

/** One "Your tokens" row: a symbol, and the networks the draft holds it on. */
interface MandateGroup {
  logoUrl: string | null;
  symbol: string;
  name: string;
  /** The deposit token (R24): no remove control, a Lock and the "Deposit token" caption. */
  locked: boolean;
  networks: NetworkId[];
}

/**
 * One card per symbol, in the order the catalog gave them.
 *
 * Grouping by symbol is what {@link addToken} does internally (it adds every selected network's
 * entry of that symbol), so a per-entry list would offer a choice the reducer does not honour.
 */
function groupCatalog(entries: MandateCatalogToken[]): CatalogGroup[] {
  const groups = new Map<string, CatalogGroup>();
  for (const entry of entries) {
    const key = entry.symbol.toLowerCase();
    const current = groups.get(key);
    if (!current) {
      groups.set(key, {
        id: tokenKey(entry),
        symbol: entry.symbol,
        name: entry.name,
        priced: entry.priced || entry.visualEligible === true,
        first: entry,
        networks: [entry.network],
        entries: [entry],
      });
      continue;
    }
    current.entries.push(entry);
    if (!current.networks.includes(entry.network)) current.networks.push(entry.network);
  }
  return [...groups.values()];
}

/**
 * One row per symbol on the right card (R24).
 *
 * A group is locked when ANY of its entries is, which is the conservative reading: a symbol the
 * mandate partly depends on as its deposit token keeps its Lock rather than offering a remove that
 * `removeTokenSymbol` would refuse to honour for the locked half.
 */
function groupMandate(tokens: MandateTokenRef[]): MandateGroup[] {
  const groups = new Map<string, MandateGroup>();
  for (const token of tokens) {
    const key = token.symbol.toLowerCase();
    const current = groups.get(key);
    if (!current) {
      groups.set(key, {
        symbol: token.symbol,
        logoUrl: token.logoUrl,
        name: token.name,
        locked: token.locked,
        networks: [token.network],
      });
      continue;
    }
    current.locked = current.locked || token.locked;
    if (!current.networks.includes(token.network)) current.networks.push(token.network);
  }
  return [...groups.values()];
}

/**
 * R25: whether a card answers this query, matched on symbol, name or the start of an address.
 *
 * A full 42-character address is an exact match by construction, since no other address shares a
 * 42-character prefix with it. `query` arrives already trimmed and lowercased.
 */
function matchesQuery(group: CatalogGroup, query: string): boolean {
  if (group.symbol.toLowerCase().includes(query)) return true;
  return group.entries.some(
    (entry) =>
      entry.name.toLowerCase().includes(query) || entry.address.toLowerCase().startsWith(query),
  );
}

/**
 * R26: add every card in order, stop at the first refusal, keep what was added.
 *
 * Pure, so the caller can run it once to decide what to report and hand the same function to
 * `update` as a reducer; the two runs see the same draft and agree.
 */
function addAllTokens(
  draft: MandateDraft,
  groups: CatalogGroup[],
  catalog: MandateCatalog,
): { next: MandateDraft; blocked: StepBlock | null } {
  let next = draft;
  for (const group of groups) {
    const result = addToken(next, group.first, catalog);
    if (isBlocked(result)) return { next, blocked: result.blocked };
    next = result;
  }
  return { next, blocked: null };
}

/** The leading visual of a token, at the size the card or the row asks for. */
function TokenMark({
  group,
  size,
}: {
  group: {
    symbol: string;
    networks: NetworkId[];
    first?: MandateCatalogToken;
    logoUrl?: string | null;
  };
  size: 22 | 28;
}) {
  const catalogLogo = safeHttpUrl(group.first?.logoUrl ?? group.logoUrl);
  if (catalogLogo)
    return (
      // biome-ignore lint/performance/noImgElement: discovery logos can use any validated HTTPS CDN.
      <img
        src={catalogLogo}
        alt=""
        aria-hidden="true"
        className={cn("rounded-full", size === 28 ? "size-7" : "size-[22px]")}
      />
    );
  return (
    <TokenLogo
      symbol={group.symbol}
      network={group.networks[0]}
      className={cn("text-xs", size === 28 ? "size-7" : "size-[22px]")}
    />
  );
}

/** Mandate step 3: the token catalog on the left, the mandate's own tokens on the right. */
export function TokensStep({ draft, catalog, update, block, onBlocked }: MandateStepProps) {
  const t = useTranslations("manager");
  const networkNames = useNetworkNames();
  const [query, setQuery] = useState("");
  const [networkFilter, setNetworkFilter] = useState<NetworkFilter>(ALL_NETWORKS);

  // POO-2332: what the right column shows (R3, R4, R7), and the catalog state (R6). Real data mode
  // keeps the shared MandateCatalogStatus notices (R14), so the mock states apply in mock mode only.
  const panel = tokenAccessPanel(draft, catalog);
  const real = catalog.dataMode === "real";
  const catalogState = real ? null : tokenCatalogState(catalog);

  // R23: the catalog is what the draft has NOT taken, so adding a token removes its card and
  // removing the token brings it back, with no second list to keep in step.
  const groups = useMemo(() => {
    const taken = new Set(draft.tokens.map(tokenKey));
    return groupCatalog(
      catalog
        .tokensFor(draft.networks, draft.protocols)
        .filter((entry) => !taken.has(tokenKey(entry))),
    );
  }, [catalog, draft.tokens, draft.networks, draft.protocols]);

  // A network that left the draft cannot keep filtering a list it is no longer part of.
  const network =
    networkFilter !== ALL_NETWORKS && !draft.networks.includes(networkFilter)
      ? ALL_NETWORKS
      : networkFilter;

  const trimmed = query.trim().toLowerCase();
  const visible = useMemo(
    () =>
      groups
        .filter((group) => (trimmed ? matchesQuery(group, trimmed) : group.priced))
        .filter((group) => network === ALL_NETWORKS || group.networks.includes(network))
        .sort((a, b) => a.symbol.localeCompare(b.symbol)),
    [groups, trimmed, network],
  );
  // "Add all" skips what it could never add, so the count on the button is a promise it can keep.
  // R7: a full basket turns "Add all" off. All mode has no slot cap, so it never turns off there.
  // Real data mode keeps its current "Add all", which reports the refusal itself (R14).
  const addable = panel.full && !real ? [] : visible.filter((group) => group.priced);

  const mandateGroups = groupMandate(draft.tokens);
  const hasRemovable = draft.tokens.some((token) => !token.locked);

  const ownBlock = block?.step === STEP ? block : null;
  // The inline notice for a refusal this step raised. Nothing else can block Tokens: the slot
  // ceiling is enforced on ADD (R27) and `validateStep("tokens")` is always null (R6).
  const notice =
    ownBlock?.reason === "no_slots"
      ? t("fundBuilder.common.noSlots")
      : ownBlock?.reason === "not_priced"
        ? t("fundBuilder.tokens.noPrice")
        : null;

  // Scroll the offending card into view when the shell points a block at this step.
  useEffect(() => {
    if (!ownBlock?.rowId) return;
    document
      .querySelector(`[data-mandate-row="${ownBlock.rowId}"]`)
      ?.scrollIntoView({ block: "center" });
  }, [ownBlock]);

  /**
   * R26: add in order until one refuses, then report that one refusal.
   *
   * Run twice on purpose. `update` takes a REDUCER, so the chain has to be expressible as one, and
   * `onBlocked` is a side effect that must not live inside a function React may call more than once.
   * The preview answers "what would this do" from the draft this render is showing, and the reducer
   * does the same work against whatever draft the store hands it. Both are pure and see the same
   * draft, so they agree, and the step never reports a refusal the store did not actually make.
   */
  function handleAddAll() {
    const preview = addAllTokens(draft, addable, catalog);
    if (preview.next !== draft) {
      update((current) => addAllTokens(current, addable, catalog).next);
    }
    if (preview.blocked) onBlocked(preview.blocked);
  }

  /** One catalog card: addable, out of slots, or without a price feed. */
  function catalogCard(group: CatalogGroup) {
    const shell =
      "flex items-center gap-3 rounded-xl border border-border bg-surface p-3 transition-colors";

    // R28: listed, disabled, and still reporting the click that asked for it.
    if (!group.priced) {
      return (
        <button
          key={group.id}
          type="button"
          aria-disabled="true"
          aria-label={group.symbol}
          data-mandate-row={group.id}
          onClick={() => onBlocked({ step: STEP, reason: "not_priced", rowId: group.id })}
          className={cn(
            shell,
            "cursor-not-allowed text-left opacity-60",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          )}
        >
          <TokenMark group={group} size={28} />
          <CardText group={group} catalog={catalog} />
          <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-muted-foreground text-xs">
            {t("fundBuilder.tokens.noPrice")}
          </span>
        </button>
      );
    }

    // R27: one slot per network this token runs on, so a two-network token needs two free. R7: the
    // ceiling is 100 in mock Selected mode, 16 in real mode, and none in All mode.
    const outOfSlots = catalogCardAction(draft, group.entries) === "no_free_slots";

    return (
      <div key={group.id} data-mandate-row={group.id} className={shell}>
        <TokenMark group={group} size={28} />
        <CardText group={group} catalog={catalog} />
        {outOfSlots ? (
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                {/* `aria-disabled`, never the native `disabled`: the click is the evidence. The
                    `title` repeats the tooltip for a touch long-press, as NetworkDots does. */}
                <Button
                  variant="secondary"
                  size="sm"
                  aria-disabled="true"
                  title={t("fundBuilder.common.noSlots")}
                  onClick={() => onBlocked({ step: STEP, reason: "no_slots", rowId: group.id })}
                  className={real ? undefined : "cursor-not-allowed text-muted-foreground"}
                >
                  {real ? <Plus className="size-4" aria-hidden="true" /> : null}
                  {real ? t("fundBuilder.common.add") : t("fundBuilder.tokens.noFreeSlots")}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top" sideOffset={4}>
                {t("fundBuilder.common.noSlots")}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ) : (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => update((current) => addToken(current, group.first, catalog))}
          >
            <Plus className="size-4" aria-hidden="true" />
            {t("fundBuilder.common.add")}
          </Button>
        )}
      </div>
    );
  }

  /**
   * The caption of a locked row. The hub deposit token is the "Deposit token". In mock mode a token
   * that only another network needs (USDG on Robinhood Chain) is "Required by <network>" (R4). Real
   * mode keeps "Deposit token" on every locked row (R14).
   */
  function lockedCaption(group: { networks: NetworkId[] }): string {
    const first = group.networks[0];
    if (real || !first || group.networks.includes(HUB_NETWORK))
      return t("fundBuilder.tokens.depositToken");
    return t("fundBuilder.tokens.requiredBy", { network: networkNames[first] });
  }

  /** One "Your tokens" row: the deposit token, locked, or a chosen token with its remove. */
  function mandateRow(group: MandateGroup) {
    return (
      <div
        key={group.symbol}
        data-mandate-row={`yours:${group.symbol}`}
        className="flex items-center gap-3 rounded-xl border border-border/60 bg-surface-raised px-3 py-2"
      >
        <TokenMark group={group} size={22} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-medium text-foreground text-sm">{group.symbol}</span>
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-muted-foreground text-xs">
              {group.locked ? lockedCaption(group) : group.name}
            </span>
            <NetworkDots networks={group.networks} catalog={catalog} size={12} />
          </span>
        </span>
        {group.locked ? (
          <Lock className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        ) : (
          <button
            type="button"
            aria-label={t("fundBuilder.common.remove", { name: group.symbol })}
            onClick={() => update((current) => removeTokenSymbol(current, group.symbol))}
            className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        )}
      </div>
    );
  }

  // R4: the locked tokens of "Your tokens · All", one row per symbol in network order.
  const lockedGroups: MandateGroup[] = [];
  for (const row of panel.lockedRows) {
    const current = lockedGroups.find((group) => group.symbol === row.symbol);
    if (current) {
      if (!current.networks.includes(row.network)) current.networks.push(row.network);
      continue;
    }
    lockedGroups.push({
      symbol: row.symbol,
      name: row.name,
      logoUrl: row.logoUrl,
      locked: true,
      networks: [row.network],
    });
  }
  const allMode = panel.yourTokens === "all";
  const slotCount = panel.slotCount;

  /** R6: the results line, or the loading or error line in its place. */
  function resultsLine() {
    if (catalogState?.status === "loading")
      return (
        <p role="status" className="text-muted-foreground text-sm">
          {t("fundBuilder.tokens.loading")}
        </p>
      );
    if (catalogState?.status === "error")
      return <p className="text-muted-foreground text-sm">{t("fundBuilder.tokens.errorTitle")}</p>;
    return (
      <p className="text-muted-foreground text-sm">
        {t("fundBuilder.tokens.results", { count: visible.length })}
      </p>
    );
  }

  /** R6: the card grid, the skeleton cards while the catalog loads, or the error box. */
  function catalogBody() {
    if (catalogState?.status === "loading")
      return (
        <div aria-hidden="true" className="grid grid-cols-2 gap-2">
          {SKELETON_CARDS.map((id) => (
            <div
              key={id}
              className="flex items-center gap-3 rounded-xl border border-border bg-surface p-3"
            >
              <Skeleton className="size-7 rounded-full" />
              <span className="flex flex-1 flex-col gap-1.5">
                <Skeleton className="h-3 w-1/3" />
                <Skeleton className="h-2.5 w-1/2" />
              </span>
            </div>
          ))}
        </div>
      );
    if (catalogState?.status === "error")
      return (
        <div
          role="alert"
          className="flex flex-col items-center gap-2 rounded-xl border border-error-border bg-error-surface px-4 py-6 text-center"
        >
          <p className="font-medium text-foreground text-sm">
            {t("fundBuilder.tokens.errorHeading")}
          </p>
          <p className="text-muted-foreground text-xs">{t("fundBuilder.tokens.errorBody")}</p>
          {catalogState.retry ? (
            <Button variant="secondary" size="sm" onClick={catalogState.retry}>
              {t("fundBuilder.tokens.retry")}
            </Button>
          ) : null}
        </div>
      );
    // Real data mode: MandateCatalogStatus shows the loading and error notices (R14).
    if (catalog.loading || catalog.error) return null;
    if (visible.length === 0) return <EmptyState title={t("fundBuilder.tokens.empty")} />;
    return <div className="grid grid-cols-2 gap-2">{visible.map(catalogCard)}</div>;
  }

  return (
    <section data-mandate-step={STEP} className="flex flex-col gap-6">
      {/* R1: Token access, mock data mode only (R14). */}
      {panel.showControl ? (
        <TokenAccessControl
          mode={panel.mode}
          onChange={(mode) => update((current) => setTokenMode(current, mode))}
        />
      ) : null}

      <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:gap-6">
        {/* The catalog (R25, R26). It stays in All mode, where Add still changes the kept list (R5). */}
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <MandateCatalogStatus catalog={catalog} draft={draft} />
          {draft.runtime === "solana-local" ? (
            <p role="status" className="text-xs text-muted-foreground">
              {t("solanaPreview.marketUnavailable")}
            </p>
          ) : null}
          <div className="flex items-center gap-3">
            <div className="relative min-w-0 flex-1">
              <Search
                className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-3 size-4 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("fundBuilder.tokens.search")}
                aria-label={t("fundBuilder.tokens.search")}
                className="pl-9"
              />
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
          <p className="text-muted-foreground text-xs">{t("fundBuilder.tokens.caption")}</p>

          <div className="flex flex-wrap items-center justify-between gap-3">
            {resultsLine()}
            {catalogState && catalogState.status !== "ready" ? null : (
              <div className="flex shrink-0 items-center gap-2">
                {/* R26: one option today. PP-NOTE: a token carries no TVL of its own, so the second
                    sort (`fundBuilder.common.sortTvl`) belongs to the Pools step, not here.

                    `label` is the SECTION name alone. FilterDropdown composes its accessible name as
                    "<label>: <selection>", so a label that already carried the selection was announced
                    as "Sort: Name: Name". The visible "Sort:" prefix R26 draws rides on the option's
                    adornment instead, which the trigger renders and `aria-label` replaces. */}
                <FilterDropdown<"name">
                  label={t("fundBuilder.common.sortFilter")}
                  options={[
                    {
                      value: "name",
                      label: t("fundBuilder.common.sortName"),
                      adornment: (
                        <span className="-mr-1">{t("fundBuilder.common.sortPrefix")}</span>
                      ),
                    },
                  ]}
                  value="name"
                  onSelect={() => undefined}
                />
                {addable.length > 0 ? (
                  <Button variant="secondary" size="sm" onClick={handleAddAll}>
                    <Plus className="size-4" aria-hidden="true" />
                    {t("fundBuilder.common.addAll", { count: addable.length })}
                  </Button>
                ) : panel.full && !real ? (
                  // R7: "Add all" is off while every slot is used.
                  <Button variant="secondary" size="sm" disabled>
                    <Plus className="size-4" aria-hidden="true" />
                    {t("fundBuilder.common.addAll", {
                      count: visible.filter((group) => group.priced).length,
                    })}
                  </Button>
                ) : null}
              </div>
            )}
          </div>

          {notice ? (
            <p
              role="alert"
              className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-destructive text-sm"
            >
              {notice}
            </p>
          ) : null}

          {catalogBody()}
        </div>

        {/* The mandate (R24, R27), with the All tokens info card on top in All mode (R4). */}
        <div className="flex w-full shrink-0 flex-col gap-3 lg:sticky lg:top-6 lg:w-[340px]">
          {allMode ? (
            <div className="rounded-xl border border-border bg-surface p-4">
              <p className="font-medium text-foreground text-sm">
                {t("fundBuilder.tokens.allTitle")}
              </p>
              <p className="mt-2 text-muted-foreground text-xs">
                {t("fundBuilder.tokens.allBody")}
              </p>
            </div>
          ) : null}

          <aside className="w-full rounded-xl border border-border bg-surface p-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-medium text-foreground text-sm">
                {allMode
                  ? t("fundBuilder.tokens.yoursAll")
                  : t("fundBuilder.tokens.yours", { count: draft.tokens.length })}
              </h3>
              {allMode ? null : (
                <button
                  type="button"
                  disabled={!hasRemovable}
                  onClick={() => update(clearTokens)}
                  className="shrink-0 rounded-md text-muted-foreground text-sm transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {t("fundBuilder.common.clearAll")}
                </button>
              )}
            </div>

            {allMode ? (
              <div className="mt-3 flex flex-col gap-2">
                {lockedGroups.map(mandateRow)}
                <div
                  data-mandate-row="yours:every-other"
                  className="flex flex-col rounded-xl border border-border/60 bg-surface-raised px-3 py-2"
                >
                  <span className="font-medium text-foreground text-sm">
                    {t("fundBuilder.tokens.everyOther")}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {t("fundBuilder.tokens.everyOtherCaption")}
                  </span>
                </div>
              </div>
            ) : (
              <div className="mt-3 flex flex-col gap-2">{mandateGroups.map(mandateRow)}</div>
            )}

            <div className="mt-4 border-border border-t pt-3">
              {panel.showSlotFooter && slotCount ? (
                <>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-muted-foreground text-xs">
                      {t("fundBuilder.common.slotsUsed")}
                    </span>
                    <span
                      className={cn(
                        "font-semibold text-sm",
                        panel.full && !real ? "text-brand-mango" : "text-foreground",
                      )}
                    >
                      {t("fundBuilder.common.slotsCount", slotCount)}
                    </span>
                  </div>
                  {panel.full && !real ? (
                    <p className="mt-2 text-brand-mango text-xs">
                      {t("fundBuilder.tokens.fullCaption", { max: slotCount.max })}
                    </p>
                  ) : (
                    <p className="mt-2 text-muted-foreground text-xs">
                      {t("fundBuilder.tokens.slotsCaption", { max: slotCount.max })}
                    </p>
                  )}
                </>
              ) : (
                <>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-muted-foreground text-xs">
                      {t("fundBuilder.tokens.slotsShort")}
                    </span>
                    <span className="font-semibold text-foreground text-sm">
                      {t("fundBuilder.tokens.noLimit")}
                    </span>
                  </div>
                  <p className="mt-2 text-muted-foreground text-xs">
                    {t("fundBuilder.tokens.noLimitCaption")}
                  </p>
                </>
              )}
            </div>
          </aside>
        </div>
      </div>
    </section>
  );
}

/** Symbol with its network dots, and the token's real name under it. */
function CardText({ group, catalog }: { group: CatalogGroup; catalog: MandateCatalog }) {
  return (
    <span className="flex min-w-0 flex-1 flex-col text-left">
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="truncate font-medium text-foreground text-sm">{group.symbol}</span>
        <NetworkDots networks={group.networks} catalog={catalog} size={12} />
      </span>
      <span className="truncate text-muted-foreground text-xs">{group.name}</span>
    </span>
  );
}
