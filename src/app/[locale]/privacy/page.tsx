import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { PrivacyPolicy } from "@/features/auth/PrivacyPolicy";

/**
 * Privacy Policy page (PP-AUTH-SCR-007). English-only legal content served noindex: the page emits
 * `robots: noindex, nofollow` and next.config.ts adds a matching X-Robots-Tag header. Do not disallow
 * this path in robots.txt, or crawlers cannot read the noindex.
 */
export const metadata: Metadata = {
  title: "Privacy Policy",
  robots: { index: false, follow: false },
};

export default async function PrivacyPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <PrivacyPolicy />;
}
