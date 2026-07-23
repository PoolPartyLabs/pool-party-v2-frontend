/**
 * @id PP-STR-CMP-021
 * @name CategoryFilter
 * @implements-rules-version v1
 *
 * POO-830 PR2 (R6): the investor MULTI-select asset-category filter on the Strategies Explore screen.
 * A trigger button opens a floating multi-select listbox of the five plain-language categories
 * (Bitcoin / Ethereum / Stablecoins / Altcoins / Meme coins); each option TOGGLES (the menu stays
 * open for multi-pick), a top "All" row clears the selection. Semantics are OR and no-selection = no
 * filter — the pure predicate lives in `lib/strategies/tags/filterByAssetTags.ts` (PP-STR-LIB-015);
 * this component only owns the control UI + the selection callback.
 *
 * Sibling to the single-select {@link FilterDropdown} (PP-CORE-CMP-059) used by the risk/type filters;
 * kept separate because the multi-select semantics (toggle, stay open, count badge, `aria-multi
 * selectable`) differ. Dark-theme tokens; closes on Escape and on focus leaving the control.
 */
"use client";

import { Check, ChevronDown } from "lucide-react";
import { useId, useState } from "react";
import type { AssetTag } from "@/lib/schemas";
import { cn } from "@/lib/utils/cn";

/** One selectable category option. */
export interface CategoryOption {
  /** The canonical asset tag committed into the selection. */
  value: AssetTag;
  /** Plain-language display label (investor voice; no DeFi jargon). */
  label: string;
}

/** Public props for {@link CategoryFilter}. */
export interface CategoryFilterProps {
  /** Section label, e.g. "Browse by category". Also the listbox's accessible name. */
  label: string;
  /** Label for the "All" row that clears the selection (no-selection = no filter). */
  allLabel: string;
  /**
   * Formats the active-selection summary appended to the trigger's accessible name (e.g. "2 selected"),
   * given the active count (always > 0 when called). Passed in — like `label`/`allLabel` — so the count
   * phrase is TRANSLATED per locale (composed of translated pieces, mirroring `FilterDropdown`), never a
   * hardcoded English word.
   */
  selectedCountLabel: (count: number) => string;
  /** The category options, in display order. */
  options: CategoryOption[];
  /** Currently selected categories (OR semantics; empty = no filter). */
  selected: AssetTag[];
  /** Called with the next selection whenever a category is toggled or the selection is cleared. */
  onChange: (next: AssetTag[]) => void;
}

/** The investor multi-select asset-category filter. */
export function CategoryFilter({
  label,
  allLabel,
  selectedCountLabel,
  options,
  selected,
  onChange,
}: CategoryFilterProps) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const count = selected.length;
  const hasSelection = count > 0;

  const toggle = (value: AssetTag) => {
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: not a widget itself, just a container that listens for Escape / focus-out to dismiss the child-owned menu; the trigger + options are the real controls, so a role here would be wrong.
    <div
      className="relative"
      onKeyDown={(event) => {
        if (event.key === "Escape") setOpen(false);
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button
        type="button"
        // PP-A11Y: the accessible name carries the section AND the active count so a screen reader
        // announces how many categories are filtering (the visible trigger shows a compact count badge).
        // The count phrase is translated (`selectedCountLabel`), never a hardcoded English word.
        aria-label={hasSelection ? `${label}: ${selectedCountLabel(count)}` : label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => setOpen((prev) => !prev)}
        className={cn(
          "inline-flex items-center gap-2 rounded-full border px-3.5 py-2 font-medium text-sm transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          hasSelection
            ? "border-input bg-surface-raised text-foreground"
            : "border-border text-muted-foreground hover:bg-surface-raised hover:text-foreground",
        )}
      >
        <span>{label}</span>
        {hasSelection ? (
          <span
            className="inline-flex min-w-5 items-center justify-center rounded-full bg-primary px-1.5 py-0.5 font-semibold text-[11px] text-primary-foreground leading-none"
            aria-hidden="true"
          >
            {count}
          </span>
        ) : null}
        <ChevronDown
          className={cn("size-4 shrink-0 transition-transform", open && "rotate-180")}
          aria-hidden="true"
        />
      </button>
      {open ? (
        <div
          id={listId}
          role="listbox"
          aria-label={label}
          aria-multiselectable="true"
          className="absolute top-full left-0 z-20 mt-1 max-h-72 min-w-52 overflow-auto rounded-md border border-border bg-surface py-1 shadow-lg"
        >
          {/* "All" reset row: selected when nothing is picked; clears the selection on click. */}
          <button
            type="button"
            role="option"
            aria-selected={!hasSelection}
            onClick={() => onChange([])}
            className={cn(
              "flex w-full items-center gap-2 px-3 py-2 text-left text-sm",
              !hasSelection
                ? "bg-surface-raised text-foreground"
                : "text-muted-foreground hover:bg-surface-raised hover:text-foreground",
            )}
          >
            <span className="flex size-4 shrink-0 items-center justify-center" aria-hidden="true">
              {!hasSelection ? <Check className="size-4" /> : null}
            </span>
            <span>{allLabel}</span>
          </button>
          {options.map((option) => {
            const isSelected = selected.includes(option.value);
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => toggle(option.value)}
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-2 text-left text-sm",
                  isSelected
                    ? "bg-surface-raised text-foreground"
                    : "text-muted-foreground hover:bg-surface-raised hover:text-foreground",
                )}
              >
                <span
                  className="flex size-4 shrink-0 items-center justify-center"
                  aria-hidden="true"
                >
                  {isSelected ? <Check className="size-4 text-primary" /> : null}
                </span>
                <span>{option.label}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
