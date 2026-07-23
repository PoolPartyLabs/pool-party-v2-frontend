/**
 * @id PP-CORE (POO-163)
 * @name LocaleError
 * @implements-rules-version v1
 *
 * Route error boundary for the [locale] subtree (Next.js App Router `error.tsx`, client-only). Shows
 * the ErrorState fallback with a retry, and reports `app_error_shown` once. Only the digest (the
 * server-side correlation id) is sent — never `error.message`, which can carry sensitive detail [R3].
 */
"use client";

import { useTranslations } from "next-intl";
import { ErrorState } from "@/components/ui/ErrorState";
import { useTrackView } from "@/lib/analytics/useTrackView";

/** Fallback UI rendered when a render error bubbles to the [locale] segment. */
export default function LocaleError({
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
