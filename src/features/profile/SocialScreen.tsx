/**
 * @id PP-PROF-SCR-003 (POO-110, POO-581, POO-637, POO-732)
 * @name Linked social accounts
 * @implements-rules-version v2
 *
 * v2 (POO-732): each provider renders its real brand mark ({@link socialBrandMarks}) instead of a
 * generic lucide glyph (R1), and the intro leads with the rewards value prop instead of "sign in
 * faster" (R2, i18n `profile.social.intro`). Connect/disconnect behavior is unchanged (R3).
 *
 * A featured Telegram card (required for notifications) + an "Other accounts" list (X, Google,
 * Discord) — no Apple. The connected state + stored handle come from the server
 * (`GET /users/:address/linked-accounts`, POO-581): an empty `accounts` list means every provider is
 * disconnected (google's handle is omitted as PII on the open read, so a connected google shows no
 * handle line). A connected row can be disconnected via the signed-write `onDisconnect` (POO-637). The
 * CONNECT affordance is intentionally inert (disabled) for now — the connect input UX (provider link /
 * gmail address) is undecided and tracked separately, so no connection is ever fabricated. Wrapped in
 * the shared SettingsLayout.
 */
"use client";

import { BellOff, Check } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ComponentType, SVGProps } from "react";
import { useState } from "react";
import type { LinkedAccount, LinkedAccountProvider } from "@/lib/profile/linkedAccountsSchema";
import { SettingsLayout } from "./components/SettingsLayout";
import { SettingsSection } from "./components/SettingsSection";
import { DiscordMark, GoogleMark, TelegramMark, XMark } from "./components/socialBrandMarks";

/**
 * The trailing account action. Connected → a disconnect toggle (success style, click disconnects,
 * disabled while the write is in flight or when no disconnect is wired). Disconnected → the primary
 * connect button, rendered DISABLED (connect is inert until its input UX is decided).
 */
function AccountAction({
  connected,
  pending,
  connectLabel,
  connectedLabel,
  onDisconnect,
}: {
  connected: boolean;
  pending: boolean;
  connectLabel: string;
  connectedLabel: string;
  onDisconnect?: () => void;
}) {
  if (connected) {
    return (
      <button
        type="button"
        onClick={onDisconnect}
        disabled={pending || !onDisconnect}
        className="inline-flex shrink-0 items-center gap-1 rounded-full px-3 py-1.5 font-medium text-sm text-success transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
      >
        <Check className="size-4" aria-hidden="true" />
        {connectedLabel}
      </button>
    );
  }
  return (
    <button
      type="button"
      disabled
      aria-disabled="true"
      className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary px-3 py-1.5 font-medium text-primary-foreground text-sm opacity-50"
    >
      {connectLabel}
    </button>
  );
}

/** Public props for {@link SocialScreen}. */
export interface SocialScreenProps {
  /** Connected linked accounts read from the server (empty = all disconnected). Defaults to none. */
  accounts?: LinkedAccount[];
  /**
   * Real-mode signed-write disconnect (POO-637). Omitted in mock mode (nothing is connected there), in
   * which case connected rows render their disconnect toggle disabled.
   */
  onDisconnect?: (provider: LinkedAccountProvider) => Promise<void>;
}

/** Linked social accounts. */
export function SocialScreen({ accounts = [], onDisconnect }: SocialScreenProps) {
  const t = useTranslations("profile");
  // Presence in the list IS the connected state (only connected links persist server-side).
  const byProvider = new Map(accounts.map((account) => [account.provider, account] as const));
  // The provider currently being disconnected, so its control disables while the write is in flight.
  const [pending, setPending] = useState<LinkedAccountProvider | null>(null);

  async function disconnect(provider: LinkedAccountProvider) {
    if (!onDisconnect) return;
    setPending(provider);
    try {
      await onDisconnect(provider);
    } finally {
      setPending(null);
    }
  }

  const telegram = byProvider.get("telegram");
  const telegramConnected = telegram !== undefined;

  const others: {
    key: LinkedAccountProvider;
    icon: ComponentType<SVGProps<SVGSVGElement>>;
    name: string;
  }[] = [
    { key: "x", icon: XMark, name: t("social.x") },
    { key: "google", icon: GoogleMark, name: t("social.google") },
    { key: "discord", icon: DiscordMark, name: t("social.discord") },
  ];

  return (
    <SettingsLayout title={t("social.title")}>
      <p className="text-muted-foreground text-sm">{t("social.intro")}</p>

      {/* Featured Telegram */}
      <div className="rounded-xl border border-info/30 bg-info/5 p-4">
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-info/15 text-info">
            <TelegramMark className="size-5" data-testid="social-icon-telegram" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="font-semibold text-foreground">{t("social.telegram.name")}</p>
              {/* Notifications run through Telegram, so the pill tracks the connected state. */}
              {telegramConnected ? null : (
                <span className="inline-flex items-center gap-1 rounded-full bg-warning/15 px-2 py-0.5 font-medium text-warning text-xs">
                  <BellOff className="size-3" aria-hidden="true" />
                  {t("social.telegram.notifOff")}
                </span>
              )}
            </div>
            <p className="mt-1 text-muted-foreground text-sm">{t("social.telegram.body")}</p>
            {telegramConnected && telegram?.handle ? (
              <p className="mt-1 truncate text-muted-foreground text-xs">{telegram.handle}</p>
            ) : null}
          </div>
        </div>
        {telegramConnected ? (
          <button
            type="button"
            onClick={() => disconnect("telegram")}
            disabled={pending === "telegram" || !onDisconnect}
            className="mt-4 inline-flex h-10 w-full items-center justify-center gap-1 font-medium text-sm text-success transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
          >
            <Check className="size-4" aria-hidden="true" />
            {t("connected")}
          </button>
        ) : (
          <button
            type="button"
            disabled
            aria-disabled="true"
            className="mt-4 inline-flex h-10 w-full items-center justify-center rounded-md bg-primary font-semibold text-primary-foreground text-sm opacity-50"
          >
            {t("social.telegram.connect")}
          </button>
        )}
      </div>

      {/* Other accounts */}
      <SettingsSection label={t("social.others")}>
        {others.map((acc) => {
          const account = byProvider.get(acc.key);
          const connected = account !== undefined;
          return (
            <div key={acc.key} className="flex items-center gap-3 px-4 py-3.5">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-raised text-muted-foreground">
                <acc.icon className="size-4" data-testid={`social-icon-${acc.key}`} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-medium text-foreground text-sm">{acc.name}</span>
                {connected && account?.handle ? (
                  <span className="block truncate text-muted-foreground text-xs">
                    {account.handle}
                  </span>
                ) : null}
              </span>
              <AccountAction
                connected={connected}
                pending={pending === acc.key}
                connectLabel={t("connect")}
                connectedLabel={t("connected")}
                onDisconnect={onDisconnect ? () => disconnect(acc.key) : undefined}
              />
            </div>
          );
        })}
      </SettingsSection>
    </SettingsLayout>
  );
}
