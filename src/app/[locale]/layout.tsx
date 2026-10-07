import { GoogleTagManager } from "@next/third-parties/google";
import { GeistMono } from "geist/font/mono";
import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { notFound } from "next/navigation";
import Script from "next/script";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { AnalyticsListener } from "@/components/analytics/AnalyticsListener";
import { ConsentBanner } from "@/components/analytics/ConsentBanner";
import { Toaster } from "@/components/ui/Toast";
import { routing } from "@/i18n/routing";
import { CONSENT_DEFAULT_SNIPPET } from "@/lib/analytics/consentSnippet";
import "../globals.css";

// Fonts are self-hosted so `next build` has NO Google Fonts network dependency (POO-230) — the
// previous build-time fetch from Google Fonts was flaking CI on merge to main.
// Poppins is the Pool Party brand typeface; it backs the `--font-sans` token (see globals.css). The
// latin woff2 (weights matching the prior setup) live in ./fonts/poppins under the OFL license.
const poppins = localFont({
  variable: "--font-poppins",
  display: "swap",
  src: [
    { path: "../fonts/poppins/poppins-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "../fonts/poppins/poppins-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "../fonts/poppins/poppins-latin-600-normal.woff2", weight: "600", style: "normal" },
    { path: "../fonts/poppins/poppins-latin-700-normal.woff2", weight: "700", style: "normal" },
  ],
});
// Geist Mono (monospace: addresses, code, tabular figures) comes from the official `geist` package —
// self-hosted, exposing the same `--font-geist-mono` var. Applied below via `GeistMono.variable`.

const gtmId = process.env.NEXT_PUBLIC_GTM_ID;

/**
 * POO-2173 review F1: where toasts sit relative to the rest of the page chrome.
 *
 * Bottom offset. Desktop keeps the position the Toast primitive was designed with, bottom-right at
 * sonner's own 24px offset, which is the fallback of the variable below. Below `lg` the shell shows
 * its fixed bottom tab bar (`AppShell`, `lg:hidden`), and a toast at 24px would sit on top of it, so
 * `max-lg` defines `--pp-toast-bottom` as the spacing step `AppFooter` reserves under the page for
 * that bar (`pb-24`). The shell has no tab-bar height token; that step is the one number it owns for
 * "clear the bar", and `layout.test.tsx` fails if the two drift apart. The offset goes through both
 * `offset` and `mobileOffset`: sonner switches to the latter at 600px, but the bar is shown up to
 * 1024px, so the breakpoint lives in the class, not in the library.
 * PP-NOTE: not seen in a browser yet.
 */
const TOASTER_BOTTOM_OFFSET = "var(--pp-toast-bottom, 24px)";
const TOASTER_CLASS_NAME = "max-lg:[--pp-toast-bottom:calc(var(--spacing)*24)]";

/**
 * Stacking. sonner ships `z-index: 999999999`, which put a toast over the consent banner. The app's
 * own scale is: mobile tab bar 40, dialogs / sheets / consent banner 50. A toast at 45 clears the tab
 * bar and stays under the banner, which must remain answerable. Inline style, because sonner's rule
 * is unlayered and a utility class would lose to it.
 */
const TOASTER_Z_INDEX = 45;

export const metadata: Metadata = {
  title: "Pool Party",
  description: "On-chain asset management, made simple.",
};

// POO-848 R1: maximumScale is kept permissive (5x) to preserve pinch-zoom (WCAG 1.4.4 / 1.4.10);
// the focus-zoom fix is the 16px mobile input fonts (R2/R3), not a scale lock, and iOS Safari
// ignores maximum-scale anyway.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  // POO-2287 rules v1: announce native dark controls before the stylesheet loads.
  colorScheme: "dark",
};

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }
  setRequestLocale(locale);
  // POO-2173 review F2: sonner's live region is announced to screen readers; name it in the page language.
  const tShell = await getTranslations({ locale, namespace: "shell" });

  return (
    <html lang={locale}>
      <body className={`${poppins.variable} ${GeistMono.variable} antialiased`}>
        {gtmId ? (
          <Script id="pp-consent-default" strategy="beforeInteractive">
            {CONSENT_DEFAULT_SNIPPET}
          </Script>
        ) : null}
        {gtmId ? <GoogleTagManager gtmId={gtmId} /> : null}
        {/*
         * The wallet provider tree is NOT mounted here. It lives in the `(auth)` route-group layout
         * so pure-public routes (privacy / terms / risk / learn) never ship or hydrate the
         * Privy/wagmi/viem bundle (POO-491). `AnalyticsIdentify` moved there too (it needs a mounted
         * WagmiProvider). `ConsentBanner` + `AnalyticsListener` are wallet-free and stay global so
         * consent + pageview tracking still run on every route.
         *
         * POO-2173: `Toaster` is the render target of the imperative `toast(...)` API (fund builder
         * "Draft saved", strategy manage view, drafts list). It was never mounted, so every toast was
         * silently dropped. It is mounted ONCE, here, because a toast can be raised from any route and
         * a second Toaster would draw every toast twice. It needs no provider and is wallet-free, so
         * it stays out of the `(auth)` tree. sonner injects its own `<style>` at runtime, which the
         * existing `style-src 'unsafe-inline'` allows; there is no nonce to forward.
         */}
        <NextIntlClientProvider>
          {children}
          <ConsentBanner />
          <AnalyticsListener />
          <Toaster
            containerAriaLabel={tShell("toaster.ariaLabel")}
            className={TOASTER_CLASS_NAME}
            offset={{ bottom: TOASTER_BOTTOM_OFFSET }}
            mobileOffset={{ bottom: TOASTER_BOTTOM_OFFSET }}
            style={{ zIndex: TOASTER_Z_INDEX }}
          />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
