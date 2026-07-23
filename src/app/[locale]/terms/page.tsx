import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { TermsOfService } from "@/features/auth/TermsOfService";

/**
 * Terms of Service page (PP-AUTH-SCR-008). English-only legal content served noindex: the page emits
 * `robots: noindex, nofollow` and next.config.ts adds a matching X-Robots-Tag header. Do not disallow
 * this path in robots.txt, or crawlers cannot read the noindex.
 */
export const metadata: Metadata = {
  title: "Terms of Service",
  robots: { index: false, follow: false },
};

export default async function TermsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <TermsOfService />;
}
