/**
 * @id PP-CORE-LIB-099 (POO-1573)
 * @name on-ramp ETH target resolver (server)
 * @implements-rules-version v1 (POO-1573 rules v2)
 *
 * Turn an `ETH-BASE` order's target RECIPE ({@link OnRampEthTarget}) into the ETH figure the mint
 * quotes received-fixed with: `gasFloorEth + fundingUsd / ethUsd`.
 *
 * ## Why the price is read here, and not derived from the wallet ([R3])
 *
 * The app's only ETH price today is the buyer's own priced holding, `native.usd / native.amount`
 * (`standaloneOnRampPlan.readBaseNativeEth`, and the planner's ratio the sizer's header points at).
 * That ratio is exactly **0 for a wallet holding no ETH**, which is the only wallet the gas-first leg
 * ever serves: the person reaching a fiat on-ramp is by definition the person with no crypto. A `0`
 * price cannot denominate anything, so the leg stayed spend-fixed and pinned USD, and a European
 * first-time buyer was charged in dollars and never offered SEPA (POO-1573, the live report).
 *
 * So the price comes from pool-party-api's own `GET /api/v1/prices` instead. It is address-based and
 * `@IsEthereumAddress()`-validated, and native ETH has no contract address, so it is priced through
 * **WETH on Base** as the proxy. This is a CRYPTO price, not a fiat FX rate, which is why it does not
 * re-open POO-333: no figure computed in dollars is ever re-denominated ([R2]), the dollars are
 * CONVERTED to the asset being bought.
 *
 * ## Server-side, inside the `"use server"` boundary
 *
 * `apiFetch` injects `PP_API_KEY`, so this module is `server-only` and reaches the client only as the
 * RPC stub of `getOnRampEthTargetAction`. It answers `null` when it cannot establish a price, and it
 * never throws: the SHAPE is `resolveOnRampCurrency`'s pairs read beside it.
 *
 * What the caller does with that `null` is what changed at rules v2. [R5] used to read "a failed read
 * costs precision, never the purchase", and the mint fell back to the shipped spend-fixed USD leg. It
 * now reads: **the failure costs the PURCHASE, never the buyer's currency**. The fallback re-pinned
 * `currencyCodeFrom` to USD, which re-fetched the method list in dollars, dropped the SEPA identifier
 * the buyer had just chosen on a screen that had offered it, and opened the widget on a card in USD.
 * That is verbatim the live report this issue exists to close, so the mint refuses instead and sends
 * the buyer back to review. See `useProvisioningRail.resolveEthTargetAmount`.
 *
 * ## Precision
 *
 * The recipe's halves are decimal STRINGS (the `fiatAmount` convention: no float) and the arithmetic
 * runs in `Decimal`, because an ETH amount carries up to 18 decimals and that is not float-safe. The
 * result is rounded UP, so a rounding error can only ever leave the gas floor MET rather than missed.
 * The wire imposes its own ceiling — `POST /on-ramp/quote` takes `amount: number` — and the last-digit
 * imprecision a double introduces at these magnitudes (0.003-0.07 ETH) is many orders of magnitude
 * below `PAYBIS_GAS_FLOOR_ETH`, so it is accepted rather than paid for with a second backend change.
 *
 * ## Quote-grade, not display-grade
 *
 * The read asks for `live=true` (pool-party-api POO-1594), because this price SIZES A PURCHASE: the
 * default path can serve an hour-old price and a stale-HIGH one silently shrinks the ETH the buyer
 * receives. See {@link PRICE_LIVE} for the deploy-order dependency and why an API without the flag
 * degrades rather than failing.
 *
 * PP-INTEGRATION-POINT: the ETH price ← pool-party-api
 * `GET /api/v1/prices?network=base&addresses=…&live=true` (CoinGecko behind it, per-token cached
 * since POO-1416, quote-grade live path since POO-1594, API-key guarded and throttled).
 */

