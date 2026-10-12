/**
 * @id PP-MGR-CMP-039
 * @name LimitsStep
 * @implements-rules-version v2 (POO-2143 rules v2, POO-2197 rules v2)
 * @implements-rules-version v1 (POO-2301 shared local runtime extension)
 * @implements-rules-version v1 (POO-2332 rules v1: token caps and All tokens mode)
 * @analytics-events none, the shell emits
 *
 * POO-2126 [R6] / [R39] / [R40] / [R41] / [R42] / [R43], epic POO-2119. Mandate step 5: how much of
 * the capital each network, protocol and token may ever hold.
 *
 * Three groups, in the order the mandate was built: networks from step 1, protocols from step 2,
 * tokens from step 3. The screen derives none of that itself; `capRows` (PP-MGR-LIB-019) decides
 * which rows exist, and the three exclusions in it are the whole point of R43. The hub has no cap row
 * because its cap is not a number (R40: it holds what is not sent elsewhere), the swap adapter and
 * the bridge have none because they are not a place capital sits, and the deposit token has none
 * because it is the unit the caps are measured against. A row this screen invented for any of the
 * three would be a control a manager can move and nothing downstream reads.
 *
 * ## Unset is not zero
 *
 * A row with no cap record yet shows "Not set" and a slider resting at 0, NOT "0%". The two are
 * different drafts: `validateStep("limits")` refuses Next on the first row with no record, and 0%
 * is a deliberate answer meaning "this network may hold nothing". Rendering them the same way would
 * leave a manager staring at a row that already reads 0% while the product says a cap is missing.
 * The first interaction, slider or checkbox, is what creates the record.
 *
 * POO-2197 rules v2: reaching 100% selects No cap while retaining the prior numeric value for an
 * untick. A focused slider hands focus to that row's surviving checkbox. Limits now requires USDC
 * plus another editable token with No cap or a percentage above zero; zero and unset do not count.
 *
 * ## The refusal is the shell's, and the row is this screen's
 *
 * Nothing here can refuse a click, so this step never calls `onBlocked`: the only refusal on step 5
 * is the shell's Next against `validateStep`, which comes back as `block` with the `data-mandate-row`
 * of the first row that has no cap. The step renders the notice, scrolls that row into view and rings
 * it for a moment (R6), because a notice at the top of a list of twelve rows does not say WHICH row
 * is missing.
 *
 * ## POO-2332: token caps in the mock builder
 *
 * Start values (R8): a token reads 0% with No cap off, a network or protocol reads No cap on. They
 * come from `effectiveCap`, so "Not set" shows only in real data mode (R14). In Selected mode an
 * "All tokens" row sets one cap for every token and reads "Mixed" when they differ (R9). In All
 * tokens mode one "Every token" row holds the default cap (R10), with the warning box and tag. An
 * enabled 0% cap shows the warning border and value (R12). A refused Next with `cap_zero` scrolls to
 * that control and blinks it 2 times (R13); the other reasons keep the single ring.
 *
 * PP-NOTE: R41, per protocol and per token caps are frontend-only until the contracts define them.
 * On chain only the per spoke network cap exists; these two are stored in the draft, enforced by the
 * Build allocation sliders and shown on Review. No copy on this screen calls any of them an on-chain
 * guarantee, and `LimitsStep.test.tsx` asserts that negatively so it cannot creep back in.
 */
"use client";

import { Layers } from "lucide-react";
import { useTranslations } from "next-intl";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { TokenLogo } from "@/components/data-display/TokenLogo";
import { cn } from "@/lib/utils/cn";
import { MandateCheckbox, MandateRow } from "../components/MandateRow";
import { NetworkLogoWithName, useNetworkNames } from "../components/NetworkDots";
import { ProtocolMark } from "../components/ProtocolMark";
import type { MandateProtocol } from "../mandateCatalog";
import {
  ALL_TOKENS_ROW_ID,
  allTokensCapOf,
  CAP_STEP_PCT,
  capRows,
  clearCap,
  EVERY_TOKEN_ROW_ID,
  effectiveCap,
  HUB_NETWORK,
  isCapZero,
  type MandateCap,
  type MandateDraft,
  type ProtocolId,
  setAllTokensCap,
  setCap,
  tokenKey,
  tokenModeOf,
} from "../mandateDraft";
import {
  allTokensRowWarns,
  allTokensSummary,
  blinkSchedule,
  setAllTokenCaps,
} from "../mandateTokenAccess";
import type { MandateStepProps } from "./stepProps";

