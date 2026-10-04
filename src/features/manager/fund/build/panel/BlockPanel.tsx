/**
 * @id PP-MGR-CMP-061
 * @name BlockPanel
 * @implements-rules-version v1 (POO-2187 rules v1)
 * @analytics-events none emitted here. What the panel does leaves through its draft
 *   (`usePanelDraft`: configured, applied, discarded, leave blocked), the canvas controller (the
 *   confirmed remove) and `onLimitHit` (the Allocation at its ceiling); the Build screen
 *   (PP-MGR-SCR-002) emits `builder_block_configured`, `builder_block_applied`,
 *   `builder_block_discarded`, `builder_block_leave_blocked`, `builder_block_limit_hit` and
 *   `builder_block_removed` from them.
 *
 * The configuration panel of the Build step (handoff "Build configuration panels" v1.2, "Panel
 * shell"), inside the frame and overline of `BuildPanelSlot` (CMP-047, finding 26). It replaces the
 * canvas batch's stub (CMP-058, removed).
 *
 * - Mode 1, nothing selected: "Nothing selected" over its body; while a menu is open on the canvas
 *   the body is that menu's sentence (Add protocol: where the block lands; a port under a Supply:
 *   that a Borrow uses the supply as collateral).
 * - The HEAD of every other mode: the protocol logo, the protocol name (Title/Small) over the block
 *   type (Caption, " · no pool yet" while empty), and the network chip at the right end, read only
 *   (P2, C5): its tooltip says the block takes the network of the place it sits in.
 * - Mode 2, pick from the mandate, and Mode 3, no match: the kind's body (`panelBodies`) hands its
 *   rows to the shared pick list (CMP-068); `Use` writes the kind's defaults with a share of 0%
 *   (P7, DP1) and the panel shows Mode 4.
 * - Mode 4, configured: the body's fields, then the status row (P5, P6), `Apply changes` (the app
 *   Button, primary, enabled only while the draft differs from applied, DP7), `Remove block`.
 * - A kind with no body yet shows the head and `Remove block`, as the stub did.
 * - [P10, DP11] `Remove block` opens the in-place confirm (CMP-066), also from the Delete key; the
 *   sentence is built from `describeRemoval`. `Apply changes` stays above the box.
 * - [P8, P9] The Allocation field (CMP-064) is the shell's: only the first position of a chain has
 *   one, its ceiling is `allocationCeiling` over the applied plan, its reason sentence names the cap
 *   or the strategy's room, and a mandate cap's sentence links to `Edit mandate · Limits`.
 */
"use client";

import { useLocale } from "next-intl";
import { useId, useMemo } from "react";
import { Button } from "@/components/ui/Button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/Tooltip";
import { cn } from "@/lib/utils/cn";
import { BlockMark } from "../blocks/BlockMark";
import { describeBlock, describePanelHead, shareNumber } from "../blocks/blockRegistry";
import type { MenuContext } from "../blocks/menuModels";
import type { MandateEditStep } from "../blocks/useBuildCanvas";
import {
  type AllocationCeiling,
  type AllocationCeilingReason,
  allocationCeiling,
} from "../plan/allocationCeiling";
import { BLOCK_KIND_PROTOCOL, type BlockKind } from "../plan/buildPlan";
import { findBlock } from "../plan/planDerive";
import { describeRemoval } from "../plan/planReducers";
import { AllocationSlider } from "./AllocationSlider";
import { PanelPickList } from "./PanelPickList";
import { PanelStatusRow } from "./PanelStatusRow";
import {
  PANEL_BODIES,
  type PanelBodies,
  type PanelBodyContext,
  type PanelBodyDefinition,
} from "./panelBodies";
import { type PanelCopy, usePanelCopy } from "./panelCopy";
import { PANEL_FOCUS_RING } from "./panelStyles";
import { RemoveBlockConfirm, removalText } from "./RemoveBlockConfirm";
import type { PanelBlockConfig, UsePanelDraftResult } from "./usePanelDraft";

/** Public props for {@link BlockPanel}. */
export interface BlockPanelProps {
  /** The applied plan, the mandate, the catalog, the violations and the canvas copy. */
  ctx: MenuContext;
  /** The selected block, or null (Mode 1). */
  selectedId: string | null;
  /** The sentence of a menu open on the canvas (Mode 1's other bodies), or null. */
  menuSentence: string | null;
  /** The panel's draft of the selected block (PP-MGR-HOK-014). */
  panel: UsePanelDraftResult;
  /** The remove confirm is open for the selected block (P10). */
  removeConfirmOpen: boolean;
  onRemoveRequest(): void;
  onRemoveCancel(): void;
  onRemoveConfirm(): void;
  /** An Edit mandate link; the caller passes it through the leave guard. */
  onEditMandate(step: MandateEditStep): void;
  /** A gesture brought the Allocation to its ceiling, with the ceiling's reason (P8). */
  onLimitHit(kind: BlockKind, reason: AllocationCeilingReason): void;
  /** The kind to body registry: the app's by default, fixtures in stories and tests. */
  bodies?: PanelBodies;
}

