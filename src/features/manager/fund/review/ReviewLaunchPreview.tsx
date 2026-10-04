/**
 * @id PP-MGR-CMP-080 (POO-2195)
 * @name ReviewLaunchPreview
 * @implements-rules-version v1
 * @analytics-events none: launch steps derive from the existing journey owner.
 */
import { useTranslations } from "next-intl";
import { Card } from "@/components/ui/Card";
import type { LaunchStepPreview } from "../launch/contracts";
export interface ReviewLaunchPreviewProps {
  steps: LaunchStepPreview[];
}
export function ReviewLaunchPreview({ steps }: ReviewLaunchPreviewProps) {
  const t = useTranslations("manager.fundBuilder.review");
  const all = useTranslations("manager");
  const transactions = steps.filter((step) => step.signer === "manager-wallet").length;
  const messages = steps.filter((step) => step.signer === "manager-message").length;
  const networks = [...new Set(steps.map((step) => step.chainId))];
  return (
    <Card className="space-y-3 rounded-[20px] p-4">
      <h3 className="text-sm font-medium">{t("launchPreviewTitle")}</h3>
      <p className="text-xs text-muted-foreground">
        {t("upToSignatures", { count: transactions + messages })}
      </p>
      <p className="text-xs text-muted-foreground">
        {t("signatureKinds", { transactions, messages })}
      </p>
      {networks.map((chainId) => (
        <div key={chainId}>
          <h4 className="text-sm font-medium">
            {all(`fundBuilder.networkNames.${chainId === 42161 ? "arbitrum" : "robinhood"}`)}
          </h4>
          <ol className="mt-2 space-y-1 text-xs text-muted-foreground">
            {steps
              .filter((step) => step.chainId === chainId)
              .map((step) => (
                <li key={step.id}>{all(`fundLaunch.${step.kind}`)}</li>
              ))}
          </ol>
        </div>
      ))}
      {!steps.length && (
        <p className="text-sm text-muted-foreground">{t("launchPreviewBlocked")}</p>
      )}
    </Card>
  );
}
