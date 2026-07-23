import { setRequestLocale } from "next-intl/server";
import { SocialDataLoader } from "@/features/profile/SocialDataLoader";
import { SocialScreen } from "@/features/profile/SocialScreen";
import { loadLinkedAccounts } from "@/lib/profile/fetchLinkedAccounts";
import { isMockMode } from "@/lib/services";

/** PP-PROF-SCR-003 — linked social accounts. Resolves the connected accounts via the linked-accounts
 *  seam (real `GET /users/:address/linked-accounts` in real mode, none in mock; POO-110 / POO-581).
 *  Real mode wraps the untouched presentational screen in a client loader that injects the signed-write
 *  disconnect (POO-637); mock mode renders the screen with no connections and an inert connect. */
export default async function SocialPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const accounts = await loadLinkedAccounts();
  return isMockMode ? (
    <SocialScreen accounts={accounts} />
  ) : (
    <SocialDataLoader accounts={accounts} />
  );
}
