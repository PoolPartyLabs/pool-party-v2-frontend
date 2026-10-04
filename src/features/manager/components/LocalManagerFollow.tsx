/**
 * @id PP-MGR-SCR-005 (private client child)
 * @name LocalManagerFollow
 * @implements-rules-version v1 (POO-2209)
 * @analytics-events none, local demonstration without a backend follow outcome
 */
"use client";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { useContractFamily } from "@/lib/hooks/useContractFamily";
export function LocalManagerFollow() {
  const { family } = useContractFamily();
  const [following, setFollowing] = useState(false);
  const t = useTranslations("manager.profile");
  if (family !== "v2") return null;
  return (
    <Button aria-pressed={following} onClick={() => setFollowing((value) => !value)}>
      {t(following ? "following" : "follow")}
    </Button>
  );
}
