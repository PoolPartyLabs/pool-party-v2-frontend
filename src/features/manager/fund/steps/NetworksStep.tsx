/**
 * @id PP-MGR-CMP-035
 * @name NetworksStep
 * @implements-rules-version v1
 * @analytics-events none, the shell emits
 *
 * POO-2123 [R10] / [R12] / [R15] / [R16] / [R17], epic POO-2119. Mandate step 1: the networks this
 * strategy may ever operate on.
 *
 * Two groups, because they answer different questions. The hub (R15) is not a choice: deposits and
 * withdrawals happen there, it can never leave the mandate, and so it renders locked with no control
 * at all rather than as a ticked checkbox nobody is allowed to untick. The spokes (R16) are the
 * actual decision, in a two-column grid with a "Select all" at the group head.
 *
 * Availability is the catalog's (`PP-MGR-LIB-018`), never a branch here: a spoke the fund contracts
 * cannot reach yet renders disabled with "Coming soon" and still takes the click, which it reports
 * through `onBlocked` (R17). That is the only way the demand for a chain is ever counted: a row that
 * refuses the click produces no event, and a product that cannot see demand never builds for it
 * (CLAUDE.md premise 11, blocked intent).
 *
 * Every write goes through `withNetworks`, which keeps the hub, drops the tokens, pools and caps of
 * a removed network, and ignores an unavailable id. This screen therefore never has to reason about
 * what a network change implies, and "Select all" can hand it the whole spoke list without first
 * filtering it by hand.
 *
 * Nothing here blocks Next (`validateStep("networks")` is always null: the hub alone is a valid
 * mandate), so the inline notice below is reachable only if the shell ever points a block at this
 * step. It is rendered anyway, because the step-props contract says a step renders its own block,
 * and the reason is MAPPED rather than assumed: a `coming_soon` refusal gets no notice at all, since
 * the row that raised it already says "Coming soon" and the event is what the refusal is for.
 */
"use client";

import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { MandateCatalogStatus } from "../components/MandateCatalogStatus";
import { MandateCheckbox, MandateRow } from "../components/MandateRow";
import { NetworkLogoWithName, useNetworkNames } from "../components/NetworkDots";
import type { MandateNetwork } from "../mandateCatalog";
import { type NetworkId, withNetworks } from "../mandateDraft";
import type { MandateStepProps } from "./stepProps";

/** This step's key, spelled once. */
const STEP = "networks" as const;

/** Mandate step 1: the hub, locked, and the spokes this strategy may also operate on. */
export function NetworksStep({ draft, catalog, update, block, onBlocked }: MandateStepProps) {
  const t = useTranslations("manager");
  const names = useNetworkNames();

  const hub = catalog.networks.find((network) => network.isHub);
  const spokes = catalog.networks.filter((network) => !network.isHub);
  const availableSpokes = spokes.filter((network) => network.available);
  const selected = new Set<NetworkId>(draft.networks);
  // An empty set is not "all selected": with every spoke disabled, a ticked Select all would claim
  // a selection nobody made, so the control is not offered at all (see the guard below).
  const allSelected =
    availableSpokes.length > 0 && availableSpokes.every((network) => selected.has(network.id));

  const ownBlock = block?.step === STEP ? block : null;

  /**
   * The inline notice for a refusal pointed at this step, or null when the row already said it.
   *
   * `coming_soon` renders NOTHING on purpose. It is the only refusal this step can raise on its own,
   * it comes from a row that already carries a "Coming soon" pill, and answering it with "Pick at
   * least one to continue." told the manager to do the thing they had just tried, about a row that is
   * not the problem. The blocked-intent event still fires through `onBlocked`, which is the half that
   * has to survive (CLAUDE.md premise 11). `nothing_selected` stays mapped because the shell can
   * still point one here, and a notice is the only thing that would explain it.
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

  /** Add or remove one spoke. The reducer keeps the hub and cleans up what the network carried. */
  function toggle(id: NetworkId) {
    update((current) => {
      const next = current.networks.includes(id)
        ? current.networks.filter((network) => network !== id)
        : [...current.networks, id];
      return withNetworks(current, next, catalog);
    });
  }

  /** R16: every available spoke, or none of them. No warning either way (R13). */
  function toggleAll() {
    const ids = allSelected ? [] : availableSpokes.map((network) => network.id);
    update((current) => withNetworks(current, ids, catalog));
  }

  /** One spoke row: selectable, or listed with "Coming soon" and reporting the refusal. */
  function spokeRow(network: MandateNetwork) {
    const name = names[network.id];
    const disabled = !network.available;
    return (
      <MandateRow
        key={network.id}
        id={network.id}
        ariaLabel={name}
        title={name}
        selected={selected.has(network.id)}
        disabled={disabled}
        statusLabel={disabled ? t("fundBuilder.common.comingSoon") : undefined}
        logo={<NetworkLogoWithName network={network.id} catalog={catalog} size={20} />}
        onToggle={() =>
          disabled
            ? onBlocked({ step: STEP, reason: "coming_soon", rowId: network.id })
            : toggle(network.id)
        }
      />
    );
  }

  return (
    <section data-mandate-step={STEP} className="flex flex-col gap-6">
      <MandateCatalogStatus catalog={catalog} draft={draft} />
      {/* Hub (R15) */}
      <div className="flex flex-col gap-2">
        <h3 className="font-medium text-foreground text-sm">{t("fundBuilder.networks.hub")}</h3>
        {hub ? (
          <MandateRow
            id={hub.id}
            ariaLabel={names[hub.id]}
            title={names[hub.id]}
            caption={t("fundBuilder.common.hubNote")}
            locked
            logo={<NetworkLogoWithName network={hub.id} catalog={catalog} size={20} />}
          />
        ) : null}
      </div>

      {/* Other networks (R16) */}
      <div className="flex flex-col gap-2 border-border border-t pt-6">
        <div className="flex items-center justify-between gap-4">
          <h3 className="font-medium text-foreground text-sm">
            {t("fundBuilder.networks.others")}
          </h3>
          {availableSpokes.length > 0 ? (
            // biome-ignore lint/a11y/useSemanticElements: the same control the rows use (a button with role="checkbox"), so the group head and its rows read and behave identically; a bare <input> would break that pairing for no gain.
            <button
              type="button"
              role="checkbox"
              aria-checked={allSelected}
              aria-label={t("fundBuilder.common.selectAll")}
              onClick={toggleAll}
              className="flex shrink-0 items-center gap-2 rounded-md text-muted-foreground text-sm transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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

        <div className="grid grid-cols-2 gap-2">{spokes.map(spokeRow)}</div>
      </div>
    </section>
  );
}
