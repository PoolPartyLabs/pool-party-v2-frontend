import { getTranslations, setRequestLocale } from "next-intl/server";
import {
  type ModerationImageRow,
  ModerationQueue,
} from "@/features/admin/components/ModerationQueue";
import { adminCanLive } from "@/lib/admin/authz";
import { resolveAdminSession } from "@/lib/admin/session";
import { moderationService } from "@/lib/services";

/**
 * @id PP-ADM-SCR-004
 * @name Moderation · Images queue
 * @implements-rules-version v1
 *
 * Post-publication moderation of uploaded images (POO-590): lists `pending` images and drives Approve
 * (confirm) / Remove (soft-hide, confirm + optional reason) via server actions that re-check the
 * session + capability. Data via the moderation service (mock today; real = pool-party-api via
 * apiFetch, never the DB; real image URLs from the hosting backend, POO-580).
 */
export default async function AdminModerationImagesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("admin");

  const session = await resolveAdminSession();
  const queue = await moderationService.listQueue();
  const items: ModerationImageRow[] = queue.map((image) => ({
    id: image.id,
    kind: image.kind,
    subjectName: image.subjectName,
    subjectId: image.subjectId,
    uploaded: image.uploadedAt.slice(0, 10),
    imageUrl: image.imageUrl,
  }));
  const canApprove = await adminCanLive(session, "image.approve");
  const canRemove = await adminCanLive(session, "image.remove");

  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <h1 className="font-semibold text-foreground text-xl">{t("moderation.title")}</h1>
        <p className="text-muted-foreground text-sm">{t("moderation.subtitle")}</p>
      </header>
      <ModerationQueue items={items} canApprove={canApprove} canRemove={canRemove} />
    </section>
  );
}
