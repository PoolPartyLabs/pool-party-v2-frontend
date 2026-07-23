import { getTranslations, setRequestLocale } from "next-intl/server";

/**
 * @id PP-ADM-SCR-006
 * @name Admin 2FA challenge (placeholder)
 * @implements-rules-version v1
 *
 * Second-factor challenge. Rendered OUTSIDE the (console) guard: a session exists but is not yet
 * two-factor-verified. The mechanism + enrollment/verification is owned by pool-party-api (POO-578).
 *
 * PP-INTEGRATION-POINT: the code is posted to pool-party-api, which verifies it against the secret it
 * stores (Neon) and re-mints `pp_admin_session` with `twoFactorVerified=true`. See POO-578.
 */
export default async function AdminTwoFactorPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("admin");

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-lg border border-border bg-surface p-8 text-center">
        <span className="font-bold text-[10px] text-primary uppercase tracking-wide">
          {t("badge")}
        </span>
        <h1 className="mt-2 font-semibold text-foreground text-xl">{t("twoFactor.title")}</h1>
        <p className="mt-2 text-muted-foreground text-sm">{t("twoFactor.subtitle")}</p>
        <p className="mt-6 text-muted-foreground text-xs">{t("twoFactor.comingSoon")}</p>
      </div>
    </main>
  );
}
