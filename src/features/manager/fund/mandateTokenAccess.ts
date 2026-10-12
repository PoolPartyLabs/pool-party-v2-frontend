/**
 * @id PP-MGR-LIB-079
 * @name mandateTokenAccess
 * @implements-rules-version v1 (POO-2332)
 * @analytics-events none, pure view models. The builder shell (PP-MGR-SCR-002) sends
 *   `builder_mandate_token_mode_changed` and `builder_mandate_blocked`.
 *
 * The view models of the Tokens and Limits steps for the token access mode (POO-2332). Each
 * function is pure and has no React. The components render what these functions return, so the
 * rules are tested here and not in a render test.
 *
 * - {@link tokenAccessPanel}: the right column of the Tokens step (R3, R4, R7) and whether the
 *   Token access control shows (R14).
 * - {@link catalogCardAction}: what a catalog card offers (R7).
 * - {@link tokenCatalogState}: the loading and error states of the catalog (R6).
 * - {@link allTokensRowValue}: the value of the "All tokens" row on Limits (R9).
 * - {@link firstZeroCap} and {@link nextBlockedLabelKey}: the zero-cap block (R12).
 */
import type { MandateCatalog, MandateCatalogToken } from "./mandateCatalog";
import {
  EVERY_TOKEN_ROW_ID,
  effectiveCap,
  firstZeroCapRow,
  HUB_NETWORK,
  type MandateDraft,
  NETWORK_ORDER,
  type NetworkId,
  type StepBlock,
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
  const real = draft.dataMode === "real" || catalog.dataMode === "real";
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

/** R12: the first enabled cap at 0%, in screen order. `validateStep` reads the same answer. */
export function firstZeroCap(
  draft: MandateDraft,
  catalog: MandateCatalog,
): { group: ZeroCapGroup; rowId: string } | null {
  return firstZeroCapRow(draft, catalog);
}

/** The i18n keys of the blocked Next label, by the kind of the zero-cap row. */
const CAP_ZERO_LABEL_KEYS: Record<ZeroCapGroup, string> = {
  network: "fundBuilder.limits.capZeroNetwork",
  protocol: "fundBuilder.limits.capZeroProtocol",
  token: "fundBuilder.limits.capZeroToken",
};

/**
 * R12: the i18n key (under the `manager` namespace) of the reason the blocked Next shows, or null
 * when Next shows its own label. Only a zero cap changes the label.
 *
 * The row id tells the kind: a network row id is a network id, the "Every token" row has its own
 * id, a token row id is a `network:address` key, and any other row is a protocol.
 */
export function nextBlockedLabelKey(block: StepBlock | null): string | null {
  if (block?.reason !== "cap_zero" || !block.rowId) return null;
  const rowId = block.rowId;
  const group: ZeroCapGroup = (NETWORK_ORDER as readonly string[]).includes(rowId)
    ? "network"
    : rowId === EVERY_TOKEN_ROW_ID || rowId.includes(":")
      ? "token"
      : "protocol";
  return CAP_ZERO_LABEL_KEYS[group];
}
