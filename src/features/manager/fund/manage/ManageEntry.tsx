/**
 * @id PP-MGR-SCR-004
 * @name ManageEntry
 * @implements-rules-version v2 (POO-2246; extends POO-2226), v2 (POO-2274)
 * @analytics-events app_error_shown, app_cta_blocked
 * Authorized V2 entry, independent of investor holder reads.
 */
"use client";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { NetworkLogo } from "@/components/data-display/NetworkLogo";
import { useBuildShellLayout } from "@/components/layout/BuildShellLayout";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { useAnalytics } from "@/lib/analytics/useAnalytics";
import { loadManageFundAction } from "@/lib/api/v2/manageActions";
import { useAuth } from "@/lib/auth/useAuth";
import { useSiweSession } from "@/lib/auth/useSiweSession";
import { ManageBlockPanel } from "./ManageBlockPanel";
import { ManageTokenRow, ManageUsd } from "./ManageCanvas";
import { ManageIdleOutputPanel } from "./ManageIdleOutputPanel";
import { ManageScreen } from "./ManageScreen";
import { normalizeManageModel } from "./manageModel";
import { manageInspectionLabelKey } from "./manageSelection";
import { MANAGE_READ_TIMEOUT_MS } from "./useManagePosition";

function ManageLoading() {
  useBuildShellLayout(true);
  const t = useTranslations("manager.manageV2");
  return (
    <article data-manage-loading="" aria-busy="true" className="flex min-w-0 flex-col gap-6">
      <p role="status" className="sr-only">
        {t("loading")}
      </p>
      <Skeleton width="16rem" height="2rem" />
      <div
        data-manage-grid=""
        className="grid min-w-0 grid-cols-1 items-start gap-6 lg:grid-cols-[180px_minmax(0,1fr)_360px] xl:grid-cols-[220px_minmax(0,1fr)_360px]"
      >
        <div className="flex flex-col gap-3">
          <Skeleton height="1rem" />
          <Skeleton height="4rem" />
          <Skeleton height="4rem" />
        </div>
        <Skeleton height="48rem" className="motion-reduce:animate-none" />
        <Skeleton height="32rem" className="motion-reduce:animate-none" />
      </div>
    </article>
  );
}
export function ManageEntry({ core }: { core: string }) {
  const t = useTranslations("manager.manageV2");
  const { address } = useAuth();
  const { isSignedIn } = useSiweSession();
  const { track } = useAnalytics();
  const [attempt, setAttempt] = useState(0);
  const identity = `${core.toLowerCase()}:${address?.toLowerCase() ?? ""}:${isSignedIn}:${attempt}`;
  const [state, setState] = useState<{
    identity: string;
    result: Awaited<ReturnType<typeof loadManageFundAction>>;
  } | null>(null);
  useEffect(() => {
    setState(null);
    if (!address || !isSignedIn) return;
    let active = true;
    const failed = () => {
      if (active)
        setState({
          identity,
          result: { ok: false, error: { status: 503, code: "V2_UNAVAILABLE" } },
        });
    };
    const timer = setTimeout(() => {
      failed();
      active = false;
    }, MANAGE_READ_TIMEOUT_MS);
    // PP-INTEGRATION-POINT: server verifies SIWE owner; no holder or investor funding dependency.
    void loadManageFundAction(core)
      .then((result) => {
        if (active) setState({ identity, result });
        clearTimeout(timer);
      })
      .catch(() => {
        failed();
        clearTimeout(timer);
      });
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [core, address, isSignedIn, identity]);
  const result = state?.identity === identity ? state.result : null;
  const forbidden =
    !address ||
    !isSignedIn ||
    (result &&
      (!result.ok
        ? result.error.status === 401 || result.error.status === 403
        : result.data.wallet.toLowerCase() !== address.toLowerCase() ||
          result.data.fund.manager.toLowerCase() !== address.toLowerCase() ||
          result.data.fund.coreVault.toLowerCase() !== core.toLowerCase()));
  const code = result && !result.ok ? result.error.code : null;
  useEffect(() => {
    if (forbidden)
      track("app_cta_blocked", {
        family: "v2",
        surface: "manager",
        reason: "manage_owner_required",
      });
    else if (code)
      track("app_error_shown", {
        family: "v2",
        surface: "manager",
        error_code: code,
        error_origin: "upstream",
      });
  }, [forbidden, code, track]);
  if (forbidden) return <p role="status">{t("forbidden")}</p>;
  if (!result) return <ManageLoading />;
  if (!result.ok)
    return (
      <div role="alert">
        <p>{t("notAvailable")}</p>
        <Button variant="secondary" onClick={() => setAttempt((value) => value + 1)}>
          {t("retry")}
        </Button>
      </div>
    );
  return (
    <ManageScreen
      key={identity}
      fund={result.data.fund}
      balances={result.data.balances}
      panel={(position, active, inspection, onBack) => (
        <ManageBlockPanel
          fund={result.data.fund}
          position={position}
          active={active}
          inspection={inspection}
          onBack={onBack}
        />
      )}
      inspector={(node, onBack) => {
        const model = normalizeManageModel(result.data.fund, result.data.balances);
        const chain = model.chains.find((chain) => chain.chainId === node.chainId);
        const tokens =
          node.kind === "cash"
            ? chain?.cash
            : node.kind === "idleInput"
              ? chain
                ? [chain.idle]
                : []
              : node.kind === "income"
                ? [model.income]
                : [];
        if (node.kind !== "idleOutput")
          return (
            <section className="flex min-w-0 flex-col gap-4 rounded-2xl border border-border bg-surface p-5">
              <h2 className="font-semibold text-sm">{t("manageBlock")}</h2>
              <header className="flex min-w-0 flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <h3 className="break-words font-semibold text-sm">
                    {node.kind !== "position"
                      ? t(manageInspectionLabelKey[node.kind])
                      : t("notAvailable")}
                  </h3>
                  {node.kind === "bridge" && node.direction ? (
                    <p className="text-muted-foreground text-xs">
                      {t(
                        node.direction === "inbound" ? "inspection.inbound" : "inspection.outbound",
                      )}
                    </p>
                  ) : null}
                </div>
                <span className="flex max-w-full items-center gap-1.5 rounded-lg bg-surface-raised p-1.5 text-xs">
                  {chain ? (
                    <NetworkLogo network={chain.network} name={chain.name} size={18} />
                  ) : null}
                  <span className="min-w-0 break-words">{chain?.name ?? t("notAvailable")}</span>
                </span>
              </header>
              {tokens?.map((token) => (
                <div
                  key={`${token.chainId}:${token.address}:${token.symbol}`}
                  className="flex flex-col gap-2"
                >
                  <ManageTokenRow token={token} />
                  {token.amount.status === "available" && token.valueUsd ? (
                    <ManageUsd read={token.valueUsd} />
                  ) : null}
                </div>
              ))}
              <p role="status" className="text-muted-foreground text-sm">
                {t("notAvailable")}
              </p>
              <Button variant="secondary" className="min-h-11 w-full" onClick={onBack}>
                {t("inspection.backToBlocks")}
              </Button>
            </section>
          );
        const hub = model.chains.find((chain) => chain.chainId === model.hubChainId && chain.hub);
        if (!hub) return null;
        return (
          <ManageIdleOutputPanel
            origin={{ core: model.core, hubChainId: model.hubChainId, token: hub.idle }}
            // PP-INTEGRATION-POINT: POO-2230 authoritative withdrawal queue/cohort/freshness read is not served. No browser dates or reserve assignment are inferred.
            read={{
              core: model.core,
              hubChainId: model.hubChainId,
              status: "unavailable",
              snapshot: null,
            }}
            onBack={onBack}
            onRetry={() =>
              track("app_cta_blocked", {
                family: "v2",
                surface: "manager",
                reason: "withdrawal_queue_unavailable",
              })
            }
          />
        );
      }}
    />
  );
}
