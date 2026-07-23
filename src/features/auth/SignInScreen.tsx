/**
 * @id PP-AUTH-SCR-001
 * @name Sign in / Sign up
 * @implements-rules-version v1
 *
 * Unified pre-auth entry. Two methods only: Continue with Google (Maria → Privy embedded wallet)
 * and Connect a wallet (Carlos → external wallet). Responsive: mobile stacks the brand above the
 * actions; desktop is a 50/50 split (brand panel | action panel). Google routes through Wallet
 * ready (PP-AUTH-SCR-003) only on first wallet creation, otherwise straight to Home; Connect a
 * wallet opens the connector picker (PP-AUTH-SCR-004).
 */
"use client";

import { ExternalLink } from "lucide-react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Link, useRouter } from "@/i18n/navigation";
import { useAnalytics } from "@/lib/analytics/useAnalytics";
import { useAuth } from "@/lib/auth/useAuth";
import { authService, isMockMode } from "@/lib/services";
import { AuthMethodButton } from "./components/AuthMethodButton";
import { AuthShell } from "./components/AuthShell";

/** Which method is mid-flight, so we can show a spinner and lock the other button. */
type Pending = "google" | "wallet" | null;

/** The Sign in / Sign up screen. */
export function SignInScreen() {
  const t = useTranslations("auth");
  const tErrors = useTranslations("errors");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const { track } = useAnalytics();
  const auth = useAuth();
  const [pending, setPending] = useState<Pending>(null);
  const [mockError, setMockError] = useState(false);

  // Clear pending when Privy flow finishes (real mode). isLoggingIn goes false on complete/error.
  useEffect(() => {
    if (!isMockMode && !auth.isLoggingIn) {
      setPending(null);
    }
  }, [auth.isLoggingIn]);

  // [POO-200 AC1/AC2] Route based on login result when authenticated in real mode.
  // New Google user → /welcome; returning user or external wallet → /.
  // [POO-200 AC5] Fire auth_signin_completed with user_id (address) and chain_id.
  useEffect(() => {
    if (!isMockMode && auth.isAuthenticated && auth.loginResult) {
      track("auth_signin_completed", {
        user_id: auth.address,
        // PP-INTEGRATION-POINT: chain_id comes from wagmi; available once wallet is connected.
      });
      if (auth.loginResult.isNewUser && auth.loginResult.loginMethod === "google") {
        router.push("/welcome");
      } else {
        router.push("/");
      }
    }
  }, [auth.isAuthenticated, auth.loginResult, auth.address, router, track]);

  async function handleGoogle() {
    setMockError(false);
    track("auth_signin_started");

    if (!isMockMode) {
      // Real mode: open Privy's popup scoped to Google OAuth only.
      // auth.isLoggingIn stays true until onComplete/onError (POO-200 AC3).
      // Error state is surfaced via auth.error (POO-199).
      setPending("google");
      auth.login("google");
      return;
    }

    // Mock mode: use the mock authService for deterministic testing.
    setPending("google");
    try {
      const session = await authService.loginWithGoogle();
      track("auth_signin_completed");
      router.push(session.isNewWallet ? "/welcome" : "/");
    } catch (err) {
      console.error("Google sign-in failed", err);
      track("auth_signin_failed");
      setMockError(true);
      setPending(null);
    }
  }

  function handleWallet() {
    if (!isMockMode) {
      // Real mode: open Privy's popup scoped to wallet connectors only.
      // auth.isLoggingIn stays true until onComplete/onError (POO-200 AC3).
      setPending("wallet");
      auth.login("wallet");
      return;
    }
    // Mock mode: navigate to the connector picker screen.
    setPending("wallet");
    router.push("/connect");
  }

  // [POO-200 AC3] Unified in-flight state: mock uses local pending, real uses auth.isLoggingIn.
  const isBusy = isMockMode ? pending !== null : auth.isLoggingIn;

  // [R5] Resolve the error message from auth.error (real mode) or mockError (mock mode).
  const errorMessage = (() => {
    // Real mode: use classified error from useAuth.
    if (!isMockMode && auth.error) {
      if (auth.error === "cancelled") return null; // [R2] Silent no-op
      if (auth.error === "unsupported-chain") return tErrors("auth.unsupportedChain");
      return tErrors("auth.networkFailure"); // "network" and any other
    }
    // Mock mode: generic fallback.
    if (mockError) return tErrors("somethingWentWrong");
    return null;
  })();

  return (
    <AuthShell>
      <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col lg:grid lg:grid-cols-2">
        {/* Brand panel — top on mobile, left on desktop. */}
        <section className="flex flex-1 flex-col items-center justify-center px-6 pt-24 pb-8 text-center lg:border-border/50 lg:border-r lg:py-0">
          {/* Decorative: the visible heading already names the brand. */}
          <Image
            src="/brand/duck-head.png"
            alt=""
            aria-hidden="true"
            width={160}
            height={160}
            className="h-28 w-28 object-contain lg:h-40 lg:w-40"
          />
          <h1 className="mt-6 text-balance font-bold text-3xl lg:text-4xl">
            {t("signIn.welcomeTitle")}
          </h1>
          <p className="mt-2 text-muted-foreground lg:text-lg">{t("signIn.welcomeSubtitle")}</p>
        </section>

        {/* Action panel — bottom on mobile, right on desktop. */}
        <section className="flex flex-col items-center justify-center px-6 pb-12 lg:py-0">
          <div className="w-full max-w-sm">
            <div className="mb-6 hidden lg:block">
              <h2 className="font-bold text-2xl">{t("signIn.getStarted")}</h2>
              <p className="mt-1 text-muted-foreground text-sm">{t("signIn.getStartedSubtitle")}</p>
            </div>

            <div className="flex flex-col gap-3">
              <AuthMethodButton
                variant="google"
                loading={pending === "google"}
                disabled={isBusy}
                onClick={handleGoogle}
              >
                {t("signIn.continueWithGoogle")}
              </AuthMethodButton>

              <div className="flex items-center gap-3 py-1" aria-hidden="true">
                <span className="h-px flex-1 bg-border" />
                <span className="text-muted-foreground text-xs">{t("signIn.or")}</span>
                <span className="h-px flex-1 bg-border" />
              </div>

              <AuthMethodButton
                variant="wallet"
                loading={pending === "wallet"}
                disabled={isBusy}
                onClick={handleWallet}
              >
                {t("signIn.connectWallet")}
              </AuthMethodButton>
            </div>

            {errorMessage ? (
              <p role="alert" className="mt-4 text-center text-destructive text-sm">
                {errorMessage}
              </p>
            ) : null}

            <p className="mt-6 text-center text-[11px] text-muted-foreground/70 leading-relaxed">
              {t("signIn.termsPrefix")}{" "}
              <Link
                href="/terms"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-0.5 text-muted-foreground hover:underline"
              >
                {t("signIn.termsLink")}
                <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
                <span className="sr-only">{tCommon("opensInNewTab")}</span>
              </Link>{" "}
              {t("signIn.termsAnd")}{" "}
              <Link
                href="/privacy"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-0.5 text-muted-foreground hover:underline"
              >
                {t("signIn.privacyLink")}
                <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
                <span className="sr-only">{tCommon("opensInNewTab")}</span>
              </Link>
            </p>
          </div>
        </section>
      </div>
    </AuthShell>
  );
}
