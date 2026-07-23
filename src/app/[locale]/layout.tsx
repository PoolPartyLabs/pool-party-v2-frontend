import { GoogleTagManager } from "@next/third-parties/google";
import { GeistMono } from "geist/font/mono";
import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { notFound } from "next/navigation";
import Script from "next/script";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { AnalyticsListener } from "@/components/analytics/AnalyticsListener";
import { ConsentBanner } from "@/components/analytics/ConsentBanner";
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
         */}
        <NextIntlClientProvider>
          {children}
          <ConsentBanner />
          <AnalyticsListener />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
