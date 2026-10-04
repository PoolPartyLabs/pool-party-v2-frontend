/**
 * @id PP-STR-CMP-040 (POO-2223)
 * @name FundComposition
 * @implements-rules-version v1
 * @analytics-events none, passive chart; Details emits its view
 * @i18n-namespace strategies.DetailsV2
 * Supplied position weights on the full NAV, including undetailed coverage.
 */
"use client";
import { useTranslations } from "next-intl";
import { NetworkLogo } from "@/components/data-display/NetworkLogo";
import { TokenLogo } from "@/components/data-display/TokenLogo";
import { ProtocolMark } from "@/features/manager/fund/components/ProtocolMark";
import type { ProtocolId } from "@/features/manager/fund/mandateDraft";
import type { FundView } from "@/lib/api/v2/fundSchemas";
import { formatPercent, formatUsd } from "@/lib/utils/format";
import { detailedCoverage } from "./fundDetailsModel";

const COLORS = [
  "var(--color-chart-periwinkle)",
  "var(--color-chart-grape-soft)",
  "var(--color-info)",
  "var(--color-success)",
  "var(--color-brand-mango)",
];
const PROTOCOLS: Partial<Record<string, { id: ProtocolId; name: string }>> = {
  "aave-v3": { id: "aave-v3", name: "Aave v3" },
  "uniswap-v4": { id: "uniswap-v4", name: "Uniswap v4" },
  "uniswap-v3": { id: "uniswap-v3", name: "Uniswap v3" },
  "uniswap-v3-swap": { id: "uniswap-v3-swap", name: "Uniswap v3" },
};
const NETWORKS: Record<string, { slug: string; name: string }> = {
  "42161": { slug: "arbitrum", name: "Arbitrum" },
  "4663": { slug: "robinhood", name: "Robinhood" },
};
const percent = (value: number) => formatPercent(value, Number.isInteger(value) ? 0 : 2);
export interface FundCompositionProps {
  /** Verified public fund snapshot. No fixture substitution in real mode. */
  fund: FundView;
}
export function FundComposition({ fund }: FundCompositionProps) {
  const t = useTranslations("strategies.DetailsV2");
  const positions = fund.positionsSummary?.positions ?? [];
  const coverage = detailedCoverage(fund);
  const rows = positions.filter(
    (position, index) =>
      positions.findIndex(
        (candidate) =>
          candidate.chainId === position.chainId &&
          candidate.positionKey.toLowerCase() === position.positionKey.toLowerCase(),
      ) === index,
  );
  // PP-INTEGRATION-POINT: positionsSummary comes from the existing public fund read; absent
  // weights remain unavailable. Event history is never used to infer allocations or prices.
  const remaining = coverage === null ? null : Number((100 - coverage).toFixed(10));
  let offset = 0;
  return (
    <div className="@container flex min-w-0 flex-col gap-4">
      <p className="text-xs text-muted-foreground">{t("currentPositions")}</p>
      <div className="flex min-w-0 flex-col items-center gap-6 @md:flex-row">
        {coverage !== null && remaining !== null ? (
          <div className="flex w-44 max-w-full shrink-0 flex-col items-center gap-3">
            <div
              role="img"
              aria-label={`${t("composition")}: ${percent(coverage)} ${t("detailed")}, ${t("coverage", { percent: String(remaining) })}`}
              className="relative flex size-[156px] max-w-full items-center justify-center"
            >
              <svg viewBox="0 0 156 156" className="absolute inset-0 size-full" aria-hidden="true">
                <circle
                  cx="78"
                  cy="78"
                  r="68"
                  fill="none"
                  stroke="var(--color-muted-foreground)"
                  strokeWidth="18"
                />
                {positions.map((position, index) => {
                  const share = Number(position.shareOfNav);
                  const start = offset;
                  offset += share;
                  return (
                    <circle
                      key={`${position.chainId}:${position.positionKey}`}
                      cx="78"
                      cy="78"
                      r="68"
                      fill="none"
                      stroke={COLORS[index % COLORS.length]}
                      strokeWidth="18"
                      pathLength="100"
                      strokeDasharray={`${share} ${100 - share}`}
                      strokeDashoffset={-start}
                      transform="rotate(-90 78 78)"
                    />
                  );
                })}
              </svg>
              <div aria-hidden="true" className="relative text-center">
                <p className="text-xl font-semibold tabular-nums">{percent(coverage)}</p>
                <p className="text-xs text-muted-foreground">{t("detailed")}</p>
              </div>
            </div>
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground tabular-nums">
              <span aria-hidden="true" className="size-2 rounded-full bg-muted-foreground" />
              {t("coverage", { percent: String(remaining) })}
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t("unavailable")}</p>
        )}
        <ul className="flex min-w-0 w-full flex-1 flex-col gap-3">
          {rows.map((position, index) => {
            const protocol = PROTOCOLS[position.adapterKind];
            const network = NETWORKS[position.chainId] ?? {
              slug: position.chainId,
              name: position.chainId,
            };
            const rawUsd = position.currentValueUsd ?? position.valueUsd;
            const usd = rawUsd === null ? null : Number(rawUsd);
            const share = position.shareOfNav === null ? null : Number(position.shareOfNav);
            const validShare =
              share !== null && Number.isFinite(share) && share >= 0 && share <= 100;
            return (
              <li
                key={`${position.chainId}:${position.positionKey}`}
                className="flex min-w-0 flex-wrap items-center gap-3 rounded-xl bg-surface-raised p-3"
              >
                <div className="flex shrink-0 -space-x-3">
                  {position.tokens.slice(0, 2).map((token) => (
                    <TokenLogo
                      key={`${token.address}:${token.symbol}`}
                      symbol={token.symbol}
                      network={network.slug}
                      className="size-9 border-2 border-surface-raised text-xs"
                    />
                  ))}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="break-words font-semibold text-sm">
                    {position.tokens.map((token) => token.symbol).join(" / ") || t("unavailable")}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    {protocol ? (
                      <ProtocolMark id={protocol.id} name={protocol.name} size={16} />
                    ) : null}
                    <span className="break-all">{protocol?.name ?? position.adapterKind}</span>
                    <NetworkLogo network={network.slug} name={network.name} size={14} />
                    <span>{network.name}</span>
                  </div>
                </div>
                <div className="ml-auto min-w-0 text-right tabular-nums">
                  <p className="flex items-center justify-end gap-1.5 text-sm font-semibold">
                    <span
                      aria-hidden="true"
                      className="size-2 shrink-0 rounded-full"
                      style={{ backgroundColor: COLORS[index % COLORS.length] }}
                    />
                    {validShare ? percent(share) : t("unavailable")}
                  </p>
                  <p className="mt-1 break-words text-xs text-muted-foreground">
                    {usd !== null && Number.isFinite(usd) && usd >= 0
                      ? formatUsd(usd)
                      : t("unavailable")}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
