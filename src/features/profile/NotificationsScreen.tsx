/**
 * @id PP-PROF-SCR-005
 * @name Alerts & notifications
 * @implements-rules-version v1
 *
 * Grouped notification switches — Delivery (Push / Email / Telegram→Connect), Investing, Money, and
 * From Pool Party — with the documented defaults. Toggles are mock (local). Wrapped in SettingsLayout.
 */
"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Toggle } from "@/components/ui/Toggle";
import { SettingsLayout } from "./components/SettingsLayout";
import { SettingsRow } from "./components/SettingsRow";
import { SettingsSection } from "./components/SettingsSection";

/** Default notification preferences (per the business rules). */
const DEFAULTS = {
  push: true,
  email: true,
  yield: true,
  priceAlerts: true,
  strategyUpdates: false,
  deposits: true,
  withdrawalReady: true,
  rubberRush: true,
  tips: true,
  productNews: false,
};

/** Alerts & notifications. */
export function NotificationsScreen() {
  const t = useTranslations("profile");
  const [prefs, setPrefs] = useState(DEFAULTS);
  const set = (key: keyof typeof DEFAULTS, value: boolean) =>
    setPrefs((prev) => ({ ...prev, [key]: value }));

  const row = (key: keyof typeof DEFAULTS, label: string) => (
    <SettingsRow
      title={label}
      trailing={
        <Toggle
          checked={prefs[key]}
          onCheckedChange={(value) => set(key, value)}
          label={label}
          disabled
        />
      }
    />
  );

  return (
    <SettingsLayout title={t("alerts.title")}>
      <div className="rounded-xl border border-border bg-surface px-4 py-3">
        <p className="text-muted-foreground text-sm">{t("security.comingSoon")}</p>
      </div>
      <SettingsSection label={t("alerts.delivery")}>
        {row("push", t("alerts.push"))}
        {row("email", t("alerts.email"))}
        <SettingsRow
          title={t("alerts.telegram")}
          trailing={
            <button
              type="button"
              disabled
              className="inline-flex shrink-0 items-center rounded-full bg-primary px-3 py-1.5 font-medium text-primary-foreground text-sm transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t("connect")}
            </button>
          }
        />
      </SettingsSection>

      <SettingsSection label={t("alerts.investing")}>
        {row("yield", t("alerts.yield"))}
        {row("priceAlerts", t("alerts.priceAlerts"))}
        {row("strategyUpdates", t("alerts.strategyUpdates"))}
      </SettingsSection>

      <SettingsSection label={t("alerts.money")}>
        {row("deposits", t("alerts.deposits"))}
        {row("withdrawalReady", t("alerts.withdrawalReady"))}
      </SettingsSection>

      <SettingsSection label={t("alerts.fromPoolParty")}>
        {row("rubberRush", t("alerts.rubberRush"))}
        {row("tips", t("alerts.tips"))}
        {row("productNews", t("alerts.productNews"))}
      </SettingsSection>
    </SettingsLayout>
  );
}
