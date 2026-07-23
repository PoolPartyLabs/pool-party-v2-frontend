import { setRequestLocale } from "next-intl/server";
import { BecomeManagerScreen } from "@/features/manager/BecomeManagerScreen";

/** PP-MGR-SCR-000 — Become a manager onboarding. Ships in v1 (not feature-flagged, murilo 2026-06-11). */
export default async function BecomeManagerPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <div className="flex flex-col gap-6">
      <BecomeManagerScreen />
    </div>
  );
}
