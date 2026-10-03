/**
 * @id PP-STR-SCR-004 (POO-2175)
 * @name FundFamilySwitch
 * @implements-rules-version v2
 * Additive route boundary preserving the existing toggle and V1 elements.
 */
"use client";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { useFeatureFlags } from "@/lib/features/useFeatureFlags";
import { useContractFamily } from "@/lib/hooks/useContractFamily";
import { FundExplorer } from "./FundExplorer";
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
  return family === "v2" ? <FundExplorer view={view} /> : v1;
}
