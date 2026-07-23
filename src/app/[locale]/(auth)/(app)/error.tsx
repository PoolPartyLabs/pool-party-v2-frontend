/**
 * @id PP-DASH-SCR-001 (POO-321)
 * @name AppSegmentError
 * @implements-rules-version v2
 *
 * Error boundary for the authenticated (app) segment (Next.js App Router `error.tsx`, client-only).
 * Unlike the [locale] boundary, this renders the ErrorState fallback INSIDE the AppShell chrome
 * (sidebar/header/footer stay), so a failed dashboard load matches the designed sober Home error
 * state: a red alert badge, "Couldn't load your dashboard", a "Try again" retry, and a "Contact
 * support" link to Help [R10]. Reports `app_error_shown` once with the digest only, never
 * `error.message`, which can carry sensitive detail [R11].
 */
"use client";

import { useTranslations } from "next-intl";
import { ErrorState } from "@/components/ui/ErrorState";
import { Link } from "@/i18n/navigation";
import { useTrackView } from "@/lib/analytics/useTrackView";

/** Fallback UI rendered when a render error bubbles to the (app) segment, within the app chrome. */
export default function AppSegmentError({
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
        title={t("dashboard.title")}
        description={t("dashboard.body")}
        onRetry={reset}
        retryLabel={t("retry")}
        secondaryAction={
          <Link
            href="/profile/help"
            className="font-medium text-muted-foreground text-sm transition-colors hover:text-foreground"
          >
            {t("dashboard.support")}
          </Link>
        }
      />
    </div>
  );
}
