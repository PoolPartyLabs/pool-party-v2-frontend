/**
 * @id PP-CORE-CMP-025
 * @name WalletMenu
 * @implements-rules-version v1
 *
 * The wallet entry point in the app chrome (header). When a wallet is connected it renders the
 * connected chip (identicon + masked address + total balance) that opens {@link WalletModal}; when
 * not connected it falls back to the existing Connect/Login button (Privy popup in real mode, the
 * sign-in route in mock mode). Owns the modal open state and wires the action handlers
 * (Buy/Receive -> deposit on-ramp, Manage -> profile, Disconnect -> logout).
 *
 * Business rules: POO-238 [R1, R2, R3]. This is the single AppShell seam for the wallet stack
 * (INT-W); it reads connected state from useAuth and balances from the wallet balance source.
 */
"use client";

import { Wallet } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { signOutAction } from "@/features/auth/siweActions";
import { useRouter } from "@/i18n/navigation";
import { useAccountService } from "@/lib/account/useAccountService";
import { useAuth } from "@/lib/auth/useAuth";
import { useTokenBalances } from "@/lib/balances";
import { isMockMode } from "@/lib/services";
import { formatUsd } from "@/lib/utils/format";
import { WalletModal } from "./WalletModal";

/** Identicon brand gradient (decorative identity, not a theme token). */
const IDENTICON_GRADIENT = "linear-gradient(135deg, #c5139f, #f7ce02)";

/** Mask an address to `0x1234…cdef` (first 6 + last 4). */
function maskAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/** Header wallet entry: connected chip + modal, or the connect/login fallback. */
export function WalletMenu() {
  const t = useTranslations("wallet");
  const auth = useAuth();
  const router = useRouter();

  if (auth.isAuthenticated && auth.address) {
    return <ConnectedWallet address={auth.address} onLogout={auth.logout} />;
  }

  // Disconnected: preserve the existing behavior (Privy popup in real mode, sign-in route in mock).
  return (
    <Button
      variant="secondary"
      size="md"
      aria-label={t("connect")}
      onClick={() => {
        if (!isMockMode) {
          auth.login();
          return;
        }
        router.push("/sign-in");
      }}
    >
      <Wallet className="size-4 shrink-0" aria-hidden="true" />
      <span className="hidden sm:inline">{t("connect")}</span>
    </Button>
  );
}

/** The connected state: the header chip that opens the wallet modal, plus the modal itself. */
function ConnectedWallet({ address, onLogout }: { address: string; onLogout: () => void }) {
  const t = useTranslations("wallet");
  const router = useRouter();
  const account = useAccountService();
  const { balances, totalUsd, dayChangeUsd, dayChangePct, isLoading, isRefreshing, refresh } =
    useTokenBalances();
  const [open, setOpen] = useState(false);
  const [walletKind, setWalletKind] = useState<"embedded" | "external">("embedded");

  useEffect(() => {
    let active = true;
    account.getWalletKind().then((kind) => {
      if (active) setWalletKind(kind);
    });
    return () => {
      active = false;
    };
  }, [account]);

  /** Close the modal, then run a navigation (so the route change isn't masked by the overlay). */
  function go(href: string) {
    setOpen(false);
    router.push(href);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t("openWallet")}
        aria-haspopup="dialog"
        className="flex items-center gap-2 rounded-full border border-border bg-surface-raised py-1.5 pr-3 pl-2 text-sm transition-colors hover:bg-surface-raised/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span
          aria-hidden="true"
          className="size-5 shrink-0 rounded-full"
          style={{ backgroundImage: IDENTICON_GRADIENT }}
        />
        <span className="hidden font-medium text-foreground sm:inline">{maskAddress(address)}</span>
        <span
          className="hidden size-1 rounded-full bg-muted-foreground sm:inline"
          aria-hidden="true"
        />
        <span className="font-semibold text-foreground">
          {isLoading ? "…" : formatUsd(totalUsd)}
        </span>
        {/* No trailing icon (murilo 2026-06-11, POO-285 R1): the chip opens a modal, not a
            dropdown — a clean chip beats a misleading directional glyph. */}
      </button>

      <WalletModal
        open={open}
        onOpenChange={setOpen}
        address={address}
        walletKind={walletKind}
        balances={balances}
        totalUsd={totalUsd}
        dayChangeUsd={dayChangeUsd}
        dayChangePct={dayChangePct}
        isLoading={isLoading}
        isRefreshing={isRefreshing}
        onRefresh={refresh}
        onBuy={() => go("/deposit")}
        onReceive={() => go("/deposit?mode=receive")}
        onManage={() => go("/profile/security")}
        onDisconnect={async () => {
          setOpen(false);
          // Kill the server-side SIWE session with the disconnect (POO-890 R1): Privy logout alone
          // leaves the httpOnly Bearer cookie valid for its 7-day maxAge. Awaited before the Privy
          // logout whose auth flip triggers the AuthGuard redirect; a failed clear never blocks it.
          await signOutAction().catch((error) => console.error("Sign-out failed", error));
          onLogout();
        }}
      />
    </>
  );
}
