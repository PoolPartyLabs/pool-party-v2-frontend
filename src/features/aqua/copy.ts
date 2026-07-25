/**
 * @id PP-AQUA-COPY
 * @name Active Reserve product copy
 * @implements-rules-version v3
 *
 * FE-R10 fixes the product name and the description, and the description is used VERBATIM in
 * the catalog, the detail page and the submission. It is 277 characters and there is a test
 * asserting both the exact string and that length, because a "small" copy edit here silently
 * desynchronises the page from the submission text.
 *
 * FE-R6 governs the rest: jargon-free, "cushioned" and never "protected", and the illiquid
 * state surfaced honestly. No maker/taker/opcode vocabulary anywhere investor-facing.
 *
 * EN only for the hackathon window (POO-1067 re-scope comment); the 11-locale port is
 * post-event.
 */

export const PRODUCT_NAME = "Active Reserve";

/** FE-R10, verbatim. Do not edit without editing the rule and the submission together. */
export const PRODUCT_DESCRIPTION =
  "An always-earning reserve that buys the dip. Capital earns Aave lending yield every block and is deployed automatically the instant the market dips into the manager's buy band, purchasing ETH below market price. Objective: accumulate ETH at a discount while never sitting idle.";

export const COPY = {
  tagline: "Always earning. Ready to buy the dip.",

  sleeves: {
    title: "Where the money is",
    // FE-R6: no "maker", no "sleeve" jargon in the label itself.
    carry: "Earning interest",
    carryHelp: "Lent on Aave, earning every block until it is needed.",
    band: "Reserved to buy",
    bandHelp: "Committed to the buy band. It keeps earning until a purchase actually settles.",
    acquired: "ETH bought",
    acquiredHelp: "Bought below market price when the market dipped into the band.",
  },

  band: {
    title: "Buy band",
    help: "The price range where this reserve buys. It sits entirely below the current market price, so it only fills when the market comes down to it.",
    current: "Market price now",
    epochEnds: "Band expires",
    expired: "Expired",
  },

  fills: {
    title: "Purchases",
    empty: "No purchases yet. The reserve buys only when the market dips into the band.",
    jitBadge: "Funded from Aave in the same transaction",
    jitHelp:
      "The capital was earning interest right up to the moment of purchase, then withdrawn and spent inside a single transaction.",
    selfDirected:
      "During the demo window these purchases are settlement proofs executed by our own wallet, not third-party demand. The interest earned on Aave is the external, real yield.",
  },

  nav: {
    title: "Total value",
    help: "Cash plus what is lent out plus the ETH bought, valued at the current market price.",
  },

  disclosure: {
    title: "What to know",
    // FE-R6: "cushioned", never "protected".
    items: [
      "Unaudited contracts. This runs under hard caps with the team's own capital.",
      "Aave risk applies to the portion that is lent out.",
      "The buy band is a commitment to buy ETH at a set range. If the market keeps falling, the ETH bought is worth less than it cost. Downside is cushioned by the discount, not removed.",
      "Withdrawals pay out in USDC. If a purchase has just settled, part of the value is held as ETH and may not be immediately withdrawable.",
    ],
  },

  notLaunched: {
    title: "Not deployed yet",
    body: "This reserve has not been deployed to Arbitrum yet. Numbers appear here once it is live; nothing on this page is simulated.",
  },

  stalePrice: "The price feed has not updated recently, so the values below may be out of date.",

  verify: {
    title: "Verify on-chain",
    help: "Every number on this page is read live from Arbitrum. Check it yourself.",
    vault: "Vault contract",
    adapter: "Interest-earning adapter",
  },
} as const;
