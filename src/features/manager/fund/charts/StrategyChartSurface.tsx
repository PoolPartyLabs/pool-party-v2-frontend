/**
 * @id PP-MGR-CMP-103
 * @name StrategyChartSurface
 * @description Isolated DEX Screener chart of the selected pool or asset, with retained strategy canvas and panel state.
 *   An unavailable chart shows one state with the preserved selection and Back (POO-2336).
 * @figma https://www.figma.com/design/jjOf5DL9uVEB7WBR9nGb4A?node-id=8678-37675
 * @figma https://www.figma.com/design/jjOf5DL9uVEB7WBR9nGb4A?node-id=8682-3253
 * @linear https://linear.app/yeildbay/issue/POO-2309
 * @linear https://linear.app/yeildbay/issue/POO-2336
 * @linear https://linear.app/yeildbay/issue/POO-2338
 * @i18n-namespace manager.marketChart
 * @implements-rules-version v1 (POO-2309), v1 (POO-2336), v1 (POO-2338) + POO-2342 rules v1 (one V2 builder, Solana is a network)
 * @analytics-events manager_chart_viewed, manager_chart_closed, manager_chart_blocked,
 *   manager_chart_failed, manager_chart_retried
 */
"use client";

import { useTranslations } from "next-intl";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/Tabs";
import { useAnalytics } from "@/lib/analytics/useAnalytics";
import { cn } from "@/lib/utils/cn";
import type { ChartSelection } from "./chartContext";
import { buildChartUrl, type ChartMarket, chartAnalyticsMarket, chartPageUrl } from "./chartModel";
import {
  type ChartFailure,
  type ChartTab,
  type ChartUnavailableView,
  type ChartView,
  chartPanelState,
} from "./chartUnavailable";

export interface StrategyChartSurfaceProps {
  selection: ChartSelection;
  context: "build" | "manage";
  children: ReactNode;
  /** Display name of the selected block. Shown in the unavailable state, never sent anywhere. */
  selectionLabel?: string | null;
  fillContainer?: boolean;
  active?: boolean;
}

/** R1 to R4: one full-panel state for every cause, with the preserved selection and Back only. */
function ChartUnavailableState({ view, onBack }: { view: ChartUnavailableView; onBack(): void }) {
  const t = useTranslations("manager.marketChart");
  return (
    <div
      data-chart-unavailable=""
      className="flex min-h-24 flex-1 flex-col items-start gap-4 bg-surface p-5 text-xs text-muted-foreground"
    >
      <p>{t(view.titleKey)}</p>
      <p>{t(view.bodyKey)}</p>
      {view.selection ? (
        <div className="flex flex-col gap-1 rounded-md bg-surface-raised px-3 py-2">
          <p className="font-semibold text-foreground text-sm">{view.selection.label}</p>
          <p>{t(view.selection.noteKey)}</p>
        </div>
      ) : null}
      <Button
        variant="secondary"
        size="md"
        className="max-w-full font-semibold sm:w-60"
        onClick={onBack}
      >
        {t(view.backKey)}
      </Button>
    </div>
  );
}

/**
 * POO-2338 R10: a fresh DEX Screener frame owns its 20 s timer. The iframe `onLoad` is the only
 * load signal. The frame sends no message to the app, and the app reads none from it.
 */