import "server-only";

import Decimal from "decimal.js";
import { z } from "zod";
import { apiFetch } from "@/lib/api/client";
import { getWrappedNative } from "@/lib/chains/config";
import type { OnRampEthTarget } from "@/lib/provisioning";

/** The api's network id for Base. Literal rather than `apiNetworkForChain(ONRAMP_CHAIN_ID)`: the
 * endpoint's own `@IsIn(SUPPORTED_NETWORKS)` list is what this has to match, and it is a wire token. */
const PRICES_NETWORK = "base";

/**
 * WETH on Base, the address native ETH is priced through.
 *
 * Native ETH has no contract address and the endpoint validates `@IsEthereumAddress()`, so the
 * wrapped token is the proxy. Canonical OP-stack predeploy, identical across every OP chain.
 *
 * READ off `supportedChainMetas` (PR #875 review), never written here: that array's own header calls
 * itself the single source for chain metadata and already carries this exact address as Base's
 * `wrappedNative`. Two copies of the token that decides which price sizes an ETH purchase is the same
 * drift class the strict-match guard in {@link readBaseEthUsd} exists to catch, one level up.
 *
 * Empty only if Base ever left the registry, which `readBaseEthUsd` treats as a failed read rather
 * than as an address to match against.
 */
export const WETH_BASE_ADDRESS: string = getWrappedNative(PRICES_NETWORK) ?? "";

/**
 * Ask for the QUOTE-GRADE price, not the display-grade one (POO-1594, PR #875 review F2).
 *
 * `GET /prices` without this routes to `getCurrenciesPrice`, which is
 * `pricesPerTokenWithStale(..., { live: false })`, and the 5-minute staleness cap in
 * `coingecko.service.ts:1532` is gated on `live &&`. So the default path can serve a price up to the
 * full `COINGECKO_STALE_TTL_MS` HOUR old when CoinGecko is down or throttled, and says so only in a
 * server-side `coingecko_serve_stale` log no caller can see. The service's own comment states the
 * rule this leg now falls under: "Display and cached reads keep the full hour; QUOTING DOES NOT,
 * because a stale-HIGH price makes `assertQuoteNearFairValue` more permissive". Here a stale-HIGH ETH
 * price shrinks `fundingUsd / ethUsd`, the buyer receives less ETH than the dollars they were sized
 * for, and the downstream swap underfunds the operation.
 *
 * DEPLOY ORDER, and why it is not a hard blocker: an API that predates POO-1594 does not 400 on this.
 * The global `ValidationPipe` runs `whitelist: true` and `forbidNonWhitelisted` appears nowhere in
 * pool-party-api (`main.ts:59-63`), so an unknown query param is STRIPPED and the request is answered
 * on the display-grade path. The degrade is therefore a loss of the staleness cap, not a failure, and
 * it is silent by construction: the response shape is identical, so nothing client-side can detect it
 * (which is why the dependency is stated on the PR and on POO-1594, not merely instrumented).
 */
const PRICE_LIVE = "live=true";

/**
 * The FE cache window, and why it is NOT the controller's 30s.
 *
 * `@CacheTTL(30_000)` sizes the display path. Caching a LIVE price for 30s here would reintroduce
 * exactly the staleness {@link PRICE_LIVE} exists to remove (POO-1594 makes the same point about the
 * controller cache). 5s matches `getCurrenciesPriceLive`'s own staleness cap, so the FE cache can
 * never be the stalest link, while still coalescing a double-tap off the per-API-key throttle bucket
 * v1 and v2 share.
 */
export const PRICE_REVALIDATE_SECONDS = 5;

/**
 * `CurrenciesPriceResponseDto[]`, narrowed to the two fields consumed. `usd` is a decimal STRING on
 * the wire (the service `.toString()`s CoinGecko's number), and extra fields (`derivedNative`) are
 * stripped rather than rejected, so a backend addition is not a breaking change here.
 */
