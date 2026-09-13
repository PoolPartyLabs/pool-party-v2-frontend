/**
 * @id PP-CORE-LIB-106 (POO-1801)
 * @name on-ramp limits
 * @implements-rules-version v1 (POO-1801 rules v1)
 * @analytics-events none, two constants emit nothing.
 *
 * [R3] The two numbers that bound a purchase, and they belong to different people.
 *
 * ## The floor is OURS (D9), and it has ONE home
 *
 * `ON_RAMP_FLOOR_USD` is a re-export of `PAYBIS_MIN_USD`, deliberately NOT a second `10`. This app
 * has been bitten by the alternative: `computeNeed.ts` records FOUR independent $10 floors
 * (`MIN_DEPOSIT`, `GAS_PRESETS_USD[0]`, `GAS_CUSTOM_MIN_USD` and that one) plus a hardcoded "as
 * little as $10" in 12 locales, and an attempt to raise one alone was REVERTED because it opened a
 * band where the screen states a minimum the app will not place (POO-1670). A fifth copy under a
 * new name would be that bug with a migration attached.
 *
 * The NAME moves and the ownership is restated: this is OUR product floor, not a provider's limit.
 * `sizeOnRampOrder.ts` already says so, and it matters at the rail change: a floor attributed to
 * Paybis looks deletable the day Paybis goes, and a floor understood as ours survives the vendor
 * that happened to be behind it. The historical constant keeps its name in `computeNeed.ts` until
 * the last Paybis module goes; renaming it there is a wider blast radius than this issue owns.
 *
 * ## The ceiling is the SANDBOX's, and it is not ours at all
 *
 * `STRIPE_SANDBOX_MAX_USD` is the $200 cap Stripe's TEST MODE applies to a crypto onramp session. It
 * bounds what a tester can put through dev, and it must never be read as a product limit or shown to
 * a buyer as one: production has no such number here, and treating a vendor's test-mode cap as our
 * own is how a sandbox constraint ships to real users.
 *
 * SOURCE, stated plainly because this file's whole discipline is provenance: the $200 figure comes
 * from the POO-1793 epic and is UNVERIFIED against a shipped artefact. It is not in
 * `@stripe/crypto@1.1.3` (which carries only the loader and its types) and no packed file this
 * session opened states it. Treat it as documentation until the POO-1799 harvest or a Stripe
 * dashboard screenshot confirms it, and correct it there rather than here if it is wrong.
 *
 * PP-INTEGRATION-POINT: the sandbox ceiling is a vendor limit we currently take on trust; confirm it
 * against a real Stripe test-mode session during the POO-1799 harvest.
 */

/**
 * [R3] OUR product floor for a fiat purchase, in USD. Re-exported from its single home so the $10
 * cannot drift; see the header for why a second literal is forbidden.
 */
export { PAYBIS_MIN_USD as ON_RAMP_FLOOR_USD } from "@/lib/provisioning/computeNeed";

/**
 * The ceiling Stripe's SANDBOX puts on one onramp session, in USD. Theirs, not ours, and test-mode
 * only. From the POO-1793 epic, unverified against a shipped artefact (see the header).
 */
export const STRIPE_SANDBOX_MAX_USD = 200;
