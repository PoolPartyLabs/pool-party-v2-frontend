/**
 * @id PP-MGR-LIB-079
 * @name mandateTokenAccess
 * @implements-rules-version v1 (POO-2332)
 * @analytics-events none, pure view models. The builder shell (PP-MGR-SCR-002) sends
 *   `builder_mandate_token_mode_changed` and `builder_mandate_blocked` with the params that
 *   {@link tokenModeChangedParams} and {@link mandateBlockedParams} return.
 *
 * The view models of the Tokens and Limits steps for the token access mode (POO-2332). Each
 * function is pure and has no React. The components render what these functions return, so the
 * rules are tested here and not in a render test.
 *
 * - {@link tokenAccessPanel}: the right column of the Tokens step (R3, R4, R7) and whether the
 *   Token access control shows (R14).
 * - {@link catalogCardAction} and {@link basketRowsView}: what a catalog card offers and how many
 *   basket rows show (R7).
 * - {@link tokenCatalogState}: the loading and error states of the catalog (R6).
 * - {@link allTokensRowValue} and {@link toggleAllTokensNoCap}: the "All tokens" row on Limits (R9).
 * - {@link mandateSummaryTokens}: the tokens and token caps the summary card shows (R10).
 * - {@link firstZeroCap}, {@link nextBlockedLabelKey} and {@link nextButtonView}: the zero-cap
 *   block on Next (R12).
 * - {@link mandateBlockedParams} and {@link capZeroBlinkKey}: the press on a blocked Next (R13).
 * - {@link tokenModeChangedParams}: when the token mode event goes out (R15).
 */
import type { AnalyticsMandateBlockReason } from "@/lib/analytics/events";
import type { AnalyticsBlockReason } from "@/lib/analytics/txFlowKit";
import type { MandateCatalog, MandateCatalogToken } from "./mandateCatalog";
import {
  capRows,
  defaultTokenCapOf,
  effectiveCap,
  firstZeroCapRow,
  HUB_NETWORK,
  isRealData,
  type MandateBlockReason,
  type MandateCap,
  type MandateDraft,
  type MandateStepKey,
  type MandateTokenRef,
  NETWORK_ORDER,
  type NetworkId,
  type StepBlock,
  setCap,
  slotsUsed,
  type TokenMode,
  tokenKey,
  tokenModeOf,
  tokenSlotCeiling,
  tokenSlotsApply,
  type ZeroCapGroup,
} from "./mandateDraft";

/** One locked row of "Your tokens · All": the hub deposit token, or a token a network needs. */
export interface LockedTokenRow {
  symbol: string;
  name: string;
  logoUrl: string | null;
  network: NetworkId;
  /** "deposit" on the hub ("Deposit token"), "required" on another network ("Required by …"). */
  kind: "deposit" | "required";
}

/** What the right column of the Tokens step shows. */
export interface TokenAccessPanel {
  /** R14: real data mode has no Token access control. */
  showControl: boolean;
  mode: TokenMode;
  /** R3: the chosen list. R4: "Your tokens · All". */
  yourTokens: "list" | "all";
  /** R4: the locked tokens, in network order. Empty in Selected mode, where the list shows them. */
  lockedRows: LockedTokenRow[];
  /** R3: "Network slots used" / "N of 100". R4: false, the "No limit" footer shows in its place. */
  showSlotFooter: boolean;
  slotCount: { used: number; max: number } | null;
  /** R7: every slot is used. */
  full: boolean;
}

/** R3, R4, R7, R14: the right column of the Tokens step. */
export function tokenAccessPanel(draft: MandateDraft, catalog: MandateCatalog): TokenAccessPanel {
  const real = isRealData(draft, catalog);
  const mode = real ? "selected" : tokenModeOf(draft);
  if (mode === "all") {
    const lockedRows: LockedTokenRow[] = NETWORK_ORDER.filter((network) =>
      draft.networks.includes(network),
    ).flatMap((network) =>
      draft.tokens
        .filter((token) => token.locked && token.network === network)
        .map((token) => ({
          symbol: token.symbol,
          name: token.name,
          logoUrl: token.logoUrl,
          network,
          kind: network === HUB_NETWORK ? ("deposit" as const) : ("required" as const),
        })),
    );
    return {
      showControl: true,
      mode,
      yourTokens: "all",
      lockedRows,
      showSlotFooter: false,
      slotCount: null,
      full: false,
    };
  }
  const used = slotsUsed(draft);
  const max = tokenSlotCeiling(draft);
  return {
    showControl: !real,
    mode,
    yourTokens: "list",
    lockedRows: [],
    showSlotFooter: true,
    slotCount: { used, max },
    full: used >= max,
  };
}

