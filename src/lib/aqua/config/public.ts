/**
 * The subset of the Aqua address config that is safe in a browser bundle.
 *
 * Deliberately NOT `server-only`, and the only file under `src/lib/aqua` besides the Drizzle
 * schema that is exempt. Everything here is a deployed contract address or a chain id: public
 * by definition, verifiable on Arbiscan, and useless to an attacker. The client genuinely
 * needs them, to read a USDC allowance and to refuse to broadcast on the wrong chain.
 *
 * The rule this preserves: no KEY, no connection string, and no server env ever appears here.
 * `serverOnly.test.ts` enforces that mechanically, and `config/addresses.ts` re-exports these
 * so there is still a single source of truth for an address.
 */

export const CHAIN_ID_ARBITRUM = 42161;

/** Gen 2: the live Aqua registry + AquaSwapVMRouter pair (see docs/VERIFIED.md). */
export const AQUA_REGISTRY = "0x1111113CCf1426A8E30e2bfF5E005d929bF6a90a" as const;
export const AQUA_SWAP_VM_ROUTER = "0x1111113Db0e0ef9D0E3A50d5f094a3a57a26C0DE" as const;

export const TOKENS = {
  /** Native Arbitrum USDC, not USDC.e. */
  USDC: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
  WETH: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
} as const;

export const DECIMALS = {
  USDC: 6,
  WETH: 18,
} as const;
