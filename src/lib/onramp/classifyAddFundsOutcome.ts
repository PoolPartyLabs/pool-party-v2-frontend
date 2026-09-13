/**
 * @id PP-CORE-LIB-109 (POO-1803)
 * @name add-funds outcome classifier
 * @implements-rules-version v1 (POO-1803 rules v1)
 * @epic POO-1793 (Privy on-ramp migration)
 *
 * @analytics-events none, this module is a pure function over a settled promise and emits nothing.
 *   The `funding_buy_*` family is wired once in POO-1813 so both hosts share one emitter, rather
 *   than each classifying and reporting its own version of the same outcome.
 *
 * [R4]: every outcome of `addFunds` is classified by ONE question, **could money have moved?**, with
 * three answers. Only a hard `no` may render a cancellation (ADR-0006).
 *
 * ## Why a table of literal strings, and why it is allowed to be incomplete
 *
 * `useAddFunds` rejects with a plain `Error` carrying a human-readable message. There is no code, no
 * class and no discriminant on the rejection, so a literal-message table is the only thing the SDK
 * gives us to classify on. That is fragile by nature: Privy can reword any of these in a patch
 * release without it being a breaking change.
 *
 * The fail-safe is what makes it safe anyway. **A message not in the table is `maybe`, never `no`.**
 * So a reworded string degrades into an observation window, which costs a little watching, rather
 * than into a cancellation rendered over a charged card. The table can only ever be too small, and
 * being too small is the harmless direction.
 *
 * Matching is EXACT, not substring: a wrapper that merely contains one of these strings is somebody
 * else's error, and reading it as a hard no would be exactly the failure this rule prevents.
 *
 * ## The table, read from the shipped bundle
 *
 * Grepped from `@privy-io/react-auth@3.40.0` `dist/esm/`. Offsets are byte offsets into the minified
 * chunk, since each is one enormous line. The first seven are the pre-flight guards in `addFunds`'s
 * own body, which all `throw` before any surface opens.
 *
 * | Message | File | Offset | Class | Why |
 * |---|---|---|---|---|
 * | `Invalid input: expected destination.address` | `index-rkoxGjIC.mjs` | 401029 | `no` | Pre-flight guard, nothing opened |
 * | `Invalid input: expected destination.chain` | `index-rkoxGjIC.mjs` | 401113 | `no` | Pre-flight guard, nothing opened |
 * | `Invalid input: expected destination.asset` | `index-rkoxGjIC.mjs` | 401195 | `no` | Pre-flight guard, nothing opened |
 * | `User must be authenticated to add funds` | `index-rkoxGjIC.mjs` | 401275 | `no` | Pre-flight guard, nothing opened |
 * | `Existing funding flow in progress` | `index-rkoxGjIC.mjs` | 401347 | `no` | Pre-flight guard, refuses a SECOND flow; the first one's fate is its own outcome |
 * | `Invalid input: expected non-empty fiat.source.assets` | `index-rkoxGjIC.mjs` | 401434 | `no` | Pre-flight guard, nothing opened |
 * | `At least one of fiat or crypto config must be provided` | `index-rkoxGjIC.mjs` | 401564 | `no` | Pre-flight guard, nothing opened |
 * | `Unable to open payment window` | `FiatOnrampScreen-CdmfW60V.mjs` | 25946 | `no` | The popup opener returned falsy, so no provider page was ever loaded and no card form shown |
 * | `Unable to initialize flow` | `FundingMethodSelectionScreen-DyH2g2iw.mjs` | 3058 | `no` | Same, on the funding-method screen. Our fiat-only call should not reach that screen; listed for completeness |
 * | `User exited flow` | `FiatOnrampScreen-CdmfW60V.mjs` | 3792 | **`maybe`** | See below |
 * | anything else | | | **`maybe`** | Fail-safe |
 *
 * ## `User exited flow` is the whole reason ADR-0006 exists
 *
 * The bundle's close handler at offset 3792 reads, deminified:
 *
 * ```js
 * error          ? {type:"failure", error}
 * : status === "provider-success"    ? {type:"success", value:{status:"confirmed"}}
 * : status === "provider-confirming" ? {type:"success", value:{status:"submitted"}}
 * : {type:"failure", error: Error("User exited flow")}
 * ```
 *
 * It is the FALL-THROUGH. A buyer whose card is being charged inside the provider's popup, who
 * closes before the state advances to `provider-confirming`, lands on the same branch as a buyer who
 * abandoned at the amount screen. The two are indistinguishable from here, which is exactly what
 * ADR-0006 says, so this is `maybe` and the observation window decides.
 *
 * ## Two messages deliberately NOT in the hard-no table
 *
 * `User cancelled funding` (`index-rkoxGjIC.mjs` @ 402526) rejects from the method chooser's
 * `onCancel`. It looks like a clean abandonment and is not safe to read as one: the SDK's own error
 * handler routes BACK to that chooser after a failed fiat attempt, so a cancel there can follow an
 * attempt that already opened a provider surface. It falls through to `maybe`.
 *
 * `Unable to start payment session` / `Expected URL response for popup-based provider`
 * (`FiatOnrampScreen-CdmfW60V.mjs` @ 26645 / 26473) fire after the popup opened, while creating the
 * session. A buyer cannot be charged without entering card details they never saw, so these are
 * probably `no`. "Probably" is not the bar for a class that may render a cancellation, so they fall
 * through to `maybe` too.
 */

