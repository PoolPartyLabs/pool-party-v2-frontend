/**
 * @id PP-CORE-CMP-036 (POO-410)
 * @name CountrySelect
 *
 * Single-select country autocomplete (combobox): a text field that filters the static country list
 * as the manager/investor types, with a dropdown of matches. Keyboard-driven (↑/↓/Enter/Escape) and
 * accessible (role=combobox + listbox/option, aria-activedescendant). The dropdown opens on focus and
 * closes on blur; selecting commits the country to `value` via `onChange`. Used by Personal info.
 */
"use client";

import { Check } from "lucide-react";
import { useId, useState } from "react";
import { Input } from "@/components/ui/Input";
import { filterCountries } from "@/lib/data/countries";
import { cn } from "@/lib/utils/cn";

/** Public props for {@link CountrySelect}. */
export interface CountrySelectProps {
  /** Field label. */
  label: string;
  /** The committed country (a name from the list), or "" when unset. */
  value: string;
  /** Called with the selected country name. */
  onChange: (country: string) => void;
  /** Placeholder for the empty search field. */
  placeholder?: string;
  /** Shown when the query matches nothing. */
  noResultsLabel?: string;
}

/** Country autocomplete used on the Personal information screen. */
export function CountrySelect({
  label,
  value,
  onChange,
  placeholder,
  noResultsLabel,
}: CountrySelectProps) {
  // `query` is the text in the field; it starts at the committed value and is reverted to it on blur
  // so a half-typed non-country never lingers. Selection is the only path that commits a new value.
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const matches = filterCountries(query);

  function commit(country: string) {
    onChange(country);
    setQuery(country);
    setOpen(false);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActive((index) => Math.min(index + 1, matches.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter" && open && matches[active]) {
      event.preventDefault();
      commit(matches[active] as string);
    } else if (event.key === "Escape") {
      setOpen(false);
      setQuery(value);
    }
  }

  return (
    <div className="relative flex flex-col gap-1.5">
      <Input
        label={label}
        role="combobox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-autocomplete="list"
        aria-activedescendant={open && matches[active] ? `${listId}-${active}` : undefined}
        autoComplete="off"
        spellCheck={false}
        placeholder={placeholder}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => {
          setOpen(true);
          setActive(0);
        }}
        onBlur={() => {
          setOpen(false);
          // Revert a half-typed query that wasn't committed via selection.
          if (query !== value) setQuery(value);
        }}
        onKeyDown={handleKeyDown}
      />
      {open ? (
        // role=listbox on a generic div (not <ul>) is the combobox pattern biome accepts; the input
        // owns the keyboard, options are clicked via mouse and tracked via aria-activedescendant.
        <div
          id={listId}
          role="listbox"
          aria-label={label}
          className="absolute top-full right-0 left-0 z-20 mt-1 max-h-60 overflow-auto rounded-md border border-border bg-surface py-1 shadow-lg"
        >
          {matches.length === 0 ? (
            <p className="px-3 py-2 text-muted-foreground text-sm">
              {noResultsLabel ?? "No match"}
            </p>
          ) : (
            matches.map((country, index) => {
              const selected = country === value;
              return (
                <button
                  key={country}
                  type="button"
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={selected}
                  // Keep focus on the input so the click lands before the blur closes the list.
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => commit(country)}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm",
                    index === active
                      ? "bg-surface-raised text-foreground"
                      : "text-muted-foreground",
                  )}
                >
                  <span>{country}</span>
                  {selected ? (
                    <Check className="size-4 shrink-0 text-primary" aria-hidden="true" />
                  ) : null}
                </button>
              );
            })
          )}
        </div>
      ) : null}
    </div>
  );
}
