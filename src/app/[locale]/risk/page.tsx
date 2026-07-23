import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { RiskDisclosure } from "@/features/auth/RiskDisclosure";

/**
 * Risk disclosure page (PP-AUTH-SCR-006). English-only legal content served noindex: the page emits
 * `robots: noindex, nofollow` and next.config.ts adds a matching X-Robots-Tag header. Do not disallow
 * this path in robots.txt, or crawlers cannot read the noindex.
 */
export const metadata: Metadata = {
  title: "Risk disclosure",
  robots: { index: false, follow: false },
};

export default async function RiskPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <RiskDisclosure />;
}
