/**
 * @id PP-CORE-SCR-010 (POO-1046)
 * @name swap feature barrel
 * @implements-rules-version v1
 * @hackathon POO-1022 (Universal Funding)
 *
 * The standalone swap + bridge area. Public surface: the screen the route mounts, plus the pure
 * request assembly its tests and any future caller need.
 */
export { SwapScreen } from "./components/SwapScreen";
export type { SwapInputArgs } from "./lib/swapRequest";
export {
  buildSwapInput,
  parseSwapAmountUsd,
  swapFundingSources,
  usdcAtDestinationUsd,
} from "./lib/swapRequest";
