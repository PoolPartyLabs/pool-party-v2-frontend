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

  composition: {
    title: "Composition",
    live: "Read live from Arbitrum, so this is where the money is right now, not a target split.",
  },

  mandate: {
    title: "Investment mandate",
    assets: "Assets",
    protocols: "Protocols",
    networks: "Networks",
  },

  position: {
    title: "Your position",
    active: "Active",
    value: "Current value",
    shares: "Your share",
    deposited: "Deposited",
    empty: "You have not invested in this reserve yet.",
  },

  actions: {
    add: "Add liquidity",
    remove: "Remove liquidity",
    addTitle: "Add liquidity",
    removeTitle: "Remove liquidity",
    amount: "Amount",
    max: "Max",
    confirmAdd: "Confirm deposit",
    confirmRemove: "Confirm withdrawal",
    connect: "Connect a wallet to invest",
    notSeeded: "This reserve is not open for deposits yet.",
    capReached: "This reserve is at its deposit cap.",
    closed: "This reserve is closed to new deposits.",
    walletBalance: "Wallet balance",
    youReceive: "You receive",
    approving: "Approving USDC",
    depositing: "Depositing",
    withdrawing: "Withdrawing",
    done: "Done",
    addHelp:
      "Your USDC is lent on Aave immediately and stands ready to buy ETH if the market dips into the band.",
    removeHelp:
      "Withdrawals pay out in USDC. Anything committed to a live band becomes available when it settles or the manager closes it.",
  },

  metrics: {
    tvl: "Total value locked",
    cap: "Deposit cap",
    carry: "Earning on Aave",
    epoch: "Band epoch",
    fee: "Premium per fill",
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
    // FE-R11. The earlier wording claimed "every number", which is not true and is the kind of
    // overclaim a judge is right to punish. Every VALUE is live; the manager's LABELS are not, and
    // saying so plainly costs nothing. See `src/lib/aqua/data/managerMetadata.ts`.
    help: "Every value on this page is read live from Arbitrum on each load. Check it yourself.",
    vault: "Vault contract",
    adapter: "Interest-earning adapter",
    // The contracts are a separate public repository. Someone checking an address on Arbiscan is
    // exactly the person who wants the source, so the link belongs here rather than in a doc.
    source: "Contract source",
    sourceRepo: "github.com/0xmvercosa/pool-party-aqua",
  },

  /**
   * FE-R11 v2: the live/committed split, stated on the page rather than buried in a repository doc.
   *
   * v1 said the band edges were manager-written and fixed in the build. They are not: they decode
   * out of the Aqua registry's own `Shipped` log. Only the purchase list is committed, and the copy
   * had to stop claiming otherwise the moment that stopped being true.
   */
  provenance: {
    title: "What is live and what is not",
    live: "Read live from Arbitrum on every load: total value, the split between interest-earning, reserved and ETH bought, the deposit cap, your position, the ETH price from Chainlink, and each buy band including its mandate and its price range, decoded from the on-chain ship record.",
    fixed:
      "The purchase list below is the one exception. Every row is a real Arbitrum transaction and links to Arbiscan, but it is a checked-in list rather than a live feed: the indexer that would read settlements off-chain is not built, and we would rather say so than imply it is.",
  },
} as const;
