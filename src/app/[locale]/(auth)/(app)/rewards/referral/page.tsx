import { setRequestLocale } from "next-intl/server";
import { ReferralScreen } from "@/features/rewards/ReferralScreen";
import { loadReferralProgram } from "@/lib/rewards/loadReferralProgram";

/** PP-REW-SCR-003 — Referral / invite-and-earn. */
export default async function ReferralPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  // POO-661: the resolver serves the mock program in mock mode and real pp-api `/referral/:wallet` data
  // (wallet from the SIWE session) in real mode; the client surfaces refresh via `useReferral`.
  const data = await loadReferralProgram();

  return <ReferralScreen data={data} />;
}
