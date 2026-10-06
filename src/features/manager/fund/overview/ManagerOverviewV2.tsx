/**
 * @id PP-MGR-SCR-001
 * @name ManagerOverviewV2
 * @implements-rules-version v1 (POO-2245)
 * @analytics-events builder_draft_opened, builder_draft_deleted, builder_mandate_error, app_error_shown, app_cta_blocked
 * page_viewed is route-owned. This read/navigation surface never settles money.
 */
"use client";
import { useSearchParams } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { type ChartPoint, PerformanceChart } from "@/components/data-display/PerformanceChart";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Skeleton } from "@/components/ui/Skeleton";
import { toast } from "@/components/ui/Toast";
import { loadFundsAction } from "@/features/funds/fundActions";
import type { FundListEntry } from "@/features/funds/fundListModel";
import { ConsoleShell } from "@/features/manager/components/ConsoleShell";
import { Link, useRouter } from "@/i18n/navigation";
import { useAnalytics } from "@/lib/analytics/useAnalytics";
import { useAuth } from "@/lib/auth/useAuth";
import { useSiweSession } from "@/lib/auth/useSiweSession";
import { isMockMode } from "@/lib/services";
import { managerOverviewDemo } from "@/mocks/data/managerOverviewV2";
import { draftResumeHref } from "../components/MandateDraftsList";
import { type MandateDraft, resumeStep, stepIndex } from "../mandateDraft";
import { deleteDraft } from "../mandateDraftStore";
import { OverviewProfile } from "./OverviewProfile";
import { overviewModel, type SetupSnapshot } from "./overviewModel";
import { useOverviewSetup } from "./useOverviewSetup";

