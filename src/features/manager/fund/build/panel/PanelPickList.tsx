/**
 * @id PP-MGR-CMP-068
 * @name PanelPickList
 * @implements-rules-version v1 (POO-2187 rules v1)
 * @analytics-events none emitted here. `Use` is the caller's: the panel's draft applies the kind's
 *   defaults and the Build screen (PP-MGR-SCR-002) reports `builder_block_configured`.
 *
 * Modes 2 and 3 of the configuration panel (handoff "Panel shell"): what an EMPTY block can become,
 * picked from the mandate.
 *
 * - Mode 2, top to bottom (gap 16): the heading with the count, "Pools in your mandate · 2" (the
 *   count is the TOTAL for the network, not the filtered count, in the Numeric style); the filter
 *   field (height 43, radius 12, `input`, a 16 px search icon), which filters the list as the
 *   manager types and never searches outside the mandate (P1); the rows (gap 6; 58 high, radius 16,
 *   `surface`, 1 px `border`, padding 8 x 12, gap 10: logos, name over the second line, the metric
 *   stack when the caller has one, and the outline pill `Use`); the caption; the link row back to
 *   the Mandate step ("Need another pool?" + "Edit mandate · Pools").
 * - Mode 3, no match: the same down to the filter, then ONE box in place of the list, the caption
 *   and the link row: radius 12, `surface-raised`, padding 16, gap 8: the title (a pasted address is
 *   shortened in the middle), the caption, and the outline pill that goes to the Mandate step.
 * - A mandate with nothing for this block on its network shows the same box with its own title
 *   (proposal of the handoff), and no filter.
 * - [P13] While the caller's live read loads, skeleton rows; a failed read shows the inline retry.
 * - Decision A3: pool rows carry no metric stack (no TVL and no APR); a row without `metric` simply
 *   has none.
 * - Review M2 of PR #54: a row with a `disabledReason` (a reserve that is not usable) shows the
 *   reason in place of its second line, dimmed, and its `Use` is disabled and described by it.
 *
 * Props only. The filter is the list's own state; `defaultFilter` seeds it (stories, Mode 3).
 */
"use client";

import { Search } from "lucide-react";
import { useId, useState } from "react";
import { Skeleton } from "@/components/ui/Skeleton";
import { cn } from "@/lib/utils/cn";
import { formatIdentityLabel } from "@/lib/utils/format";
import { type PanelMetric, type PanelTokenLogo, TokenLogos } from "./PanelSelect";
import { NUMERIC_LABEL, OUTLINE_PILL, PANEL_LINK } from "./panelStyles";

/** One row of the list: something of the mandate this block can become. */
export interface PanelPickItem {
  id: string;
  /** "WETH / USDC", "USDC". */
  title: string;
  /** The second line: the fee ("0.05%") or the token name ("USD Coin"). */
  subtitle: string;
  logos: readonly PanelTokenLogo[];
  /** The right-aligned metric stack, or none (decision A3: pool rows have none). */
  metric?: PanelMetric | null;
  /** What the filter matches, besides the title: symbols, names, the address. */
  searchText: string;
  /** `Use` cannot run yet (its live read has not landed). */
  useDisabled?: boolean;
  /**
   * The row cannot be used, and why (review M2 of PR #54): "Supply cap reached", "Paused". Shown in
   * the row in place of the second line, and it disables `Use`.
   */
  disabledReason?: string;
}

/** The link back to a Mandate step. */
export interface PanelLinkRow {
  /** "Need another pool?". */
  prompt: string;
  /** "Edit mandate · Pools". */
  label: string;
  onClick(): void;
}

/** Public props for {@link PanelPickList}. */
export interface PanelPickListProps {
  /** "Pools in your mandate". */
  heading: string;
  /** Every item of the mandate on this network, whatever the filter shows. */
  count: number;
  /** "Filter by token or address". Also the field's name. */
  filterPlaceholder: string;
  items: readonly PanelPickItem[];
  /** "Use". */
  useLabel: string;
  /** The button's name for one row: "Use WETH / USDC". */
  rowLabel(title: string): string;
  onUse(id: string): void;
  /** "Only the Uniswap v4 pools on Arbitrum that you chose in the mandate (step 4). ..." */
  caption: string;
  link: PanelLinkRow;
  /** Mode 3: the box's title for the typed text, and its caption. */
  noMatch: { title(typed: string): string; caption: string };
  /** The box's title when the mandate holds nothing for this block on this network. */
  emptyTitle: string;
  /** The filter's first text (stories: the no-match state). */
  defaultFilter?: string;
  /** P13: the caller's live read. `loading` draws skeleton rows, `error` the inline retry. */
  status?: "ready" | "loading" | "error";
  /** The read failed: the sentence, and the retry. */
  error?: { text: string; retryLabel: string; onRetry(): void };
}

/** Whether a row answers the filter: any word of its title or its search text, no case. */
export function matchesFilter(item: PanelPickItem, filter: string): boolean {
  const wanted = filter.trim().toLowerCase();
  if (wanted === "") return true;
  return `${item.title} ${item.subtitle} ${item.searchText}`.toLowerCase().includes(wanted);
}