/**
 * [P2, C5] The network chip of the head: read only, so it is not a button, but a keyboard reaches its
 * tooltip (the canvas's focus policy for an element that only explains itself). The sentence wraps
 * (the app Tooltip's `max-w-xs`): it is too long for the canvas's one-line tooltip.
 */
function NetworkChip({
  network,
  name,
  tooltip,
}: {
  network: string;
  name: string;
  tooltip: string;
}) {
  const descriptionId = useId();
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild aria-describedby={descriptionId}>
          <span
            // biome-ignore lint/a11y/noNoninteractiveTabindex: the canvas's focus policy (POO-2154): a tab stop for its tooltip (P2), not announced as a button doing nothing.
            tabIndex={0}
            data-network-chip=""
            className={cn(
              "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border border-border bg-surface-raised py-1 pr-2.5 pl-1",
              PANEL_FOCUS_RING,
            )}
          >
            <BlockMark logo="network" markId={network} name={name} size={20} />
            <span className="text-foreground text-xs">{name}</span>
          </span>
        </TooltipTrigger>
        <span id={descriptionId} hidden>
          {tooltip}
        </span>
        <TooltipContent side="top" className="max-w-xs">
          {tooltip}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/** A body for any config shape: the registry types each kind's own, the shell holds the union. */
type AnyBody = PanelBodyDefinition<PanelBlockConfig>;

/** Ids for a remove preview: a remove can re-add a Swap · auto, whose id the confirm never shows. */
function previewIds(): () => string {
  let next = 0;
  return () => {
    next += 1;
    return `remove-preview-${next}`;
  };
}

/** The reason sentence and the link row of the Allocation's ceiling (P8). */
function ceilingWords(
  ceiling: AllocationCeiling,
  kind: BlockKind,
  ctx: MenuContext,
  copy: PanelCopy,
  onEditMandate: (step: MandateEditStep) => void,
): { sentence: string; link: { prompt: string; label: string; onClick(): void } | null } {
  const limits = {
    prompt: copy.allocation.needMore,
    label: copy.link.limits,
    onClick: () => onEditMandate("limits"),
  };
  if (ceiling.reason === "protocolCap") {
    return {
      sentence: copy.allocation.capProtocol(
        ctx.copy.protocolName(kind),
        shareNumber(ceiling.capPct ?? ceiling.max),
      ),
      link: limits,
    };
  }
  if (ceiling.reason === "networkCap") {
    return {
      sentence: copy.allocation.capNetwork(
        ctx.copy.networkName(ceiling.network ?? ""),
        shareNumber(ceiling.capPct ?? ceiling.max),
      ),
      link: limits,
    };
  }
  return { sentence: copy.allocation.room(shareNumber(ceiling.otherPct)), link: null };
}

/** The (i) of the Allocation: the mandate's protocol cap, when there is one (P8). */
function allocationHelp(kind: BlockKind, ctx: MenuContext, copy: PanelCopy): string {
  const protocol = BLOCK_KIND_PROTOCOL[kind];
  const cap = protocol ? ctx.draft.caps.protocols[protocol] : undefined;
  if (!cap || cap.noCap) return copy.allocation.help;
  return copy.allocation.helpCap(ctx.copy.protocolName(kind), shareNumber(cap.pct));
}

/** Modes 2 and 3: the body's rows in the shared pick list. Keyed on the block by the caller. */
function PickBody({
  definition,
  context,
  copy,
  onUse,
}: {
  definition: AnyBody;
  context: PanelBodyContext;
  copy: PanelCopy;
  onUse(config: PanelBlockConfig): void;
}) {
  const model = definition.usePick(context);
  const items = model.rows.map((row) => ({
    ...row,
    useDisabled: row.useDisabled === true || row.config === null,
  }));
  return (
    <PanelPickList
      heading={model.heading}
      count={model.count}
      filterPlaceholder={model.filterPlaceholder}
      items={items}
      useLabel={copy.use}
      rowLabel={copy.pickRowLabel}
      onUse={(id) => {
        const row = model.rows.find((candidate) => candidate.id === id);
        if (row?.config) onUse(row.config);
      }}
      caption={model.caption}
      link={{
        prompt: model.link.prompt,
        label: model.link.label,
        onClick: () => context.onEditMandate(model.link.step),
      }}
      noMatch={model.noMatch}
      emptyTitle={model.emptyTitle}
      status={model.status}
      error={
        model.onRetry
          ? { text: copy.read.error, retryLabel: copy.read.retry, onRetry: model.onRetry }
          : undefined
      }
    />
  );
}

/** The configuration panel: Mode 1, or the head and the mode of the selected block. */
export function BlockPanel({
  ctx,
  selectedId,
  menuSentence,
  panel,
  removeConfirmOpen,
  onRemoveRequest,
  onRemoveCancel,
  onRemoveConfirm,
  onEditMandate,
  onLimitHit,
  bodies = PANEL_BODIES,
}: BlockPanelProps) {
  const copy = usePanelCopy();
  const locale = useLocale();
  const head = selectedId ? describePanelHead(selectedId, ctx) : null;
  const found = selectedId ? findBlock(ctx.plan, selectedId) : null;
  const block = found?.block.family === "position" ? found.block : null;

  const removal = useMemo(() => {
    if (!removeConfirmOpen || !selectedId) return null;
    const description = describeRemoval(
      ctx.plan,
      { draft: ctx.draft, catalog: ctx.catalog, newId: previewIds() },
      selectedId,
    );
    if (!description) return null;
    return removalText({
      description,
      blockTitle: describeBlock(selectedId, ctx).title,
      stepTitle: (step) => describeBlock(step.id, ctx).title,
      copy: copy.confirm,
      listNames: ctx.copy.listNames,
      locale,
    });
  }, [removeConfirmOpen, selectedId, ctx, copy, locale]);

  if (!head || !found || !block || !selectedId) {
    return (
      <div data-block-panel="nothing" className="flex flex-col gap-2">
        <p className="font-semibold text-base text-foreground">{ctx.copy.panel.nothingTitle}</p>
        <p className="text-muted-foreground text-sm">
          {menuSentence ?? ctx.copy.panel.nothingBody}
        </p>
      </div>
    );
  }

  const kind = block.kind;
  const definition = bodies[kind] as AnyBody | undefined;
  const configured = panel.applied?.config !== null && panel.applied?.config !== undefined;
  const mode = !definition ? "head" : configured ? "configured" : "pick";
  const context: PanelBodyContext = {
    blockId: selectedId,
    kind,
    network: found.network,
    networkName: head.networkName,
    draft: ctx.draft,
    catalog: ctx.catalog,
    plan: ctx.plan,
    onEditMandate,
  };

  let allocation = null;
  if (mode === "configured" && panel.draft?.sharePct !== null && panel.draft) {
    const ceiling = allocationCeiling(ctx.plan, ctx, found.chain.id);
    if (ceiling) {
      const top = Math.max(0, Math.floor(ceiling.max));
      const words = ceilingWords(ceiling, kind, ctx, copy, onEditMandate);
      allocation = (
        <AllocationSlider
          value={panel.draft.sharePct ?? 0}
          ceiling={top}
          onChange={panel.setShare}
          onReachCeiling={() => onLimitHit(kind, ceiling.reason)}
          copy={{
            label: copy.allocation.label,
            help: allocationHelp(kind, ctx, copy),
            helpLabel: copy.moreAbout(copy.allocation.label),
          }}
          ceilingSentence={words.sentence}
          ceilingLink={words.link}
        />
      );
    }
  }

  return (
    <div data-block-panel={mode} className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <span className="flex h-6 w-[22px] shrink-0 items-center justify-center">
          <BlockMark logo="protocol" markId={kind} name={head.protocolName} size={22} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <p className="truncate font-semibold text-base text-foreground">{head.protocolName}</p>
          <p className="truncate text-muted-foreground text-xs">{head.blockType}</p>
        </div>
        <NetworkChip
          network={head.network}
          name={head.networkName}
          tooltip={copy.networkTooltip(head.networkName)}
        />
      </div>

      {mode === "pick" && definition ? (
        <PickBody
          key={selectedId}
          definition={definition}
          context={context}
          copy={copy}
          onUse={(config) => {
            panel.use(config);
          }}
        />
      ) : null}

      {mode === "configured" && definition && panel.applied?.config && panel.draft?.config ? (
        <>
          <definition.Fields
            context={context}
            applied={panel.applied.config}
            config={panel.draft.config}
            onConfigChange={panel.setConfig}
            allocation={allocation}
          />
          <PanelStatusRow
            status={panel.leaveBlocked ? "leaveBlocked" : panel.dirty ? "pending" : "applied"}
            copy={{
              pending: copy.status.pending,
              applied: copy.status.applied,
              discard: copy.status.discard,
              leaveTitle: copy.leave.title,
              leaveBody: copy.leave.body,
              leaveDiscard: copy.leave.discard,
            }}
            onDiscard={panel.discard}
            attempt={panel.leaveAttempt}
          />
          <Button
            variant="primary"
            className="w-full"
            disabled={!panel.dirty}
            onClick={() => {
              panel.apply();
            }}
          >
            {copy.apply}
          </Button>
        </>
      ) : null}

      {removeConfirmOpen && removal ? (
        <RemoveBlockConfirm
          title={removal.title}
          sentence={removal.sentence}
          cancelLabel={copy.confirm.cancel}
          removeLabel={ctx.copy.panel.remove}
          onCancel={onRemoveCancel}
          onConfirm={onRemoveConfirm}
        />
      ) : (
        <button
          type="button"
          onClick={onRemoveRequest}
          className={cn(
            "self-center rounded-sm font-medium text-destructive text-sm hover:underline",
            PANEL_FOCUS_RING,
          )}
        >
          {ctx.copy.panel.remove}
        </button>
      )}
    </div>
  );
}