/** This step's key, spelled once. */
const STEP = "limits" as const;

/** How long a refused row keeps its ring (R6). Long enough to find it, short enough to not nag. */
const HIGHLIGHT_MS = 1500;

/** R13: how many times a refused cap control blinks, and how long each phase lasts. */
const BLINK_TIMES = 2;
const BLINK_PERIOD_MS = 250;

/** Logo edge, in px. The rows are taller than steps 1 and 2, so the mark grows with them. */
const LOGO_SIZE = 28;

/** The three scopes `setCap` writes to, which are also the three groups on this screen. */
type CapScope = "networks" | "protocols" | "tokens";

/**
 * What the "No cap" box does, in both directions.
 *
 * Ticking is the easy half: the row keeps whatever share it had, so un-ticking can give it back.
 * Un-ticking is where the three states matter. A row that HAD a share returns to it. A row that had
 * none goes back to UNSET rather than to `{ noCap: false, pct: 0 }`, because 0% is a deliberate
 * answer ("this network may hold nothing") that `validateStep` accepts: writing it here would let
 * Next through on a ceiling nobody chose, one click after the manager said they wanted no ceiling at
 * all. `pct` is 0 exactly when no share was ever stored, which is why that is the test.
 */
function toggleNoCap(
  draft: MandateDraft,
  scope: CapScope,
  id: string,
  cap: MandateCap | undefined,
): MandateDraft {
  const noCap = cap?.noCap ?? false;
  const pct = cap?.pct ?? 0;
  if (!noCap) return setCap(draft, scope, id, { noCap: true, pct });
  // PP-NOTE: assumption (coordinator default). `pct > 0` also swallows a DELIBERATE 0%: capped at
  // 0%, ticked, then unticked, and the row is unset rather than back at 0%. `{ noCap: true, pct: 0 }`
  // is what both a chosen 0% and an untouched row leave behind, so the draft cannot tell them apart,
  // and this reading is the one that fails closed: Next is refused for a missing cap and the manager
  // sets the slider again. The alternative lets Next through on a ceiling nobody chose. Pinned by
  // "forgets a deliberate 0% cap across a No cap round trip" in `LimitsStep.test.tsx`.
  return pct > 0 ? setCap(draft, scope, id, { noCap: false, pct }) : clearCap(draft, scope, id);
}

/** One group's head: the title and the rule it applies, on one baseline (R39). */
function GroupHead({ title, caption }: { title: string; caption: string }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <h3 className="font-medium text-foreground text-sm">{title}</h3>
      <p className="text-muted-foreground text-sm">{caption}</p>
    </div>
  );
}

/** The mark of the two aggregate token rows, which stand for no single token. */
function AllTokensMark() {
  return (
    <span
      aria-hidden="true"
      className="flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-raised text-muted-foreground"
    >
      <Layers className="size-4" />
    </span>
  );
}

