import { setRequestLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";

/**
 * PP-MGR-SCR-005 — Manager live position (operate), rewired (POO-519).
 *
 * The console manage view (/manager?manage=<id>) is the single manager surface for operating a
 * strategy, so this route now just redirects there (locale-preserving via the i18n-aware redirect).
 * Unknown ids are handled by the console itself (it ignores a ?manage id the manager does not own).
 */
export default async function ManagerPositionPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  // [R1] Locale-preserving redirect to the console manage view for this strategy.
  redirect({ href: { pathname: "/manager", query: { manage: id } }, locale });
}
