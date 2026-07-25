import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { ActiveReserveScreen } from "@/features/aqua/ActiveReserveScreen";
import { PRODUCT_DESCRIPTION, PRODUCT_NAME } from "@/features/aqua/copy";
import { readActiveReserveState } from "@/lib/aqua/api/vaultState";

/**
 * Active Reserve investor page (POO-1067).
 *
 * Server-rendered and uncached on purpose: IDX-R2 says money is read fresh, and a page that
 * served a stale NAV from an ISR cache would be showing a number that is not true on chain.
 * `force-dynamic` costs a round trip per view and buys the only property that matters here.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: PRODUCT_NAME,
  description: PRODUCT_DESCRIPTION,
};

export default async function ActiveReservePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const state = await readActiveReserveState();
  return <ActiveReserveScreen state={state} now={new Date()} />;
}