/** Mandate step 5: the per network, per protocol and per token caps. */
export function LimitsStep({ draft, catalog, update, block }: MandateStepProps) {
  const t = useTranslations("manager");
  const networkNames = useNetworkNames();

  // Literal keys, indexed by id: `MandateProtocol.name` holds a translation KEY, and `t(p.name)`
  // would be a dynamic key the i18n usage scan cannot see.
  const protocolNames: Record<ProtocolId, string> = {
    "uniswap-v3-swap": t("fundBuilder.protocolNames.uniswapV3Swap"),
    across: t("fundBuilder.protocolNames.across"),
    "aave-v3": t("fundBuilder.protocolNames.aaveV3"),
    "uniswap-v3": t("fundBuilder.protocolNames.uniswapV3"),
    "uniswap-v4": t("fundBuilder.protocolNames.uniswapV4"),
    gmx: t("fundBuilder.protocolNames.gmx"),
    pendle: t("fundBuilder.protocolNames.pendle"),
    kamino: t("solanaPreview.protocols.kamino"),
    jupiter: t("solanaPreview.protocols.jupiter"),
    raydium: t("solanaPreview.protocols.raydium"),
    orca: t("solanaPreview.protocols.orca"),
  };
  // The short form of the protocol caption (R39): "Lending", not "Lending · supply tokens to earn
  // interest". Only the kinds that can reach a cap row are listed; `capRows` drops the required two,
  // which are the swap and the bridge, so those two kinds have no key and no row to put one on.
  const kindCaptions: Partial<Record<MandateProtocol["kind"], string>> = {
    lending: t("fundBuilder.limits.kind.lending"),
    dex: t("fundBuilder.limits.kind.dex"),
    // PP-NOTE: buildathon scope (2026-10-03, POO-2143): commented out, restore when the fund contracts reach it.
    // perps: t("fundBuilder.limits.kind.perps"),
  };

  // The visible text. The accessible name adds the row (see the checkbox below).
  const noCapLabel = t("fundBuilder.common.noCap");
  const unsetLabel = t("fundBuilder.limits.unset");
  const noRowsLabel = t("fundBuilder.limits.noRows");
  const mixedLabel = t("fundBuilder.limits.mixed");

  const rows = capRows(draft, catalog);
  const protocolsById = new Map(catalog.protocols.map((protocol) => [protocol.id, protocol]));
  const realMode = catalog.dataMode === "real";
  const allMode = !realMode && tokenModeOf(draft) === "all";
  const summary = allTokensSummary(draft, catalog);

  const ownBlock = block?.step === STEP ? block : null;
  const focusNoCapRow = useRef<string | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a controlled draft update removes the slider before focus can move to its surviving checkbox.
  useEffect(() => {
    const id = focusNoCapRow.current;
    if (!id) return;
    const checkbox = document.querySelector<HTMLButtonElement>(
      `[data-mandate-row="${id}"] button[role="checkbox"]`,
    );
    if (checkbox?.getAttribute("aria-checked") === "true") {
      checkbox.focus();
      focusNoCapRow.current = null;
    }
  }, [draft]);
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const [blinking, setBlinking] = useState<string | null>(null);

  // R6: find the row the shell is pointing at, then ring it for a moment. Both halves are needed:
  // the scroll answers "where", the ring answers "which one", and a long list gives neither for free.
  const blockedRowId = ownBlock?.rowId;
  const blockedReason = ownBlock?.reason;
  useEffect(() => {
    const rowId = blockedRowId;
    if (!rowId || blockedReason === "cap_zero") return;
    document.querySelector(`[data-mandate-row="${rowId}"]`)?.scrollIntoView({ block: "center" });
    setHighlighted(rowId);
    const timer = window.setTimeout(() => setHighlighted(null), HIGHLIGHT_MS);
    return () => window.clearTimeout(timer);
  }, [blockedRowId, blockedReason]);

  // R13: a refused Next with `cap_zero` scrolls to the token cap control and blinks it 2 times. The
  // control is the "All tokens" row (Selected mode) or the "Every token" row (All mode). In All mode
  // the block row id is the Every token row. `ownBlock` is a new object on every press, so a second
  // press blinks again.
  useEffect(() => {
    if (ownBlock?.reason !== "cap_zero") return;
    const target =
      document.querySelector(`[data-mandate-row="${ALL_TOKENS_ROW_ID}"]`) !== null
        ? ALL_TOKENS_ROW_ID
        : ownBlock.rowId;
    if (!target) return;
    document.querySelector(`[data-mandate-row="${target}"]`)?.scrollIntoView({ block: "center" });
    // Reduced motion: the ring stays lit, with no blink. The focus move below carries the rest.
    const reducedMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Move focus to the control, so a keyboard or screen reader user lands where the notice points.
    document
      .querySelector<HTMLElement>(
        `[data-mandate-row="${target}"] input[type="range"], [data-mandate-row="${target}"] button[role="checkbox"]`,
      )
      ?.focus({ preventScroll: true });
    const timers = blinkSchedule(BLINK_TIMES, BLINK_PERIOD_MS, reducedMotion).map((phase) =>
      window.setTimeout(() => setBlinking(phase.on ? target : null), phase.at),
    );
    return () => {
      for (const timer of timers) window.clearTimeout(timer);
      setBlinking(null);
    };
  }, [ownBlock]);

  /**
   * One cap row: the mark, the name, and the control cluster.
   *
   * The cluster has two shapes. Capped (or unset) is slider + value + the unticked box; "No cap"
   * drops the slider and the value entirely (R39), because a greyed-out slider beside a ticked box
   * invites a drag that cannot mean anything.
   *
   * `accessibleName` defaults to the visible `name` and is given separately only where the visible
   * one is not unique: a token held on two networks is two rows, and "WETH" names both. See the
   * per-token group below.
   *
   * The row reads and writes through `read` and `write`, so the same markup serves a network, a
   * protocol, a token, the "All tokens" row (R9) and the "Every token" row (R10). `mixed` (R9) shows
   * "Mixed" in place of the percentage.
   */
  function capRow({
    id,
    name,
    accessibleName = name,
    caption,
    logo,
    badge,
    cap,
    read,
    write,
    legacyScope,
    mixed = false,
    watchZero = false,
    zeroInside = false,
  }: {
    id: string;
    name: string;
    accessibleName?: string;
    caption?: string;
    logo: ReactNode;
    /** Drawn after the title, for whatever the name alone leaves ambiguous (the network). */
    badge?: ReactNode;
    /** What the row shows now. Undefined only in real data mode, for a row with no record. */
    cap: MandateCap | undefined;
    /** The same cap, read from the draft a reducer receives. */
    read: (current: MandateDraft) => MandateCap | undefined;
    write: (current: MandateDraft, next: MandateCap) => MandateDraft;
    /** Real data mode only: the scope whose stored cap an untick may clear (R14). */
    legacyScope?: CapScope;
    mixed?: boolean;
    /** R12: this row is a token cap, so an enabled 0% takes the warning border and value. */
    watchZero?: boolean;
    /** R12: a "Mixed" row warns when one token it stands for is at an enabled 0%. */
    zeroInside?: boolean;
  }) {
    const noCap = cap?.noCap ?? false;
    const pct = cap?.pct ?? 0;
    const warn = watchZero && (mixed ? zeroInside : isCapZero(cap));
    // Unset reads "Not set", never "0%": see the file header. The slider's `aria-valuetext` says the
    // same thing the sighted row says, so the two never disagree.
    const valueText = mixed ? mixedLabel : cap ? `${pct}%` : unsetLabel;

    return (
      <div
        key={id}
        data-mandate-row={id}
        data-cap-warning={warn ? "true" : undefined}
        className={cn(
          "flex min-h-14 items-center gap-4 rounded-xl border border-border bg-surface px-4 py-3 transition-shadow",
          warn && "border-warning",
          highlighted === id && "ring-2 ring-destructive/60",
          blinking === id && "ring-2 ring-warning",
        )}
      >
        {logo}
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate font-medium text-foreground text-sm">{name}</span>
            {badge}
          </span>
          {caption ? (
            <span className="truncate text-muted-foreground text-xs">{caption}</span>
          ) : null}
        </span>

        {noCap ? null : (
          <>
            <input
              type="range"
              min={0}
              max={100}
              step={CAP_STEP_PCT}
              value={pct}
              aria-label={t("fundBuilder.limits.sliderLabel", { name: accessibleName })}
              aria-valuetext={valueText}
              // The value is read HERE, not inside the reducer: the input is controlled, so by the
              // time a deferred reducer runs React has already reset `event.target.value` to the
              // draft's own number and the move would silently write back what was there.
              onChange={(event) => {
                const next = Number(event.target.value);
                if (next === 100 && document.activeElement === event.currentTarget)
                  focusNoCapRow.current = id;
                update((current) => {
                  const prior = read(current);
                  return write(
                    current,
                    next === 100
                      ? { noCap: true, pct: prior?.pct ?? 0 }
                      : { noCap: false, pct: next },
                  );
                });
              }}
              className="h-1 w-20 shrink-0 cursor-pointer appearance-none rounded-full accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-56"
              // The filled part of the track is the value, which `accent-color` alone does not draw
              // on every engine. Both stops read from the token layer, so a partner theme recolours
              // the slider with the rest of the app.
              style={{
                background: `linear-gradient(to right, var(--color-primary) ${pct}%, var(--color-surface-raised) ${pct}%)`,
              }}
            />
            <span
              className={cn(
                "min-w-12 shrink-0 text-right font-medium text-sm",
                warn ? "text-warning" : cap || mixed ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {valueText}
            </span>
          </>
        )}

        {/* biome-ignore lint/a11y/useSemanticElements: the 20 px box the rest of the mandate uses (a button with role="checkbox"), so the cap rows read and behave like the selection rows on steps 1 to 4; a bare <input> would break that pairing for no gain. */}
        <button
          type="button"
          role="checkbox"
          aria-checked={noCap}
          // PP-A11Y: the row name is in the ACCESSIBLE name, not only beside it. Twelve boxes all
          // called "No cap" are twelve controls a rotor cannot tell apart; the visible text stays
          // short because on screen the row it belongs to is right there.
          aria-label={t("fundBuilder.limits.noCapLabel", { name: accessibleName })}
          onClick={() =>
            update((current) => {
              if (legacyScope && realMode) return toggleNoCap(current, legacyScope, id, cap);
              // Mock builder: a ticked box keeps the share, an unticked one gives it back (R8, R11).
              return write(current, { noCap: !noCap, pct });
            })
          }
          className={cn(
            "flex shrink-0 items-center gap-2 rounded-md text-sm transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            noCap ? "text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          <MandateCheckbox selected={noCap} />
          {noCapLabel}
        </button>
      </div>
    );
  }

  /** A network, protocol or token row: the cap lives in `draft.caps[scope][id]` (R8). */
  function scopedRow(
    scope: CapScope,
    props: {
      id: string;
      name: string;
      accessibleName?: string;
      caption?: string;
      logo: ReactNode;
      badge?: ReactNode;
    },
  ) {
    return capRow({
      ...props,
      cap: effectiveCap(draft, scope, props.id),
      read: (current) => effectiveCap(current, scope, props.id),
      write: (current, next) => setCap(current, scope, props.id, next),
      legacyScope: scope,
      watchZero: scope === "tokens",
    });
  }

  /** R9: one cap for every token in the list, "Mixed" when the caps differ. */
  function allTokensRow() {
    const uniform = summary.kind === "uniform" ? summary.cap : undefined;
    return capRow({
      id: ALL_TOKENS_ROW_ID,
      name: t("fundBuilder.limits.allTokensRow.title"),
      caption: t("fundBuilder.limits.allTokensRow.caption"),
      logo: <AllTokensMark />,
      cap: uniform ?? (summary.kind === "mixed" ? { noCap: false, pct: 0 } : undefined),
      read: (current) => {
        const next = allTokensSummary(current, catalog);
        return next.kind === "uniform" ? next.cap : undefined;
      },
      write: (current, next) => setAllTokenCaps(current, catalog, next),
      mixed: summary.kind === "mixed",
      watchZero: true,
      zeroInside: allTokensRowWarns(draft, catalog),
    });
  }

  /** R10: the default cap of All tokens mode. */
  function everyTokenRow() {
    const cap = allTokensCapOf(draft);
    return capRow({
      id: EVERY_TOKEN_ROW_ID,
      name: t("fundBuilder.limits.everyTokenRow.title"),
      caption: t("fundBuilder.limits.everyTokenRow.caption"),
      logo: <AllTokensMark />,
      cap,
      read: (current) => allTokensCapOf(current),
      write: (current, next) => setAllTokensCap(current, next),
      watchZero: true,
    });
  }

  /** R43: a group whose earlier step added nothing says so rather than showing a bare head. */
  function emptyLine() {
    return <p className="text-muted-foreground text-sm">{noRowsLabel}</p>;
  }

  return (
    <section data-mandate-step={STEP} className="flex flex-col gap-6">
      {catalog.dataMode === "real" ? (
        <p role="note" className="text-muted-foreground text-sm">
          {t("fundBuilder.real.limits")}
        </p>
      ) : null}
      {/* R6: one notice for the step, above every group, because the row it points at can be in any
          of the three. The ring and the scroll are what name the row. */}
      {ownBlock ? (
        <p
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-destructive text-sm"
        >
          {ownBlock.reason === "cap_zero"
            ? t("fundBuilder.limits.capZero")
            : ownBlock.reason === "token_allowance_required"
              ? t(
                  rows.tokens.length === 0
                    ? "fundBuilder.limits.addPositiveToken"
                    : "fundBuilder.limits.positiveTokenRequired",
                )
              : t("fundBuilder.limits.capMissing")}
        </p>
      ) : null}

      {/* Per network (R39/R40/R43) */}
      <div className="flex flex-col gap-2">
        <GroupHead
          title={t("fundBuilder.limits.perNetwork")}
          caption={
            catalog.dataMode === "real"
              ? t("fundBuilder.real.limits")
              : t("fundBuilder.limits.perNetworkCaption")
          }
        />

        {/* R40: the hub is not a cap, it is the remainder. Locked, with no control to move. */}
        <MandateRow
          id={HUB_NETWORK}
          ariaLabel={networkNames[HUB_NETWORK]}
          title={networkNames[HUB_NETWORK]}
          caption={t("fundBuilder.limits.hubCaption")}
          locked
          logo={<NetworkLogoWithName network={HUB_NETWORK} catalog={catalog} size={LOGO_SIZE} />}
          trailing={
            <span className="shrink-0 text-muted-foreground text-xs">
              {t("fundBuilder.limits.hubRow")}
            </span>
          }
        />

        {/* PP-INTEGRATION-POINT: POO-2133 stores percentage intent; POO-2169 adds on-chain enforcement. */}
        {rows.networks.length === 0
          ? emptyLine()
          : rows.networks.map((network) =>
              scopedRow("networks", {
                id: network,
                name: networkNames[network],
                logo: <NetworkLogoWithName network={network} catalog={catalog} size={LOGO_SIZE} />,
              }),
            )}
      </div>

      {/* Per protocol (R39/R41/R43) */}
      <div className="flex flex-col gap-2 border-border border-t pt-6">
        <GroupHead
          title={t("fundBuilder.limits.perProtocol")}
          caption={
            catalog.dataMode === "real"
              ? t("fundBuilder.real.allocation")
              : t("fundBuilder.limits.perProtocolCaption")
          }
        />
        {rows.protocols.length === 0
          ? emptyLine()
          : rows.protocols.map((protocol) =>
              scopedRow("protocols", {
                id: protocol,
                name: protocolNames[protocol],
                caption: kindCaptions[protocolsById.get(protocol)?.kind ?? "dex"],
                logo: (
                  <ProtocolMark id={protocol} name={protocolNames[protocol]} size={LOGO_SIZE} />
                ),
              }),
            )}
      </div>

      {/* Per token (R39/R41/R43) */}
      <div className="flex flex-col gap-2 border-border border-t pt-6">
        <GroupHead
          title={t("fundBuilder.limits.perToken")}
          caption={
            realMode
              ? t("fundBuilder.real.allocation")
              : allMode
                ? t("fundBuilder.limits.perTokenAllCaption")
                : t("fundBuilder.limits.perTokenCaption")
          }
        />
        {allMode ? (
          <>
            {everyTokenRow()}
            <div
              role="note"
              className="flex flex-col gap-2 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3"
            >
              <p className="font-medium text-foreground text-sm">
                {t("fundBuilder.limits.allWarning.title")}
              </p>
              <p className="text-muted-foreground text-sm">
                {t("fundBuilder.limits.allWarning.body")}
              </p>
              <span className="w-fit rounded-full border border-warning/60 bg-warning/15 px-2.5 py-0.5 font-medium text-warning text-xs">
                {t("fundBuilder.limits.allWarning.tag")}
              </span>
            </div>
          </>
        ) : (
          <>
            {/* R9: the aggregate row comes first and only in the mock builder (R14). */}
            {!realMode && rows.tokens.length > 0 ? allTokensRow() : null}
            {/* One row per token ENTRY, which means one per network the token runs on (R27). The two
                rows of the same token are different caps on different chains, so the network is in the
                row AND in the accessible name of both its controls: "WETH" named both, and a rotor
                listed four controls none of which said which chain it capped. */}
            {rows.tokens.length === 0
              ? emptyLine()
              : rows.tokens.map((token) =>
                  scopedRow("tokens", {
                    id: tokenKey(token),
                    name: token.symbol,
                    accessibleName: t("fundBuilder.limits.tokenOnNetwork", {
                      symbol: token.symbol,
                      network: networkNames[token.network],
                    }),
                    caption: token.name,
                    logo: (
                      <TokenLogo
                        symbol={token.symbol}
                        network={token.network}
                        className="size-7 text-xs"
                      />
                    ),
                    badge: (
                      <NetworkLogoWithName network={token.network} catalog={catalog} size={16} />
                    ),
                  }),
                )}
          </>
        )}
      </div>

      {/* R42 */}
      <p className="text-muted-foreground text-sm">
        {catalog.dataMode === "real"
          ? t("fundBuilder.real.allocation")
          : t("fundBuilder.limits.footnote")}
      </p>
    </section>
  );
}
