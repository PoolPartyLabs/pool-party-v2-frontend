import { hasLocale } from "next-intl";
import { getRequestConfig } from "next-intl/server";
import { routing } from "./routing";

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;

  // PP-NOTE: namespaces are loaded per locale and merged here. Add more as features land.
  const [
    common,
    consent,
    errors,
    auth,
    home,
    strategies,
    portfolio,
    cards,
    deposit,
    profile,
    shell,
    rewards,
    manager,
    wallet,
    admin,
  ] = await Promise.all([
    import(`./messages/${locale}/common.json`),
    import(`./messages/${locale}/consent.json`),
    import(`./messages/${locale}/errors.json`),
    import(`./messages/${locale}/auth.json`),
    import(`./messages/${locale}/home.json`),
    import(`./messages/${locale}/strategies.json`),
    import(`./messages/${locale}/portfolio.json`),
    import(`./messages/${locale}/cards.json`),
    import(`./messages/${locale}/deposit.json`),
    import(`./messages/${locale}/profile.json`),
    import(`./messages/${locale}/shell.json`),
    import(`./messages/${locale}/rewards.json`),
    import(`./messages/${locale}/manager.json`),
    import(`./messages/${locale}/wallet.json`),
    import(`./messages/${locale}/admin.json`),
  ]);

  return {
    locale,
    messages: {
      common: common.default,
      consent: consent.default,
      errors: errors.default,
      auth: auth.default,
      home: home.default,
      strategies: strategies.default,
      portfolio: portfolio.default,
      cards: cards.default,
      deposit: deposit.default,
      profile: profile.default,
      shell: shell.default,
      rewards: rewards.default,
      manager: manager.default,
      wallet: wallet.default,
      admin: admin.default,
    },
  };
});
