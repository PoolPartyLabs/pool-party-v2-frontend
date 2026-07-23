/**
 * @id PP-CARD-MCK-001
 * @name cards mock data
 * @implements-rules-version v1
 *
 * Static fixtures for the Cards area (Linear POO-139): the partner marketplace catalog, the
 * investor's held cards, and a held card's activity feed. Pool Party is a marketplace + referral,
 * not an issuer — see the Linear doc "Cards — Business Rules & Scope". Money is USD; card
 * transactions follow the transaction-display rule (per-token amount + price-at-time USD). Offer
 * `perks` are `cards`-namespace i18n keys (e.g. `explore.perks.noAnnualFee`), resolved at render by
 * CardOffer so they localize — not raw display copy; partner integrations map to these keys.
 * Timestamps are fixed epoch-ms constants (not `Date.now()`) so the data is deterministic for
 * SSR/SSG and tests. Replace via the PP-INTEGRATION-POINTs in the service factory.
 */
import type { CardOffer, CardTransaction, OwnedCard } from "@/lib/schemas";

/** PP-MOCK: the partner card marketplace (Explore). Six partners across Visa + Mastercard. */
export const cardOffers: CardOffer[] = [
  {
    partnerId: "ether-fi",
    name: "Ether.fi",
    subtitle: "Cash · crypto debit",
    network: "visa",
    brandColor: "#5B7CFA",
    perks: [
      "explore.perks.cashbackEth3",
      "explore.perks.noAnnualFee",
      "explore.perks.spendStablesEth",
    ],
    badge: "active",
    ctaState: "manage",
    onboardingUrl: "https://ether.fi/cash",
  },
  {
    partnerId: "gnosis-pay",
    name: "Gnosis Pay",
    subtitle: "Self-custodial Visa",
    network: "visa",
    brandColor: "#3A8074",
    perks: [
      "explore.perks.spendFromWallet",
      "explore.perks.eurUsdAccounts",
      "explore.perks.selfCustodial",
    ],
    badge: "requested",
    ctaState: "activating",
    onboardingUrl: "https://gnosispay.com",
  },
  {
    partnerId: "metamask",
    name: "MetaMask",
    subtitle: "Crypto Mastercard",
    network: "mastercard",
    brandColor: "#E8833A",
    perks: [
      "explore.perks.spendMetamask",
      "explore.perks.cryptoRewards",
      "explore.perks.globalMastercard",
    ],
    badge: "popular",
    ctaState: "request",
    onboardingUrl: "https://metamask.io/card",
  },
  {
    partnerId: "1inch",
    name: "1inch",
    subtitle: "Crypto debit card",
    network: "mastercard",
    brandColor: "#1B314F",
    perks: [
      "explore.perks.cashback1inch",
      "explore.perks.noFxFees",
      "explore.perks.worksWorldwide",
    ],
    ctaState: "request",
    onboardingUrl: "https://1inch.io/card",
  },
  {
    partnerId: "coinbase",
    name: "Coinbase Card",
    subtitle: "Crypto Visa debit",
    network: "visa",
    brandColor: "#1652F0",
    perks: [
      "explore.perks.spendEarnRewards",
      "explore.perks.noAnnualFee",
      "explore.perks.visaDebitGlobal",
    ],
    ctaState: "request",
    onboardingUrl: "https://www.coinbase.com/card",
  },
  {
    partnerId: "crypto-com",
    name: "Crypto.com",
    subtitle: "Visa card",
    network: "visa",
    brandColor: "#0A2540",
    perks: [
      "explore.perks.cashbackCro5",
      "explore.perks.loungeAccess",
      "explore.perks.noAnnualFee",
    ],
    ctaState: "request",
    onboardingUrl: "https://crypto.com/cards",
  },
];

/** PP-MOCK: the investor's held cards. One active Ether.fi card (rechargeable balance). */
export const ownedCards: OwnedCard[] = [
  {
    id: "card-ether-fi",
    partnerId: "ether-fi",
    brand: "ether.fi",
    network: "visa",
    maskedPan: "4242",
    balanceUsd: 248.5,
    type: "debit",
    status: "active",
    brandColor: "#5B7CFA",
  },
];

/**
 * PP-MOCK: the held card's activity feed, newest first. Spends are negative; credits (cashback,
 * refunds, top-ups) are positive. USD value is price-at-time (USDC ≈ $1).
 */
export const cardTransactions: CardTransaction[] = [
  {
    id: "ctx-spotify",
    cardId: "card-ether-fi",
    merchant: "Spotify",
    category: "Music",
    tokenSymbol: "USDC",
    tokenAmount: -12.99,
    usdValueAtTime: 12.99,
    timestamp: 1_780_300_500_000,
  },
  {
    id: "ctx-uber",
    cardId: "card-ether-fi",
    merchant: "Uber",
    category: "Transport",
    tokenSymbol: "USDC",
    tokenAmount: -24.5,
    usdValueAtTime: 24.5,
    timestamp: 1_780_298_700_000,
  },
  {
    id: "ctx-amazon",
    cardId: "card-ether-fi",
    merchant: "Amazon",
    category: "Shopping",
    tokenSymbol: "USDC",
    tokenAmount: -89.9,
    usdValueAtTime: 89.9,
    timestamp: 1_780_221_720_000,
  },
  {
    id: "ctx-cashback",
    cardId: "card-ether-fi",
    merchant: "Cashback",
    category: "Ether.fi",
    tokenSymbol: "USDC",
    tokenAmount: 1.27,
    usdValueAtTime: 1.27,
    timestamp: 1_780_214_400_000,
  },
  {
    id: "ctx-starbucks",
    cardId: "card-ether-fi",
    merchant: "Starbucks",
    category: "Food",
    tokenSymbol: "USDC",
    tokenAmount: -6.4,
    usdValueAtTime: 6.4,
    timestamp: 1_780_201_800_000,
  },
  {
    id: "ctx-topup",
    cardId: "card-ether-fi",
    merchant: "Top up",
    category: "From your wallet",
    tokenSymbol: "USDC",
    tokenAmount: 200,
    usdValueAtTime: 200,
    timestamp: 1_780_120_000_000,
  },
];
