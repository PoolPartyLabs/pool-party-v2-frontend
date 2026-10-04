/**
 * @id PP-MGR-SCR-004
 * @name ManageEntry
 * @implements-rules-version v1 (POO-2226)
 * @analytics-events app_error_shown, app_cta_blocked
 * Authorized V2 entry, independent of investor holder reads.
 */
"use client";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { useAnalytics } from "@/lib/analytics/useAnalytics";
import { loadManageFundAction } from "@/lib/api/v2/manageActions";
import { useAuth } from "@/lib/auth/useAuth";
import { useSiweSession } from "@/lib/auth/useSiweSession";
import { ManageBlockPanel } from "./ManageBlockPanel";
import { ManageScreen } from "./ManageScreen";
import { MANAGE_READ_TIMEOUT_MS } from "./useManagePosition";
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
  if (!result) return <p role="status">{t("loading")}</p>;
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
      panel={(position, active) => (
        <ManageBlockPanel fund={result.data.fund} position={position} active={active} />
      )}
    />
  );
}
