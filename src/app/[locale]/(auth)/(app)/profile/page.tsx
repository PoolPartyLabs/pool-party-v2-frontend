import { setRequestLocale } from "next-intl/server";
import { ProfileHubScreen } from "@/features/profile/ProfileHubScreen";
import { loadInvestorProfile } from "@/lib/profile/loadInvestorProfile";

/** PP-PROF-SCR-001 — the Profile menu hub. Resolves identity via the investor-profile seam: the real
 *  pool-party-api read (`GET /users/:address`, wallet from the SIWE session) in real mode, the mock
 *  session profile otherwise (POO-222 R7 / POO-233 / POO-426). The presentational screen is unchanged. */
export default async function ProfilePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  return <ProfileHubScreen user={await loadInvestorProfile()} />;
}
