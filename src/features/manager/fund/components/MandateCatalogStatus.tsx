/**
 * @id PP-MGR-CMP-060 (POO-2133)
 * @name MandateCatalogStatus
 * @implements-rules-version v1
 * Honest real catalog loading, failure and stale-draft notices.
 */
"use client";
import { useTranslations } from "next-intl";
import { ErrorState } from "@/components/ui/ErrorState";
import { Skeleton } from "@/components/ui/Skeleton";
import type { MandateCatalog } from "../mandateCatalog";
import type { MandateDraft } from "../mandateDraft";

export interface MandateCatalogStatusProps {
  catalog: MandateCatalog;
  draft: MandateDraft;
}
export function MandateCatalogStatus({ catalog, draft }: MandateCatalogStatusProps) {
  const t = useTranslations("manager");
  if (catalog.dataMode !== "real") return null;
  if (catalog.loading)
    return (
      <div role="status" aria-label={t("fundBuilder.real.loading")}>
        <Skeleton className="h-12 w-full" />
      </div>
    );
  if (catalog.error)
    return (
      <ErrorState
        title={t("fundBuilder.real.error")}
        onRetry={catalog.retry}
        retryLabel={t("fundBuilder.real.retry")}
      />
    );
  if (draft.dataMode !== "real" || draft.catalogVersion !== "v2-catalog-v1")
    return (
      <p role="alert" className="text-destructive text-sm">
        {t("fundBuilder.real.stale")}
      </p>
    );
  return null;
}
