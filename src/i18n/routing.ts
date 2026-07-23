import { defineRouting } from "next-intl/routing";
import { defaultLocale, locales } from "./config";

export const routing = defineRouting({
  locales,
  defaultLocale,
  localePrefix: "always",
  // Pick the visitor's language from the browser on first arrival. The middleware matches the
  // `Accept-Language` header against `locales` when an unprefixed path (e.g. `/`) is requested and no
  // `NEXT_LOCALE` cookie exists yet, then redirects to that locale (falling back to `defaultLocale`).
  // An explicit choice via the LocaleSwitcher is written to the cookie and wins on later visits.
  // This is next-intl's default — set explicitly so the browser-detection behaviour is documented.
  localeDetection: true,
});
