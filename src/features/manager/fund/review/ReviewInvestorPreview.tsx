/**
 * @id PP-MGR-CMP-078 (POO-2195)
 * @name ReviewInvestorPreview
 * @implements-rules-version v1
 * @analytics-events none: read-only preview inside ReviewPhase.
 */
import { useLocale, useTranslations } from "next-intl";
import { Card } from "@/components/ui/Card";
import { type ReviewDraft, reviewSchema } from "../launch/review";
import { bpsToPercentText, formatUsdc, parseUsdc } from "./reviewForm";
export interface ReviewInvestorPreviewProps {
  review: ReviewDraft;
}
export function ReviewInvestorPreview({ review }: ReviewInvestorPreviewProps) {
  const t = useTranslations("manager.fundBuilder.review");
  const locale = useLocale();
  const valid = reviewSchema.safeParse(review);
  const value = valid.success ? valid.data : null;
  const minimum = value ? parseUsdc(value.minimum) : null;
  const percent = (bps: number) =>
    `${new Intl.NumberFormat(locale).format(Number(bpsToPercentText(bps)))}%`;
  return (
    <Card className="space-y-3 rounded-[20px] p-4">
      <h3 className="text-sm font-medium">{t("investorPreviewTitle")}</h3>
      {value ? (
        <>
          <h4 className="text-lg font-semibold">{value.name}</h4>
          {value.description && (
            <p className="text-sm text-muted-foreground">{value.description}</p>
          )}
          <dl className="space-y-2 text-sm">
            {[
              { key: "performanceLabel", value: percent(value.performanceFeeBps) },
              { key: "managementLabel", value: percent(value.managementFeeBps) },
              {
                key: "minimumLabel",
                value: minimum === null ? t("unavailable") : `${formatUsdc(minimum, locale)} USDC`,
              },
              { key: "instantLabel", value: percent(value.payoutFeeBps) },
              { key: "accessLabel", value: t("public") },
            ].map((row) => (
              <div key={row.key} className="flex justify-between gap-4">
                <dt className="text-muted-foreground">{t(row.key)}</dt>
                <dd>{row.value}</dd>
              </div>
            ))}
          </dl>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">{t("previewInvalid")}</p>
      )}
      <p className="text-xs text-muted-foreground">{t("identityCaption")}</p>
    </Card>
  );
}
