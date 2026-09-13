/**
 * @id PP-CORE-HOK-033 (POO-1621)
 * @name useOnRampCurrencies tests
 * @implements-rules-version v1 (POO-1618 rules v1)
 *
 * The options half of the currency control. The set is the vendor's, per pair, and it changes
 * without a release, so the ONLY acceptable source is the server (POO-1621: "do not work around this
 * by hardcoding the list in the client"). Everything here is about that contract: it asks per pair,
 * it never invents, and a failure leaves the caller with nothing rather than with a lie.
 */
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useOnRampCurrencies } from "./useOnRampCurrencies";

const mocks = vi.hoisted(() => ({ getCurrencies: vi.fn() }));

vi.mock("@/lib/onramp/onRampActions", () => ({
  getOnRampSupportedCurrenciesAction: mocks.getCurrencies,
}));

afterEach(() => {
  mocks.getCurrencies.mockReset();
});

describe("useOnRampCurrencies (POO-1621)", () => {
  // @rule the set is per PAIR, so the pair is what it is asked for, and the answer is published
  // exactly as the server sorted it.
  it("publishes the supported set for the pair", async () => {
    mocks.getCurrencies.mockResolvedValue({ ok: true, currencies: ["BRL", "EUR", "USD"] });

    const { result } = renderHook(() =>
      useOnRampCurrencies({ currencyCodeTo: "USDC-BASE", enabled: true }),
    );

    await waitFor(() => expect(result.current.currencies).toEqual(["BRL", "EUR", "USD"]));
    expect(mocks.getCurrencies).toHaveBeenCalledWith({ currencyCodeTo: "USDC-BASE" });
  });

  // @rule POO-1630: a failure yields NOTHING, never a fabricated list. The caller's degraded state
  // is the read-only statement of the resolved currency, which is what shipped before this existed.
  it("publishes nothing when the set cannot be read", async () => {
    mocks.getCurrencies.mockResolvedValue({
      ok: false,
      code: "ONRAMP_CURRENCIES_UNAVAILABLE",
      message: "no",
    });

    const { result } = renderHook(() =>
      useOnRampCurrencies({ currencyCodeTo: "USDC-BASE", enabled: true }),
    );

    await waitFor(() => expect(mocks.getCurrencies).toHaveBeenCalled());
    expect(result.current.currencies).toBeUndefined();
  });

  // @rule the same quota rule every on-ramp read follows: nothing is spent for a control nobody is
  // being shown.
  it("asks for nothing while disabled", () => {
    renderHook(() => useOnRampCurrencies({ currencyCodeTo: "USDC-BASE", enabled: false }));

    expect(mocks.getCurrencies).not.toHaveBeenCalled();
  });

  // @rule the pair FLIPS at runtime (`ETH-BASE` while the balance read is degraded or in flight,
  // then `USDC-BASE`), so the answer for the old pair may not stand for the new one and the set is
  // re-read rather than reused.
  it("re-reads the set when the pair changes", async () => {
    mocks.getCurrencies.mockResolvedValue({ ok: true, currencies: ["USD"] });

    const { rerender } = renderHook(
      ({ pair }: { pair: string }) => useOnRampCurrencies({ currencyCodeTo: pair, enabled: true }),
      { initialProps: { pair: "ETH-BASE" } },
    );

    await waitFor(() => expect(mocks.getCurrencies).toHaveBeenCalledTimes(1));
    rerender({ pair: "USDC-BASE" });
    await waitFor(() => expect(mocks.getCurrencies).toHaveBeenCalledTimes(2));
    expect(mocks.getCurrencies).toHaveBeenLastCalledWith({ currencyCodeTo: "USDC-BASE" });
  });

  // @rule race: an answer for a pair that is no longer on screen may not be published. The pair flip
  // above is exactly the sequence that produces one, and a 44-code list for the wrong pair is a
  // control that offers currencies this purchase cannot use.
  it("discards an answer that a newer pair superseded", async () => {
    let settleFirst: ((value: unknown) => void) | undefined;
    mocks.getCurrencies.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          settleFirst = resolve;
        }),
    );
    mocks.getCurrencies.mockResolvedValue({ ok: true, currencies: ["EUR", "USD"] });

    const { result, rerender } = renderHook(
      ({ pair }: { pair: string }) => useOnRampCurrencies({ currencyCodeTo: pair, enabled: true }),
      { initialProps: { pair: "ETH-BASE" } },
    );

    await waitFor(() => expect(mocks.getCurrencies).toHaveBeenCalledTimes(1));
    rerender({ pair: "USDC-BASE" });
    await waitFor(() => expect(result.current.currencies).toEqual(["EUR", "USD"]));

    settleFirst?.({ ok: true, currencies: ["JPY"] });
    await waitFor(() => expect(result.current.currencies).toEqual(["EUR", "USD"]));
  });
});
