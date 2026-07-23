/**
 * @id PP-CORE-CMP-063 (POO-904)
 * @name MobileLocaleSheet
 * @implements-rules-version v1
 *
 * Mobile header language picker: a lucide `Languages` icon button (44px touch target, i18n
 * accessible name) [R1] that opens the bottom {@link Sheet} listing the 11 supported locales as
 * endonyms (never translated), with the current locale marked [R2]. Selecting one runs the same
 * hard-navigation switch as the desktop {@link LocaleSwitcher} select — `locale_changed`
 * analytics, NEXT_LOCALE via the full-document request, path/search/hash preserved — through the
 * shared {@link useLocaleSwitch} seam [R4], then closes the sheet. Desktop (lg+) keeps the select
 * [R3]; the Manager Console AdminShell is out of scope [R6].
 */
"use client";

import { Check, Languages } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { LOCALE_OPTIONS, type LocaleValue, useLocaleSwitch } from "@/hooks/useLocaleSwitch";
import { cn } from "@/lib/utils/cn";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "./Sheet";

/** Public props for {@link MobileLocaleSheet}. */
export interface MobileLocaleSheetProps {
  /** Extra classes merged onto the trigger button. */
  className?: string;
}

/**
 * Icon trigger + bottom-sheet locale list for the mobile header. Controlled open state so a
 * selection can close the sheet explicitly: the hard navigation unloads the document anyway, but
 * while it is pending (or stubbed in tests) the sheet must not linger open [R2].
 */
export function MobileLocaleSheet({ className }: MobileLocaleSheetProps) {
  const t = useTranslations("shell");
  const { locale, switchLocale } = useLocaleSwitch();
  const [open, setOpen] = useState(false);

  const handleSelect = (nextLocale: LocaleValue) => {
    // [R2] Analytics + hard navigation live in the shared switch (useLocaleSwitch), then close.
    switchLocale(nextLocale);
    setOpen(false);
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          type="button"
          aria-label={t("locale.changeLanguage")}
          className={cn(
            // [R1] size-11 = 44px: the minimum touch target (POO-840 precedent).
            "inline-flex size-11 items-center justify-center rounded-md text-muted-foreground transition-colors",
            "hover:bg-surface-raised hover:text-foreground",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            className,
          )}
        >
          <Languages className="size-5" aria-hidden="true" />
        </button>
      </SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{t("locale.title")}</SheetTitle>
        </SheetHeader>
        <div className="flex flex-col gap-1">
          {LOCALE_OPTIONS.map((option) => {
            const isCurrent = option.value === locale;
            return (
              <button
                key={option.value}
                type="button"
                // Each endonym is in its own language; tag it so screen readers switch voice.
                lang={option.value}
                aria-current={isCurrent ? "true" : undefined}
                onClick={() => handleSelect(option.value)}
                className={cn(
                  // [R1] min-h-11 = 44px rows: comfortable touch targets for the whole list.
                  "flex min-h-11 items-center justify-between rounded-md px-3 text-left text-sm transition-colors",
                  "hover:bg-surface-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  isCurrent ? "font-medium text-foreground" : "text-muted-foreground",
                )}
              >
                <span>{option.label}</span>
                {/* [R2] Visual mark for the current locale (aria-current carries the semantics). */}
                {isCurrent ? <Check className="size-4 text-primary" aria-hidden="true" /> : null}
              </button>
            );
          })}
        </div>
      </SheetContent>
    </Sheet>
  );
}

MobileLocaleSheet.displayName = "MobileLocaleSheet";
