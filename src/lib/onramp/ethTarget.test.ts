/**
 * @id PP-CORE-LIB-099 (POO-1573)
 * @name on-ramp ETH target tests
 * @implements-rules-version v1 (POO-1573 rules v2)
 *
 * Rules under test (POO-1573 rules v2):
 *   [R1] the gas-first leg is quoted received-fixed against an ETH TARGET, so the amount that crosses
 *        is a crypto figure and the buyer's own currency is left to the server to resolve.
 *   [R2] the conversion is the LAST step: `fundingUsd` arrives already floored (PAYBIS_MIN_USD) and
 *        already grossed up, and no USD figure is ever re-denominated on the way through.
 *   [R3] the price is a real ETH price read server-side, not the buyer's own balance ratio, which is
 *        exactly 0 for the empty wallet this leg exists to serve.
 *   [R5] an unpriceable target answers `null` here and the MINT refuses the purchase (rules v2; v1
 *        fell back to the spend-fixed USD leg, which silently re-billed a European in dollars on a
 *        card). This module's own contract is unchanged by that: it answers `null` and never throws.
 *        The refusal is pinned in `useProvisioningRail.test.tsx`.
 *
 * `apiFetch` is mocked: this suite is about the price read's SHAPE (path, cache, degrade) and the
 * decimal arithmetic, not the transport (`api/client.ts` has its own suite).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/errors";

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("@/lib/api/client", () => ({ apiFetch: mocks.apiFetch }));

import {
  PRICE_REVALIDATE_SECONDS,
  resolveOnRampEthTarget,
  toEthAmount,
  WETH_BASE_ADDRESS,
} from "./ethTarget";
// The other half of the same order: the sizer records `fiatAmount`, this module solves the CHARGE.
// Pure and transport-free, so importing it here costs nothing and lets the divergence between the
// two be pinned where they actually meet (`CR-TOK-006`).
import { sizeOnRampOrder } from "./sizeOnRampOrder";

/** The `/prices` row pool-party-api returns for one address (`usd` is a decimal STRING on the wire). */
function priceRow(usd: string, address: string = WETH_BASE_ADDRESS) {
  return [{ address, usd, derivedNative: "1" }];
}

beforeEach(() => {
  mocks.apiFetch.mockReset();
  mocks.apiFetch.mockResolvedValue(priceRow("2500"));
});

describe("toEthAmount (POO-1573)", () => {
  // @rule R1: the target is `gasFloorEth + fundingUsd / ethUsd`. The gas floor is ALREADY an ETH
  // quantity and is added as one; only the funding half is converted.
  it("adds the ETH gas floor to the converted USD funding", () => {
    expect(toEthAmount({ gasFloorEth: "0.001", fundingUsd: "50.00" }, 2500)).toBe("0.021");
  });

  // @rule R1: an in-flow order's gas is USD-denominated, so its ETH half is "0" and the whole target
  // is the conversion.
  it("converts the whole order when the ETH floor is zero", () => {
    expect(toEthAmount({ gasFloorEth: "0", fundingUsd: "214.00" }, 4000)).toBe("0.0535");
  });

  // @rule POO-1573 (rules comment, 2026-08-13): full decimals, and rounded UP where rounding is
  // unavoidable, so the gas floor is met rather than missed by a rounding error.
  it("carries 18 decimals and rounds UP, never down", () => {
    // 10 / 3 = 3.3333… ; the 18th decimal is raised rather than truncated.
    expect(toEthAmount({ gasFloorEth: "0", fundingUsd: "10" }, 3)).toBe("3.333333333333333334");
  });

  // @rule R5: a price we could not read is not a price. Every degraded value answers `null` so the
  // caller keeps the shipped spend-fixed behaviour instead of quoting a target of 0 or Infinity.
  it("refuses a zero, negative or non-finite price", () => {
    const target = { gasFloorEth: "0.001", fundingUsd: "50.00" };
    expect(toEthAmount(target, 0)).toBeNull();
    expect(toEthAmount(target, -1)).toBeNull();
    expect(toEthAmount(target, Number.NaN)).toBeNull();
    expect(toEthAmount(target, Number.POSITIVE_INFINITY)).toBeNull();
  });

  // @rule R5: a recipe that is not a decimal string (contract drift, a hand-built order) degrades the
  // same way rather than throwing inside a mint the user is waiting on.
  it("refuses a malformed recipe", () => {
    expect(toEthAmount({ gasFloorEth: "not-a-number", fundingUsd: "50.00" }, 2500)).toBeNull();
    expect(toEthAmount({ gasFloorEth: "0", fundingUsd: "" }, 2500)).toBeNull();
  });

  // @rule R1: a target of zero cannot be quoted received-fixed (the backend's receive floor is "> 0",
  // POO-1588), so it is refused here rather than 400ing upstream.
  it("refuses a zero target", () => {
    expect(toEthAmount({ gasFloorEth: "0", fundingUsd: "0" }, 2500)).toBeNull();
  });
});

