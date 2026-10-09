/**
 * @id PP-MGR-CMP-087
 * @name AuxiliaryBlockPanel
 * @implements-rules-version v1 (POO-2237)
 * @implements-rules-version v1 (POO-2301 shared local runtime extension)
 * @analytics-events none emitted here; usePanelDraft owns applied/discarded/blocked outcomes.
 *
 * Configure manual Swap tokens and whole-strategy spoke allocation using the shared draft.
 * Token choices do not create executable swap routes; Review retains its unsupported-swap gate.
 */
"use client";
import { useTranslations } from "next-intl";
import { useId } from "react";
import { Button } from "@/components/ui/Button";
import { normalizeTokenIdentity, tokenKey } from "../../mandateDraft";
import { SolanaJupiterInspector } from "../../solana-preview/SolanaHoldingPresenter";
import type { MenuContext } from "../blocks/menuModels";
import type { MandateEditStep } from "../blocks/useBuildCanvas";
import {
  isManualSwapConfig,
  manualSwapTokens,
  spokeAllocationBounds,
  validManualSwapConfig,
} from "../plan/auxiliaryConfig";
import { BLOCK_DEFAULT_SLIPPAGE_PCT } from "../plan/blockConfig";
import { AllocationSlider } from "./AllocationSlider";
import { FundSlippageControl } from "./FundSlippageControl";
import { PanelSelect } from "./PanelSelect";
import { PanelStatusRow } from "./PanelStatusRow";
import { usePanelCopy } from "./panelCopy";
import { PANEL_LINK } from "./panelStyles";
import type { PanelDraftTarget, UsePanelDraftResult } from "./usePanelDraft";
export interface AuxiliaryBlockPanelProps {
  target: PanelDraftTarget;
  panel: UsePanelDraftResult;
  ctx: MenuContext;
  onEditMandate(step: MandateEditStep): void;
  onRemoveRequest(): void;
}
export function AuxiliaryBlockPanel({
  target,
  panel,
  ctx,
  onEditMandate,
  onRemoveRequest,
}: AuxiliaryBlockPanelProps) {
  const t = useTranslations("manager.fundBuilder.canvas.panel.auxiliary");
  const solana = useTranslations("manager.solanaPreview");
  const copy = usePanelCopy();
  const inputId = useId();
  const outputId = useId();
  const swap = target.kind === "swap";
  const jupiter = swap && target.network === "solana" && ctx.draft.runtime === "solana-local";
  const config = isManualSwapConfig(panel.draft?.config)
    ? panel.draft.config
    : { tokenInKey: "", tokenOutKey: "", slippagePct: BLOCK_DEFAULT_SLIPPAGE_PCT };
  const tokens = manualSwapTokens(ctx.draft, target.network);
  const options = tokens.map((token) => ({
    id: tokenKey(token),
    label: token.symbol,
    logos: [
      {
        symbol: token.symbol,
        network: token.network,
        ...(jupiter && token.logoUrl ? { logoUrl: token.logoUrl } : {}),
      },
    ],
  }));
  const bounds = spokeAllocationBounds(ctx.plan, ctx.draft, target.network);
  const share = panel.draft?.sharePct ?? 0;
  const valid = swap
    ? validManualSwapConfig(config, ctx.draft, target.network)
    : Number.isFinite(share) && share >= bounds.min && share <= bounds.max;
  const note = panel.refusal
    ? {
        tone: "refused" as const,
        text:
          panel.refusal === "share_exceeds_parent"
            ? copy.refused.shareExceedsParent
            : copy.refused.notInMandate,
      }
    : panel.dirty && !valid
      ? { tone: "hold" as const, text: swap ? t("invalidPair") : copy.refused.shareExceedsParent }
      : null;

  return (
    <div data-block-panel={target.kind} className="flex flex-col gap-4">
      <div>
        <p className="font-semibold text-base text-foreground">
          {jupiter ? solana("holding.jupiter") : swap ? t("swap") : t("spoke")}
        </p>
        <p className="text-muted-foreground text-xs">{ctx.copy.networkName(target.network)}</p>
      </div>
      <div data-panel-fields="" className="flex flex-col gap-4">
        {swap ? (
          <>
            <div className="flex flex-col gap-2">
              <span id={inputId} className="text-foreground text-sm">
                {t("tokenIn")}
              </span>
              <PanelSelect
                labelId={inputId}
                options={options.filter(
                  (option) =>
                    option.id !== normalizeTokenIdentity(target.network, config.tokenOutKey),
                )}
                value={config.tokenInKey || null}
                idComparison={jupiter ? "exact" : "case-insensitive"}
                onChange={(tokenInKey) => panel.setConfig({ ...config, tokenInKey })}
              />
            </div>
            <div className="flex flex-col gap-2">
              <span id={outputId} className="text-foreground text-sm">
                {t("tokenOut")}
              </span>
              <PanelSelect
                labelId={outputId}
                options={options.filter(
                  (option) =>
                    option.id !== normalizeTokenIdentity(target.network, config.tokenInKey),
                )}
                value={config.tokenOutKey || null}
                idComparison={jupiter ? "exact" : "case-insensitive"}
                onChange={(tokenOutKey) => panel.setConfig({ ...config, tokenOutKey })}
              />
            </div>
            {tokens.length < 2 ? (
              <p className="text-muted-foreground text-xs">{t("empty")}</p>
            ) : null}
            <button type="button" className={PANEL_LINK} onClick={() => onEditMandate("tokens")}>
              {copy.link.tokens}
            </button>
            <FundSlippageControl
              value={config.slippagePct}
              onChange={(slippagePct) => panel.setConfig({ ...config, slippagePct })}
              copy={{ ...copy.slippage, helpLabel: copy.moreAbout(copy.slippage.label) }}
            />
            {jupiter ? (
              <SolanaJupiterInspector
                intent={null}
                quote={null}
                clock={{ now: null, blockHeight: null }}
              />
            ) : null}
          </>
        ) : (
          <>
            <AllocationSlider
              value={share}
              ceiling={bounds.max}
              minimum={bounds.min}
              onChange={(value) => {
                if (bounds.min <= bounds.max)
                  panel.setShare(Math.max(bounds.min, Math.min(bounds.max, value)));
              }}
              copy={{
                label: copy.allocation.label,
                help: copy.allocation.help,
                helpLabel: copy.moreAbout(copy.allocation.label),
              }}
              ceilingSentence={copy.refused.shareExceedsParent}
              ceilingLink={null}
            />
            <p className="text-muted-foreground text-xs tabular-nums">
              {t("bounds", { min: bounds.min, max: bounds.max })}
            </p>
            <button type="button" className={PANEL_LINK} onClick={() => onEditMandate("limits")}>
              {copy.link.limits}
            </button>
          </>
        )}
      </div>
      <PanelStatusRow
        status={panel.leaveBlocked ? "leaveBlocked" : panel.dirty ? "pending" : "applied"}
        copy={{
          ...copy.status,
          leaveTitle: copy.leave.title,
          leaveBody: copy.leave.body,
          leaveDiscard: copy.leave.discard,
        }}
        onDiscard={panel.discard}
        attempt={panel.leaveAttempt}
        note={note}
      />
      <Button
        variant="primary"
        className="w-full"
        disabled={!panel.dirty || !valid}
        onClick={() => panel.apply()}
      >
        {copy.apply}
      </Button>
      {swap ||
      ctx.plan.spokes.find((spoke) => spoke.network === target.network)?.chains.length === 0 ? (
        <button
          type="button"
          className="self-center rounded-sm text-destructive text-sm hover:underline focus-visible:ring-2 focus-visible:ring-ring"
          onClick={onRemoveRequest}
        >
          {ctx.copy.panel.remove}
        </button>
      ) : null}
    </div>
  );
}
