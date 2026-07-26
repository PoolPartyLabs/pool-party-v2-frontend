import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { ActiveReserveScreen } from "@/features/aqua/ActiveReserveScreen";
import { PRODUCT_DESCRIPTION, PRODUCT_NAME } from "@/features/aqua/copy";
import { readActiveReserveState, readAquaPosition } from "@/lib/aqua/api/vaultState";
import { requireFeature } from "@/lib/features/requireFeature";

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
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  // Dark-launched, and the removal seam: with `activeReserve` off this 404s rather than merely
  // being unlinked, so taking the entry out of production is one env var, not a revert.
  requireFeature("activeReserve");

  const state = await readActiveReserveState();
  // The investor's stake is read separately and may be absent: the page renders fully for a
  // visitor with no wallet, and the position card simply does not appear.
  const investor = await searchParams.then((q) => q.investor);
  const position =
    typeof investor === "string" && /^0x[0-9a-fA-F]{40}$/.test(investor)
      ? await readAquaPosition(investor as `0x${string}`)
      : null;

  return <ActiveReserveScreen state={state} now={new Date()} position={position} />;
}
