import { setRequestLocale } from "next-intl/server";
import { PersonalInfoDataLoader } from "@/features/profile/PersonalInfoDataLoader";
import { PersonalInfoScreen } from "@/features/profile/PersonalInfoScreen";
import { loadInvestorProfile } from "@/lib/profile/loadInvestorProfile";
import { isMockMode } from "@/lib/services";

/** PP-PROF-SCR-002 — personal information. Resolves identity via the investor-profile seam (real
 *  `GET /users/:address` in real mode, mock otherwise; POO-222 R7 / POO-233 / POO-426). Real mode
 *  wraps the untouched presentational screen in a client loader that injects the signed-write save
 *  (POO-637); mock mode renders the screen with its default session action. */
export default async function PersonalInfoPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await loadInvestorProfile();
  return isMockMode ? <PersonalInfoScreen user={user} /> : <PersonalInfoDataLoader user={user} />;
}
