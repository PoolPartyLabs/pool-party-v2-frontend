/**
 * @id PP-MGR-CMP-103
 * @name StrategyChartSurface
 * @description Isolated market-reference chart with retained strategy canvas and panel state.
 * @figma https://www.figma.com/design/jjOf5DL9uVEB7WBR9nGb4A?node-id=8678-37675
 * @linear https://linear.app/yeildbay/issue/POO-2309
 * @i18n-namespace manager.marketChart
 * @implements-rules-version v1 (POO-2309)
 * @analytics-events manager_chart_viewed, manager_chart_closed, manager_chart_blocked,
 *   manager_chart_failed, manager_chart_retried
 */
"use client";

import { useLocale, useTranslations } from "next-intl";
import { type ReactNode, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/Tabs";
import { useAnalytics } from "@/lib/analytics/useAnalytics";
import { cn } from "@/lib/utils/cn";
import type { ChartSelection } from "./chartContext";
import { buildChartUrl, type ChartMarket, readChartMessage } from "./chartModel";

export interface StrategyChartSurfaceProps {
  selection: ChartSelection;
  context: "build" | "manage" | "solana-local";
  children: ReactNode;
  fillContainer?: boolean;
  active?: boolean;
}

type ChartFailure = "no_data" | "load_timeout";

/** A fresh remote instance owns its listener/timer; no message can write financial state. */
function TradingViewFrame({
  market,
  locale,
  onFailure,
  onRetry,
}: {
  market: ChartMarket;
  locale: string;
  onFailure(reason: ChartFailure): void;
  onRetry(): void;
}) {
  const t = useTranslations("manager.marketChart");
  const opaqueId = useId();
  const instanceId = `pp-chart-${opaqueId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const frame = useRef<HTMLIFrameElement>(null);
  const [status, setStatus] = useState<"loading" | "booted" | ChartFailure>("loading");
  const src = useMemo(
    () => buildChartUrl(market, locale, instanceId),
    [market, locale, instanceId],
  );
  useEffect(() => {
    let failed = false;
    const fail = (reason: ChartFailure) => {
      if (failed) return;
      failed = true;
      window.clearTimeout(timer);
      setStatus(reason);
      onFailure(reason);
    };
    const timer = window.setTimeout(() => fail("load_timeout"), 20_000);
    const receive = (event: MessageEvent) => {
      const message = readChartMessage(event, frame.current?.contentWindow, instanceId);
      if (message === "no-data") fail("no_data");
      if (message === "boot" && !failed) {
        window.clearTimeout(timer);
        // Provider boot precedes its data load. Never use this to certify candles or execution.
        setStatus("booted");
      }
    };
    window.addEventListener("message", receive);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("message", receive);
    };
  }, [instanceId, onFailure]);
  const failed = status === "no_data" || status === "load_timeout";
  return (
    <div className="relative min-h-24 min-w-0 flex-1" aria-busy={status === "loading"}>
      {/* PP-INTEGRATION-POINT: isolated public market reference; no app/wallet state is sent. */}
      <iframe
        ref={frame}
        data-tradingview-frame=""
        src={src}
        title={t("frameTitle", { pair: market.pair })}
        lang={locale}
        referrerPolicy="no-referrer"
        sandbox="allow-scripts allow-same-origin allow-popups"
        aria-hidden={failed || undefined}
        inert={failed || undefined}
        tabIndex={failed ? -1 : undefined}
        className={cn("absolute inset-0 h-full w-full border-0", failed && "invisible")}
      />
      {status === "loading" ? (
        <p
          role="status"
          className="pointer-events-none absolute inset-x-3 top-3 rounded-lg bg-surface p-3 text-sm text-foreground"
        >
          {t("loading")}
        </p>
      ) : null}
      {failed ? (
        <div
          role="alert"
          className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-surface p-4 text-center text-sm text-foreground"
        >
          <p>{t(status === "no_data" ? "noData" : "loadError")}</p>
          <Button variant="secondary" size="sm" onClick={onRetry}>
            {t("retry")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** Presentation owner only; financial state remains in the mounted parent and canvas. */
export function StrategyChartSurface({
  selection,
  context,
  children,
  fillContainer = false,
  active = true,
}: StrategyChartSurfaceProps) {
  const t = useTranslations("manager.marketChart");
  const locale = useLocale();
  const { track } = useAnalytics();
  const [tab, setTab] = useState("flow");
  const [visitedIdentity, setVisitedIdentity] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const { availability, identity } = selection;
  const market = availability.status === "available" ? availability.market : null;
  const reason = availability.status === "unavailable" ? availability.reason : null;
  const marketId = market?.id ?? "unavailable";
  const widgetKey = JSON.stringify([identity, locale, market?.symbol]);
  const chartsVisible = tab === "charts";
  const visited = chartsVisible || visitedIdentity === widgetKey;
  useEffect(() => {
    if (active && chartsVisible) setVisitedIdentity(widgetKey);
  }, [active, chartsVisible, widgetKey]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new private identity/locale is a new chart visit even for the same bounded market; neither identity is emitted.
  useEffect(() => {
    if (!active || !chartsVisible) return;
    track("manager_chart_viewed", { chart_context: context, chart_market: marketId });
    if (reason) {
      track("manager_chart_blocked", {
        chart_context: context,
        chart_market: marketId,
        chart_reason: reason,
      });
    }
    return () => track("manager_chart_closed", { chart_context: context, chart_market: marketId });
  }, [active, chartsVisible, context, marketId, reason, identity, locale, track]);
  const onFailure = useCallback(
    (failure: ChartFailure) => {
      track("manager_chart_failed", {
        chart_context: context,
        chart_market: marketId,
        chart_reason: failure,
      });
    },
    [track, context, marketId],
  );
  const retry = () => {
    track("manager_chart_retried", { chart_context: context, chart_market: marketId });
    setAttempt((value) => value + 1);
  };
  const blockedCopy = {
    no_selection: t("noSelection"),
    unconfigured: t("unconfigured"),
    unsupported_block: t("unsupportedBlock"),
    lending_reference: t("lendingReference"),
    unsupported_pair: t("unsupportedPair"),
  };
  return (
    <Tabs
      data-strategy-chart-surface=""
      value={tab}
      onValueChange={setTab}
      activationMode="manual"
      onKeyDown={(event) => {
        // Chart controls must not reach the parent Build remove/deselect shortcuts.
        if (
          ["Delete", "Backspace", "Escape"].includes(event.key) &&
          !(event.target instanceof Element && event.target.closest("[data-canvas-viewport]"))
        ) {
          event.stopPropagation();
        }
      }}
      className={cn("min-w-0 gap-3", fillContainer && "h-full min-h-0")}
    >
      <TabsList
        aria-label={t("tabsLabel")}
        className="max-w-full shrink-0 self-start overflow-x-auto"
      >
        <TabsTrigger value="flow">{t("flow")}</TabsTrigger>
        <TabsTrigger value="charts">{t("charts")}</TabsTrigger>
      </TabsList>
      <div className="relative min-h-0 min-w-0 flex-1">
        {/* forceMount plus visibility, never display:none, preserves React Flow measurements. */}
        <TabsContent
          value="flow"
          forceMount
          aria-hidden={chartsVisible || undefined}
          inert={chartsVisible || undefined}
          tabIndex={chartsVisible ? -1 : 0}
          className={cn("h-full min-h-0 w-full", chartsVisible && "invisible pointer-events-none")}
        >
          {children}
        </TabsContent>
        <TabsContent
          value="charts"
          forceMount
          aria-hidden={!chartsVisible || undefined}
          inert={!chartsVisible || undefined}
          tabIndex={chartsVisible ? 0 : -1}
          className={cn(
            "absolute inset-0 flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-surface",
            !chartsVisible && "invisible pointer-events-none",
          )}
        >
          {market ? (
            <>
              <header className="scrollbar-dark min-h-0 shrink space-y-1 overflow-y-auto border-b border-border px-3 py-2">
                <h3 className="font-semibold text-sm text-foreground">{t("referenceTitle")}</h3>
                <p className="text-sm text-foreground">
                  {market.pair} · {market.venue}
                </p>
                <p className="text-xs text-muted-foreground">{t("referenceDescription")}</p>
              </header>
              {visited ? (
                <TradingViewFrame
                  key={`${widgetKey}:${attempt}`}
                  market={market}
                  locale={locale}
                  onFailure={onFailure}
                  onRetry={retry}
                />
              ) : null}
              <footer className="shrink-0 border-t border-border px-3 py-2 text-xs text-muted-foreground">
                <a
                  href={`https://www.tradingview.com/symbols/${market.symbol.split(":")[1]}/?exchange=BINANCE`}
                  target="_blank"
                  rel="noopener noreferrer"
                  referrerPolicy="no-referrer"
                  className="underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {t("attribution")}
                </a>
              </footer>
            </>
          ) : (
            <div className="flex min-h-24 flex-1 flex-col items-center justify-center gap-2 p-4 text-center text-sm">
              <p className="font-semibold text-foreground">{t("notAvailable")}</p>
              <p className="text-muted-foreground">{blockedCopy[reason ?? "no_selection"]}</p>
            </div>
          )}
        </TabsContent>
      </div>
    </Tabs>
  );
}
