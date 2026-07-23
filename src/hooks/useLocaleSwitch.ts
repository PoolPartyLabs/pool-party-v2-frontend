/**
 * @id PP-CORE-HOK-024 (POO-904)
 * @name useLocaleSwitch
 * @implements-rules-version v1
 *
 * Single source of truth for switching the active locale [R4]: the supported-locale endonym list
 * ({@link LOCALE_OPTIONS}) and the switch itself, shared by the desktop {@link LocaleSwitcher}
 * select and the mobile {@link MobileLocaleSheet} picker. `switchLocale` records `locale_changed`
 * (previous → next) and hard-navigates to the locale-prefixed equivalent of the current URL,
 * preserving path, search and hash; the full-document request lets the next-intl middleware
 * persist the `NEXT_LOCALE` cookie.
 *
 * PP-NOTE(POO-465): the hard navigation (`window.location.assign`, not `router.replace`) is a
 * deliberate deviation from the upstream next-intl soft-navigation pattern — a mid-hydration
 * `router.replace` was silently dropped by Next 15.5.18 after next-intl wrote the NEXT_LOCALE
 * cookie (no RSC request). The hard navigation guarantees a fresh document in the chosen locale
 * and a correct `html lang`. Full rationale in LocaleSwitcher.tsx (PP-CORE-CMP-021).
 */
"use client";

import { useLocale } from "next-intl";
import { getPathname, usePathname } from "@/i18n/navigation";
import { useAnalytics } from "@/lib/analytics/useAnalytics";

/**
 * Supported locales paired with their endonym (the language's own name for itself).
 * Labels are intentionally NOT translated so each option is recognizable to its own speakers.
 */
export const LOCALE_OPTIONS = [
  { value: "pt-BR", label: "Português" },
  { value: "en", label: "English" },
  { value: "es", label: "Español" },
  { value: "fr", label: "Français" },
  { value: "de", label: "Deutsch" },
  { value: "nl", label: "Nederlands" },
  { value: "ja", label: "日本語" },
  { value: "ko", label: "한국어" },
  { value: "zh-CN", label: "简体中文" },
  { value: "zh-TW", label: "繁體中文" },
  { value: "vi", label: "Tiếng Việt" },
] as const;

/** Union of the locale codes the switch can target, derived from {@link LOCALE_OPTIONS}. */
export type LocaleValue = (typeof LOCALE_OPTIONS)[number]["value"];

/** What {@link useLocaleSwitch} returns. */
export interface LocaleSwitch {
  /** The active locale (from `useLocale()`). */
  locale: string;
  /** Record `locale_changed` and hard-navigate to the same URL under `nextLocale` [R2]. */
  switchLocale: (nextLocale: LocaleValue) => void;
}

/**
 * The shared locale-switch behavior behind every locale picker. Reads the active locale and
 * current pathname; `switchLocale` tracks and then hard-navigates (see the module header for why
 * a hard navigation).
 */
export function useLocaleSwitch(): LocaleSwitch {
  const locale = useLocale();
  const pathname = usePathname();
  const { track } = useAnalytics();

  const switchLocale = (nextLocale: LocaleValue) => {
    // Record the switch before navigating (the hard navigation unloads this document).
    // PP-ANALYTICS: locale_changed is pushed to the dataLayer right before unload; GTM delivery
    // is best-effort.
    track("locale_changed", { previous_locale: locale, locale: nextLocale });
    // [R2] Hard navigation to the locale-prefixed equivalent of the current URL, preserving
    // search and hash. The full-document request lets the middleware persist NEXT_LOCALE.
    const target =
      getPathname({ href: pathname, locale: nextLocale }) +
      window.location.search +
      window.location.hash;
    // PP-SECURITY: belt-and-suspenders open-redirect guard. `target` is same-origin by
    // construction (locale-prefixed pathname), but assert it before navigating: it must be an
    // absolute path ("/...") and NOT protocol-relative ("//..."). If the invariant breaks, fall
    // back to the locale root rather than navigating to an untrusted, off-origin destination.
    const safeTarget =
      target.startsWith("/") && !target.startsWith("//") ? target : `/${nextLocale}`;
    window.location.assign(safeTarget);
  };

  return { locale, switchLocale };
}
