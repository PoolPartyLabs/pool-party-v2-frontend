/**
 * @id PP-MGR-CMP-036
 * @name ProtocolsStep
 * @implements-rules-version v3 (POO-2143 rules v2, POO-2167 rules v3)
 * @analytics-events none, the shell emits
 *
 * POO-2123 [R12] / [R19] / [R20] / [R21] / [R22], epic POO-2119. Mandate step 2: the protocols this
 * strategy may ever use.
 *
 * Two groups again, for the same reason as step 1. The swap adapter and the bridge (R19) are not a
 * decision: a strategy that cannot swap or move money between its own networks cannot run, so they
 * render locked above a divider with no control. Everything below the divider is the real choice.
 *
 * The "On" column (R20) shows `availableOn ∩ draft.networks`, never `availableOn` alone. The
 * difference matters: Aave v3 runs on the hub only, so a Robinhood dot beside it would promise a
 * deployment that does not exist, and the manager would discover it on step 4 with no pools. When
 * that intersection is empty the column is dropped entirely rather than drawn as a bare label, and
 * the row goes disabled (R21) alongside a protocol the product lists but cannot operate. GMX was that
 * protocol until the buildathon scope commented it out (R21 v2, POO-2143); Uniswap v3 positions are
 * that protocol now (R20 v3, POO-2167), through the same mechanism and the same "Coming soon".
 *
 * A disabled row still takes its click and reports it through `onBlocked`, exactly as on step 1:
 * "which protocol did managers keep trying to add" is the one question this screen can answer for
 * the roadmap, and a row that swallows the click answers nothing (CLAUDE.md premise 11).
 *
 * R22: Across is today's bridge, not necessarily tomorrow's, so its name appears in its own row and
 * nowhere else. The bridge caption speaks about moving money between networks, never about "via
 * Across", and `ProtocolsStep.test.tsx` asserts that negatively so the phrase cannot creep back.
 */
"use client";

import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { cn } from "@/lib/utils/cn";
import { MandateCheckbox, MandateRow } from "../components/MandateRow";
import { NetworkDots } from "../components/NetworkDots";
import { ProtocolMark } from "../components/ProtocolMark";
import type { MandateProtocol } from "../mandateCatalog";
import { type NetworkId, type ProtocolId, withProtocols } from "../mandateDraft";
import type { MandateStepProps } from "./stepProps";

/** This step's key, spelled once. */
const STEP = "protocols" as const;

