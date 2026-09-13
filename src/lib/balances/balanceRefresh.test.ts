/**
 * @id PP-BALANCES (POO-1128)
 * @name balanceRefresh.test
 * @implements-rules-version v1
 * Unit test for the wallet-balance invalidation channel ([R4]): every subscriber is notified,
 * unsubscribing stops delivery, a subscriber that unsubscribes mid-notification never starves the
 * ones after it, and a throwing subscriber never breaks the publisher's success path.
 */
import { describe, expect, it, vi } from "vitest";
import { requestBalanceRefresh, subscribeBalanceRefresh } from "./balanceRefresh";

describe("balanceRefresh", () => {
  it("notifies every subscriber on request", () => {
    const first = vi.fn();
    const second = vi.fn();
    const unsubFirst = subscribeBalanceRefresh(first);
    const unsubSecond = subscribeBalanceRefresh(second);

    requestBalanceRefresh();

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    unsubFirst();
    unsubSecond();
  });

  it("stops delivering once unsubscribed", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeBalanceRefresh(listener);

    requestBalanceRefresh();
    unsubscribe();
    requestBalanceRefresh();

    expect(listener).toHaveBeenCalledTimes(1);
  });

  // The hook unsubscribes from inside an effect cleanup, which can run while a publish is in flight
  // (a write that unmounts the modal). Iterating a snapshot keeps later subscribers from being
  // skipped when an earlier one mutates the set.
  it("still notifies later subscribers when an earlier one unsubscribes mid-notification", () => {
    const later = vi.fn();
    let unsubEarly: () => void = () => {};
    const early = vi.fn(() => unsubEarly());
    unsubEarly = subscribeBalanceRefresh(early);
    const unsubLater = subscribeBalanceRefresh(later);

    requestBalanceRefresh();

    expect(early).toHaveBeenCalledTimes(1);
    expect(later).toHaveBeenCalledTimes(1);
    unsubLater();
  });

  // Publishers call this from a transaction success handler; a broken subscriber must never turn a
  // confirmed on-chain write into a thrown error on screen.
  it("isolates a throwing subscriber from the others and from the caller", () => {
    const healthy = vi.fn();
    const unsubBroken = subscribeBalanceRefresh(() => {
      throw new Error("subscriber blew up");
    });
    const unsubHealthy = subscribeBalanceRefresh(healthy);

    expect(() => requestBalanceRefresh()).not.toThrow();
    expect(healthy).toHaveBeenCalledTimes(1);

    unsubBroken();
    unsubHealthy();
  });
});
