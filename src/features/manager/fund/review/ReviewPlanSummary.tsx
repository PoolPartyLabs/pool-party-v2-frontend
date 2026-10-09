/**
 * @id PP-MGR-CMP-079 (POO-2195)
 * @name ReviewPlanSummary
 * @implements-rules-version v1
 * @implements-rules-version v1 (POO-2301 shared local runtime extension)
 * @analytics-events none: derived mandate and applied Build summaries.
 */
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { planOf } from "../build/plan/buildPlan";
import type { MandateDraft } from "../mandateDraft";
export interface ReviewPlanSummaryProps {
  draft: MandateDraft;
  onEditMandate: () => void;
  onEditBuild: () => void;
}
export function ReviewPlanSummary({ draft, onEditMandate, onEditBuild }: ReviewPlanSummaryProps) {
  const t = useTranslations("manager.fundBuilder.review");
  const all = useTranslations("manager");
  const locale = useLocale();
  const number = new Intl.NumberFormat(locale);
  const plan = planOf(draft);
  const positions = [...plan.hub.chains, ...plan.spokes.flatMap((spoke) => spoke.chains)]
    .flatMap((chain) => chain.steps)
    .filter((step) => step.family === "position");
  return (
    <Card className="space-y-4 rounded-[20px] p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">{t("mandateSummary")}</h3>
        <Button variant="ghost" size="sm" onClick={onEditMandate}>
          {t("editMandate")}
        </Button>
      </div>

      <p className="text-sm">
        {draft.networks.map((network) => all(`fundBuilder.networkNames.${network}`)).join(", ")}
      </p>
      <p className="text-xs text-muted-foreground">
        {t("selectionSummary", {
          tokens: number.format(draft.tokens.length),
          pools: number.format(draft.pools.length),
          protocols: number.format(draft.protocols.length),
        })}
      </p>
      <p className="text-sm">
        {draft.protocols
          .map(
            (protocol) =>
              (
                ({
                  "uniswap-v3-swap": all("fundBuilder.protocolNames.uniswapV3Swap"),
                  "uniswap-v3": all("fundBuilder.protocolNames.uniswapV3"),
                  "uniswap-v4": all("fundBuilder.protocolNames.uniswapV4"),
                  "aave-v3": all("fundBuilder.protocolNames.aaveV3"),
                  across: all("fundBuilder.protocolNames.across"),
                  gmx: all("fundBuilder.protocolNames.gmx"),
                  pendle: all("fundBuilder.protocolNames.pendle"),
                  kamino: all("solanaPreview.protocols.kamino"),
                  jupiter: all("solanaPreview.protocols.jupiter"),
                  raydium: all("solanaPreview.protocols.raydium"),
                  orca: all("solanaPreview.protocols.orca"),
                }) as const
              )[protocol],
          )
          .join(", ")}
      </p>
      <div className="flex items-center justify-between border-t border-border pt-4">
        <h3 className="text-sm font-medium">{t("buildSummary")}</h3>
        <Button variant="ghost" size="sm" onClick={onEditBuild}>
          {t("editBuild")}
        </Button>
      </div>
      <p className="text-sm">{t("positionCount", { count: positions.length })}</p>
      <p className="text-xs text-muted-foreground">{t("allocationIntent")}</p>
      <div className="space-y-2 border-t border-border pt-4 text-xs">
        <h4 className="font-medium">{t("fixedTitle")}</h4>
        <p className="text-muted-foreground">{t("fixedSummary")}</p>
        <h4 className="font-medium">{t("decreaseTitle")}</h4>
        <p className="text-muted-foreground">{t("decreaseSummary")}</p>
      </div>
    </Card>
  );
}
