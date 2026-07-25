/**
 * @id PP-CORE-SCR-010 (POO-1046)
 * @name SwapError
 * @implements-rules-version v1
 * @hackathon POO-1022 (Universal Funding)
 *
 * Error boundary for `/swap` (App Router `error.tsx`, client-only). Its own boundary rather than the
 * segment's, because this screen can be mid-route when it fails and the retry has to land back on
 * the swap surface, not on the dashboard's "Couldn't load your dashboard".
 *
 * Never renders `error.message`: it can carry wallet detail, upstream payloads or an API code the
 * user cannot act on. Reports the digest only, exactly as the segment boundary does.
 */
"use client";

import { useTranslations } from "next-intl";
import { ErrorState } from "@/components/ui/ErrorState";
import { useTrackView } from "@/lib/analytics/useTrackView";

export default function SwapError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("errors");
  useTrackView("app_error_shown", { error_code: error.digest });

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <ErrorState
        title={t("somethingWentWrong")}
        description={t("description")}
        onRetry={reset}
        retryLabel={t("retry")}
      />
    </div>
  );
}