/** Could money have moved? The only question, and its only three answers ([R4]). */
export type MoneyMoved = "no" | "maybe" | "confirmed";

/** The provider's own claim about the charge. Never settlement (ADR-0004). */
export type ProviderStatus = "submitted" | "confirmed";

/** What `addFunds` settled to: its resolution, or its rejection. */
export type SettledAddFunds =
  | { ok: true; result: { method?: string; status?: string } }
  | { ok: false; error: unknown };

/** The classifier's answer. `reason` is a stable slug, safe to log and to branch on. */
export interface AddFundsClassification {
  moved: MoneyMoved;
  reason: string;
  providerStatus?: ProviderStatus;
}

/**
 * The hard-no table. Exported so a test can assert the mapping rather than restate it, and so a
 * future reader can see the whole class at once.
 *
 * `Existing funding flow in progress` deserves its note: it is a hard no for THIS call, because this
 * call opened nothing. It says nothing about the flow already running, which carries its own outcome.
 */
export const HARD_NO_MESSAGES: Readonly<Record<string, string>> = {
  "Invalid input: expected destination.address": "invalid_destination_address",
  "Invalid input: expected destination.chain": "invalid_destination_chain",
  "Invalid input: expected destination.asset": "invalid_destination_asset",
  "User must be authenticated to add funds": "not_authenticated",
  "Existing funding flow in progress": "flow_already_open",
  "Invalid input: expected non-empty fiat.source.assets": "empty_fiat_assets",
  "At least one of fiat or crypto config must be provided": "no_funding_config",
  "Unable to open payment window": "popup_blocked",
  "Unable to initialize flow": "popup_blocked",
};

/** The inconclusive exit, kept apart from the table above because it is the opposite class. */
export const USER_EXITED_MESSAGE = "User exited flow";

/** The adapter's own refusal when `defaultAsset` is absent ([R1]); it never reaches the SDK. */
export const MISSING_DEFAULT_ASSET_REASON = "missing_default_asset";

/**
 * The adapter's own refusal when `defaultAsset` is present but is not a code the rail sells ([R1]).
 *
 * Kept beside its sibling, and apart from {@link HARD_NO_MESSAGES}, for the same reason: both are
 * decisions WE made before any surface opened, so neither is a message to match on. A code outside
 * the rail's union would otherwise come back as `Invalid input` prose on a buyer's screen.
 */
export const UNSUPPORTED_FIAT_ASSET_REASON = "unsupported_fiat_asset";

/** The message of a rejection, when it is an `Error` at all. */
function messageOf(error: unknown): string | null {
  return error instanceof Error ? error.message : null;
}

/**
 * Classify one settled `addFunds` call ([R4]).
 *
 * A resolution is always a provider CLAIM that money may have moved, whichever status it carries:
 * `confirmed` and `submitted` differ in what the provider says about its own progress, not in
 * whether we may treat the purchase as complete. Neither is settlement (ADR-0004: only the on-chain
 * delta is), so both map to `confirmed` here and the watcher decides the rest.
 */
export function classifyAddFundsOutcome(settled: SettledAddFunds): AddFundsClassification {
  if (settled.ok) {
    const status = settled.result?.status;
    if (status === "confirmed" || status === "submitted") {
      return { moved: "confirmed", reason: `provider_${status}`, providerStatus: status };
    }
    // The crypto branch, which we never request. If it ever arrives it still claims funds moved.
    if (settled.result?.method === "crypto" && status === "completed") {
      return { moved: "confirmed", reason: "provider_crypto_completed" };
    }
    // A success shape we do not recognise is not evidence of nothing happening.
    return { moved: "maybe", reason: "unknown_success_status" };
  }

  const message = messageOf(settled.error);
  if (message === null) return { moved: "maybe", reason: "unknown_error" };

  const hardNo = Object.hasOwn(HARD_NO_MESSAGES, message) ? HARD_NO_MESSAGES[message] : undefined;
  if (hardNo !== undefined) return { moved: "no", reason: hardNo };

  if (message === USER_EXITED_MESSAGE) return { moved: "maybe", reason: "user_exited" };

  return { moved: "maybe", reason: "unknown_error" };
}
