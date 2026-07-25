/**
 * @id PP-CORE-MOD-005
 * @name WalletModal
 * @implements-rules-version v1
 *
 * Connected-wallet modal: the surface that opens from the wallet chip in the app chrome. Shows the
 * account (masked address + kind + copy), the total balance across networks, four quick actions
 * (Buy / Swap / Send / Receive), a network filter, and the per-token balances (token amount AND
 * USD value, per the transaction-display rule). Renders a bottom-sheet on mobile and a centered
 * dialog on desktop, composed directly on @radix-ui/react-dialog (no bottom-sheet primitive exists
 * yet). Presentational: all data and side-effects (navigation, disconnect) come from props.
 *
 * Business rules: POO-238 [R1-R9], POO-285 [R2]. Buy and Receive navigate to the deposit on-ramp;
 * Send opens an in-modal "coming soon" placeholder (POO-241).
 *
 * POO-1046 [R4] (hackathon POO-1022): Swap is the "coming soon" it has been since POO-240 UNTIL the
 * host passes {@link WalletModalProps.onSwap}, which it does only when the `swapScreen` flag is on.
 * The prop is the whole switch, deliberately: this component stays presentational and knows nothing
 * about flags, and with the flag off the modal is byte-identical to what shipped.
 */
"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  Check,
  ChevronRight,
  Coins,
  Copy,
  type LucideIcon,
  Plus,
  RefreshCw,
  X,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { NetworkLogo } from "@/components/data-display/NetworkLogo";
import { groupWalletBalances, type TokenBalance } from "@/lib/balances";
import { resolveTokenLogo } from "@/lib/tokens/tokenLogo";
import { cn } from "@/lib/utils/cn";
import { formatPercent, formatSignedUsd, formatTokenAmount, formatUsd } from "@/lib/utils/format";
import { networkColor, networkName, networkSlug } from "../networks";

/** Identicon brand gradient (decorative identity, not a theme token). */
const IDENTICON_GRADIENT = "linear-gradient(135deg, #c5139f, #f7ce02)";

/** A deferred action that opens the in-modal placeholder. */
type ComingSoonAction = "send";

/** Public props for {@link WalletModal}. Presentational — data + handlers are injected. */
export interface WalletModalProps {
  /** Whether the modal is open. */
  open: boolean;
  /** Open-state change handler (scrim, Esc, close button). */
  onOpenChange: (open: boolean) => void;
  /** Full checksummed wallet address. */
  address: string;
  /** Wallet kind tag (Privy embedded vs connected external). */
  walletKind: "embedded" | "external";
  /** Token holdings across chains (zero balances already removed). */
  balances: TokenBalance[];
  /** Total USD value across every chain. */
  totalUsd: number;
  /** Mock 24h change in USD. */
  dayChangeUsd: number;
  /** Mock 24h change as a fraction of the total. */
  dayChangePct: number;
  /** Whether balances are still loading. */
  isLoading: boolean;
  /** Whether a manual in-place refresh is running (spins + disables the refresh control). POO-808. */
  isRefreshing?: boolean;
  /** Manually re-read the balance (POO-808). When omitted, the refresh control is not rendered. */
  onRefresh?: () => void;
  /** Open the Buy on-ramp (closes the modal + navigates). */
  onBuy: () => void;
  /** Open the Receive (crypto deposit) screen (closes the modal + navigates). */
  onReceive: () => void;
  /**
   * Open the standalone swap + bridge screen (POO-1046 [R4]). Omitted while the `swapScreen` flag
   * is off, which is what keeps Swap the inert "coming soon" it has been since POO-240.
   */
  onSwap?: () => void;
  /** Open account management (closes the modal + navigates). */
  onManage: () => void;
  /** Disconnect / log out the wallet. */
  onDisconnect: () => void;
}

