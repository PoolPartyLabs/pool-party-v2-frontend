import { getTranslations, setRequestLocale } from "next-intl/server";
import {
  ManagerVerificationQueue,
  type VerificationQueueRow,
} from "@/features/admin/components/ManagerVerificationQueue";
import { adminCanLive } from "@/lib/admin/authz";
import { resolveAdminSession } from "@/lib/admin/session";
import { verificationService } from "@/lib/services";

/**
 * @id PP-ADM-SCR-002
 * @name Operations · Managers verification queue
 * @implements-rules-version v1
 *
 * Lists managers with a `pending` verification request and drives Approve / Reject (POO-587). The
 * pending list comes from the verification service (mock today; real = pool-party-api via apiFetch,
 * never the DB). Approve/reject run in server actions that re-check the session + capability; Reject
 * renders only when the session holds `verification.reject` (admin/master).
 */
const usdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export default async function AdminManagersPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("admin");

  const session = await resolveAdminSession();
  const pending = await verificationService.listPending();
  const rows: VerificationQueueRow[] = pending.map((request) => ({
    handle: request.managerHandle,
    name: request.managerName,
    submitted: request.submittedAt.slice(0, 10),
    aum: usdFormatter.format(request.aum),
    strategyCount: request.strategyCount,
  }));
  const canReject = await adminCanLive(session, "verification.reject");

  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <h1 className="font-semibold text-foreground text-xl">{t("managers.title")}</h1>
        <p className="text-muted-foreground text-sm">{t("managers.subtitle")}</p>
      </header>
      <ManagerVerificationQueue rows={rows} canReject={canReject} />
    </section>
  );
}
