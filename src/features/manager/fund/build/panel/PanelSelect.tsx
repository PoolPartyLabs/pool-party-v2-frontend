/**
 * @id PP-MGR-CMP-063
 * @name PanelSelect
 * @implements-rules-version v1 (POO-2187 rules v1)
 * @analytics-events none, a presentational control. A choice changes the panel's draft only, and
 *   reaches analytics as a field of `builder_block_applied` (PP-MGR-SCR-002 emits it on Apply).
 *
 * The select of the configuration panels (handoff P11): the Pool of a pool block, the Asset of an
 * Aave block.
 *
 * - Closed: 326 x 43, radius 12, `input` fill, 1 px `border`, padding 10 x 12, gap 8: the logo or
 *   logos, the value (Body/Default), a 16 px chevron.
 * - Open: a 1 px `primary` stroke, the chevron up, and a popover 4 px under it, the same width, in a
 *   layer above the panel (it may run past the panel's bottom): rows with the logo, the name and the
 *   right-aligned metrics; the selected row has the hover fill and a `primary` check at the far
 *   right; a 1 px divider; a footer with the link row of Mode 2 ("Need another pool?" +
 *   "Edit mandate · Pools"), which wraps on two lines when it does not fit.
 * - [P11] Choosing a row changes the DRAFT, not the canvas: the caller's `onChange` writes the draft.
 * - [P1] It lists only what the caller hands it: the mandate's items for the block's network.
 *
 * Keyboard: the button opens the list with Enter, Space or Arrow Down; Arrow Up and Down move the
 * active row, Home and End jump, Enter chooses, Escape closes and focus returns to the button. A
 * press outside closes it. Props only: the strings and the options arrive ready.
 *
 * {@link TokenLogos} (the one or two token logos of a row) lives here and is shared with the pick
 * list (PP-MGR-CMP-068).
 */
"use client";

import { Check, ChevronDown, ChevronUp } from "lucide-react";
import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { TokenLogo } from "@/components/data-display/TokenLogo";
import { cn } from "@/lib/utils/cn";
import { NUMERIC_LABEL, PANEL_FOCUS_RING, PANEL_LINK } from "./panelStyles";

/** A token logo of a row: its symbol, and the network for the fallback list. */
export interface PanelTokenLogo {
  symbol: string;
  network?: string | null;
}

/** One or two token logos; the second overlaps the first with a ring of the surface under it. */
export function TokenLogos({
  logos,
  size,
  ringClass,
}: {
  logos: readonly PanelTokenLogo[];
  /** 20 in a select or a popover row, 24 in a pick list row. */
  size: 20 | 24;
  /** The ring colour of the second logo: the fill under it (`ring-input`, `ring-surface`). */
  ringClass: string;
}) {
  const box = size === 24 ? "size-6 text-[10px]" : "size-5 text-[9px]";
  return (
    <span aria-hidden="true" className="flex shrink-0 items-center">
      {logos.slice(0, 2).map((logo, index) => (
        <span
          key={logo.symbol}
          className={cn(
            "flex shrink-0 rounded-full",
            index > 0 ? cn(size === 24 ? "-ml-2 ring-2" : "-ml-1.5 ring-[1.5px]", ringClass) : null,
          )}
        >
          <TokenLogo symbol={logo.symbol} network={logo.network} className={box} />
        </span>
      ))}
    </span>
  );
}

/** A metric at the right end of a row: a label over a value (P11, Mode 2). */
export interface PanelMetric {
  /** "Supply APY". */
  label: string;
  /** "4.1%". */
  value: string;
  /** `success` for a supply rate, `foreground` for a borrow rate. */
  tone?: "success" | "foreground";
}

/** One option of the select. */
export interface PanelSelectOption {
  id: string;
  /** "WETH / USDC · 0.05%", "USDC". */
  label: string;
  logos: readonly PanelTokenLogo[];
  /** The right-aligned stack, or none (decision A3: pool rows leave TVL and APR out). */
  metric?: PanelMetric | null;
}

/** Public props for {@link PanelSelect}. */
export interface PanelSelectProps {
  /** The id of the field's label, which names the select. */
  labelId: string;
  options: readonly PanelSelectOption[];
  /** The selected option's id. */
  value: string | null;
  /** A row was chosen: write it to the draft (P11). */
  onChange(id: string): void;
  /** The footer link row: "Need another pool?" + "Edit mandate · Pools". */
  footer?: { prompt: string; label: string; onClick(): void } | null;
  /** Start open (stories, an open state). */
  defaultOpen?: boolean;
}

