/**
 * @id PP-CORE-HOK-033 (POO-1621, POO-1618, POO-1576)
 * @name useOnRampCurrencies
 * @implements-rules-version v1 (POO-1618 rules v1, decided on POO-1576)
 *
 * The OPTIONS half of the buyer's currency control: which fiats Paybis will sell this pair for.
 *
 * ## Why it is a read and not a constant
 *
 * The set is the vendor's, it is per PAIR, and it changes without a release. POO-1621 refuses the
 * shortcut in as many words ("do not work around this by hardcoding the list in the client"),
 * because that is the same defect POO-1513 deleted one layer down: a `"pix" | "card" | "applePay" |
 * "bank"` union that was neither country-filtered nor availability-checked, which is why a European
 * was offered Pix and an Android buyer was never offered Google Pay. A hardcoded currency list is
 * that mistake with a different noun.
 *
 * Measured 2026-08-14 (murilo, from the Paybis console): 44 fiats, and the SAME set for both targets
 * this app buys (`USDC-BASE` and the gas-first `ETH-BASE`). That equality is what makes the runtime
 * pair flip harmless rather than a state nobody drew: a choice made while the balance read still
 * says gas-first cannot be invalidated when it resolves. It is measured, not assumed, so this hook
 * still asks per pair and still re-asks when the pair moves.
 *
 * ## What it deliberately does not do
 *
 * It never fabricates. A failed read publishes NOTHING, and the caller's degraded state is the
 * read-only statement of the currency the server resolved, which is exactly what shipped before this
 * control existed. A Select rendered over a fabricated list is a control that lies (POO-494 [R1]),
 * and a Select rendered over a single option is not a choice.
 *
 * It also holds no CHOICE. The chosen currency lives in the surface that offers it, and travels from
 * there to `useBuyRouteQuote` as a proposal the server validates (POO-1618 [R2]). This hook answers
 * one question - what may be offered - so the two surfaces that need it (`/deposit`'s picker and the
 * provisioning method step) cannot disagree about the answer.
 *
 * PP-INTEGRATION-POINT: the supported fiat set ← `getOnRampSupportedCurrenciesAction`
 * (PP-CORE-LIB-063), over pool-party-api `GET /api/v1/on-ramp/currency-pairs-to-buy`.
 */
"use client";

import { useEffect, useRef, useState } from "react";
import { getOnRampSupportedCurrenciesAction } from "@/lib/onramp/onRampActions";

/** What {@link useOnRampCurrencies} needs. */
export interface OnRampCurrenciesInput {
  /** The Paybis crypto code being bought. Coverage is per PAIR, so this decides the answer. */
  currencyCodeTo: string;
  /**
   * Gate the read. Off wherever no control is being offered, so no upstream quota is spent listing
   * currencies nobody is being shown - the same posture every other on-ramp read here takes.
   */
  enabled: boolean;
}

/** What {@link useOnRampCurrencies} returns. */
export interface OnRampCurrenciesState {
  /**
   * The ISO-4217 codes this pair can be bought with, as the server sorted them, or NOTHING when the
   * set could not be read. Absence is a state the caller must handle, never an empty list to render.
   */
  currencies?: string[];
}

/** Read the fiat currencies this pair can be bought with. Degrades to nothing; never throws. */
export function useOnRampCurrencies({
  currencyCodeTo,
  enabled,
}: OnRampCurrenciesInput): OnRampCurrenciesState {
  const [currencies, setCurrencies] = useState<string[] | undefined>(undefined);
  // Monotonic run id: only the newest read may write. The pair FLIPS at runtime (`ETH-BASE` while
  // the balance read is degraded or in flight, then `USDC-BASE` when it lands), so a superseded
  // answer is an ordinary occurrence here rather than a theoretical one.
  const runIdRef = useRef(0);

  useEffect(() => {
    const runId = ++runIdRef.current;
    setCurrencies(undefined);
    if (!enabled) return;

    void (async () => {
      try {
        const result = await getOnRampSupportedCurrenciesAction({ currencyCodeTo });
        if (runIdRef.current !== runId) return; // superseded
        // A failure leaves `currencies` absent, which is the caller's read-only degrade. There is
        // deliberately no report here: the server names the cause at the degrade site that knows
        // what it costs (`onramp.currency_pairs_unreadable`), and a second client-side line would
        // only say that a read this hook cannot diagnose did not answer.
        if (result.ok) setCurrencies(result.currencies);
      } catch {
        // The actions do not throw across the RSC boundary, but a client-side surprise degrades the
        // same way: no options, and the caller states the resolved currency instead.
        if (runIdRef.current === runId) setCurrencies(undefined);
      }
    })();
  }, [currencyCodeTo, enabled]);

  return { ...(currencies === undefined ? {} : { currencies }) };
}