function ChartFrame({
  market,
  loadError,
  onFailure,
  onRetry,
}: {
  market: ChartMarket;
  loadError: ChartView["loadError"];
  onFailure(reason: ChartFailure): void;
  onRetry(): void;
}) {
  const t = useTranslations("manager.marketChart");
  const timer = useRef<number | null>(null);
  const [status, setStatus] = useState<"loading" | "loaded" | ChartFailure>("loading");
  const src = useMemo(() => buildChartUrl(market), [market]);
  useEffect(() => {
    timer.current = window.setTimeout(() => {
      timer.current = null;
      setStatus("load_timeout");
      onFailure("load_timeout");
    }, 20_000);
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = null;
    };
  }, [onFailure]);
  const loaded = () => {
    // A load after the timeout does not hide the retry action.
    if (timer.current === null) return;
    window.clearTimeout(timer.current);
    timer.current = null;
    setStatus("loaded");
  };
  const failed = status === "load_timeout";
  return (
    <div className="relative min-h-24 min-w-0 flex-1" aria-busy={status === "loading"}>
      {/* PP-INTEGRATION-POINT: isolated public DEX Screener chart; only the chain slug and the public pool or token address are sent. */}
      <iframe
        data-chart-frame=""
        src={src}
        title={t("frameTitle", { name: market.label || market.venue })}
        referrerPolicy="no-referrer"
        sandbox="allow-scripts allow-same-origin allow-popups"
        onLoad={loaded}
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
      {loadError ? (
        <div
          role="alert"
          className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-surface p-4 text-center text-sm text-foreground"
        >
          <p>{t(loadError.messageKey)}</p>
          <Button variant="secondary" size="sm" onClick={onRetry}>
            {t(loadError.retryKey)}
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
  selectionLabel = null,
  fillContainer = false,
  active = true,
}: StrategyChartSurfaceProps) {
  const t = useTranslations("manager.marketChart");
  const { track } = useAnalytics();
  const [tab, setTab] = useState<ChartTab>("flow");
  const [visitedIdentity, setVisitedIdentity] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [failure, setFailure] = useState<{ frame: string; reason: ChartFailure } | null>(null);
  const flowTrigger = useRef<HTMLButtonElement>(null);
  const [focusFlow, setFocusFlow] = useState(0);
  const { availability, identity } = selection;
  const market = availability.status === "available" ? availability.market : null;
  const reason = availability.status === "unavailable" ? availability.reason : null;
  // R9: a bounded value, never an address.
  const marketId = chartAnalyticsMarket(availability);
  const widgetKey = JSON.stringify([identity, market ? buildChartUrl(market) : null]);
  const chartsVisible = tab === "charts";
  const visited = chartsVisible || visitedIdentity === widgetKey;
  const frameKey = `${widgetKey}:${attempt}`;
  // R4, R5: a provider failure belongs to one frame instance; a new key starts with none.
  const panel = chartPanelState(
    availability,
    failure?.frame === frameKey ? failure.reason : null,
    selectionLabel,
  );
  useEffect(() => {
    if (active && chartsVisible) setVisitedIdentity(widgetKey);
  }, [active, chartsVisible, widgetKey]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new private identity is a new chart visit even for the same bounded market; the identity is not emitted.
  useEffect(() => {
    if (!active || !chartsVisible) return;
    track("manager_chart_viewed", { chart_context: context, chart_market: marketId });
    if (reason) {
      // R6: the blocked event keeps its reason values.
      track("manager_chart_blocked", {
        chart_context: context,
        chart_market: marketId,
        chart_reason: reason,
      });
    }
    return () => track("manager_chart_closed", { chart_context: context, chart_market: marketId });
  }, [active, chartsVisible, context, marketId, reason, identity, track]);
  const onFailure = useCallback(
    (reason: ChartFailure) => {
      setFailure({ frame: frameKey, reason });
      track("manager_chart_failed", {
        chart_context: context,
        chart_market: marketId,
        chart_reason: reason,
      });
    },
    [track, context, marketId, frameKey],
  );
  const retry = () => {
    track("manager_chart_retried", { chart_context: context, chart_market: marketId });
    setAttempt((value) => value + 1);
  };
  // R3: Back changes the tab only. The parent keeps the selected block and its draft.
  const back = () => {
    setTab("flow");
    setFocusFlow((request) => request + 1);
  };
  // R3: after the flow panel is visible again, focus goes to its tab, as Manage Back does.
  useEffect(() => {
    if (focusFlow > 0) flowTrigger.current?.focus();
  }, [focusFlow]);
  return (
    <Tabs
      data-strategy-chart-surface=""
      value={tab}
      onValueChange={(value) => setTab(value === "charts" ? "charts" : "flow")}
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
        <TabsTrigger ref={flowTrigger} value="flow">
          {t("flow")}
        </TabsTrigger>
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
            "absolute inset-0 flex h-full min-h-0 min-w-0 flex-col overflow-hidden border border-border bg-surface",
            // Figma 8682-3253: the unavailable panel uses the 16px radius token.
            panel.kind === "unavailable" ? "rounded-lg" : "rounded-xl",
            !chartsVisible && "invisible pointer-events-none",
          )}
        >
          {panel.kind === "chart" ? (
            <>
              <header className="scrollbar-dark min-h-0 shrink space-y-1 overflow-y-auto border-b border-border px-3 py-2">
                <h3 className="font-semibold text-sm text-foreground">
                  {t(panel.market.kind === "pool" ? "poolTitle" : "assetTitle")}
                </h3>
                <p className="text-sm text-foreground">
                  {panel.market.label} · {panel.market.venue}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t(panel.market.kind === "pool" ? "poolDescription" : "assetDescription")}
                </p>
              </header>
              {visited ? (
                <ChartFrame
                  key={frameKey}
                  market={panel.market}
                  loadError={panel.loadError}
                  onFailure={onFailure}
                  onRetry={retry}
                />
              ) : null}
              <footer className="shrink-0 border-t border-border px-3 py-2 text-xs text-muted-foreground">
                <a
                  href={chartPageUrl(panel.market)}
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
            <ChartUnavailableState view={panel} onBack={back} />
          )}
        </TabsContent>
      </div>
    </Tabs>
  );
}