const pricesResponseSchema = z.array(
  z.object({ address: z.string().min(1), usd: z.string().min(1) }),
);

/** The ETH price in USD, or `null` when it could not be established ([R5]). Never throws. */
async function readBaseEthUsd(): Promise<number | null> {
  // No address means no proxy to price ETH through, and a blank one would match any row the upstream
  // echoed. Unreachable while Base is in the registry; a failed read rather than a wrong price if not.
  if (!WETH_BASE_ADDRESS) return null;
  try {
    const raw = await apiFetch(
      `prices?network=${PRICES_NETWORK}&addresses=${WETH_BASE_ADDRESS}&${PRICE_LIVE}`,
      {
        schema: pricesResponseSchema,
        revalidate: PRICE_REVALIDATE_SECONDS,
        tags: ["prices-base-weth"],
      },
    );
    if (!raw) return null;
    /**
     * Keyed by whatever casing the upstream echoes (`prices.service.formatResponse` maps CoinGecko's
     * response keys, which are lowercased contract addresses), so the match is case-insensitive.
     *
     * It is also STRICT: no positional fallback to `raw[0]`. With one address requested the first row
     * is normally the answer, but "normally" is doing real work on a money path. A row for another
     * token would be taken as the ETH price and, at USDC's $1.0002, `50 / 1.0002` sizes a ~50 ETH
     * received-fixed order against a $50 one. An unrecognised answer is a failed read ([R5]), and the
     * caller refuses the purchase rather than sizing one off an unidentified token.
     */
    const row = raw.find(
      (entry) => entry.address.toLowerCase() === WETH_BASE_ADDRESS.toLowerCase(),
    );
    if (!row) return null;
    const usd = Number(row.usd);
    return Number.isFinite(usd) && usd > 0 ? usd : null;
  } catch {
    return null;
  }
}

/**
 * Solve `gasFloorEth + fundingUsd / ethUsd` to a decimal STRING, or `null` when the inputs cannot
 * produce a target ([R5]).
 *
 * Pure, so the arithmetic is unit-tested without the transport. Rounded UP at 18dp (the ERC-20
 * ceiling and ETH's own decimals), so the gas floor is met rather than missed by a rounding error.
 */
export function toEthAmount(target: OnRampEthTarget, ethUsd: number): string | null {
  if (!Number.isFinite(ethUsd) || ethUsd <= 0) return null;
  try {
    const gasFloorEth = new Decimal(target.gasFloorEth);
    const fundingUsd = new Decimal(target.fundingUsd);
    if (gasFloorEth.isNegative() || fundingUsd.isNegative()) return null;
    const eth = gasFloorEth.plus(fundingUsd.div(ethUsd)).toDecimalPlaces(18, Decimal.ROUND_UP);
    // A zero target cannot be quoted received-fixed: the backend's receive-direction floor is "> 0"
    // (POO-1588), and Paybis would refuse it anyway.
    return eth.greaterThan(0) ? eth.toFixed() : null;
  } catch {
    // `new Decimal("")` throws. A recipe that is not a decimal string is contract drift or a
    // hand-built order, and it answers like every other failed read rather than throwing inside a
    // mint the buyer is waiting on. The REFUSAL is the caller's ([R5] v2); this stays a `null`.
    return null;
  }
}

/**
 * The ETH target for one order, priced NOW ([R1]), or `null` when ETH cannot be priced ([R5]).
 *
 * Sampled at mint time on purpose: POO-1512 [R8] already refuses to bake a `quoteId` into a plan
 * because "a plan executes for minutes and a quote expires", and a target computed from a price is
 * the same class of perishable value.
 */
export async function resolveOnRampEthTarget(target: OnRampEthTarget): Promise<string | null> {
  const ethUsd = await readBaseEthUsd();
  if (ethUsd === null) return null;
  return toEthAmount(target, ethUsd);
}
