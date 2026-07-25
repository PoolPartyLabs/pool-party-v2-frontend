import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { ActiveReserveScreen } from "@/features/aqua/ActiveReserveScreen";
import type { ActiveReserveState } from "@/lib/aqua/api/vaultState";

/**
 * Dev-only preview of the Active Reserve page in its LIVE state (POO-1067).
 *
 * The real page at `/active-reserve` reads Arbitrum, so before the vault is deployed it can
 * only ever render the honest "not deployed yet" state. That leaves the layout that the demo
 * actually shows, the one with NAV, sleeves, a band positioned against spot and a fills feed,
 * unreviewable until the moment it matters. This route renders that layout from fixtures so
 * it can be checked, and corrected, before launch rather than on stage.
 *
 * The fixture is clearly synthetic and this route 404s in production, so there is no path by
 * which these numbers reach an investor. Nothing here feeds the real page.
 */
const FIXTURE: ActiveReserveState = {
  status: "live",
  vault: "0x00000000000000000000000000000000000000A1",
  adapter: "0x00000000000000000000000000000000000000B2",
  price: { ethUsdE8: "186654000000", ageSeconds: 118, stale: false },
  sleeves: {
    hotBufferUsdc: "10000000",
    parkedUsdc: "190000000",
    acquiredWeth: "510000000000000000",
  },
  nav: {
    totalAssetsUsdc: "1151936433",
    wethValuedUsdc: "951936433",
    totalShares: "200000000000",
  },
  bands: [
    {
      strategyHash: `0x${"aa".repeat(32)}`,
      mandate: "production",
      lowE8: "158655900000",
      highE8: "177321300000",
      spotAtShipE8: "186654000000",
      committedUsdc: "60000000",
      acquiredWeth: "0",
      epoch: 0,
      deadline: String(Math.floor(Date.UTC(2026, 6, 28, 16, 0, 0) / 1000)),
      shipTxHash: `0x${"cc".repeat(32)}`,
      active: true,
    },
    {
      strategyHash: `0x${"bb".repeat(32)}`,
      mandate: "demo",
      lowE8: "186094000000",
      highE8: "186467000000",
      spotAtShipE8: "186654000000",
      committedUsdc: "40000000",
      acquiredWeth: "510000000000000000",
      epoch: 1,
      deadline: String(Math.floor(Date.UTC(2026, 6, 28, 16, 0, 0) / 1000)),
      shipTxHash: `0x${"ff".repeat(32)}`,
      active: true,
    },
  ],
  fills: [
    {
      txHash: `0x${"dd".repeat(32)}`,
      when: "2026-07-25T11:04:12.000Z",
      mandate: "demo",
      amountIn: "500000000000000000",
      amountOut: "924433668",
      jitUnparked: true,
    },
    {
      txHash: `0x${"ee".repeat(32)}`,
      when: "2026-07-25T10:58:31.000Z",
      mandate: "demo",
      amountIn: "10000000000000000",
      amountOut: "18497409",
      jitUnparked: false,
    },
  ],
};

export default async function ActiveReserveDevPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  if (process.env.NODE_ENV === "production") notFound();
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <>
      <p className="bg-primary/10 px-4 py-2 text-center text-sm font-medium">
        Dev preview. Every number below is fixture data, not chain state.
      </p>
      <ActiveReserveScreen state={FIXTURE} now={new Date("2026-07-25T16:00:00Z")} />
    </>
  );
}
