/**
 * @id PP-CP-SCR-001
 * @name CashPlusScreen
 * @i18n-namespace cashPlus
 * @implements-rules-version v1
 * Connects the dedicated investor page to direct chain reads and the current wallet.
 */
"use client";
import { CashPlusView } from "./components/CashPlusView";
import { useCashPlus } from "./hooks/useCashPlus";

export function CashPlusScreen() {
  // PP-INTEGRATION-POINT: direct contract reads and current-wallet operations remain inside Cash+.
  const controller = useCashPlus();
  return <CashPlusView controller={controller} />;
}