export interface OverviewDemo {
  state: "ready" | "loading" | "empty" | "error";
  funds: FundListEntry[];
  setup: SetupSnapshot;
  aum: string;
  readyCount: number;
  networks: number;
  series: ChartPoint[];
  manager: string;
  rowAum: Record<string, string>;
}
/** Explicit demo input is used by stories only. Live reads have no fixture fallback. */
export function ManagerOverviewV2({
  demo,
  profileContent,
}: {
  demo?: OverviewDemo;
  profileContent?: React.ReactNode;
}) {
  const source = demo ?? (isMockMode ? managerOverviewDemo : undefined);
  const params = useSearchParams();
  const t = useTranslations("manager.overviewV2");
  const managerT = useTranslations("manager");
  const common = useTranslations("common");
  const format = useFormatter();
  const router = useRouter();
  const { address } = useAuth();
  const { isSignedIn } = useSiweSession();
  const { track } = useAnalytics();
  const local = useOverviewSetup(address);
  const [retry, setRetry] = useState(0);
  const [period, setPeriod] = useState("30D");
  const tab =
    params.get("tab") === "profile"
      ? "profile"
      : params.get("tab") === "strategies"
        ? "strategies"
        : "overview";
  const [pending, setPending] = useState<MandateDraft | null>(null);
  const identity = `${address ?? ""}:${isSignedIn}:${retry}`;
  const [snapshot, setSnapshot] = useState<{
    identity: string;
    result: Awaited<ReturnType<typeof loadFundsAction>>;
  } | null>(null);
  const result = snapshot?.identity === identity ? snapshot.result : null;
  useEffect(() => {
    const refresh = () => setRetry((value) => value + 1);
    const launch = (event: Event) => {
      if ((event as CustomEvent<{ completed?: boolean }>).detail?.completed) refresh();
    };
    window.addEventListener("focus", refresh);
    window.addEventListener("pp:v2:launch-changed", launch);
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener("pp:v2:launch-changed", launch);
    };
  }, []);

  useEffect(() => {
    if (source || (!isMockMode && !isSignedIn)) return;
    let active = true;
    setSnapshot(null);
    const timer = window.setTimeout(() => {
      if (!active) return;
      active = false;
      setSnapshot({
        identity,
        result: { ok: false, error: { status: 504, code: "V2_UNAVAILABLE" } },
      });
    }, 30_000);
    // PP-INTEGRATION-POINT: discovery is not authoritative history/readiness or AUM coverage.
    void loadFundsAction("manager")
      .then((result) => {
        window.clearTimeout(timer);
        if (active) setSnapshot({ identity, result });
      })
      .catch(() => {
        window.clearTimeout(timer);
        if (active)
          setSnapshot({
            identity,
            result: { ok: false, error: { status: 502, code: "V2_UNAVAILABLE" } },
          });
      });
    return () => {
      window.clearTimeout(timer);
      active = false;
    };
  }, [source, identity, isSignedIn]);
  const verified =
    !!result?.ok && !!address && result.data.wallet?.toLowerCase() === address.toLowerCase();
  const funds = source?.funds ?? (verified && result?.ok ? result.data.funds : null);
  const setup = source?.setup ?? local;
  const model = setup ? overviewModel(funds, setup, source?.manager ?? address) : null;
  const state =
    source?.state ??
    (!isMockMode && !isSignedIn
      ? "session"
      : !result
        ? "loading"
        : !result.ok
          ? "error"
          : verified
            ? "ready"
            : "session");
  useEffect(() => {
    if (state === "error")
      track("app_error_shown", {
        family: "v2",
        surface: "manager",
        error_code: "V2_UNAVAILABLE",
        error_origin: "upstream",
      });
    if (state === "session")
      track("app_cta_blocked", {
        family: "v2",
        surface: "manager",
        reason: "manager_session_required",
      });
  }, [state, track]);
  const selectTab = (next: "overview" | "strategies" | "profile") => {
    router.push(next === "overview" ? "/manager" : `/manager?tab=${next}`);
  };
  const confirmDelete = () => {
    if (!pending) return;
    const draft = pending;
    setPending(null);
    if (deleteDraft(draft.id)) track("builder_draft_deleted", { step: resumeStep(draft) });
    else {
      toast.error(managerT("fundBuilder.drafts.deleteFailed"));
      track("builder_mandate_error", {
        step: resumeStep(draft),
        error_code: "DRAFT_DELETE_FAILED",
        error_origin: "app",
      });
    }
  };
  const rows = model?.rows ?? [];
  return (
    <ConsoleShell
      comingSoonLabel={t("comingSoon")}
      active={tab}
      onSelectTab={selectTab}
      profileHref={address ? `/m/${address}` : undefined}
    >
      {tab === "profile" ? (
        (profileContent ?? <OverviewProfile />)
      ) : source?.state === "empty" ? (
        <Card className="p-8">
          <p>{t("workspaceReady")}</p>
          <h2 className="mt-4 text-2xl font-semibold">{t("noStrategies")}</h2>
          <p className="mt-2">{t("firstStrategy")}</p>
          <p className="mt-2 text-muted-foreground">{t("saveProgress")}</p>
        </Card>
      ) : (
        <>
          {tab === "overview" ? (
            <>
              <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]">
                <Card className="flex min-h-[23.75rem] flex-col gap-3 p-6">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h2 className="text-sm text-muted-foreground">{t("totalAum")}</h2>
                    <div className="flex gap-1">
                      {["7D", "30D", "All"].map((range) => (
                        <Button
                          key={t(
                            range === "7D" ? "period7" : range === "30D" ? "period30" : "periodAll",
                          )}
                          variant="ghost"
                          size="sm"
                          aria-pressed={period === range}
                          disabled={!source}
                          onClick={() => setPeriod(range)}
                        >
                          {t(
                            range === "7D" ? "period7" : range === "30D" ? "period30" : "periodAll",
                          )}
                        </Button>
                      ))}
                    </div>
                  </div>
                  {state === "loading" ? (
                    <Skeleton height={48} />
                  ) : (
                    <p className="text-3xl font-semibold tabular-nums">
                      {source?.state === "ready" ? source.aum : t("notAvailable")}
                    </p>
                  )}
                  <p className="text-sm text-muted-foreground">
                    {source
                      ? t("acrossStrategies", { count: source.readyCount })
                      : t("notAvailable")}
                  </p>
                  {source && state === "ready" ? (
                    <PerformanceChart
                      className="mt-auto h-48"
                      ariaLabel={t("totalAum")}
                      data={period === "7D" ? source.series.slice(-7) : source.series}
                    />
                  ) : state === "loading" ? (
                    <Skeleton height={180} />
                  ) : (
                    <p role="status" className="m-auto text-sm text-muted-foreground">
                      {t("historyUnavailable")}
                    </p>
                  )}
                </Card>
                <Card className="flex flex-col gap-4 p-6">
                  <h2 className="font-semibold">{t("continueSetup")}</h2>
                  <p className="text-sm text-muted-foreground">{t("setupSubtitle")}</p>
                  {!model ? (
                    <Skeleton height={100} />
                  ) : (
                    <>
                      {model.localUnavailable ? <p role="alert">{t("localUnavailable")}</p> : null}
                      {model.setup.length === 0 ? (
                        model.localUnavailable ? null : (
                          <p className="text-sm text-muted-foreground">{t("noSetup")}</p>
                        )
                      ) : (
                        <ul className="space-y-3">
                          {model.setup.map((item) =>
                            item.kind === "launch" ? (
                              <li
                                key={item.journey.journeyId}
                                className="rounded-xl border border-border p-3"
                              >
                                <p className="font-medium">{item.journey.draft.review.name}</p>
                                <p className="mt-1 text-xs text-muted-foreground">
                                  {t(item.completed ? "indexingPending" : "launchInProgress")}
                                </p>
                                <Link
                                  className="mt-3 inline-flex min-h-11 items-center rounded-lg border border-border px-3 text-sm"
                                  href={`/manager/fund-launch/${encodeURIComponent(item.journey.journeyId)}`}
                                >
                                  {t("resumeLaunch")}
                                </Link>
                              </li>
                            ) : (
                              <li
                                key={item.draft.id}
                                className="rounded-xl border border-border p-3"
                              >
                                <p className="font-medium">
                                  {item.draft.name ?? managerT("fundBuilder.drafts.unnamed")}
                                </p>
                                <p className="mt-1 text-xs text-muted-foreground">
                                  {t("mandateStep", {
                                    step: stepIndex(item.draft, resumeStep(item.draft)).index,
                                    count: stepIndex(item.draft, resumeStep(item.draft)).count,
                                  })}
                                </p>
                                <p className="text-xs text-muted-foreground">{t("savedDevice")}</p>
                                <p className="text-xs text-muted-foreground">
                                  {t("updated", {
                                    when: format.relativeTime(
                                      new Date(item.draft.updatedAt),
                                      new Date(),
                                    ),
                                  })}
                                </p>
                                <div className="mt-3 flex flex-wrap gap-2">
                                  <Button
                                    variant="secondary"
                                    onClick={() => {
                                      track("builder_draft_opened", {
                                        step: resumeStep(item.draft),
                                      });
                                      router.push(draftResumeHref(item.draft));
                                    }}
                                  >
                                    {t("resumeDraft")}
                                  </Button>
                                  <details className="relative ml-auto">
                                    <summary
                                      className="flex min-h-11 cursor-pointer list-none items-center px-3"
                                      aria-label={`${t("delete")}: ${item.draft.name ?? managerT("fundBuilder.drafts.unnamed")}`}
                                    >
                                      <span aria-hidden="true">⋯</span>
                                    </summary>
                                    <Button
                                      variant="ghost"
                                      className="absolute right-0 z-10 whitespace-nowrap border border-border bg-surface"
                                      onClick={() => setPending(item.draft)}
                                    >
                                      {t("delete")}
                                    </Button>
                                  </details>
                                </div>
                              </li>
                            ),
                          )}
                        </ul>
                      )}
                    </>
                  )}
                </Card>
              </div>
              <div className="grid gap-6 sm:grid-cols-3">
                {[
                  [
                    "strategies",
                    source?.state === "ready" ? source.readyCount : undefined,
                    "readyToManage",
                  ],
                  [
                    "inSetup",
                    model?.localUnavailable ? undefined : model?.setup.length,
                    "setupCounts",
                  ],
                  [
                    "networks",
                    source?.state === "ready" ? source.networks : undefined,
                    "acrossNetworks",
                  ],
                ].map(([title, value, caption]) => (
                  <Card key={String(title)} className="p-6">
                    <h2 className="text-sm text-muted-foreground">{t(String(title))}</h2>
                    <p className="my-2 text-2xl font-semibold tabular-nums">
                      {value ?? t("notAvailable")}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {caption === "setupCounts"
                        ? !model || model.localUnavailable
                          ? t("notAvailable")
                          : t("setupCounts", {
                              launches: model?.setup.filter((i) => i.kind === "launch").length ?? 0,
                              drafts: model?.setup.filter((i) => i.kind === "draft").length ?? 0,
                            })
                        : t(String(caption))}
                    </p>
                  </Card>
                ))}
              </div>
            </>
          ) : null}
          <Card className="overflow-hidden p-6">
            <div className="mb-5 flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">{t("yourStrategies")}</h2>
              {tab === "overview" ? (
                <Button variant="ghost" onClick={() => selectTab("strategies")}>
                  {t("seeAll")}
                </Button>
              ) : null}
            </div>
            {state === "loading" ? (
              <div role="status">
                <p className="mb-3">{t("loading")}</p>
                <Skeleton height={120} />
              </div>
            ) : state === "error" ? (
              <div role="alert">
                <h3>{t("loadFailed")}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{t("retryDescription")}</p>
                <Button variant="secondary" className="mt-4" onClick={() => setRetry((n) => n + 1)}>
                  {t("retry")}
                </Button>
                <p className="mt-3 text-sm">{t("setupPreserved")}</p>
              </div>
            ) : state === "session" ? (
              <p role="status">{t("session")}</p>
            ) : rows.length === 0 ? (
              <p>{t("noKnownStrategies")}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-muted-foreground">
                    <tr>
                      {["strategy", "status", "networks", "aum"].map((key) => (
                        <th key={key} scope="col" className="pb-4 font-medium">
                          {t(key)}
                        </th>
                      ))}
                      <th scope="col">
                        <span className="sr-only">{t("manage")}</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((fund) => (
                      <tr key={fund.coreVault} className="border-t border-border">
                        <td className="py-4 font-medium">
                          {fund.profile?.name?.trim() || `PP-${fund.creationNumber}`}
                        </td>
                        <td className="py-4">
                          {fund.state === "Open"
                            ? t("stateOpen")
                            : fund.state === "Closing"
                              ? t("stateClosing")
                              : fund.state === "Closed"
                                ? t("stateClosed")
                                : t("notAvailable")}
                        </td>
                        <td className="py-4">
                          {fund.chains
                            .map((c) =>
                              c.chainId === "42161"
                                ? "Arbitrum"
                                : c.chainId === "4663"
                                  ? "Robinhood Chain"
                                  : c.chainId,
                            )
                            .join(", ")}
                        </td>
                        <td className="py-4 tabular-nums">
                          {source?.rowAum[fund.coreVault] ?? t("notAvailable")}
                        </td>
                        <td className="py-4 text-right">
                          <Link
                            className="inline-flex min-h-11 items-center rounded-lg border border-border px-4"
                            href={`/funds/${fund.coreVault}?view=manager`}
                          >
                            {t("manage")}
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
      {pending ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open) setPending(null);
          }}
          title={managerT("fundBuilder.drafts.deleteTitle")}
          body={managerT("fundBuilder.drafts.deleteBody", {
            name: pending.name ?? managerT("fundBuilder.drafts.unnamed"),
          })}
          confirmLabel={managerT("fundBuilder.drafts.delete")}
          cancelLabel={common("cancel")}
          onConfirm={confirmDelete}
          tone="destructive"
        />
      ) : null}
    </ConsoleShell>
  );
}
