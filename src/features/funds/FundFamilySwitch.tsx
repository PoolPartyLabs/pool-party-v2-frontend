/**
 * @id PP-STR-SCR-004 (POO-2175)
 * POO-2245 rules v1 adds the V2 Overview presentation without changing V1 defaults.
 * @name FundFamilySwitch
 * @implements-rules-version v2; POO-2215 rules v1
 * Additive route boundary preserving the existing toggle and V1 elements.
 */
"use client";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { ManagerOverviewV2 } from "@/features/manager/fund/overview/ManagerOverviewV2";
import { useFeatureFlags } from "@/lib/features/useFeatureFlags";
import { useContractFamily } from "@/lib/hooks/useContractFamily";
import { InvestorListLoader } from "./InvestorListLoader";
export interface FundFamilySwitchProps {
  v1: ReactNode;
  view: "explore" | "holder" | "manager";
}
export function FundFamilySwitch({ v1, view }: FundFamilySwitchProps) {
  const { isEnabled } = useFeatureFlags();
  const { family, hydrated } = useContractFamily();
  const t = useTranslations("strategies.funds");
  if (!isEnabled("fundContracts")) return v1;
  if (!hydrated) return <p role="status">{t("loading")}</p>;
  return family === "v2" ? (
    view === "manager" ? (
      <ManagerOverviewV2 />
    ) : (
      <InvestorListLoader view={view} />
    )
  ) : (
    v1
  );
}