/**
 * R7: what one catalog card offers. A card is one symbol, so it weighs every entry of that symbol:
 * a token takes one slot on each network it runs on.
 */
export function catalogCardAction(
  draft: MandateDraft,
  entries: Pick<MandateCatalogToken, "network" | "address">[],
): "add" | "added" | "no_free_slots" {
  const taken = new Set(draft.tokens.map(tokenKey));
  const missing = entries.filter((entry) => !taken.has(tokenKey(entry))).length;
  if (missing === 0) return "added";
  if (tokenSlotsApply(draft) && slotsUsed(draft) + missing > tokenSlotCeiling(draft))
    return "no_free_slots";
  return "add";
}

/** R7: the basket rows Figma 9295:1116 shows before "and N more tokens". */
export const BASKET_ROWS_SHOWN = 4;

/**
 * R7: how many rows of the selected basket show. A long basket shows {@link BASKET_ROWS_SHOWN}
 * rows and a "and N more tokens" control, which shows the rest when the manager opens it.
 */
export function basketRowsView(
  rowCount: number,
  expanded: boolean,
): { shown: number; hidden: number } {
  if (expanded || rowCount <= BASKET_ROWS_SHOWN) return { shown: rowCount, hidden: 0 };
  return { shown: BASKET_ROWS_SHOWN, hidden: rowCount - BASKET_ROWS_SHOWN };
}

/**
 * R6: the catalog state the Tokens step shows. The selected list lives on the draft, so neither
 * state touches it. `retry` reloads the catalog, or is null when there is nothing to reload.
 */
export function tokenCatalogState(catalog: MandateCatalog): {
  status: "loading" | "error" | "ready";
  retry: (() => void) | null;
} {
  if (catalog.loading) return { status: "loading", retry: null };
  if (catalog.error) return { status: "error", retry: catalog.retry ?? null };
  return { status: "ready", retry: null };
}

/** The value the "All tokens" row shows (R9). */
export type AllTokensRowValue =
  | { kind: "value"; pct: number }
  | { kind: "no_cap" }
  | { kind: "mixed" };

/**
 * R9: the value of the "All tokens" row. One shared cap shows as that cap. Caps that differ show as
 * "Mixed". Each row reads its effective cap, so two unset token rows are the same 0% (R8).
 */
export function allTokensRowValue(draft: MandateDraft, tokenKeys: string[]): AllTokensRowValue {
  const caps = tokenKeys.map((key) => effectiveCap(draft, "tokens", key));
  const [first, ...rest] = caps;
  if (!first) return { kind: "value", pct: 0 };
  const same = rest.every((cap) => (first.noCap ? cap.noCap : !cap.noCap && cap.pct === first.pct));
  if (!same) return { kind: "mixed" };
  return first.noCap ? { kind: "no_cap" } : { kind: "value", pct: first.pct };
}

/**
 * R9: the No cap box of the "All tokens" row. When every row has No cap, the box clears No cap on
 * each row and each row gets its own value back. Otherwise the box sets No cap on each row and
 * keeps each value, so a second press does not reset the rows to 0%.
 */
export function toggleAllTokensNoCap(draft: MandateDraft, tokenKeys: string[]): MandateDraft {
  const noCap = allTokensRowValue(draft, tokenKeys).kind !== "no_cap";
  return tokenKeys.reduce(
    (next, key) =>
      setCap(next, "tokens", key, { noCap, pct: effectiveCap(next, "tokens", key).pct }),
    draft,
  );
}

/** One token cap of the summary card (R10). */
export interface SummaryTokenCap {
  key: string;
  symbol: string;
  /** Undefined when the row has no record, which the card prints as "Not set". */
  cap: MandateCap | undefined;
}

/**
 * R10: the tokens and token caps the summary card shows.
 *
 * Selected mode lists every token and one cap for each unlocked token. All mode lists only the
 * locked tokens, because any other token can enter, and the default cap of the "Every token" row
 * takes the place of the per-token caps. Real data mode is always Selected (R14).
 */
export function mandateSummaryTokens(
  draft: MandateDraft,
  catalog: MandateCatalog,
): {
  mode: TokenMode;
  tokens: MandateTokenRef[];
  tokenCaps: SummaryTokenCap[] | null;
  defaultCap: MandateCap | null;
} {
  const mode = isRealData(draft, catalog) ? "selected" : tokenModeOf(draft);
  if (mode === "all") {
    return {
      mode,
      tokens: draft.tokens.filter((token) => token.locked),
      tokenCaps: null,
      defaultCap: defaultTokenCapOf(draft),
    };
  }
  return {
    mode,
    tokens: draft.tokens,
    tokenCaps: capRows(draft, catalog).tokens.map((token) => {
      const key = tokenKey(token);
      return { key, symbol: token.symbol, cap: draft.caps.tokens[key] };
    }),
    defaultCap: null,
  };
}

