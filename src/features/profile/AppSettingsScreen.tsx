/**
 * @id PP-PROF-SCR-006
 * @name App settings
 * @implements-rules-version v1
 *
 * General (Language via LocaleSwitcher → next-intl routing, Currency, Appearance), Privacy (Hide
 * balances, Share analytics) and About (version + legal links). Toggles are mock (local). Wrapped
 * in the shared SettingsLayout.
 */
"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { LocaleSwitcher } from "@/components/ui/LocaleSwitcher";
import { Toggle } from "@/components/ui/Toggle";
import { SettingsLayout } from "./components/SettingsLayout";
import { SettingsRow } from "./components/SettingsRow";
import { SettingsSection } from "./components/SettingsSection";

/** App settings. */
export function AppSettingsScreen() {
  const t = useTranslations("profile");
  const [privacy, setPrivacy] = useState({ shareAnalytics: true });
  const set = (key: keyof typeof privacy, value: boolean) =>
    setPrivacy((prev) => ({ ...prev, [key]: value }));

  return (
    <SettingsLayout title={t("appSettings.title")}>
      <SettingsSection label={t("appSettings.general")}>
        <SettingsRow title={t("appSettings.language")} trailing={<LocaleSwitcher />} />
        <SettingsRow title={t("appSettings.currency")} value={t("appSettings.currencyValue")} />
        <SettingsRow title={t("appSettings.appearance")} value={t("appSettings.appearanceValue")} />
      </SettingsSection>

      <SettingsSection label={t("appSettings.privacy")}>
        <SettingsRow
          title={t("appSettings.shareAnalytics")}
          trailing={
            <Toggle
              checked={privacy.shareAnalytics}
              onCheckedChange={(value) => set("shareAnalytics", value)}
              label={t("appSettings.shareAnalytics")}
            />
          }
        />
      </SettingsSection>

      {/* The legal rows open the /terms and /privacy pages in a new tab (POO-795). */}
      <SettingsSection label={t("appSettings.about")}>
        <SettingsRow title={t("appSettings.version")} value={t("appSettings.versionValue")} />
        <SettingsRow title={t("appSettings.terms")} href="/terms" external />
        <SettingsRow title={t("appSettings.privacyPolicy")} href="/privacy" external />
      </SettingsSection>
    </SettingsLayout>
  );
}
