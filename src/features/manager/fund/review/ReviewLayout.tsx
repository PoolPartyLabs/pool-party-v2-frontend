/**
 * @id PP-MGR-CMP-077
 * @name Shared Review layout
 * @implements-rules-version v1 (POO-2301)
 * @analytics-events none, bindings own their view and field events.
 */
"use client";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
/** One presentation wrapper for the standard and local Review bindings. */
export function ReviewLayout({
  children,
  localVisual = false,
}: {
  children: ReactNode;
  localVisual?: boolean;
}) {
  const t = useTranslations("manager.fundBuilder.review");
  const all = useTranslations("manager");
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">{t("title")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {localVisual ? all("solanaPreview.marketUnavailable") : t("caption")}
        </p>
      </div>
      {children}
    </div>
  );
}
