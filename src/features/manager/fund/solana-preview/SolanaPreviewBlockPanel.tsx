/**
 * @id PP-MGR-CMP-089
 * @name SolanaPreviewBlockPanel
 * @description Local pair/allocation editing with explicit unavailable market fields.
 * @figma https://www.figma.com/design/jjOf5DL9uVEB7WBR9nGb4A?node-id=8359-3089
 * @linear https://linear.app/yeildbay/issue/POO-2281
 * @i18n-namespace manager.solanaPreview
 * @implements-rules-version v2 (POO-2281), v1 (POO-2290/2291)
 * @analytics-events none, form intent is owned by PP-MGR-SCR-009.
 */
"use client";

import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useId, useRef } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { ManageLendingRiskSection } from "../manage/ManageLendingRiskSection";
import {
  isLiquidityBlock,
  type PreviewBlock,
  type PreviewEdit,
  type PreviewError,
  type PreviewPair,
  parseAllocation,
} from "./previewModel";
import { PreviewLogo } from "./SolanaPreviewCanvas";
import { SolanaRangePresenter } from "./SolanaRangePresenter";
import type { SolanaRangeContext, SolanaRangeDraft } from "./solanaRangeModel";

export interface SolanaPreviewBlockPanelProps {
  block: PreviewBlock;
  edit: PreviewEdit;
  error: PreviewError | null;
  applied: boolean;
  onEdit(value: Partial<PreviewEdit>): void;
  onApply(): void;
  onDiscard(): void;
  onClose(): void;
  onUnavailable(): void;
  /** A verified protocol snapshot/draft supplied by the host. No live context exists by default. */
  rangeContext?: SolanaRangeContext | null;
  rangeDraft?: SolanaRangeDraft | null;
  onRangeChange?(range: SolanaRangeDraft): void;
}

