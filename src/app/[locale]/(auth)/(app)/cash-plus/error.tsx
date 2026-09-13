/** @id PP-CP-SCR-001 @name Cash+ route error @implements-rules-version v1 */
"use client";
import { useTranslations } from "next-intl";
import { ErrorState } from "@/components/ui/ErrorState";
export default function CashPlusError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("cashPlus");
  return (
    <ErrorState
      title={t("errorTitle")}
      description={t("errorBody")}
      retryLabel={t("refresh")}
      onRetry={reset}
    />
  );
}
