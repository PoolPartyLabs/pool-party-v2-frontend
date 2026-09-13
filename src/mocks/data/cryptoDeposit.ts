/**
 * @id PP-CORE-MCK-008
 * @name crypto deposit fixture (mock)
 * @implements-rules-version v1 (POO-1624 rules v1)
 *
 * The USDC a crypto deposit "arrives" with on the `/deposit` invest-context resume, for MOCK MODE
 * only (premise 2).
 *
 * ## Why this fixture exists as a module rather than a constant on the screen
 *
 * It used to be `const CRYPTO_RECEIVED = 100` at the top of `DepositScreen.tsx`, three lines above
 * the fiat minimum and indistinguishable from it, and NOTHING gated it on `isMockMode`. A 2500ms
 * `setTimeout` advanced the crypto path to a receipt and that number was printed as the amount that
 * had landed, in production, on a deposit nobody measured (POO-1624). The rule it broke is the one
 * this project states most plainly: no mock in real mode, missing real data is hidden or empty,
 * never faked.
 *
 * Moving it here makes the boundary STRUCTURAL rather than a comment. `src/mocks/` is the one place
 * a reader already knows is fixture data, so a future edit that reaches for this value has to
 * import it from a directory whose name is the answer to "may this reach a real buyer?".
 * `onRampCurrencies.ts` (`PP-CORE-MCK-006`) is the same move for the same reason, one screen over.
 *
 * ## Maximum realism
 *
 * $100 is the screen's own default entry (`amountText` opens at "100") and sits inside the app's
 * $10..$200,000 bound (POO-727), so the harness renders a receipt at the scale a real one would
 * have. It is a FALLBACK: under the invest context, which is the only context that can reach this
 * step at all, the shortfall the buyer was asked for is the figure used instead, so the mock
 * receipt agrees with the banner two screens back (POO-494 [R5]).
 *
 * PP-MOCK: a static figure, read only behind `isMockMode`.
 *
 * PP-INTEGRATION-POINT: the real amount is whatever the transfer actually delivered, and nothing in
 * this app observes it. The assumed contract, and the reason it is not built here, are recorded at
 * the one seam that would consume it (`DepositScreen.tsx`, the crypto-waiting effect) and in
 * POO-1624; the candidate mechanism is the balance-delta reconcile POO-1129 already built for the
 * fiat rail.
 */

/**
 * The mock USDC credited on the invest-context crypto resume, when no shortfall names a better
 * figure. Never read in real mode: the step that renders it is unreachable there.
 */
export const MOCK_CRYPTO_DEPOSIT_USDC = 100;
