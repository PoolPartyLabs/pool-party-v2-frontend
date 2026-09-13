/**
 * @id PP-DEP-CMP-006
 * @name CurrencySelect
 * @implements-rules-version v1 (POO-1613 rules v1)
 *
 * Names the resolved fiat currency above the payment-method section and, wherever the host has a
 * readable option set, lets the buyer BROWSE the rest of the supported set.
 *
 * ## Interactive in both modes since POO-1630. It was mock-only, and this is what changed.
 *
 * POO-1613 shipped the control with `options`/`onSelect` passed ONLY behind `isMockMode`, so a real
 * buyer read display text and the browse list came from a fixture. That was correct while the real
 * supported set did not exist. POO-1621 published it and POO-1618 gave the quote a currency proposal,
 * so POO-1630 wired both: mock reads its fixture, real reads the live set, and NOTHING else differs.
 *
 * **The rule that did not bend:** this component still cannot become interactive by accident. It goes
 * interactive only when it has BOTH a non-empty `options` and an `onSelect`, so a missing or
 * unreadable set degrades to the same display-only state POO-1613 shipped, rather than offering a
 * currency it cannot switch to (POO-494 [R1]). What changed is where the options come from, not
 * whether their absence is handled.
 *
 * **What this control emits is a PROPOSAL.** The host sends it to the methods call and keeps
 * displaying the currency the SERVER echoed, so a refused pick leaves the screen unchanged rather
 * than naming a currency the figures beside it are not denominated in.
 *
 * PP-INTEGRATION-POINT: the option set is live via `getOnRampSupportedCurrenciesAction`
 * (POO-1621, `useOnRampCurrencies` / PP-CORE-HOK-033). The pick reaches the quote as a proposal
 * (POO-1618) and the ECHO reaches the mint through `StandaloneOnRampRail` (POO-1630), so the
 * checkout opens on the currency the review priced.
 */
"use client";

import { ChevronDown, Search } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useId, useMemo, useState } from "react";
import { cn } from "@/lib/utils/cn";

/**
 * The currency's localized display name, from the browser's own locale data
 * (`Intl.DisplayNames`) rather than a hand-written table to maintain. Falls back to the bare code
 * for a value the runtime does not recognise, which is safer than throwing on a render path.
 */
function currencyName(code: string, locale: string): string {
  try {
    return new Intl.DisplayNames([locale], { type: "currency" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** Public props for {@link CurrencySelect}. */
export interface CurrencySelectProps {
  /** The resolved currency code (e.g. `"USD"`). Absent renders NOTHING (AC3: never guess). */
  currencyCode?: string;
  /** The full option set. Real (POO-1621) or mock; absent or empty keeps the control display-only. */
  options?: readonly string[];
  /** Commits a picked currency (a PROPOSAL; the host redisplays the server's echo). Absent keeps
   * the control display-only, even if `options` is set. */
  onSelect?: (code: string) => void;
}

/** Names the resolved on-ramp currency, interactive whenever the host supplies a real option set. */
export function CurrencySelect({ currencyCode, options, onSelect }: CurrencySelectProps) {
  const t = useTranslations("deposit");
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const listId = useId();
  const interactive = options !== undefined && options.length > 0 && onSelect !== undefined;

  const filtered = useMemo(() => {
    if (!interactive || currencyCode === undefined) return [];
    const q = query.trim().toLowerCase();
    const matches = (code: string) =>
      q === "" ||
      code.toLowerCase().includes(q) ||
      currencyName(code, locale).toLowerCase().includes(q);
    // The resolved default sits first, radio-marked, so the buyer never scrolls to find where they
    // already are; the rest follow alphabetically by localized name.
    const rest = (options ?? [])
      .filter((code) => code !== currencyCode && matches(code))
      .sort((a, b) => currencyName(a, locale).localeCompare(currencyName(b, locale)));
    return matches(currencyCode) ? [currencyCode, ...rest] : rest;
  }, [interactive, options, query, currencyCode, locale]);

  if (currencyCode === undefined) return null;

  const label = `${currencyCode} · ${currencyName(currencyCode, locale)}`;

  if (!interactive) {
    return (
      <div className="flex flex-col gap-2">
        <p className="font-medium text-foreground text-sm">{t("currency.title")}</p>
        <p className="rounded-xl border border-border bg-surface px-3.5 py-3 text-foreground text-sm">
          {label}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="font-medium text-foreground text-sm">{t("currency.title")}</p>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: not a widget itself, a container that
          listens for Escape / focus-out to dismiss the child-owned menu (mirrors FilterDropdown,
          PP-CORE-CMP-059); the trigger + options are the real controls. */}
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
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          onClick={() => setOpen((prev) => !prev)}
          className="flex w-full items-center justify-between gap-2 rounded-xl border border-border bg-surface px-3.5 py-3 text-left text-foreground text-sm transition-colors hover:bg-surface-raised"
        >
          <span>{label}</span>
          <ChevronDown
            className={cn("size-4 shrink-0 transition-transform", open && "rotate-180")}
            aria-hidden="true"
          />
        </button>
        {open ? (
          <div className="absolute top-full left-0 z-20 mt-1 w-full rounded-md border border-border bg-surface shadow-lg">
            <div className="flex items-center gap-2 border-border border-b px-3 py-2">
              <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <input
                type="text"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("currency.search", { count: options?.length ?? 0 })}
                aria-label={t("currency.search", { count: options?.length ?? 0 })}
                className="w-full bg-transparent text-foreground text-sm outline-none placeholder:text-muted-foreground"
              />
            </div>
            <div
              id={listId}
              role="listbox"
              aria-label={t("currency.title")}
              className="max-h-72 overflow-auto py-1"
            >
              {filtered.map((code) => {
                const selected = code === currencyCode;
                return (
                  <button
                    key={code}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onClick={() => {
                      onSelect?.(code);
                      setOpen(false);
                      setQuery("");
                    }}
                    className={cn(
                      "flex w-full items-center justify-between gap-2 px-3.5 py-2 text-left text-sm",
                      selected
                        ? "bg-surface-raised text-foreground"
                        : "text-muted-foreground hover:bg-surface-raised hover:text-foreground",
                    )}
                  >
                    <span>
                      {code} · {currencyName(code, locale)}
                    </span>
                    {selected ? (
                      <span
                        className="size-2 shrink-0 rounded-full bg-foreground"
                        aria-hidden="true"
                      />
                    ) : null}
                  </button>
                );
              })}
              {filtered.length === 0 ? (
                <p className="px-3.5 py-3 text-muted-foreground text-sm">
                  {t("currency.noResults")}
                </p>
              ) : null}
            </div>
            <p className="border-border border-t px-3.5 py-2 text-muted-foreground text-xs">
              {t("currency.footnote")}
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
