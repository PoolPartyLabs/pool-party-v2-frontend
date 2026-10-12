/**
 * @id PP-MGR-CMP-036
 * @name ProtocolsStep
 * @implements-rules-version v4 (POO-2143 rules v2, POO-2167 rules v4); POO-2209 rules v1
 * @implements-rules-version v1 (POO-2301 shared local runtime extension)
 * @implements-rules-version v1 (POO-2333 Figma parity: R3, R4, R5, R6, R7)
 * @analytics-events none, the shell emits
 *
 * POO-2123 [R12] / [R19] / [R20] / [R21] / [R22], epic POO-2119. Mandate step 2: the protocols
 * this strategy may ever use.
 *
 * Two groups again. POO-2333 puts the real choice first: "Protocols to operate" sits above the
 * divider. The swap adapter and the bridge (R19) sit below it as "Swap and bridge" (POO-2333 R3):
 * preselected, collapsed to "{names} · selected for you", and open on Show to checkbox rows. A
 * strategy that cannot swap, or that cannot move money between its own networks, cannot run, so
 * the last swap, and the bridge of a mandate with a spoke, are locked (POO-2333 R4,
 * `lockedProtocols`). A locked row is an `aria-disabled` checkbox: its click goes to `onBlocked`
 * with the reason `required_protocol`, and the step shows no notice for it, because the open head
 * already states the minimums. The groups, the head text, the click guard, the row names and the
 * hidden rows come from `mandateStepView` (PP-MGR-LIB-081). A protocol that the config does not
 * enable is not drawn (POO-2333 R7). The Uniswap v3 rows are "Uniswap v3 · Swap" and
 * "Uniswap v3 · Liquidity" (POO-2333 R6).
 *
 * The "Available on" column (R20, renamed by POO-2333 R5) shows `availableOn ∩ draft.networks`,
 * never `availableOn` alone. The difference matters: Aave v3 runs on the hub only, so a Robinhood
 * dot beside it would promise a deployment that does not exist, and the manager would discover it
 * on step 4 with no pools. When that intersection is empty the column is dropped entirely rather
 * than drawn as a bare label, and the row goes disabled (R21). The Swap and bridge rows have no
 * such column (Figma 9286:2).
 *
 * A disabled row still takes its click and reports it through `onBlocked`, exactly as on step 1:
 * "which protocol did managers keep trying to add" is the one question this screen can answer for
 * the roadmap, and a row that swallows the click answers nothing (CLAUDE.md premise 11).
 *
 * R22: Across is today's bridge, not necessarily tomorrow's, so its name appears only in its own
 * row and in the collapsed Swap and bridge head, which names the selected protocols (POO-2333 R3).
 * The bridge caption speaks about moving money between networks, never about "via Across", and
 * `ProtocolsStep.test.tsx` asserts that negatively so the phrase cannot creep back.
 */
"use client";

import { ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils/cn";
import { MandateCatalogStatus } from "../components/MandateCatalogStatus";
import { MandateCheckbox, MandateRow } from "../components/MandateRow";
import { NetworkDots } from "../components/NetworkDots";
import { ProtocolMark } from "../components/ProtocolMark";
import type { MandateProtocol } from "../mandateCatalog";
import {
  type MandateDraft,
  type ProtocolId,
  UNAVAILABLE_PROTOCOLS,
  withProtocols,
} from "../mandateDraft";
import {
  availableOnColumn,
  protocolClick,
  protocolRowNames,
  protocolSections,
  refusedProtocolClick,
  SWAP_BRIDGE_DEFAULT_OPEN,
  selectedForYou,
  swapBridgeHead,
  swapBridgeHeadText,
} from "./mandateStepView";
import type { MandateStepProps } from "./stepProps";

/** This step's key, spelled once. */
const STEP = "protocols" as const;

/** The id of the Swap and bridge rows region, which the Show and Hide toggle controls. */
const SWAP_BRIDGE_REGION = "mandate-swap-bridge-rows";

/** Mandate step 2: the protocols this strategy may use, then the swap and the bridge. */
export function ProtocolsStep({ draft, catalog, update, block, onBlocked }: MandateStepProps) {
  const t = useTranslations("manager");

  // POO-2333 R6: Uniswap v3 has two rows, so each name says what the row does.
  const names = protocolRowNames(t);
  const captions: Record<MandateProtocol["kind"], string> = {
    swap: t("fundBuilder.protocolCaptions.swap"),
    bridge: t("fundBuilder.protocolCaptions.bridge"),
    lending: t("fundBuilder.protocolCaptions.lending"),
    dex: t("fundBuilder.protocolCaptions.dex"),
    perps: t("fundBuilder.protocolCaptions.perps"),
    yield: t("fundBuilder.protocolCaptions.yield"),
  };

  // POO-2333 R3/R7: the two groups, without the protocols that the config does not enable.
  const { operate: operable, swapAndBridge } = protocolSections(catalog, draft);
  const chosen = new Set<ProtocolId>(draft.protocols);
  const [swapBridgeOpen, setSwapBridgeOpen] = useState(SWAP_BRIDGE_DEFAULT_OPEN);
  const head = swapBridgeHead(swapBridgeOpen, draft);

  /** Operable, on chain, and reachable from at least one network this mandate holds. */
  const canSelect = (protocol: MandateProtocol) =>
    protocol.available &&
    !UNAVAILABLE_PROTOCOLS.includes(protocol.id) &&
    availableOnColumn(protocol, draft).length > 0;
  const selectable = operable.filter(canSelect);
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
   * `required_protocol` renders nothing too: the locked row is an `aria-disabled` checkbox, and the
   * open Swap and bridge head already says which rows the strategy keeps (POO-2333 R3, R4).
   */
  const notice = ownBlock
    ? ({
        nothing_selected: t("fundBuilder.common.nothingSelected"),
        coming_soon: null,
        cap_missing: null,
        token_allowance_required: null,
        no_slots: null,
        has_hook: null,
        not_priced: null,
        name_length: null,
        required_protocol: null,
      }[ownBlock.reason] ?? null)
    : null;

  // Scroll the offending row into view when the shell points a block at this step.
  useEffect(() => {
    if (!ownBlock?.rowId) return;
    document
      .querySelector(`[data-mandate-row="${ownBlock.rowId}"]`)
      ?.scrollIntoView({ block: "center" });
  }, [ownBlock]);

  /** R5: the designed row owns the choice on every supported selected network in real mode. */
  function selectProtocols(current: MandateDraft, ids: ProtocolId[]): MandateDraft {
    const result = withProtocols(current, ids);
    if (catalog.dataMode !== "real") return result;
    const positionIds = ["aave-v3", "uniswap-v4"] as const;
    result.positionProtocolsByChain = Object.fromEntries(
      result.networks.map((network) => [
        network,
        positionIds.filter(
          (id) =>
            result.protocols.includes(id) &&
            catalog.protocols.some(
              (protocol) =>
                protocol.id === id && canSelect(protocol) && protocol.availableOn.includes(network),
            ),
        ),
      ]),
    );
    result.pools = result.pools.filter((pool) =>
      result.positionProtocolsByChain?.[pool.network]?.includes("uniswap-v4"),
    );
    result.aaveV3Reserves = result.protocols.includes("aave-v3")
      ? (catalog.reserves ?? [])
          .filter((reserve) => reserve.available)
          .map((reserve) => reserve.token.address.toLowerCase())
      : [];
    return result;
  }

  /** Add or remove one protocol. The reducer keeps required rows and clears dependent pools. */
  function toggle(id: ProtocolId) {
    // POO-2333 R4: the last swap, and the bridge of a mandate with a spoke, cannot be cleared.
    const refusal = refusedProtocolClick(draft, id);
    if (refusal) {
      onBlocked(refusal);
      return;
    }
    update((current) => {
      const next = current.protocols.includes(id)
        ? current.protocols.filter((protocol) => protocol !== id)
        : [...current.protocols, id];
      return selectProtocols(current, next);
    });
  }

  /** R20: every selectable protocol, or none of them. The required two are never in scope. */
  function toggleAll() {
    const ids = new Set<ProtocolId>(selectable.map((protocol) => protocol.id));
    update((current) => {
      return selectProtocols(
        current,
        allSelected
          ? current.protocols.filter((protocol) => !ids.has(protocol))
          : [...current.protocols, ...ids],
      );
    });
  }

  /** One operable row: the choice, its caption, and where it runs. */
  function operableRow(protocol: MandateProtocol) {
    const name = names[protocol.id];
    const networks = availableOnColumn(protocol, draft);
    const disabled = !canSelect(protocol);
    return (
      <MandateRow
        key={protocol.id}
        id={protocol.id}
        ariaLabel={name}
        title={name}
        caption={captions[protocol.kind]}
        selected={!disabled && chosen.has(protocol.id)}
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

  /** POO-2333 R3/R4: one Swap and bridge row. A locked row is an `aria-disabled` checkbox. */
  function swapBridgeRow(protocol: MandateProtocol) {
    const name = names[protocol.id];
    return (
      <MandateRow
        key={protocol.id}
        id={protocol.id}
        ariaLabel={name}
        title={name}
        caption={captions[protocol.kind]}
        selected={chosen.has(protocol.id)}
        disabled={protocolClick(draft, protocol.id) === "locked"}
        logo={<ProtocolMark id={protocol.id} name={name} />}
        onToggle={() => toggle(protocol.id)}
      />
    );
  }

  // POO-2333 R3: the head text, which names each selected protocol once while the group is closed.
  const headCopy = swapBridgeHeadText(t, head, selectedForYou(swapAndBridge, draft));

  return (
    <section data-mandate-step={STEP} className="flex flex-col gap-6">
      <MandateCatalogStatus catalog={catalog} draft={draft} />
      {/* Figma 8010:1634: the two groups and the divider, 16 px apart. */}
      <div className="flex flex-col gap-4">
        {/* Protocols to operate (R20) */}
        <div className="flex flex-col gap-2">
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
                  "flex shrink-0 items-center gap-2 rounded-md text-muted-foreground text-sm",
                  "transition-colors hover:text-foreground focus-visible:outline-none",
                  "focus-visible:ring-2 focus-visible:ring-ring",
                )}
              >
                <MandateCheckbox selected={allSelected} />
                {t("fundBuilder.common.selectAll")}
              </button>
            ) : null}
          </div>

          {notice ? <Notice text={notice} /> : null}

          {[
            ...operable.filter(canSelect),
            ...operable.filter((protocol) => !canSelect(protocol)),
          ].map(operableRow)}

          {/* POO-2333 R5 */}
          <p className="text-muted-foreground text-xs">{t("fundBuilder.protocols.onFootnote")}</p>
        </div>

        {/* Swap and bridge (R19, POO-2333 R3/R4), below the divider (Figma 8010:1635) */}
        {swapAndBridge.length > 0 ? (
          <div className="flex flex-col gap-2 border-border border-t pt-4">
            <div className="flex items-center gap-2">
              <h3 className="shrink-0 font-medium text-foreground text-sm">
                {t("fundBuilder.protocols.swapBridge")}
              </h3>
              <p className="min-w-0 flex-1 text-muted-foreground text-xs">{headCopy}</p>
              <button
                type="button"
                aria-expanded={swapBridgeOpen}
                aria-controls={SWAP_BRIDGE_REGION}
                onClick={() => setSwapBridgeOpen((open) => !open)}
                className={cn(
                  "flex shrink-0 items-center gap-1 rounded-md text-muted-foreground text-sm",
                  "transition-colors hover:text-foreground focus-visible:outline-none",
                  "focus-visible:ring-2 focus-visible:ring-ring",
                )}
              >
                {head.toggle === "hide"
                  ? t("fundBuilder.protocols.hide")
                  : t("fundBuilder.protocols.show")}
                <ChevronDown
                  aria-hidden="true"
                  className={cn("size-3.5 transition-transform", swapBridgeOpen && "rotate-180")}
                />
              </button>
            </div>
            {/* Always in the tree, so `aria-controls` always points at an element. */}
            <div id={SWAP_BRIDGE_REGION} hidden={!swapBridgeOpen} className="flex flex-col gap-2">
              {swapAndBridge.map(swapBridgeRow)}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

/** A refusal pointed at this step, in the destructive tone. */
function Notice({ text }: { text: string }) {
  return (
    <p
      role="alert"
      className={cn(
        "rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2",
        "text-destructive text-sm",
      )}
    >
      {text}
    </p>
  );
}
