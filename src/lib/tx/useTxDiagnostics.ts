/**
 * @id PP-CORE-LIB-012
 * @name useTxDiagnostics
 * @implements-rules-version v1
 *
 * Client hook assembling the {@link TxDiagnostics} snapshot for the error-details box
 * (PP-CORE-MOD-002 v2, POO-279 R1): browser + OS from the navigator, wallet kind from the
 * account service (Privy embedded vs external connector), active language from next-intl.
 */
"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { accountService } from "@/lib/services";
import { collectUserAgentInfo, languageLabel, type TxDiagnostics } from "./diagnostics";

/** The current environment snapshot (wallet resolves async; starts as the unknown label). */
export function useTxDiagnostics(): TxDiagnostics {
  const t = useTranslations("strategies");
  const locale = useLocale();
  const [wallet, setWallet] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    accountService
      .getWalletKind()
      .then((kind) => {
        if (!cancelled) {
          setWallet(
            kind === "embedded" ? t("flow.error.walletEmbedded") : t("flow.error.walletExternal"),
          );
        }
      })
      .catch(() => {
        // leave the unknown label
      });
    return () => {
      cancelled = true;
    };
  }, [t]);

  const { browser, os } = collectUserAgentInfo();
  return {
    browser,
    os,
    // Locale-neutral em dash while the service resolves (or fails): "…" read as if loading were
    // part of the copied support payload.
    wallet: wallet ?? "—",
    language: languageLabel(locale),
  };
}
