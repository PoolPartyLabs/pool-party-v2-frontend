/**
 * @id PP-MGR-HOK-021 (POO-2181)
 * @name useV2LaunchStatus
 * @implements-rules-version v2
 * Read-only browser-local launch status without wallet or RPC requests.
 */
"use client";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth/useAuth";
import { getLaunchStatusForDraft } from "./journey";

export function useV2LaunchStatus(draftId: string) {
  const { address } = useAuth();
  const [snapshot, setSnapshot] = useState<{
    draftId: string;
    wallet: string | undefined;
    value: ReturnType<typeof getLaunchStatusForDraft>;
  } | null>(null);
  useEffect(() => {
    const refresh = () =>
      setSnapshot({
        draftId,
        wallet: address,
        value: getLaunchStatusForDraft(draftId, address ?? null),
      });
    refresh();
    window.addEventListener("pp:v2:launch-changed", refresh);
    window.addEventListener("storage", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener("pp:v2:launch-changed", refresh);
      window.removeEventListener("storage", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [draftId, address]);
  return snapshot?.draftId === draftId && snapshot.wallet === address ? snapshot.value : null;
}
