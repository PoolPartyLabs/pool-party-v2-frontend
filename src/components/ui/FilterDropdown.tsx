/**
 * @id PP-CORE-CMP-059 (POO-658, POO-756; promoted from PP-STR-CMP-019)
 * @name FilterDropdown
 * @implements-rules-version v1
 *
 * A single-select filter collapsed into a floating dropdown (murilo POO-658): a trigger button shows
 * the current selection; clicking opens a listbox of options; selecting commits + closes. Shared UI
 * primitive (POO-756: promoted to `components/ui` for its second consumer, the Manager Console
 * "Sort by" control) — used by Explore's risk/type filters and the manager sort control. Closes on
 * Escape and on focus leaving the control (click-outside / tab-away). Dark-theme tokens, mirrors
 * {@link CountrySelect}'s combobox pattern (option buttons under role=listbox, clicked directly). The
 * trigger's aria-label is "section: current selection" so a screen reader announces the active value
 * while the visible button text stays the compact value.
 */
"use client";

import { ChevronDown } from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import { cn } from "@/lib/utils/cn";

/** One selectable filter option. */
export interface FilterOption<T> {
  /** The committed value (the FIRST option is treated as the "all"/neutral one for styling). */
  value: T;
  /** Display label. */
  label: string;
  /** Optional leading adornment (e.g. the risk color dot). */
  adornment?: ReactNode;
}

/** Public props for {@link FilterDropdown}. */
export interface FilterDropdownProps<T> {
  /** The section name, e.g. "Browse by risk"; the trigger's accessible name is "section: selection". */
  label: string;
  /** The options, "all"/neutral first. */
  options: FilterOption<T>[];
  /** The committed value. */
  value: T;
  /** Called with the newly selected value. */
  onSelect: (value: T) => void;
}

/** A filter collapsed behind a button that opens a floating listbox of options. */
export function FilterDropdown<T>({ label, options, value, onSelect }: FilterDropdownProps<T>) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const selected = options.find((option) => option.value === value) ?? options[0];
  // The FIRST option is the neutral "all": a non-neutral selection gives the trigger the active look.
  const isNeutral = value === options[0]?.value;

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
        // PP-A11Y: the accessible name carries BOTH the section and the CURRENT selection so a screen
        // reader announces the active filter value (the visible trigger text is the compact value only).
        aria-label={`${label}: ${selected?.label}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => setOpen((prev) => !prev)}
        className={cn(
          "inline-flex items-center gap-2 rounded-full border px-3.5 py-2 font-medium text-sm transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          isNeutral
            ? "border-border text-muted-foreground hover:bg-surface-raised hover:text-foreground"
            : "border-input bg-surface-raised text-foreground",
        )}
      >
        {selected?.adornment}
        <span>{selected?.label}</span>
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
          className="absolute top-full left-0 z-20 mt-1 max-h-72 min-w-48 overflow-auto rounded-md border border-border bg-surface py-1 shadow-lg"
        >
          {options.map((option) => {
            const isSelected = option.value === value;
            return (
              <button
                key={String(option.value)}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => {
                  onSelect(option.value);
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-2 text-left text-sm",
                  isSelected
                    ? "bg-surface-raised text-foreground"
                    : "text-muted-foreground hover:bg-surface-raised hover:text-foreground",
                )}
              >
                {option.adornment}
                <span>{option.label}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