/** Mandate step 2: the required two, locked, and the protocols this strategy may also use. */
export function ProtocolsStep({ draft, catalog, update, block, onBlocked }: MandateStepProps) {
  const t = useTranslations("manager");

  // Literal keys, indexed by id: `MandateProtocol.name` holds a translation KEY, and `t(p.name)`
  // would be a dynamic key the i18n usage scan cannot see.
  const names: Record<ProtocolId, string> = {
    "uniswap-v3-swap": t("fundBuilder.protocolNames.uniswapV3Swap"),
    across: t("fundBuilder.protocolNames.across"),
    "aave-v3": t("fundBuilder.protocolNames.aaveV3"),
    "uniswap-v3": t("fundBuilder.protocolNames.uniswapV3"),
    "uniswap-v4": t("fundBuilder.protocolNames.uniswapV4"),
    // PP-NOTE: buildathon scope (2026-10-03, POO-2143): commented out, restore when the fund contracts reach it.
    // gmx: t("fundBuilder.protocolNames.gmx"),
  };
  const captions: Record<MandateProtocol["kind"], string> = {
    swap: t("fundBuilder.protocolCaptions.swap"),
    bridge: t("fundBuilder.protocolCaptions.bridge"),
    lending: t("fundBuilder.protocolCaptions.lending"),
    dex: t("fundBuilder.protocolCaptions.dex"),
    // PP-NOTE: buildathon scope (2026-10-03, POO-2143): commented out, restore when the fund contracts reach it.
    // perps: t("fundBuilder.protocolCaptions.perps"),
  };

  const required = catalog.protocols.filter((protocol) => protocol.required);
  const operable = catalog.protocols.filter((protocol) => !protocol.required);
  const chosen = new Set<ProtocolId>(draft.protocols);

  /** The networks of step 1 this protocol runs on, in the mandate's own order. */
  const networksFor = (protocol: MandateProtocol): NetworkId[] =>
    draft.networks.filter((network) => protocol.availableOn.includes(network));

  /** Operable, on chain, and reachable from at least one network this mandate holds. */
  const selectable = operable.filter(
    (protocol) => protocol.available && networksFor(protocol).length > 0,
  );
  const allSelected =
    selectable.length > 0 && selectable.every((protocol) => chosen.has(protocol.id));

  const ownBlock = block?.step === STEP ? block : null;

  /**
   * The inline notice for a refusal pointed at this step, or null when the row already said it.
   *
   * `coming_soon` renders NOTHING, for the reason step 1 gives: it is the only refusal this step
   * raises, the row that raised it already carries a "Coming soon" pill, and "Pick at least one to
   * continue." answered a click on GMX by asking for the thing the manager had just tried. The
   * blocked-intent event still leaves through `onBlocked`, which is the half the roadmap reads.
   */
  const notice = ownBlock
    ? ({
        nothing_selected: t("fundBuilder.common.nothingSelected"),
        coming_soon: null,
        cap_missing: null,
        no_slots: null,
        has_hook: null,
        not_priced: null,
        name_length: null,
      }[ownBlock.reason] ?? null)
    : null;

  // Scroll the offending row into view when the shell points a block at this step.
  useEffect(() => {
    if (!ownBlock?.rowId) return;
    document
      .querySelector(`[data-mandate-row="${ownBlock.rowId}"]`)
      ?.scrollIntoView({ block: "center" });
  }, [ownBlock]);

  /** Add or remove one protocol. The reducer keeps the required two and clears pools if needed. */
  function toggle(id: ProtocolId) {
    update((current) => {
      const next = current.protocols.includes(id)
        ? current.protocols.filter((protocol) => protocol !== id)
        : [...current.protocols, id];
      return withProtocols(current, next);
    });
  }

  /** R20: every selectable protocol, or none of them. The required two are never in scope. */
  function toggleAll() {
    const ids = new Set<ProtocolId>(selectable.map((protocol) => protocol.id));
    update((current) =>
      withProtocols(
        current,
        allSelected
          ? current.protocols.filter((protocol) => !ids.has(protocol))
          : [...current.protocols, ...ids],
      ),
    );
  }

  /** One operable row: the choice, its caption, and where it runs. */
  function operableRow(protocol: MandateProtocol) {
    const name = names[protocol.id];
    const networks = networksFor(protocol);
    const disabled = !protocol.available || networks.length === 0;
    return (
      <MandateRow
        key={protocol.id}
        id={protocol.id}
        ariaLabel={name}
        title={name}
        caption={captions[protocol.kind]}
        selected={chosen.has(protocol.id)}
        disabled={disabled}
        statusLabel={disabled ? t("fundBuilder.common.comingSoon") : undefined}
        logo={<ProtocolMark id={protocol.id} name={name} />}
        trailing={
          networks.length > 0 ? (
            <span className="flex shrink-0 flex-col items-end gap-1">
              <span className="text-muted-foreground text-xs">{t("fundBuilder.protocols.on")}</span>
              <NetworkDots networks={networks} catalog={catalog} />
            </span>
          ) : undefined
        }
        onToggle={() =>
          disabled
            ? onBlocked({ step: STEP, reason: "coming_soon", rowId: protocol.id })
            : toggle(protocol.id)
        }
      />
    );
  }

  return (
    <section data-mandate-step={STEP} className="flex flex-col gap-6">
      {/* Required (R19) */}
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h3 className="font-medium text-foreground text-sm">
            {t("fundBuilder.protocols.required")}
          </h3>
          <p className="text-muted-foreground text-sm">
            {t("fundBuilder.protocols.requiredSubtitle")}
          </p>
        </div>
        {required.map((protocol) => (
          <MandateRow
            key={protocol.id}
            id={protocol.id}
            ariaLabel={names[protocol.id]}
            title={names[protocol.id]}
            caption={captions[protocol.kind]}
            locked
            logo={<ProtocolMark id={protocol.id} name={names[protocol.id]} />}
          />
        ))}
      </div>

      {/* Protocols to operate (R20) */}
      <div className="flex flex-col gap-2 border-border border-t pt-6">
        <div className="flex items-center justify-between gap-4">
          <h3 className="font-medium text-foreground text-sm">
            {t("fundBuilder.protocols.operate")}
          </h3>
          {selectable.length > 0 ? (
            // biome-ignore lint/a11y/useSemanticElements: the same control the rows use (a button with role="checkbox"), so the group head and its rows read and behave identically.
            <button
              type="button"
              role="checkbox"
              aria-checked={allSelected}
              aria-label={t("fundBuilder.common.selectAll")}
              onClick={toggleAll}
              className={cn(
                "flex shrink-0 items-center gap-2 rounded-md text-muted-foreground text-sm transition-colors",
                "hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              )}
            >
              <MandateCheckbox selected={allSelected} />
              {t("fundBuilder.common.selectAll")}
            </button>
          ) : null}
        </div>

        {notice ? (
          <p
            role="alert"
            className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-destructive text-sm"
          >
            {notice}
          </p>
        ) : null}

        {operable.map(operableRow)}

        <p className="text-muted-foreground text-xs">{t("fundBuilder.protocols.onFootnote")}</p>
      </div>
    </section>
  );
}
