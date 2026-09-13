import { type RenderOptions, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { ReactElement, ReactNode } from "react";
import enAuth from "@/i18n/messages/en/auth.json";
import enCards from "@/i18n/messages/en/cards.json";
import enCashPlus from "@/i18n/messages/en/cashPlus.json";
import enCommon from "@/i18n/messages/en/common.json";
import enConsent from "@/i18n/messages/en/consent.json";
import enDeposit from "@/i18n/messages/en/deposit.json";
import enErrors from "@/i18n/messages/en/errors.json";
import enHome from "@/i18n/messages/en/home.json";
import enManager from "@/i18n/messages/en/manager.json";
import enPortfolio from "@/i18n/messages/en/portfolio.json";
import enProfile from "@/i18n/messages/en/profile.json";
import enRewards from "@/i18n/messages/en/rewards.json";
import enShell from "@/i18n/messages/en/shell.json";
import enStrategies from "@/i18n/messages/en/strategies.json";
import enSwap from "@/i18n/messages/en/swap.json";
import enWallet from "@/i18n/messages/en/wallet.json";

/**
 * App-wide providers for tests. Wraps NextIntlClientProvider (locale "en") so any
 * component using `useTranslations` renders. Extended later with Zustand stores and
 * service/query providers as those land.
 *
 * PP-NOTE: feature tests import this single helper from day one so adding providers
 * later is a one-file change with no test churn.
 */
function Providers({ children }: { children: ReactNode }) {
  return (
    <NextIntlClientProvider
      locale="en"
      messages={{
        common: enCommon,
        cashPlus: enCashPlus,
        consent: enConsent,
        errors: enErrors,
        auth: enAuth,
        home: enHome,
        manager: enManager,
        strategies: enStrategies,
        portfolio: enPortfolio,
        cards: enCards,
        deposit: enDeposit,
        profile: enProfile,
        rewards: enRewards,
        shell: enShell,
        swap: enSwap,
        wallet: enWallet,
      }}
    >
      {children}
    </NextIntlClientProvider>
  );
}

export function renderWithProviders(ui: ReactElement, options?: Omit<RenderOptions, "wrapper">) {
  return render(ui, { wrapper: Providers, ...options });
}

// Re-export RTL surface so tests have one import site.
export * from "@testing-library/react";
export { userEvent };
