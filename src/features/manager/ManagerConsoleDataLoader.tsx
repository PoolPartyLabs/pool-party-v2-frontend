/**
 * @id PP-MGR-SCR-001 (POO-224)
 * @name Manager console data loader
 * @implements-rules-version v1
 *
 * Real-mode client boundary for the manager console. Waits for the SIWE session, fetches the
 * signed-in wallet's managed strategies + derived dashboard via getManagerConsoleAction, and
 * renders ManagerConsoleScreen. Skeleton until it resolves; a real failure bubbles to the route
 * error boundary. Used only when isMockMode is false; mock mode SSRs the console directly.
 */
"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Skeleton } from "@/components/ui/Skeleton";
import { SkeletonTable, SkeletonTiles } from "@/components/ui/skeletons";
import { useSiweSession } from "@/lib/auth/useSiweSession";
import { useUploadMedia } from "@/lib/media/useUploadMedia";
import { useOwnerProfileSession } from "@/lib/profile/useOwnerProfileSession";
import { usePostWriteRefresh } from "@/lib/tx/usePostWriteRefresh";
import {
  getManagerConsoleAction,
  getManagerStrategyDetailAction,
  type ManagerConsolePayload,
} from "./actions";
import { ManagerConsoleScreen } from "./ManagerConsoleScreen";

/** Loading placeholder for the manager console Overview. */
function ManagerConsoleSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <Skeleton height={180} radius="0.75rem" />
      <SkeletonTiles count={4} />
      <SkeletonTable rows={4} />
    </div>
  );
}

/** Public props for {@link ManagerConsoleDataLoader}. */
export interface ManagerConsoleDataLoaderProps {
  /** Strategy id to open directly in the manage view on mount (from /manager?manage=<id>, POO-224). */
  initialManageId?: string;
  /** POO-704: the owner's PUBLIC `displayName` (`/users/me`), resolved server-side by the page and
   * forwarded to the console greeting; blank/absent falls back to the masked wallet. */
  displayName?: string;
}

/** Fetches the signed-in wallet's manager console and renders it. */
export function ManagerConsoleDataLoader({
  initialManageId,
  displayName,
}: ManagerConsoleDataLoaderProps = {}) {
  const { isSignedIn, status } = useSiweSession();
  // POO-694/POO-707: real-mode Profile-tab avatar / banner uploads. Mints (session-authorized, NO wallet
  // signature — POO-707 [R2]) + uploads to S3 and resolves the trusted CDN URL the Profile tab uploads
  // at Save and stages into its registry write. Mirrors PersonalInfoDataLoader.
  const uploadAvatar = useUploadMedia("avatar");
  const uploadBanner = useUploadMedia("banner");
  // POO-779 R2: flip the shared role to manager locally on a create-pool success (below), so the sidebar
  // shows "Manager" immediately without a role refetch (the backend already flipped it at confirm).
  const { markManager } = useOwnerProfileSession();
  const [data, setData] = useState<ManagerConsolePayload | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshTick is an intentional re-fetch trigger — bumping it re-runs the effect though the body doesn't read it.
  useEffect(() => {
    if (status === "error") {
      setError(new Error("Could not establish a wallet session"));
      return;
    }
    if (!isSignedIn) {
      setData(null);
      setError(null);
      return;
    }

    let active = true;
    // Refresh in place: don't clear data, so a refreshTick bump (post-write / created poll) keeps the
    // current console rendered instead of flashing the skeleton (mirrors usePositions / detail loader).
    setError(null);
    getManagerConsoleAction()
      .then((next) => {
        if (active) setData(next);
      })
      .catch((err) => {
        if (active) setError(err);
      });
    return () => {
      active = false;
    };
  }, [isSignedIn, status, refreshTick]);

  // Force a re-fetch after a manage mutation (collect/move-range/close), so the console reflects the
  // new on-chain state without waiting for a sign-in change (router.refresh() alone can't re-run this
  // hook). Mirrors usePositions().refresh().
  const refresh = useCallback(() => setRefreshTick((tick) => tick + 1), []);

  // After create-pool (ReviewStep navigates to /manager?created=1), poll the console in place until
  // the new strategy surfaces from the backend, then strip the flag so a manual refresh doesn't re-poll.
  const searchParams = useSearchParams();
  const postWriteRefresh = usePostWriteRefresh(refresh);
  const createdHandledRef = useRef(false);
  useEffect(() => {
    if (!data || createdHandledRef.current || searchParams.get("created") == null) return;
    createdHandledRef.current = true;
    // POO-779 R2: a first-time manager's session profile was read as investor before this create-pool;
    // flip the shared store locally so the sidebar Manager entry appears without a role refetch.
    markManager();
    window.history.replaceState(null, "", window.location.pathname);
    postWriteRefresh();
  }, [data, searchParams, postWriteRefresh, markManager]);

  if (error) throw error;
  if (!data) return <ManagerConsoleSkeleton />;

  return (
    <ManagerConsoleScreen
      dashboard={data.dashboard}
      strategies={data.strategies}
      profile={data.profile}
      getStrategyDetail={getManagerStrategyDetailAction}
      onConsoleRefresh={refresh}
      initialManageId={initialManageId}
      onUploadAvatar={uploadAvatar}
      onUploadBanner={uploadBanner}
      displayName={displayName}
    />
  );
}
