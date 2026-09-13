/**
 * @id PP-CORE-LIB-106 (POO-1801, POO-1784, POO-1916)
 * @name on-ramp destinations
 * @implements-rules-version v3 (POO-1916 rules v1) · v2 (POO-1784 rules v1) · v1 (POO-1801 rules v1)
 * @analytics-events none, the module builds a destination object; the funnel belongs to its callers.
 *
 * [R2] Where a purchase should land, in the vocabulary the rail speaks: a CAIP-2 chain and a TOKEN
 * ADDRESS.
 *
 * ## `asset` is an ADDRESS, and it used to be a SYMBOL
 *
 * This is the silent flip this module exists to absorb. At `@privy-io/react-auth@3.29.2`
 * `destination.asset` was a token SYMBOL (the SDK uppercased it); from 3.33.0 it is a token ADDRESS.
 * Both are typed `string`, so code written against the old shape keeps compiling and starts sending
 * `"USDC"` where a `0x...` is expected. Naming the field's meaning here, once, is the whole defence:
 * callers hand this object over, they do not assemble one.
 *
 * ## The address is READ, never written twice
 *
 * `supportedChainMetas` already carries the Base USDC address (`chains/config.ts`), byte-identical to
 * the one Privy's own docs quote, and it is the same value every balance read, logo and symbol in the
 * app resolves through. A second literal here would be a second source of truth for the one field
 * where being wrong means money arriving somewhere nobody is watching, so `destinations.test.ts`
 * asserts against the SOURCE: it greps this file for any `0x...` address and fails if one appears.
 *
 * ## The asset is USDC, and a chain whose stable is not USDC is not a destination
 *
 * `supportedChainMetas` names the field `usdc`, but it is the STABLE slot: on Robinhood Chain (4663)
 * it holds USDG at 6 decimals, not USDC (`chains/config.ts`, POO-1779 [R1] carries the label beside
 * the address for exactly this reason). This function sells USDC, so a chain whose stable is
 * something else is not a destination it can name, and answering with the USDG address would send a
 * buyer's dollars to a token nobody asked for on a chain the rail may not even list. The symbol is
 * READ from the registry beside the address, never written a second time here, for the same reason
 * the address is.
 *
 * Base-only is a CALLER decision for v1 (D8). This function stays generic over the registry, so the
 * second chain to offer fiat in USDC needs a new caller, not a new module.
 *
 * ## A DIFFERENT question, next door: {@link onRampCanDeliverStable} (POO-1784, POO-1916)
 *
 * The planner and the route picker both have to know whether a purchase can reach a given chain's
 * stable, and until POO-1784 only the planner did: `buildPlan` carried a private predicate
 * (POO-1779) and `resolveFundingRoutes` carried none, so the panel drew `buy` for a Robinhood target
 * and the planner then refused it. That is the shape of every divergence between a picker and the
 * thing it picks, so the predicate lives HERE, once, and both sides import it.
 *
 * POO-1784 then went one step too far and COMPOSED it from `usdcDestination`, on the premise that
 * the bridge carrying a purchase onwards is same-token. POO-1916 [R1] separates them again: where
 * the RAMP delivers (Base USDC, fixed, because that is what the rail sells) is not what the BRIDGE
 * lands on the target chain. They are neighbours, not the same fact, and this module is where that
 * distinction has to be visible or the next reader fuses them again.
 */
import { toCaip2 } from "@/lib/chains/caip2";
import { supportedChainMetas } from "@/lib/chains/config";

/** A purchase destination in the rail's vocabulary. */
export interface OnRampDestination {
  /**
   * CAIP-2 chain identifier, e.g. `eip155:8453` ([R1]). Typed as the template literal rather than
   * `string` so a caller handing this to an SDK that demands `${string}:${string}` needs no cast.
   */
  chain: `${string}:${string}`;
  /**
   * The token's CONTRACT ADDRESS (3.33.0+), NOT its symbol. See the header: this field was a symbol
   * at 3.29.2 and both shapes are `string`, so the mistake does not announce itself.
   */
  asset: string;
}

/** The stable this function sells. Compared against the registry's own label, never retyped as one. */
const USDC = "USDC";

/**
 * Where a USDC purchase should land on `chainId`, or `undefined` when this app does not ship that
 * chain, or ships it with a stable that is not USDC ([R2]). The chain check is {@link toCaip2}'s, so
 * an unsupported id fails once, here, rather than producing a half-valid destination.
 */
export function usdcDestination(chainId: number): OnRampDestination | undefined {
  const chain = toCaip2(chainId);
  if (chain === undefined) return undefined;
  const stable = supportedChainMetas.find((meta) => meta.chain.id === chainId)?.usdc;
  if (stable === undefined || stable.symbol !== USDC) return undefined;
  return { chain, asset: stable.address };
}

/**
 * Does this app know a stable to deliver on `chainId` at all? (POO-1779's question, POO-1916 [R1].)
 *
 * ## What this used to say, and why it was wrong
 *
 * POO-1784 answered `usdcDestination(chainId) !== undefined`, on the premise stated in
 * `buildPlan.ts`: the rail sells USDC and the leg that carries a purchase onwards is a BRIDGE, which
 * is same-token by construction, so the only stable a card payment could ever land was Base's own.
 * That made Robinhood Chain (4663, USDG) `false`, and the fiat route to it was suppressed.
 *
 * The premise was measured on ONE pair. `WETH(137) -> USDC(42161)` does answer `404`, and still does.
 * `USDC(8453) -> USDG(4663)` answers `200` with `routing: "BRIDGE"`: 10.000000 USDC in for 9.952342
 * USDG out (probed 2026-09-11, re-probed 2026-09-12 at 9.956847). The bridge carries stable-to-stable
 * across chains, so a fiat purchase DOES reach a Robinhood strategy in one bridge call, and the real
 * boundary is not same-token vs different-token but whichever pairs the aggregator serves.
 *
 * ## So this predicate answers only the STATIC half
 *
 * Which is the registry's half: is there a stable address on that chain for a bridge to land on. It
 * deliberately does not name a chain id or a ticker, because the failure mode [R3] guards against is
 * trading one hardcode ("the target stable must be USDC") for another ("4663 is fine").
 *
 * Routability is LIVE ([R3]). `buildPlan.buildOnRampSteps` quotes the fiat bridge before it offers
 * the purchase, and a pair the bridge will not carry degrades there into the same
 * `PROVISIONING_INSUFFICIENT_FUNDS` dead end a `404` already produces — never a crash, and never a
 * route that dies after the card has been charged. The picker cannot ask a live question (it is a
 * pure function inside a render), so it is optimistic on this static answer and the planner settles
 * it, which is the same asymmetry `resolveFundingRoutes` already documents against the planner.
 *
 * An UNSUPPORTED chain is `false`, which the pre-POO-1784 planner got wrong: `stableSymbol` degrades
 * an unknown id to "USDC", so an id outside the registry compared equal to Base's own and fell
 * through the guard. Reading the registry slot itself closes that by construction, and keeps closing
 * it now that the symbol comparison is gone.
 */
export function onRampCanDeliverStable(chainId: number): boolean {
  return supportedChainMetas.find((meta) => meta.chain.id === chainId)?.usdc !== undefined;
}