/** Mask an address to `0x1234…cdef` (first 6 + last 4). */
function maskAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/** The wallet modal. See {@link WalletModalProps}. */
export function WalletModal({
  open,
  onOpenChange,
  address,
  walletKind,
  balances,
  totalUsd,
  dayChangeUsd,
  dayChangePct,
  isLoading,
  isRefreshing = false,
  onRefresh,
  onBuy,
  onReceive,
  onSwap,
  onManage,
  onDisconnect,
}: WalletModalProps) {
  const t = useTranslations("wallet");
  const [comingSoon, setComingSoon] = useState<ComingSoonAction | null>(null);
  const [copied, setCopied] = useState(false);

  // USDC first, then the rest, each dust-filtered (< $1) and sorted by USD desc (POO-814). The total
  // above still counts ALL holdings incl. the hidden dust, so this only shapes the list.
  const groups = groupWalletBalances(balances);
  const isEmpty = !isLoading && groups.usdc.length === 0 && groups.others.length === 0;

  function copyAddress() {
    navigator.clipboard?.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  // Reset the transient sub-view whenever the modal closes, so it reopens on the default screen.
  function handleOpenChange(next: boolean) {
    if (!next) {
      setComingSoon(null);
    }
    onOpenChange(next);
  }

  const signedPct = `${dayChangePct >= 0 ? "+" : "-"}${formatPercent(Math.abs(dayChangePct) * 100)}`;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={handleOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className={cn(
            "fixed inset-0 z-50 bg-background/80 backdrop-blur-sm",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0",
          )}
        />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className={cn(
            // Mobile: bottom sheet.
            "fixed inset-x-0 bottom-0 z-50 flex max-h-[92vh] flex-col gap-5 overflow-y-auto",
            "rounded-t-3xl border-border border-t bg-surface p-5 pb-7 text-foreground",
            "focus-visible:outline-none",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0",
            "data-[state=open]:slide-in-from-bottom-4 data-[state=closed]:slide-out-to-bottom-4",
            // Desktop: centered dialog.
            "sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-full sm:max-w-[26rem]",
            "sm:max-h-[85vh] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-3xl sm:border sm:p-6",
          )}
        >
          {/* Drag handle (mobile only). */}
          <div
            aria-hidden="true"
            className="mx-auto h-1 w-10 shrink-0 rounded-full bg-muted-foreground/40 sm:hidden"
          />

          {/* Header. Title stays mounted in every sub-view for accessibility. */}
          <div className="flex items-center justify-between">
            <DialogPrimitive.Title className="font-semibold text-foreground text-xl">
              {t("title")}
            </DialogPrimitive.Title>
            <DialogPrimitive.Close
              aria-label={t("close")}
              className="flex size-8 items-center justify-center rounded-full bg-surface-raised text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="size-4" aria-hidden="true" />
            </DialogPrimitive.Close>
          </div>

          {comingSoon ? (
            <ComingSoonView action={comingSoon} onBack={() => setComingSoon(null)} />
          ) : (
            <>
              {/* Account chip */}
              <div className="flex items-center gap-2.5 rounded-xl bg-surface-raised px-3 py-2.5">
                <span
                  aria-hidden="true"
                  className="size-6 shrink-0 rounded-full"
                  style={{ backgroundImage: IDENTICON_GRADIENT }}
                />
                <span className="font-medium text-foreground text-sm">{maskAddress(address)}</span>
                <span className="rounded-full bg-surface px-2 py-0.5 text-muted-foreground text-xs">
                  {walletKind === "embedded" ? t("kind.embedded") : t("kind.external")}
                </span>
                <button
                  type="button"
                  onClick={copyAddress}
                  aria-label={t("copyAddress")}
                  className="ml-auto flex items-center gap-1 rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground"
                >
                  {copied ? (
                    <>
                      <Check className="size-4 text-success" aria-hidden="true" />
                      <span className="text-success text-xs" aria-live="polite">
                        {t("copied")}
                      </span>
                    </>
                  ) : (
                    <Copy className="size-4" aria-hidden="true" />
                  )}
                </button>
              </div>

              {/* Total balance */}
              <div className="flex flex-col gap-0.5">
                <span className="font-medium text-muted-foreground text-xs tracking-wide">
                  {t("totalBalance")}
                </span>
                {isLoading ? (
                  <div className="h-9 w-40 animate-pulse rounded-md bg-surface-raised" />
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-3xl text-foreground">
                      {formatUsd(totalUsd)}
                    </span>
                    {/* Manual refresh (POO-808): received tokens don't change the address, so the
                        balance only re-reads on demand. In-place: the total stays put while the
                        icon spins; never blanks to the skeleton. */}
                    {onRefresh ? (
                      <button
                        type="button"
                        onClick={onRefresh}
                        disabled={isRefreshing}
                        aria-label={t("refresh")}
                        aria-busy={isRefreshing || undefined}
                        className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed"
                      >
                        <RefreshCw
                          className={cn("size-4", isRefreshing && "animate-spin")}
                          aria-hidden="true"
                        />
                      </button>
                    ) : null}
                  </div>
                )}
                {isEmpty ? (
                  <span className="text-muted-foreground text-sm">{t("addFunds")}</span>
                ) : (
                  !isLoading && (
                    <span className="text-success text-sm">
                      {t("dayChange", { usd: formatSignedUsd(dayChangeUsd), pct: signedPct })}
                    </span>
                  )
                )}
              </div>

              {/* Quick actions. Always available, even at a zero balance (POO-480). */}
              <div className="flex items-stretch gap-2">
                <ActionButton icon={Plus} label={t("actions.buy")} accent onClick={onBuy} />
                {/* [R4] Live once the host hands it a destination; the inert original otherwise. */}
                <ActionButton
                  icon={ArrowLeftRight}
                  label={t("actions.swap")}
                  onClick={onSwap}
                  {...(onSwap ? {} : { disabledHint: t("comingSoon.title") })}
                />
                <ActionButton
                  icon={ArrowUpRight}
                  label={t("actions.send")}
                  onClick={() => setComingSoon("send")}
                />
                <ActionButton
                  icon={ArrowDownLeft}
                  label={t("actions.receive")}
                  onClick={onReceive}
                />
              </div>

              {/* Holdings across every network (chain-agnostic, no switcher, POO-239). A zero-balance
                  wallet shows a "No assets yet" note here in place of the list; the actions row above
                  and the footer below stay put (POO-480). */}
              {isLoading ? (
                <TokenListSkeleton />
              ) : isEmpty ? (
                <EmptyState />
              ) : (
                <div className="flex flex-col">
                  {groups.usdc.map((balance) => (
                    <TokenRow key={`${balance.symbol}-${balance.chainId}`} balance={balance} />
                  ))}
                  {/* Soft divider between the USDC group and everything else (POO-814 R1). */}
                  {groups.usdc.length > 0 && groups.others.length > 0 ? (
                    <div
                      data-testid="wallet-group-divider"
                      className="my-1 h-px bg-border/60"
                      aria-hidden="true"
                    />
                  ) : null}
                  {groups.others.map((balance) => (
                    <TokenRow key={`${balance.symbol}-${balance.chainId}`} balance={balance} />
                  ))}
                </div>
              )}

              {/* Footer. Always shown. "Manage wallet" is only meaningful for an embedded
                  (social-login) wallet; an external wallet is managed in the user's own wallet app,
                  so it is hidden there (murilo 2026-06-29). Disconnect is always available. */}
              <div
                className={cn(
                  "flex items-center border-border border-t pt-3",
                  walletKind === "embedded" ? "justify-between" : "justify-end",
                )}
              >
                {walletKind === "embedded" ? (
                  <button
                    type="button"
                    onClick={onManage}
                    className="flex items-center gap-1 text-muted-foreground text-sm transition-colors hover:text-foreground"
                  >
                    {t("manage")}
                    <ChevronRight className="size-4" aria-hidden="true" />
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={onDisconnect}
                  className="font-medium text-destructive text-sm transition-colors hover:opacity-80"
                >
                  {t("disconnect")}
                </button>
              </div>
            </>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/**
 * A single quick-action: circular icon button + label. `accent` tints the icon gold (Buy).
 * `disabledHint` renders the action inert (aria-disabled, dimmed) with a hover/focus tooltip AND
 * a fixed caption under the label — the bottom-sheet has no hover, so the hint must read without
 * any interaction (murilo 2026-06-11: caption fixa sob o botão). Stays focusable for keyboard.
 */
function ActionButton({
  icon: Icon,
  label,
  onClick,
  accent = false,
  disabledHint,
}: {
  icon: LucideIcon;
  label: string;
  onClick?: () => void;
  accent?: boolean;
  disabledHint?: string;
}) {
  const disabled = disabledHint != null;
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      aria-disabled={disabled || undefined}
      className={cn(
        "group relative flex flex-1 flex-col items-center gap-2 rounded-lg py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        disabled && "cursor-not-allowed",
      )}
    >
      {disabled ? (
        <span
          role="tooltip"
          className="-top-7 -translate-x-1/2 pointer-events-none absolute left-1/2 whitespace-nowrap rounded-md border border-border bg-surface-raised px-2 py-1 text-foreground text-xs opacity-0 transition-opacity group-focus-visible:opacity-100 group-hover:opacity-100"
        >
          {disabledHint}
        </span>
      ) : null}
      <span
        className={cn(
          "flex size-14 items-center justify-center rounded-full border border-border bg-surface-raised",
          disabled && "opacity-40",
        )}
      >
        <Icon
          className={cn("size-5", accent ? "text-primary" : "text-foreground")}
          aria-hidden="true"
        />
      </span>
      <span
        className={cn(
          "text-xs",
          accent ? "text-foreground" : "text-muted-foreground",
          disabled && "opacity-40",
        )}
      >
        {label}
      </span>
      {disabled ? (
        <span className="-mt-1.5 text-[10px] text-muted-foreground/80">{disabledHint}</span>
      ) : null}
    </button>
  );
}

/** A token balance row: token logo + network-logo badge, symbol + name·network, amount + USD value. */
function TokenRow({ balance }: { balance: TokenBalance }) {
  const decimals = balance.decimals <= 6 ? 2 : 4;
  const slug = networkSlug(balance.chainId);
  // Committed token art first (PP-CORE-LIB-021); fall back to the source logo URL, then a symbol chip.
  const tokenLogo = resolveTokenLogo(balance.symbol, slug) ?? balance.logoUrl;
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <div className="flex min-w-0 items-center gap-3">
        <span className="relative shrink-0">
          {/* Decorative: the symbol label names the token. */}
          {tokenLogo ? (
            <img
              src={tokenLogo}
              alt=""
              aria-hidden="true"
              className="size-9 rounded-full bg-surface-raised object-cover"
            />
          ) : (
            <span
              aria-hidden="true"
              className="flex size-9 items-center justify-center rounded-full bg-surface-raised font-semibold text-[10px] text-muted-foreground"
            >
              {balance.symbol.slice(0, 3).toUpperCase()}
            </span>
          )}
          {/* Network-logo badge (POO-814 R5): the chain's brand logo, replacing the flat color dot. */}
          <NetworkLogo
            network={slug}
            name={networkName(balance.chainId)}
            size={14}
            fallbackColor={networkColor(balance.chainId)}
            className="absolute right-0 bottom-0 ring-2 ring-surface"
          />
        </span>
        <div className="min-w-0">
          <p className="truncate font-semibold text-foreground text-sm">{balance.symbol}</p>
          <p className="truncate text-muted-foreground text-xs">
            {balance.name} &middot; {networkName(balance.chainId)}
          </p>
        </div>
      </div>
      <div className="shrink-0 text-right">
        <p className="font-medium text-foreground text-sm">
          {formatTokenAmount(balance.amount, balance.symbol, decimals)}
        </p>
        <p className="text-muted-foreground text-xs">{formatUsd(balance.usd)}</p>
      </div>
    </div>
  );
}

/** Loading placeholder rows for the token list. */
function TokenListSkeleton() {
  return (
    <div className="flex flex-col gap-2 py-1">
      {[0, 1, 2].map((row) => (
        <div key={row} className="flex items-center gap-3 py-1">
          <div className="size-9 shrink-0 animate-pulse rounded-full bg-surface-raised" />
          <div className="flex flex-1 flex-col gap-1.5">
            <div className="h-3 w-20 animate-pulse rounded bg-surface-raised" />
            <div className="h-2.5 w-28 animate-pulse rounded bg-surface-raised" />
          </div>
          <div className="h-3 w-16 animate-pulse rounded bg-surface-raised" />
        </div>
      ))}
    </div>
  );
}

/**
 * Zero-balance note shown in place of the token list (POO-480). The quick-actions row (Buy / Swap /
 * Send / Receive) and the footer (Manage wallet / Disconnect) stay put around it, so this is an
 * informational placeholder only. Buy / Receive live in the always-present actions row, so the note
 * no longer carries its own CTAs (which would duplicate them).
 */
function EmptyState() {
  const t = useTranslations("wallet");
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl bg-surface-raised px-5 py-7 text-center">
      <span className="flex size-13 items-center justify-center rounded-full bg-surface">
        <Coins className="size-6 text-muted-foreground" aria-hidden="true" />
      </span>
      <p className="font-semibold text-base text-foreground">{t("emptyTitle")}</p>
      <p className="text-muted-foreground text-sm">{t("emptyBody")}</p>
    </div>
  );
}

/** In-modal placeholder for the deferred Send flow (POO-241). Swap is a disabled button instead. */
function ComingSoonView({ onBack }: { action: ComingSoonAction; onBack: () => void }) {
  const t = useTranslations("wallet");
  return (
    <div className="flex flex-col items-center gap-3 px-2 py-8 text-center">
      <span className="flex size-14 items-center justify-center rounded-full bg-surface-raised">
        <ArrowUpRight className="size-6 text-muted-foreground" aria-hidden="true" />
      </span>
      <p className="font-semibold text-foreground text-lg">{t("comingSoon.title")}</p>
      <p className="max-w-xs text-muted-foreground text-sm">{t("comingSoon.send")}</p>
      <button
        type="button"
        onClick={onBack}
        className="mt-2 h-11 w-full rounded-xl bg-surface-raised font-semibold text-foreground text-sm transition-colors hover:bg-surface-raised/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {t("comingSoon.back")}
      </button>
    </div>
  );
}
