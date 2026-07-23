/**
 * @id PP-AUTH-SCR-004
 * @name Connect wallet
 * @implements-rules-version v1
 *
 * Carlos's own-wallet path: pick a connector (MetaMask / WalletConnect / Coinbase / Phantom) →
 * connect → Home (no Privy "wallet ready" step; Carlos brings his own custody). Each row shows a
 * short descriptor; a Back link returns to Sign in, and "Learn more" opens the in-app wallets guide.
 * Connector brand marks are placeholders for now (neutral wallet icon).
 */
"use client";

import { ChevronLeft, ChevronRight, Loader2, Wallet } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Link, useRouter } from "@/i18n/navigation";
import { useAnalytics } from "@/lib/analytics/useAnalytics";
import { authService } from "@/lib/services";
import { AuthShell } from "./components/AuthShell";

/** The Connect wallet screen. */
export function ConnectWalletScreen() {
  const t = useTranslations("auth");
  const tErrors = useTranslations("errors");
  const router = useRouter();
  const { track } = useAnalytics();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState(false);

  // Literal t() calls (not dynamic keys) so the i18n used-key scan resolves every label.
  const connectors = [
    { id: "metamask", label: t("connect.metamask"), sub: t("connect.metamaskSub") },
    { id: "walletConnect", label: t("connect.walletConnect"), sub: t("connect.walletConnectSub") },
    { id: "coinbase", label: t("connect.coinbase"), sub: t("connect.coinbaseSub") },
    { id: "phantom", label: t("connect.phantom"), sub: t("connect.phantomSub") },
  ];

  async function handleConnect(id: string) {
    setPending(id);
    setError(false);
    track("wallet_connect_started");
    try {
      // PP-INTEGRATION-POINT: external wallet connectors (wagmi / Privy).
      await authService.connectWallet(id);
      // user_id (hashed wallet) + chain_id ride with POO-164 / real Privy.
      track("wallet_connect_completed");
      router.push("/");
    } catch (err) {
      console.error("Wallet connect failed", err);
      track("wallet_connect_failed");
      setError(true);
      setPending(null);
    }
  }

  return (
    <AuthShell>
      <div className="relative flex min-h-screen flex-col items-center justify-center px-6">
        <Link
          href="/sign-in"
          className="absolute top-4 left-4 inline-flex items-center gap-1 text-muted-foreground text-sm hover:text-foreground"
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
          {t("connect.back")}
        </Link>

        <div className="w-full max-w-sm">
          <div className="mb-6 text-center">
            <h1 className="font-bold text-2xl">{t("connect.title")}</h1>
            <p className="mt-2 text-muted-foreground text-sm">{t("connect.subtitle")}</p>
          </div>

          <ul className="flex flex-col gap-3">
            {connectors.map((connector) => (
              <li key={connector.id}>
                <button
                  type="button"
                  disabled={pending !== null}
                  onClick={() => handleConnect(connector.id)}
                  className="flex w-full items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3.5 text-left transition-colors hover:bg-surface-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-raised">
                    {pending === connector.id ? (
                      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <Wallet className="size-4 text-muted-foreground" aria-hidden="true" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium text-sm">{connector.label}</span>
                    <span className="block text-muted-foreground text-xs">{connector.sub}</span>
                  </span>
                  <ChevronRight
                    className="size-4 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                </button>
              </li>
            ))}
          </ul>

          {error ? (
            <p role="alert" className="mt-4 text-center text-destructive text-sm">
              {tErrors("somethingWentWrong")}
            </p>
          ) : null}

          <p className="mt-6 text-center text-muted-foreground text-sm">
            {t("connect.newToWallets")}{" "}
            <Link href="/learn/wallets" className="font-medium text-primary hover:underline">
              {t("connect.learnMore")}
            </Link>
          </p>
        </div>
      </div>
    </AuthShell>
  );
}