/** Static drawing choices and unavailable market fields, never pool discovery or transaction input. */
export function SolanaPreviewBlockPanel({
  block,
  edit,
  error,
  applied,
  onEdit,
  onApply,
  onDiscard,
  onClose,
  onUnavailable,
  rangeContext = null,
  rangeDraft = null,
  onRangeChange,
}: SolanaPreviewBlockPanelProps) {
  const t = useTranslations("manager");
  const protocolNames = {
    kamino: t("solanaPreview.protocols.kamino"),
    jupiter: t("solanaPreview.protocols.jupiter"),
    raydium: t("solanaPreview.protocols.raydium"),
    orca: t("solanaPreview.protocols.orca"),
  };
  const headingRef = useRef<HTMLHeadingElement>(null);
  const rangeId = useId();
  useEffect(() => {
    const frame = requestAnimationFrame(() => headingRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, []);
  const lp = isLiquidityBlock(block.protocol);
  const showRange = lp && (parseAllocation(edit.allocation) ?? 0) > 0;
  const verifiedRange = rangeContext?.protocol === block.protocol ? rangeContext : null;
  const fields =
    block.protocol === "kamino"
      ? [
          t("solanaPreview.supplyApy"),
          t("solanaPreview.availableLiquidity"),
          t("solanaPreview.depositCapacity"),
        ]
      : block.protocol === "jupiter"
        ? [
            t("solanaPreview.expectedOutput"),
            t("solanaPreview.minimumReceived"),
            t("solanaPreview.route"),
            t("solanaPreview.swapSlippage"),
          ]
        : [
            t("solanaPreview.pool"),
            t("solanaPreview.price"),
            t("solanaPreview.feeModel"),
            t("solanaPreview.liquidityTolerance"),
          ];
  return (
    <aside
      aria-labelledby="solana-preview-configure"
      className="min-w-0 rounded-[20px] border border-border bg-surface p-4"
    >
      <div className="mb-5 flex items-center gap-3">
        <PreviewLogo protocol={block.protocol} className="size-7" />
        <div className="min-w-0 flex-1">
          <h2
            id="solana-preview-configure"
            tabIndex={-1}
            ref={headingRef}
            className="font-semibold text-base outline-none"
          >
            {t("solanaPreview.configure")}
          </h2>
          <p className="text-muted-foreground text-sm">{protocolNames[block.protocol]}</p>
        </div>
        <span className="flex shrink-0 items-center gap-1 text-muted-foreground text-xs">
          <PreviewLogo protocol="solana" className="size-3" />
          Solana
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="size-8 shrink-0 p-0"
          aria-label={t("solanaPreview.closePanel")}
          onClick={onClose}
        >
          <X className="size-4" aria-hidden="true" />
        </Button>
      </div>
      <p className="mb-5 text-muted-foreground text-xs">{t("solanaPreview.drawingChoice")}</p>
      {lp ? (
        <p className="mb-4 text-muted-foreground text-xs">{t("solanaPreview.wsSolDrawing")}</p>
      ) : null}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onApply();
        }}
        className="space-y-5"
      >
        <Input
          label={t("solanaPreview.allocation")}
          inputMode="numeric"
          autoComplete="off"
          value={edit.allocation}
          onChange={(event) => onEdit({ allocation: event.target.value })}
          error={
            error === "allocation_invalid"
              ? t("solanaPreview.allocationInvalid")
              : error === "allocation_total"
                ? t("solanaPreview.allocationExceeded")
                : undefined
          }
        />
        {block.protocol === "kamino" ? (
          <div>
            <span className="text-muted-foreground text-xs">{t("solanaPreview.reserve")}</span>
            <p className="mt-1 text-sm">{t("solanaPreview.supplyUsdc")}</p>
          </div>
        ) : (
          <label className="block space-y-2">
            <span className="text-sm">
              {t(lp ? "solanaPreview.pair" : "solanaPreview.conversion")}
            </span>
            <select
              value={edit.pair}
              onChange={(event) => onEdit({ pair: event.target.value as PreviewPair })}
              className="h-10 w-full rounded-md border border-border bg-surface px-3 text-base text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-sm"
            >
              <option value="SOL / USDC">{lp ? "SOL / USDC" : "SOL → USDC"}</option>
              <option value="USDC / SOL">{lp ? "USDC / SOL" : "USDC → SOL"}</option>
            </select>
          </label>
        )}
        <dl className="space-y-3 border-t border-border pt-4">
          {fields.map((field) => (
            <div key={field} className="flex items-start justify-between gap-4 text-xs">
              <dt className="text-muted-foreground">{field}</dt>
              <dd className="text-right">{t("solanaPreview.marketUnavailable")}</dd>
            </div>
          ))}
        </dl>
        {showRange ? (
          <section aria-labelledby={rangeId} className="min-w-0 border-t border-border pt-4">
            <h3 id={rangeId} className="mb-2 font-medium text-sm">
              {t("solanaPreview.range")}
            </h3>
            {/* PP-INTEGRATION-POINT: POO-2240/2261 require same-snapshot pool/program/mint/grid evidence; no example prices or default ticks fill a missing context. */}
            <SolanaRangePresenter
              context={verifiedRange}
              range={rangeDraft}
              onChange={(range) => onRangeChange?.(range)}
              onInvalid={() => onUnavailable()}
              readOnly={!onRangeChange}
            />
          </section>
        ) : null}
        {block.protocol === "kamino" ? (
          <>
            {/* PP-INTEGRATION-POINT: POO-2290/2240 require a full verified Kamino obligation; a local Supply drawing does not prove no debt. */}
            <ManageLendingRiskSection
              origin={{ identity: null, preview: null }}
              current={{ status: "unavailable", snapshot: null }}
              after={{ status: "unavailable", snapshot: null }}
            />
            <p className="text-muted-foreground text-xs">{t("solanaPreview.withdrawals")}</p>
          </>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="primary" className="flex-1">
            {t("solanaPreview.apply")}
          </Button>
          <Button variant="ghost" type="button" onClick={onDiscard}>
            {t("solanaPreview.discard")}
          </Button>
        </div>
        {applied ? (
          <p role="status" className="text-success text-xs">
            {t("solanaPreview.localApplied")}
          </p>
        ) : null}
      </form>
      <button
        type="button"
        onClick={onUnavailable}
        className="mt-5 flex w-full items-center justify-between gap-3 rounded-lg border border-border p-3 text-left text-muted-foreground text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-disabled="true"
      >
        <span>{t("solanaPreview.execution")}</span>
        <span>{t("solanaPreview.executionUnavailable")}</span>
      </button>
    </aside>
  );
}
