/**
 * @id PP-MGR-SCR-001
 * @name OverviewProfile
 * @implements-rules-version v1 (POO-2245 R9)
 * @analytics-events app_error_shown
 * Independent identity read for the existing profile editor; no V1 financial payload.
 */
"use client";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { useAnalytics } from "@/lib/analytics/useAnalytics";
import { useAuth } from "@/lib/auth/useAuth";
import { useSiweSession } from "@/lib/auth/useSiweSession";
import { useUploadMedia } from "@/lib/media/useUploadMedia";
import type { ManagerProfile } from "@/lib/schemas";
import { isMockMode } from "@/lib/services";
import { getManagerProfileAction } from "../../actions";
import { ManagerProfileTabView } from "../../components/ManagerProfileTabView";

export function OverviewProfile() {
  const t = useTranslations("manager.overviewV2");
  const { address } = useAuth();
  const { isSignedIn } = useSiweSession();
  const { track } = useAnalytics();
  const uploadAvatar = useUploadMedia("avatar");
  const uploadBanner = useUploadMedia("banner");
  const [retry, setRetry] = useState(0);
  const [snapshot, setSnapshot] = useState<{ key: string; profile: ManagerProfile | null } | null>(
    null,
  );
  const key = `${address?.toLowerCase() ?? ""}:${isSignedIn}:${retry}`;
  const canRead = isMockMode || (!!address && isSignedIn);
  const result = snapshot?.key === key ? snapshot : null;
  useEffect(() => {
    if (!canRead) return;
    let active = true;
    const fail = () => {
      if (!active) return;
      active = false;
      setSnapshot({ key, profile: null });
      track("app_error_shown", {
        family: "v2",
        surface: "manager",
        error_code: "MANAGER_PROFILE_UNAVAILABLE",
        error_origin: "upstream",
      });
    };
    const timer = setTimeout(fail, 30_000);
    // PP-INTEGRATION-POINT: existing profile registry; writes/uploads stay in the shared editor.
    void getManagerProfileAction()
      .then((profile) => {
        if (!active) return;
        if (
          !profile ||
          (!isMockMode && profile.address?.toLowerCase() !== address?.toLowerCase())
        ) {
          fail();
          return;
        }
        clearTimeout(timer);
        setSnapshot({ key, profile });
        active = false;
      })
      .catch(fail);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [canRead, address, key, track]);
  if (!canRead) return <p role="status">{t("session")}</p>;
  if (!result)
    return (
      <div role="status" aria-busy="true">
        <span className="sr-only">{t("loading")}</span>
        <Skeleton height={320} />
      </div>
    );
  if (!result.profile)
    return (
      <div role="alert">
        <p>{t("notAvailable")}</p>
        <Button variant="secondary" className="mt-4" onClick={() => setRetry((n) => n + 1)}>
          {t("retry")}
        </Button>
      </div>
    );
  return (
    <ManagerProfileTabView
      key={key}
      profile={result.profile}
      onSaved={(profile) => setSnapshot({ key, profile })}
      onUploadAvatar={isMockMode ? undefined : uploadAvatar}
      onUploadBanner={isMockMode ? undefined : uploadBanner}
    />
  );
}