/**
 * `CR-TOK-006`, pinned end to end (PR #875 review, F1).
 *
 * The sizer and this solver are the two halves of one order, and `fiatAmount` is recorded by the
 * first while the CHARGE is solved by the second. On the standalone gas-first leg they diverge, by
 * design and by a decision taken on the record (Rafael, 2026-08-13). This suite is where the two
 * halves meet, so it is where the size of that divergence is nailed down: a future change that
 * "fixes" it silently has to come through here.
 */
describe("[CR-TOK-006] the recorded figure vs the solved charge (POO-1573)", () => {
  const ETH_USD_AT_MINT = 2_500;
  const GAS_FLOOR_ETH = 0.001;

  /** What the solved ETH target is worth in USD at the price the mint used. */
  function chargeUsd(target: { gasFloorEth: string; fundingUsd: string }): number {
    return Number(toEthAmount(target, ETH_USD_AT_MINT)) * ETH_USD_AT_MINT;
  }

  // @rule POO-1573 R2: with a real `ethUsd` in hand the sizer values the ETH floor itself, so the
  // recorded figure IS the charge. The divergence below is not inherent to the split.
  it("agree to the cent when the caller could price ETH", () => {
    const { order } = sizeOnRampOrder({
      standalone: true,
      requiredUsd: 100,
      baseNativeEth: 0.0005,
      gasFloorEth: GAS_FLOOR_ETH,
      ethUsd: ETH_USD_AT_MINT,
    });

    expect(chargeUsd(order.ethTarget as { gasFloorEth: string; fundingUsd: string })).toBeCloseTo(
      Number(order.fiatAmount),
      2,
    );
  });

  /**
   * @rule POO-1573 R2 / `CR-TOK-006`: for the wallet this leg exists to serve, `ethUsd` is 0, so
   * `fiatAmount` under-records the charge by EXACTLY `gasFloorEth x ethUsd` ($2.50 at $2,500/ETH).
   *
   * Accepted: the ETH leg now genuinely funds gas, which it did not before this issue (it was
   * spend-fixed at `fiatAmount`, so the recorded figure WAS the charge and the gas was whatever it
   * happened to buy), and the surplus stays in the buyer's wallet. Not silent: recorded on
   * `CR-TOK-006` in `docs/COMPLIANCE_REGISTER.md`, and pinned here.
   */
  it("diverge by exactly the ETH gas floor for a zero-ETH wallet", () => {
    const { order } = sizeOnRampOrder({
      standalone: true,
      requiredUsd: 100,
      baseNativeEth: 0,
      gasFloorEth: GAS_FLOOR_ETH,
      // The `native.usd / native.amount` ratio for a wallet holding no ETH. Not a degraded read: the
      // arithmetically correct answer for an empty wallet, which is what makes this leg's case.
      ethUsd: 0,
    });

    const target = order.ethTarget as { gasFloorEth: string; fundingUsd: string };
    expect(order.fiatAmount).toBe("100.00");
    expect(chargeUsd(target) - Number(order.fiatAmount)).toBeCloseTo(
      GAS_FLOOR_ETH * ETH_USD_AT_MINT,
      6,
    );
  });

  /**
   * @rule POO-1573 R2 — PR #875 review, F4: the divergence above is the UN-VALUED FLOOR, and nothing
   * else. It must not grow a second source.
   *
   * This is the same zero-ETH wallet, plus the one input that can put a USD gas figure and an ETH gas
   * floor in the same standalone order: the user's card-ladder choice (rules v2 [R1] lets a
   * standalone order raise its gas with one). The dollar sizing takes the winner, `max($25, $0)`, so
   * the recipe must charge for that $25 ONCE. Summing the floor on top made the charge $127.50
   * against a recorded $125 for a divergence `CR-TOK-006` sizes at $2.50-when-unpriceable, i.e. a
   * SECOND $2.50 on an order that had already paid for its gas.
   */
  it("[F4] agree to the cent for a zero-ETH wallet whose gas choice priced the gas", () => {
    const { order } = sizeOnRampOrder({
      standalone: true,
      requiredUsd: 100,
      baseNativeEth: 0,
      gasFloorEth: GAS_FLOOR_ETH,
      ethUsd: 0,
      // A card-ladder rung (`GAS_PRESETS_USD`), which at any plausible ETH price buys many times the
      // 0.001 ETH floor: $25 is 0.01 ETH at $2,500.
      gasChoiceUsd: 25,
    });

    const target = order.ethTarget as { gasFloorEth: string; fundingUsd: string };
    expect(order.fiatAmount).toBe("125.00");
    expect(chargeUsd(target)).toBeCloseTo(Number(order.fiatAmount), 2);
  });
});