/** R12: the first enabled cap at 0%, in screen order. `validateStep` reads the same answer. */
export function firstZeroCap(
  draft: MandateDraft,
  catalog: MandateCatalog,
): { group: ZeroCapGroup; rowId: string } | null {
  return firstZeroCapRow(draft, catalog);
}

/** The i18n keys of the blocked Next label, by the kind of the zero-cap row. */
export const CAP_ZERO_LABEL_KEYS = {
  network: "fundBuilder.limits.capZeroNetwork",
  protocol: "fundBuilder.limits.capZeroProtocol",
  token: "fundBuilder.limits.capZeroToken",
} as const satisfies Record<ZeroCapGroup, string>;

/** One of {@link CAP_ZERO_LABEL_KEYS}. */
export type CapZeroLabelKey = (typeof CAP_ZERO_LABEL_KEYS)[ZeroCapGroup];

/**
 * R12: the i18n key (under the `manager` namespace) of the reason the blocked Next shows, or null
 * when Next shows its own label. The group comes from {@link firstZeroCap}.
 */
export function nextBlockedLabelKey(zero: { group: ZeroCapGroup } | null): CapZeroLabelKey | null {
  return zero ? CAP_ZERO_LABEL_KEYS[zero.group] : null;
}

/** What the Next button of the action bar shows (R12). */
export interface NextButtonView {
  variant: "primary" | "secondary";
  /** "true" when Next looks blocked. Next is never `disabled`, so the press still lands (R6). */
  ariaDisabled: "true" | undefined;
  /** The i18n key of the reason Next shows in place of its label, or null. */
  labelKey: CapZeroLabelKey | null;
}

/** R12: the Next button for the zero-cap row of {@link firstZeroCap}, or for no block. */
export function nextButtonView(zero: { group: ZeroCapGroup } | null): NextButtonView {
  const labelKey = nextBlockedLabelKey(zero);
  return labelKey
    ? { variant: "secondary", ariaDisabled: "true", labelKey }
    : { variant: "primary", ariaDisabled: undefined, labelKey: null };
}

/**
 * Every refusal the mandate can raise, as the reason GA4 receives.
 *
 * Total by construction (a `Record` over the domain union), so a reason added upstream fails to
 * compile here rather than reaching the dataLayer as an unmapped string. Two fold into reasons that
 * already existed: a name that fails its length rule is `name_invalid`, which is what the V1 Review
 * already reports for the identical rule, and a token with no price feed is `price_unknown`. One
 * question, one series, across both builders.
 */
export const MANDATE_BLOCK_REASON_EVENT: Record<
  MandateBlockReason,
  AnalyticsBlockReason | AnalyticsMandateBlockReason
> = {
  nothing_selected: "nothing_selected",
  cap_missing: "cap_missing",
  cap_zero: "cap_zero",
  token_allowance_required: "token_allowance_required",
  no_slots: "no_slots",
  has_hook: "has_hook",
  coming_soon: "coming_soon",
  not_priced: "price_unknown",
  name_length: "name_invalid",
};

/** R13: the params of `builder_mandate_blocked` for one refused press. */
export function mandateBlockedParams(block: StepBlock): {
  step: MandateStepKey;
  block_reason: AnalyticsBlockReason | AnalyticsMandateBlockReason;
} {
  return { step: block.step, block_reason: MANDATE_BLOCK_REASON_EVENT[block.reason] };
}

/**
 * R13: the key of one blink of the zero-cap row. Each press of a blocked Next gives a new `press`
 * count, so a new key, and the row plays its blink once more. A re-render keeps the key, so the
 * blink does not play again. Null for any block that is not a zero cap.
 */
export function capZeroBlinkKey(block: StepBlock | null, press: number): string | null {
  if (block?.reason !== "cap_zero" || !block.rowId) return null;
  return `${block.rowId}:${press}`;
}

/** The draft and token mode a render of the builder shows (R15). */
export interface SeenTokenMode {
  draftId: string;
  mode: TokenMode;
}

/**
 * R15: the params of `builder_mandate_token_mode_changed`, or null when nothing changed.
 *
 * `seen` is what the previous render showed. The first render (no `seen`) and a render of another
 * draft (a load or a resume) only set the baseline. Only a change of the mode on the same draft
 * sends the event.
 */
export function tokenModeChangedParams(
  seen: SeenTokenMode | null,
  current: SeenTokenMode,
): { token_mode: TokenMode } | null {
  if (!seen || seen.draftId !== current.draftId || seen.mode === current.mode) return null;
  return { token_mode: current.mode };
}
