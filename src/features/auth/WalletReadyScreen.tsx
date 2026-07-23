/**
 * @id PP-AUTH-SCR-003 (POO-201)
 * @name Wallet ready (Privy)
 * @implements-rules-version v1
 *
 * Maria's post-Google outcome screen: confirms the embedded wallet was provisioned. Reassurance
 * copy (secured on this device, no seed phrase) + a "Secured by Privy" chip. Single CTA → Home.
 *
 * POO-201: Gated to new Google users only. Returning users, wallet users, and direct
 * navigation (loginResult is null after refresh) redirect to /. Shows exactly once.
 */
"use client";

import { Lock, ShieldCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { Button } from "@/components/ui/Button";
import { useRouter } from "@/i18n/navigation";
import { useTrackView } from "@/lib/analytics/useTrackView";
import { useAuth } from "@/lib/auth/useAuth";
import { AuthShell } from "./components/AuthShell";

/** The Wallet ready (Privy) screen. */
export function WalletReadyScreen() {
  const t = useTranslations("auth");
  const router = useRouter();
  const auth = useAuth();
  useTrackView("auth_wallet_ready_viewed");

  // [POO-201] Only new Google users see this screen. Everyone else → Home.
  const isNewGoogleUser =
    auth.loginResult?.isNewUser === true && auth.loginResult.loginMethod === "google";

  useEffect(() => {
    if (!isNewGoogleUser) {
      router.replace("/");
    }
  }, [isNewGoogleUser, router]);

  // Don't render content while redirecting.
  if (!isNewGoogleUser) return null;

  return (
    <AuthShell>
      <div className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
        <div className="relative mb-8 flex size-24 items-center justify-center">
          <span
            aria-hidden="true"
            className="absolute inset-0 rounded-full bg-primary/20 blur-2xl"
          />
          <span className="relative flex size-20 items-center justify-center rounded-full bg-primary/15 ring-1 ring-primary/30">
            <ShieldCheck className="size-10 text-primary" aria-hidden="true" />
          </span>
        </div>

        <h1 className="font-bold text-2xl lg:text-3xl">{t("walletReady.title")}</h1>
        <p className="mt-3 max-w-sm text-muted-foreground">{t("walletReady.subtitle")}</p>

        <span className="mt-5 inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1.5 text-muted-foreground text-xs">
          <Lock className="size-3.5" aria-hidden="true" />
          {t("walletReady.securedBy")}
        </span>

        <div className="mt-10 w-full max-w-sm">
          <Button size="lg" className="w-full" onClick={() => router.push("/")}>
            {t("walletReady.continue")}
          </Button>
        </div>
      </div>
    </AuthShell>
  );
}