/** Mode 3's box, and the empty mandate's. */
function MandateBox({
  title,
  caption,
  link,
}: {
  title: string;
  caption: string;
  link: PanelLinkRow;
}) {
  return (
    <div
      data-panel-pick-box=""
      className="flex flex-col items-start gap-2 rounded-xl bg-surface-raised p-4"
    >
      <p className="break-words font-medium text-foreground text-sm">{title}</p>
      <p className="text-muted-foreground text-xs">{caption}</p>
      <button type="button" onClick={link.onClick} className={cn(OUTLINE_PILL, "h-[34px]")}>
        {link.label}
      </button>
    </div>
  );
}

/** Modes 2 and 3: pick from the mandate. */
export function PanelPickList({
  heading,
  count,
  filterPlaceholder,
  items,
  useLabel,
  rowLabel,
  onUse,
  caption,
  link,
  noMatch,
  emptyTitle,
  defaultFilter = "",
  status = "ready",
  error,
}: PanelPickListProps) {
  const [filter, setFilter] = useState(defaultFilter);
  const headingId = useId();
  const shown = items.filter((item) => matchesFilter(item, filter));
  const empty = status === "ready" && items.length === 0;
  const noMatchShown = status === "ready" && items.length > 0 && shown.length === 0;

  return (
    <div data-panel-pick-list="" className="flex flex-col gap-4">
      <p id={headingId} className="font-medium text-foreground text-sm">
        {heading} · <span className="lining-nums tabular-nums">{count}</span>
      </p>

      {empty ? null : (
        <label className="flex h-[43px] items-center gap-2 rounded-xl border border-border bg-input px-3.5 focus-within:ring-2 focus-within:ring-ring">
          <Search aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
          <input
            type="text"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder={filterPlaceholder}
            aria-label={filterPlaceholder}
            autoComplete="off"
            className="w-full min-w-0 bg-transparent text-foreground text-sm outline-none placeholder:text-muted-foreground"
          />
        </label>
      )}

      {empty ? (
        <MandateBox title={emptyTitle} caption={noMatch.caption} link={link} />
      ) : noMatchShown ? (
        <MandateBox
          title={noMatch.title(formatIdentityLabel(filter.trim()))}
          caption={noMatch.caption}
          link={link}
        />
      ) : (
        <>
          {status === "loading" ? (
            <div data-panel-pick-loading="" className="flex flex-col gap-1.5">
              <Skeleton height={58} radius={16} />
              <Skeleton height={58} radius={16} />
            </div>
          ) : status === "error" && error ? (
            <div
              role="alert"
              className="flex items-center justify-between gap-3 rounded-xl border border-border p-3"
            >
              <p className="text-muted-foreground text-xs">{error.text}</p>
              <button type="button" onClick={error.onRetry} className={OUTLINE_PILL}>
                {error.retryLabel}
              </button>
            </div>
          ) : (
            <ul aria-labelledby={headingId} className="m-0 flex list-none flex-col gap-1.5 p-0">
              {shown.map((item) => (
                <li
                  key={item.id}
                  data-panel-pick-item={item.id}
                  data-disabled={item.disabledReason ? "" : undefined}
                  className="flex h-[58px] items-center gap-2.5 rounded-2xl border border-border bg-surface px-3 py-2"
                >
                  <span
                    className={cn(
                      "flex min-w-0 flex-1 items-center gap-2.5",
                      item.disabledReason ? "opacity-60" : null,
                    )}
                  >
                    <TokenLogos logos={item.logos} size={24} ringClass="ring-surface" />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate font-medium text-foreground text-sm">
                        {item.title}
                      </span>
                      <span
                        id={`${headingId}-${item.id}-second`}
                        className="truncate text-muted-foreground text-xs"
                      >
                        {item.disabledReason ?? item.subtitle}
                      </span>
                    </span>
                  </span>
                  {item.metric ? (
                    <span className="flex shrink-0 flex-col items-end">
                      <span className="text-muted-foreground text-xs">{item.metric.label}</span>
                      <span
                        className={cn(
                          NUMERIC_LABEL,
                          item.metric.tone === "foreground" ? "text-foreground" : "text-success",
                        )}
                      >
                        {item.metric.value}
                      </span>
                    </span>
                  ) : null}
                  <button
                    type="button"
                    disabled={item.useDisabled === true || Boolean(item.disabledReason)}
                    aria-label={rowLabel(item.title)}
                    aria-describedby={
                      item.disabledReason ? `${headingId}-${item.id}-second` : undefined
                    }
                    onClick={() => onUse(item.id)}
                    className={OUTLINE_PILL}
                  >
                    {useLabel}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="text-muted-foreground text-xs">{caption}</p>
          <p className="flex flex-wrap items-baseline gap-x-1.5 text-sm">
            <span className="text-muted-foreground">{link.prompt}</span>
            <button type="button" onClick={link.onClick} className={PANEL_LINK}>
              {link.label}
            </button>
          </p>
        </>
      )}
    </div>
  );
}
