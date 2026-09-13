/**
 * @id PP-TX (POO-301 / POO-352 / POO-610 / POO-1826)
 * @name Built transaction schema
 * @implements-rules-version v2 (POO-1826 rules v1) · v1
 *
 * Zod schema for the subset of the pool-party-api build-tx response the client needs to send.
 * The API builds the full transaction (calldata); the client only signs + submits it. The `tx` and
 * `estimatedGasInUsd` fields drive the send + the network-fee line; `swapInfo` (POO-610) is parsed
 * DISPLAY-ONLY for the Review step (price impact + protocol fee + min received). The `request`/`result`
 * fields are ignored.
 *
 * PP-SECURITY (POO-352): the client SIGNS AND BROADCASTS whatever this parses, so the build response
 * is a trust boundary (a compromised/MITM'd response could substitute draining calldata). Validate
 * the shape strictly: `to`/`from` are 0x-addresses, `data` is 0x-hex calldata, `value` is a wei
 * amount (decimal or 0x-hex, what `toHexValue` in sendTransaction accepts). The wallet's own prompt
 * remains the final value guard; this rejects malformed/garbage fields before they reach the wallet.
 * `swapInfo` [R2] is strictly numeric and display-only: it never touches `tx.to/data/value` and never
 * gates signing, and a malformed `swapInfo` degrades to `undefined` ([R1], see {@link swapInfoField})
 * so bad display data can neither smuggle a non-number into the Review nor reject a legitimate tx.
 *
 * POO-1826 [R1]: `tx.gas` is the gas LIMIT the API advertises (the on-chain estimate x 1.25), not a
 * price. A Pool Party manager write is a 13-frame-deep call graph and EIP-150's 63/64 rule strands
 * ~7% of any limit at every frame, so a wallet broadcasting at its own bare `eth_estimateGas` runs
 * out of gas in the deepest frame and the transaction fails with EMPTY revert data. The field is
 * OPTIONAL and advisory: a response without it (an older API) still parses and the wallet estimates
 * as before. The user-facing fee keeps coming from `estimatedGasInUsd`; a limit is a ceiling on what
 * the transaction MAY spend, never a charge [R3].
 *
 * PP-INTEGRATION-POINT (POO-609 / POO-521): `swapInfo` mirrors the API's `TxResponseWithSwap` block on
 * every build-tx response. The scale of `priceImpactPercentage` is still to be confirmed with the
 * backend (build example 50 vs optimize examples 0.15) before it is rendered.
 */
import { z } from "zod";

/** 0x-prefixed 20-byte address. */
const hexAddress = z.string().regex(/^0x[a-fA-F0-9]{40}$/, "must be a 0x address");
/** 0x-prefixed hex calldata (empty `0x` allowed for a plain value transfer). */
const hexData = z.string().regex(/^0x[a-fA-F0-9]*$/, "must be 0x-hex calldata");
/**
 * A non-negative integer quantity as a string: decimal ("0" default) or a 0x-hex quantity, the two
 * forms the API sends and `toHexValue` in `sendTransaction` accepts. Used for the native `value` and,
 * since POO-1826, for the advertised gas limit, which is the same wire shape and the same risk.
 */
const weiValue = z.string().regex(/^(?:0x[a-fA-F0-9]+|\d+)$/, "must be a wei amount");

/**
 * The swap figures the build attaches for the Review step (POO-610), mirroring the API's
 * `TxResponseWithSwap`. Strictly numeric and display-only; unknown keys are stripped.
 */
const swapInfoSchema = z.object({
  /** Price impact of the swap, in percent (scale TBD with the backend, POO-521). */
  priceImpactPercentage: z.number(),
  /** Protocol fee for the swap, in USD. */
  protocolFee: z.number(),
  /** Minimum received from the swap, in stablecoin. */
  minAmountInStable: z.number(),
});

/** Display-only swap figures the Review step reads off the built tx (POO-610). */
export type SwapInfo = z.infer<typeof swapInfoSchema>;

/**
 * Tolerant `swapInfo` field: a malformed or absent block [R1] degrades to `undefined` (no rows)
 * instead of rejecting the tx it rides on — display data must never gate signing — while unknown
 * keys are stripped and non-numeric fields are dropped [R2]. The `as ZodType<SwapInfo | undefined>`
 * cast keeps the tolerant field's input type off `BuiltTx` (Zod v3 infers a preprocess input as
 * `unknown`, which would otherwise leak through `apiFetch`'s generic into every build action).
 */
const swapInfoField = z.preprocess(
  (v) => swapInfoSchema.safeParse(v).data,
  swapInfoSchema.optional(),
) as z.ZodType<SwapInfo | undefined>;

/** A transaction the wallet can submit, as built by pool-party-api. */
export const builtTxSchema = z.object({
  tx: z.object({
    to: hexAddress,
    from: hexAddress.optional(),
    data: hexData,
    /** Native value in wei, as a decimal string ("0" for most operations). */
    value: weiValue.optional(),
    /**
     * Gas LIMIT for the send (POO-1826 [R1]), decimal string, the API's estimate x 1.25. Optional:
     * absent means "let the wallet estimate", which is the pre-POO-1826 behaviour.
     */
    gas: weiValue.optional(),
  }),
  /**
   * Chain the tx was built for (POO-824 R4). When present the client refuses to broadcast unless
   * it matches the flow's target chain. PP-INTEGRATION-POINT (POO-825): pool-party-api does not
   * return it yet; the field is optional until that wiring lands.
   */
  chainId: z.number().int().optional(),
  /** Gas estimate in USD, shown as the network fee. */
  estimatedGasInUsd: z.number().optional(),
  /**
   * Manager performance-fee estimate charged on a collect, in USD (POO-811; collect builds only —
   * the manager cut over the gross claimable). Absent (manager collect / no fee / other builds) =
   * NO line, never a fabricated $0 (POO-799 directive #1). Display-only like swapInfo.
   */
  performanceFeeInUsd: z.number().optional(),
  /** Display-only swap figures for the Review step (POO-610); tolerant, see {@link swapInfoField}. */
  swapInfo: swapInfoField,
});

/** A built transaction ready to submit. */
export type BuiltTx = z.infer<typeof builtTxSchema>;