/** The metric stack at the right of a row. */
function MetricStack({ metric }: { metric: PanelMetric }) {
  return (
    <span className="flex shrink-0 flex-col items-end">
      <span className="text-muted-foreground text-xs">{metric.label}</span>
      <span
        className={cn(
          NUMERIC_LABEL,
          metric.tone === "foreground" ? "text-foreground" : "text-success",
        )}
      >
        {metric.value}
      </span>
    </span>
  );
}

/** The select of the panels (P11). */
export function PanelSelect({
  labelId,
  options,
  value,
  onChange,
  footer,
  defaultOpen = false,
}: PanelSelectProps) {
  const [open, setOpen] = useState(defaultOpen);
  const selectedIndex = options.findIndex((option) => option.id === value);
  const [active, setActive] = useState(Math.max(0, selectedIndex));
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const listId = useId();
  const optionId = (index: number) => `${listId}-option-${index}`;
  const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined;

  // A press outside the select (button and popover) closes it.
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (root.current && event.target instanceof Node && !root.current.contains(event.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // On open, the list takes focus with the selected row active.
  useEffect(() => {
    if (open) list.current?.focus({ preventScroll: true });
  }, [open]);

  const openList = () => {
    setActive(Math.max(0, selectedIndex));
    setOpen(true);
  };

  const close = () => {
    setOpen(false);
    button.current?.focus({ preventScroll: true });
  };

  const choose = (index: number) => {
    const option = options[index];
    if (!option) return;
    if (option.id !== value) onChange(option.id);
    close();
  };

  const onListKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const last = options.length - 1;
    const moves: Record<string, () => void> = {
      ArrowDown: () => setActive((index) => Math.min(last, index + 1)),
      ArrowUp: () => setActive((index) => Math.max(0, index - 1)),
      Home: () => setActive(0),
      End: () => setActive(last),
      Enter: () => choose(active),
      " ": () => choose(active),
      Escape: () => close(),
    };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    // The key belongs to the list: an Escape here must not also close the canvas's confirm or menu.
    event.stopPropagation();
    move();
  };

  return (
    <div ref={root} data-panel-select="" className="relative">
      <button
        ref={button}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-labelledby={labelId}
        aria-describedby={`${listId}-value`}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={(event) => {
          if (!open && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
            event.preventDefault();
            openList();
          }
        }}
        className={cn(
          "flex h-[43px] w-full items-center gap-2 rounded-xl border bg-input px-3 text-left",
          open ? "border-primary" : "border-border",
          PANEL_FOCUS_RING,
        )}
      >
        {selected ? <TokenLogos logos={selected.logos} size={20} ringClass="ring-input" /> : null}
        <span id={`${listId}-value`} className="min-w-0 flex-1 truncate text-foreground text-sm">
          {selected?.label ?? ""}
        </span>
        {open ? (
          <ChevronUp aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        )}
      </button>
      {open ? (
        <div
          data-panel-select-popover=""
          className="absolute top-full right-0 left-0 z-50 mt-1 flex flex-col rounded-xl border border-border bg-surface p-1"
        >
          <div
            ref={list}
            id={listId}
            role="listbox"
            tabIndex={-1}
            aria-labelledby={labelId}
            aria-activedescendant={options.length > 0 ? optionId(active) : undefined}
            onKeyDown={onListKey}
            className="flex flex-col gap-0.5 outline-none"
          >
            {options.map((option, index) => {
              const isSelected = option.id === value;
              return (
                // biome-ignore lint/a11y/useKeyWithClickEvents: the listbox owns the keyboard (aria-activedescendant); a row is chosen with Enter there.
                <div
                  key={option.id}
                  id={optionId(index)}
                  role="option"
                  tabIndex={-1}
                  aria-selected={isSelected}
                  onClick={() => choose(index)}
                  onMouseEnter={() => setActive(index)}
                  className={cn(
                    "flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2",
                    isSelected || index === active ? "bg-surface-raised" : null,
                  )}
                >
                  <TokenLogos logos={option.logos} size={20} ringClass="ring-surface" />
                  <span className="min-w-0 flex-1 truncate text-foreground text-sm">
                    {option.label}
                  </span>
                  {option.metric ? <MetricStack metric={option.metric} /> : null}
                  {isSelected ? (
                    <Check aria-hidden="true" className="size-4 shrink-0 text-primary" />
                  ) : null}
                </div>
              );
            })}
          </div>
          {footer ? (
            <div className="mt-1 flex flex-wrap items-baseline gap-x-1.5 border-border border-t px-2 pt-2 pb-1 text-sm">
              <span className="text-muted-foreground">{footer.prompt}</span>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  footer.onClick();
                }}
                className={PANEL_LINK}
              >
                {footer.label}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