describe("resolveOnRampEthTarget (POO-1573)", () => {
  // @rule R3: the price comes from pool-party-api `GET /api/v1/prices`, addressed by WETH-on-Base
  // (native ETH has no contract address and the endpoint is `@IsEthereumAddress()`-validated), read
  // inside the `"use server"` boundary and cached, like the pairs read beside it.
  it("prices WETH on Base through the cached /prices read", async () => {
    const amount = await resolveOnRampEthTarget({ gasFloorEth: "0.001", fundingUsd: "50.00" });

    const [path, options] = mocks.apiFetch.mock.calls[0] as [string, Record<string, unknown>];
    expect(path).toContain("prices?");
    expect(path).toContain("network=base");
    expect(path).toContain(WETH_BASE_ADDRESS);
    expect(options.revalidate).toBe(PRICE_REVALIDATE_SECONDS);
    expect(amount).toBe("0.021");
  });

  /**
   * @rule POO-1573 [R3] (PR #875 review, F2): a price that SIZES A PURCHASE must be quote-grade.
   *
   * The default `/prices` path is display-grade: `getCurrenciesPrice` routes to
   * `pricesPerTokenWithStale(..., { live: false })`, and the 5-minute staleness cap in
   * `coingecko.service.ts` is gated on `live &&`, so a throttled or down CoinGecko lets this route
   * serve a price up to the full `COINGECKO_STALE_TTL_MS` HOUR old, logged server-side only. The
   * service's own comment says why that is not acceptable here: "Display and cached reads keep the
   * full hour; quoting does not". A stale-HIGH ETH price makes `fundingUsd / ethUsd` too small, the
   * buyer receives less ETH than the dollars they were sized for, and the downstream swap underfunds
   * the operation — the failure class POO-1375 moved the USDC leg away from.
   *
   * pool-party-api POO-1594 exposes the existing 5s-capped `getCurrenciesPriceLive` behind `live`.
   */
  it("asks for the quote-grade LIVE price, not the hour-tolerant display one", async () => {
    await resolveOnRampEthTarget({ gasFloorEth: "0.001", fundingUsd: "50.00" });

    const [path] = mocks.apiFetch.mock.calls[0] as [string, Record<string, unknown>];
    expect(path).toContain("live=true");
    // The FE cache may not outlive the live path's own 5s staleness cap, or it reintroduces exactly
    // the staleness the flag exists to remove (POO-1594 makes the same point about `@CacheTTL`).
    expect(PRICE_REVALIDATE_SECONDS).toBeLessThanOrEqual(5);
  });

  /**
   * @rule POO-1573 [R5] (PR #875 review, F2): the `live` flag carries a deploy-order dependency on
   * pool-party-api POO-1594, and BOTH un-deployed shapes have to be survivable.
   *
   * (1) The deployed API's global `ValidationPipe` runs `whitelist: true` with NO
   *     `forbidNonWhitelisted` anywhere in the repo (`main.ts:59-63`), so an API that predates
   *     POO-1594 STRIPS the unknown `live` param and answers 200 with the display-grade price. That
   *     is the actual behaviour, and it is why this is not a hard blocker: the leg keeps working and
   *     loses only the staleness cap.
   * (2) Were that ever to change (a `forbidNonWhitelisted` added, a gateway rejecting the param), the
   *     read must still answer rather than throw: a 400 becomes `null`, exactly as a throttle does,
   *     and the mint refuses the purchase on it ([R5] v2) instead of crashing inside a mint the buyer
   *     is waiting on.
   */
  it("degrades rather than throwing if an API rejects the live flag", async () => {
    mocks.apiFetch.mockRejectedValueOnce(
      new ApiError(400, "VALIDATION_FAILED", "property live should not exist"),
    );
    await expect(
      resolveOnRampEthTarget({ gasFloorEth: "0.001", fundingUsd: "50.00" }),
    ).resolves.toBeNull();
  });

  // @rule R5: the degrade posture of `resolveOnRampCurrency`'s pairs read, verbatim — a 404, a
  // throttle, a timeout or a parse failure costs precision, never the purchase.
  it("answers null when the price read fails", async () => {
    mocks.apiFetch.mockRejectedValueOnce(new ApiError(429, "THROTTLED", "slow down"));
    await expect(
      resolveOnRampEthTarget({ gasFloorEth: "0.001", fundingUsd: "50.00" }),
    ).resolves.toBeNull();
  });

  // @rule R5: an EMPTY answer is the same degrade. CoinGecko can simply not know a token, and
  // pool-party-api maps that to no row rather than an error.
  it("answers null when the price list has no row for WETH", async () => {
    mocks.apiFetch.mockResolvedValueOnce([]);
    await expect(
      resolveOnRampEthTarget({ gasFloorEth: "0.001", fundingUsd: "50.00" }),
    ).resolves.toBeNull();
    mocks.apiFetch.mockResolvedValueOnce(null);
    await expect(
      resolveOnRampEthTarget({ gasFloorEth: "0.001", fundingUsd: "50.00" }),
    ).resolves.toBeNull();
  });

  /**
   * @rule R5 / R3 (PR #875 self-review): a row for a DIFFERENT token is not an ETH price.
   *
   * The upstream keys its answer by the address it priced (`prices.service.formatResponse` maps
   * CoinGecko's response keys, which are lowercased contract addresses), so the case-insensitive
   * match above already covers every legitimate echo. Anything else is drift, and taking the first
   * row anyway would size a real purchase off an unidentified token's price. Answer `null` instead,
   * and the mint refuses ([R5] v2) rather than billing anyone against a price we cannot identify.
   */
  it("answers null when the only row is for another token", async () => {
    mocks.apiFetch.mockResolvedValueOnce(
      priceRow("1.0002", "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"),
    );
    await expect(
      resolveOnRampEthTarget({ gasFloorEth: "0.001", fundingUsd: "50.00" }),
    ).resolves.toBeNull();
  });

  /**
   * @rule R3: the same address in a different CASE is the same token, and CoinGecko lowercases.
   *
   * The echoed row varies the `0x` PREFIX, not the body (PR #875 review). WETH-on-Base is
   * `0x4200…0006`, an OP-stack predeploy with no alphabetic hex digit anywhere in it, so
   * `.toLowerCase()` on the constant is byte-identical to the constant: this test passed with both
   * `.toLowerCase()` calls deleted and the comparison made strict `===`, i.e. it duplicated the happy
   * path and asserted nothing about casing at all. The prefix is the only casing an all-numeric
   * address can actually vary in, so it is what has to be exercised for the assertion to bite.
   */
  it("matches the WETH row case-insensitively", async () => {
    mocks.apiFetch.mockResolvedValueOnce(priceRow("2500", WETH_BASE_ADDRESS.replace("0x", "0X")));
    await expect(
      resolveOnRampEthTarget({ gasFloorEth: "0.001", fundingUsd: "50.00" }),
    ).resolves.toBe("0.021");
  });

  // @rule R5: a row whose price is zero or unparseable is not a price either.
  it("answers null on an unusable price value", async () => {
    mocks.apiFetch.mockResolvedValueOnce(priceRow("0"));
    await expect(
      resolveOnRampEthTarget({ gasFloorEth: "0.001", fundingUsd: "50.00" }),
    ).resolves.toBeNull();
  });
});
