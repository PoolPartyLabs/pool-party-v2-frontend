import "server-only";

/**
 * @id PP-AQUA
 * @name Aqua API module (Active Reserve)
 * @implements-rules-version v3
 *
 * The internal API module for the Aqua strategy class. Per SRV-R1 v3 this layer plays the
 * role pool-party-api plays for the rest of the app: it owns persistence, on-chain
 * orchestration, and the domain services (compiler, indexer, taker). Server actions above it
 * are thin wrappers doing validation and auth only, and nothing outside this module is
 * allowed to touch Drizzle or viem for Aqua data.
 *
 * Every file here imports `server-only`, so an accidental client import is a build error
 * rather than a leaked database URL or private key (SRV-R4).
 *
 * PP-INTEGRATION-POINT: this module is the seam. Post-hackathon, its internals are replaced
 * by calls to the real pool-party-api and the surface below stays put.
 *
 * Layout:
 *   config/     addresses (mirrors VERIFIED.md) and server-only env access
 *   db/         Drizzle schema and the single connection factory
 *   chain/      viem clients
 *   api/        domain services; the compiler lands here in POO-1061
 */

export { arbitrumPublicClient, takerWalletClient } from "./chain/clients";
export {
  AAVE_A_USDC,
  AAVE_V3_POOL,
  AQUA_REGISTRY,
  AQUA_SWAP_VM_ROUTER,
  assertNotDeadGeneration,
  CHAIN_ID_ARBITRUM,
  CHAINLINK_ETH_USD,
  DEAD_GEN1_REGISTRY,
  DEAD_GEN1_ROUTER,
  DECIMALS,
  MAKER_HOOK_SELECTOR,
  MAKER_HOOK_SIGNATURE,
  TOKENS,
} from "./config/addresses";
export { aquaDb, closeAquaDb } from "./db/client";
export type { AquaFill, AquaShip, NewAquaFill, NewAquaShip } from "./db/schema";
export { aquaFills, aquaShips } from "./db/schema";
