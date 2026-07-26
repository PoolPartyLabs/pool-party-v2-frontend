import "server-only";

/**
 * Canonical Arbitrum addresses for the Active Reserve build.
 *
 * MIRROR of `docs/VERIFIED.md` in the pool-party-aqua repo, which is the source of truth and
 * carries the evidence for every value here. Per POO-1058 R2 this is the single place the app
 * learns an address; nothing else hardcodes one.
 *
 * Gen 1 is a dead parallel deployment (43 ships, last activity ~2026-04) and must never be
 * used. It is listed only so guards can assert against it.
 */

/**
 * The public constants live in `./public` (no `server-only`) because the browser genuinely
 * needs them: a USDC allowance read and a wrong-chain guard. They are re-exported here so
 * server code keeps one import site and there is still a single source of truth per address.
 */
export {
  AQUA_REGISTRY,
  AQUA_SWAP_VM_ROUTER,
  CHAIN_ID_ARBITRUM,
  DECIMALS,
  TOKENS,
} from "./public";

/** Gen 1: DEAD. Present so `assertNotDeadGeneration` can refuse it. */
export const DEAD_GEN1_REGISTRY = "0x499943e74fb0ce105688beee8ef2abec5d936d31" as const;
export const DEAD_GEN1_ROUTER = "0x8fdd04dbf6111437b44bbca99c28882434e0958f" as const;

/** Chainlink ETH/USD, 8 decimals. Measured over 24h: 360 updates, median gap 121s, max 29.5 min. */
export const CHAINLINK_ETH_USD = "0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612" as const;

/** Aave v3 on Arbitrum: the carry leg. */
export const AAVE_V3_POOL = "0x794a61358D6845594F94dc1DB02A252b5b4814aD" as const;
export const AAVE_A_USDC = "0x724dc807b04555b71ed48a6896b6F41593b8C637" as const;

/**
 * The maker hook the deployed router actually calls (VLT-R9 v2).
 *
 * MEASURED twice, independently: Track B captured the raw calldata the live router sends to a
 * maker contract and matched the selector; Track A derived the same signature from
 * `swap-vm` v1.0.1 `IMakerHooks.sol`. `forge inspect PartyVault methodIdentifiers` confirms
 * the deployed vault exposes it. It is NOT in the published SwapVM ABI.
 *
 * The selector is asserted against the signature in `serverOnly.test.ts` rather than trusted,
 * so the pair cannot drift if the signature is ever edited.
 */
export const MAKER_HOOK_SIGNATURE =
  "preTransferOut(address,address,address,address,uint256,uint256,bytes32,bytes,bytes)" as const;
export const MAKER_HOOK_SELECTOR = "0x5a394f80" as const;

/**
 * Payload put in `MakerTraits.preTransferOutHook`. The vault ignores it; the router forwards
 * it untouched as `makerHookData`. It exists only because the SDK's `Interaction` asserts
 * non-empty hex bytes, so a hook cannot be declared with no data at all.
 *
 * Track A's launch payload builder uses the same single byte, which keeps the two program
 * producers byte-identical for the same inputs.
 */
export const MAKER_HOOK_DATA = "0x01" as const;

const DEAD_ADDRESSES = new Set<string>([
  DEAD_GEN1_REGISTRY.toLowerCase(),
  DEAD_GEN1_ROUTER.toLowerCase(),
]);

/** Refuse the dead generation loudly rather than producing a strategy nobody can fill. */
export function assertNotDeadGeneration(address: string): void {
  if (DEAD_ADDRESSES.has(address.toLowerCase())) {
    throw new Error(
      `${address} belongs to the dead gen-1 Aqua deployment. Use the gen-2 pair from VERIFIED.md.`,
    );
  }
}
