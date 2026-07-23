import { getTranslations, setRequestLocale } from "next-intl/server";
import { moderationService, verificationService } from "@/lib/services";

/**
 * @id PP-ADM-SCR-001
 * @name Admin Overview
 * @implements-rules-version v1
 *
 * Operational snapshot for the Admin Console. The pending-verification tile is live (POO-587); the
 * remaining tiles render placeholders until wired in POO-146.
 *
 * PP-INTEGRATION-POINT: operational counts ← pool-party-api admin endpoints via `apiFetch` (verification
 * + moderation queues, managers, strategies, users); the frontend never reads the database directly.
 * See POO-146.
 */
export default async function AdminOverviewPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("admin");

  // Live operational counts (POO-587 verifications, POO-590 images); other tiles wire in POO-146.
  const [pendingVerifications, pendingImages] = await Promise.all([
    verificationService.listPending(),
    moderationService.listQueue(),
  ]);

  const tiles = [
    { label: t("overview.pendingVerifications"), value: String(pendingVerifications.length) },
    { label: t("overview.pendingImages"), value: String(pendingImages.length) },
    { label: t("overview.verifiedManagers"), value: "—" },
    { label: t("overview.activeStrategies"), value: "—" },
    { label: t("overview.users"), value: "—" },
  ];

  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <h1 className="font-semibold text-foreground text-xl">{t("overview.title")}</h1>
        <p className="text-muted-foreground text-sm">{t("overview.subtitle")}</p>
      </header>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {tiles.map((tile) => (
          <div key={tile.label} className="rounded-lg border border-border bg-surface p-4">
            <p className="text-muted-foreground text-xs">{tile.label}</p>
            <p className="mt-2 font-semibold text-2xl tabular-nums">{tile.value}</p>
          </div>
        ))}
      </div>
      <p className="text-muted-foreground text-xs">{t("overview.placeholder")}</p>
    </section>
  );
}
