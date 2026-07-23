/**
 * @id PP-CORE (SETUP-014 / POO-82)
 * @name ConsentBanner
 * @i18n-namespace consent
 * @implements-rules-version v1
 *
 * Consent Mode v2 banner. Shows only when no choice is stored yet (`pp_consent` cookie unset).
 * Accepting flips analytics/ad storage to granted; declining keeps the cookieless default.
 */
"use client";

import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";
import {
  type ConsentState,
  readConsent,
  updateConsentMode,
  writeConsent,
} from "@/lib/analytics/consent";

export function ConsentBanner() {
  const t = useTranslations("consent");
  const [mounted, setMounted] = useState(false);
  const [state, setState] = useState<ConsentState>("unknown");
  const titleId = useId();
  const descriptionId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    setState(readConsent());
    setMounted(true);
  }, []);

  // Only on the client, and only until a choice is needed (avoids a hydration flash).
  const visible = mounted && state === "unknown";

  // When the banner appears, move focus into it so keyboard and screen-reader users encounter
  // the choice; restore focus to wherever it was once the banner is dismissed.
  useEffect(() => {
    if (!visible) return;
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    containerRef.current?.focus();
    return () => restoreFocusRef.current?.focus?.();
  }, [visible]);

  if (!visible) return null;

  const choose = (granted: boolean) => {
    writeConsent(granted ? "granted" : "denied");
    updateConsentMode(granted);
    setState(granted ? "granted" : "denied");
  };

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      tabIndex={-1}
      onKeyDown={(event) => {
        // Esc keeps the cookieless default (decline) and dismisses the banner.
        if (event.key === "Escape") choose(false);
      }}
      className="fixed inset-x-0 bottom-0 z-50 border-border border-t bg-surface p-4 focus-visible:outline-none"
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p id={titleId} className="font-semibold text-foreground">
            {t("title")}
          </p>
          <p id={descriptionId} className="text-muted-foreground text-sm">
            {t("description")}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={() => choose(false)}
            className="rounded-md border border-border px-4 py-2 text-foreground text-sm"
          >
            {t("decline")}
          </button>
          <button
            type="button"
            onClick={() => choose(true)}
            className="rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground text-sm"
          >
            {t("accept")}
          </button>
        </div>
      </div>
    </div>
  );
}
