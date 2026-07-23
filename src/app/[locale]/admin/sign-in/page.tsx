import { getTranslations, setRequestLocale } from "next-intl/server";

/**
 * @id PP-ADM-SCR-005
 * @name Admin sign-in (placeholder)
 * @implements-rules-version v1
 *
 * Pre-auth Google sign-in for the Admin Console. Rendered OUTSIDE the (console) guard so it is
 * reachable when unauthenticated. The real Google sign-in lands in the admin-auth issue.
 *
 * PP-INTEGRATION-POINT: the button obtains a Google credential and posts it to pool-party-api, which
 * verifies it (Workspace domain `hd=@pool-party.xyz` + email allowlist) and mints the `pp_admin_session`
 * JWT; the frontend never verifies the token itself. If the AWS perimeter proxy fronts the app it may
 * supply the identity at the edge instead (see POO-577). See POO-143.
 */
export default async function AdminSignInPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("admin");

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-lg border border-border bg-surface p-8 text-center">
        <span className="font-bold text-[10px] text-primary uppercase tracking-wide">
          {t("badge")}
        </span>
        <h1 className="mt-2 font-semibold text-foreground text-xl">{t("signIn.title")}</h1>
        <p className="mt-2 text-muted-foreground text-sm">{t("signIn.subtitle")}</p>
        <button
          type="button"
          disabled
          className="mt-6 w-full cursor-not-allowed rounded-md bg-surface-raised px-4 py-2 font-medium text-muted-foreground text-sm"
        >
          {t("signIn.google")}
        </button>
        <p className="mt-3 text-muted-foreground text-xs">{t("signIn.comingSoon")}</p>
      </div>
    </main>
  );
}
