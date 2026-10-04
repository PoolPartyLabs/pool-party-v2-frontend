/**
 * @id PP-MGR-CMP-058
 * @name PanelStub
 * @implements-rules-version v1 (POO-2155 rules v1)
 * @analytics-events none, a presentational stub. "Remove block" is handed to the controller
 *   (`useBuildCanvas`), which reports `blockRemoved` through `onEvent`; the Build screen
 *   (PP-MGR-SCR-002, S7) owns every event.
 *
 * The body of the Configure block panel in this batch (handoff v1.2 AN10, heads-up HU1). The frame
 * and its overline are `BuildPanelSlot`'s (S2); this is what goes inside, and the configuration
 * batch replaces it without touching the canvas.
 *
 * - Nothing selected: "Nothing selected" (Title/Small) over its body.
 * - A block selected: its head (protocol logo, protocol name as the title, block type as the
 *   caption, " · no pool yet" or " · no asset yet" while empty, the network chip at the right end:
 *   a pill 28 high, logo 20, `surface-raised`, 1 px `border`), then "Remove block", a destructive
 *   text button.
 * - While a menu is open on the canvas, its sentence replaces the body (8130-3408, 8181-2110).
 *
 * Every string arrives as a prop (the controller builds them), so the stub decides nothing. The only
 * control is "Remove block": the head explains, it does not act, so it is not a button.
 */
"use client";

import { NetworkLogo } from "@/components/data-display/NetworkLogo";
import { BlockMark } from "./BlockMark";
import type { PanelHead } from "./blockRegistry";

/** Public props for {@link PanelStub}. */
export interface PanelStubProps {
  /** The selected block's head, or null when nothing is selected. */
  head: PanelHead | null;
  /** "Nothing selected". */
  nothingTitle: string;
  /** The nothing-selected body, the sentence of an open menu, or null. */
  body: string | null;
  /** "Remove block". */
  removeLabel: string;
  /** Remove the selected block (I6). */
  onRemove(): void;
}

/** The network chip of the head: where the block sits (C5). */
function NetworkChip({ network, name }: { network: string; name: string }) {
  return (
    <span
      data-network-chip=""
      className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border border-border bg-surface-raised py-1 pr-2.5 pl-1"
    >
      <NetworkLogo network={network} name={name} size={20} />
      <span className="text-foreground text-xs">{name}</span>
    </span>
  );
}

/** The Configure block body of this batch. */
export function PanelStub({ head, nothingTitle, body, removeLabel, onRemove }: PanelStubProps) {
  if (!head) {
    return (
      <div data-panel-stub="nothing" className="flex flex-col gap-2">
        <p className="font-semibold text-base text-foreground">{nothingTitle}</p>
        {body ? <p className="text-muted-foreground text-sm">{body}</p> : null}
      </div>
    );
  }
  return (
    <div data-panel-stub="block" className="flex flex-col gap-4">
      <div className="flex items-center gap-2.5">
        <BlockMark logo="protocol" markId={head.blockKind} name={head.protocolName} />
        <div className="flex min-w-0 flex-1 flex-col">
          <p className="truncate font-semibold text-base text-foreground">{head.protocolName}</p>
          <p className="truncate text-muted-foreground text-xs">{head.blockType}</p>
        </div>
        <NetworkChip network={head.network} name={head.networkName} />
      </div>
      {body ? <p className="text-muted-foreground text-sm">{body}</p> : null}
      <button
        type="button"
        onClick={onRemove}
        className="self-start rounded-sm font-medium text-destructive text-sm hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {removeLabel}
      </button>
    </div>
  );
}
