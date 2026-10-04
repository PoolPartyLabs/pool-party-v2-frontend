/**
 * @id PP-MGR-SCR-005 (private client child)
 * @name LocalManagerFollow
 * @implements-rules-version v1 (POO-2209); v1 (POO-2223)
 * @analytics-events none, local demonstration without a backend follow outcome
 */
"use client";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { useContractFamily } from "@/lib/hooks/useContractFamily";

interface LocalManagerFollowProps {
  /** Optional shared state for responsive copies of the same manager card. */
  following?: boolean;
  /** Receives the next local state; no persistence or social API call. */
  onFollowingChange?: (following: boolean) => void;
}
export function LocalManagerFollow({
  following: controlled,
  onFollowingChange,
}: LocalManagerFollowProps = {}) {
  const { family } = useContractFamily();
  // PP-INTEGRATION-POINT: replace local state with a manager-identity follow service when wired;
  // no persisted relationship or follower count is produced by this presentation.
  const [localFollowing, setLocalFollowing] = useState(false);
  const following = controlled ?? localFollowing;
  const t = useTranslations("manager.profile");
  if (family !== "v2") return null;
  return (
    <Button
      aria-pressed={following}
      onClick={() => {
        const next = !following;
        if (onFollowingChange) onFollowingChange(next);
        else setLocalFollowing(next);
      }}
    >
      {t(following ? "following" : "follow")}
    </Button>
  );
}
