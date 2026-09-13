/**
 * @id PP-STR-CMP-029 (POO-1808) - tests
 * @name the buy step's blocked intents reach the dataLayer
 * @implements-rules-version v1 (POO-1808 rules v1)
 * @analytics-events tx_amount_blocked
 *
 * [R8] Premise 11's blocked-intent half, for the four walls this step puts in front of a buyer
 * BEFORE a checkout opens: the rail sells no native coin, nobody will sell to them today, we cannot
 * charge in their currency, and we could not read the balance a delivery would be measured against.
 * None is a validation failure, and every one is invisible without instrumentation: the buyer sees a
 * sentence and leaves, and nothing downstream ever records that they wanted to buy.
 *
 * Assertions read `window.dataLayer` rather than a mocked `track`, so what is asserted is what GTM
 * would really receive, sanitizer included. That also lets the last case prove the negative that
 * matters most on a funding surface: no wallet address is anywhere in the payload.
 *
 * The `funding_buy_*` family is POO-1813's, wired once through one shared emitter
 * (`fundingBuyFunnel.ts`, `PP-CORE-LIB-111`) so a second emitter cannot double-count a purchase.
 * Exactly ONE of its four rows originates from this step, `funding_buy_settled`, because it is the
 * observed balance delta and the adapter that reports the other three never sees a balance. The
 * other three are asserted at the adapter's own seam (`usePrivyOnRamp.test.tsx`), and the case below
 * pins that split from this side: a step that started emitting `started` or `submitted` would be
 * counting the same purchase twice.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import messages from "@/i18n/messages/en/strategies.json";
import type { ProvisioningOrder } from "@/lib/provisioning/types";
import { PrivyBuyStep, type PrivyBuyStepDeps } from "./provisioning/PrivyBuyStep";

const ADDRESS = "0x1111111111111111111111111111111111111111";

const USDC_ORDER: ProvisioningOrder = {
  currencyCode: "USDC-BASE",
  fiatAmount: "120.00",
  fiatCurrency: "USD",
};

function renderStep(
  deps: Partial<PrivyBuyStepDeps>,
  order: ProvisioningOrder = USDC_ORDER,
  buyerCurrency?: string,
) {
  const full: PrivyBuyStepDeps = {
    openCheckout: vi.fn(async () => ({
      attemptId: "att_1",
      moved: "confirmed" as const,
      reason: "ok",
    })),
    probeCoverage: vi.fn(async () => ({ status: "covered" as const, methods: [] })),
    readBalance: vi.fn(async () => BigInt(0)),
    watchVisible: vi.fn(async () => ({
      outcome: "settled" as const,
      delivered: { amount: "120", asset: "0xusdc", chain: "eip155:8453", observedAt: 1 },
    })),
    sleep: async () => {},
    now: () => 0,
    environment: "sandbox",
    ...deps,
  };
  render(
    <NextIntlClientProvider locale="en" messages={{ strategies: messages }}>
      <PrivyBuyStep
        order={order}
        address={ADDRESS}
        onSettled={vi.fn()}
        onFailed={vi.fn()}
        deps={full}
        {...(buyerCurrency ? { buyerCurrency } : {})}
        analytics={{ flow: "invest", strategyId: "strat-1" }}
      />
    </NextIntlClientProvider>,
  );
}

/** Every event pushed so far, in order. */
function pushed(): Record<string, unknown>[] {
  return (window.dataLayer ?? []) as Record<string, unknown>[];
}

beforeEach(() => {
  window.dataLayer = [];
});
afterEach(() => {
  vi.clearAllMocks();
});

describe("[R8] blocked intents", () => {
  // @rule R8
  it("[R8] reports a refused native order once, with its own reason", async () => {
    renderStep({}, { ...USDC_ORDER, currencyCode: "ETH-BASE" });

    await waitFor(() =>
      expect(pushed()).toContainEqual(
        expect.objectContaining({
          event: "tx_amount_blocked",
          block_reason: "onramp_native_unavailable",
        }),
      ),
    );
    expect(pushed().filter((entry) => entry.event === "tx_amount_blocked")).toHaveLength(1);
  });

  // @rule R8
  it("[R8] reports an uncovered buyer with a DIFFERENT reason, so the two are separable", async () => {
    // Folding these together would make "this rail cannot sell ETH at all" indistinguishable from
    // "nobody sells to Brazil today", which point at opposite fixes.
    renderStep({ probeCoverage: vi.fn(async () => ({ status: "uncovered" as const })) });

    await waitFor(() =>
      expect(pushed()).toContainEqual(
        expect.objectContaining({
          event: "tx_amount_blocked",
          block_reason: "onramp_uncovered",
        }),
      ),
    );
  });

  // @rule R8
  it("[R8] reports a currency the rail cannot charge in, rather than charging dollars", async () => {
    // The POO-1512 class. A silent USD fallback is a charge in money nobody chose, and it looks
    // like a completed purchase from every angle we can see, so it is a refusal we can count.
    renderStep({}, USDC_ORDER, "XYZ");

    await waitFor(() =>
      expect(pushed()).toContainEqual(
        expect.objectContaining({
          event: "tx_amount_blocked",
          block_reason: "onramp_currency_unsupported",
        }),
      ),
    );
  });

  // @rule R8
  it("[R8] reports an unreadable baseline, the wall with no visible refusal", async () => {
    // The only one of the four that does not swap the screen for a sentence: the CTA just never
    // enables. Without this event that is a buyer stuck on "checking your balance" forever and a
    // metric that never moves.
    renderStep({
      readBalance: vi.fn(async () => {
        throw new Error("rpc down");
      }),
    });

    await waitFor(() =>
      expect(pushed()).toContainEqual(
        expect.objectContaining({
          event: "tx_amount_blocked",
          block_reason: "onramp_baseline_unreadable",
        }),
      ),
    );
  });

  // @rule R8
  it("[R8] carries the flow context on every reason, so the funnel can attribute them", async () => {
    renderStep({ probeCoverage: vi.fn(async () => ({ status: "uncovered" as const })) });

    await waitFor(() =>
      expect(pushed()).toContainEqual(
        expect.objectContaining({
          event: "tx_amount_blocked",
          block_reason: "onramp_uncovered",
          flow: "invest",
          strategy_id: "strat-1",
        }),
      ),
    );
  });

  // @rule R8
  it("[R8] reports NOTHING when the purchase is allowed to proceed", async () => {
    // A blocked-intent event that also fired on the happy path would make the metric meaningless.
    renderStep({});

    const cta = await screen.findByRole("button");
    await waitFor(() => expect(cta).toBeEnabled());
    await userEvent.click(cta);

    await waitFor(() => expect(screen.getByRole("status")).toBeInTheDocument());
    expect(pushed().filter((entry) => entry.event === "tx_amount_blocked")).toHaveLength(0);
  });

  // @rule R8
  it("[R8] emits ONLY the settled row of the funding_buy_* family, never the adapter's three", async () => {
    /**
     * POO-1813 [R3]/[R4]. This assertion used to demand silence, which was true only while the
     * family was unwired. What it protects is the same thing either way: ONE emitter per row. The
     * adapter is mocked in this suite, so `started`, `submitted` and `failed` cannot appear unless
     * this step grew its own copy of them, which would report every purchase twice.
     */
    renderStep({});
    const cta = await screen.findByRole("button");
    await waitFor(() => expect(cta).toBeEnabled());
    await userEvent.click(cta);

    await waitFor(() => expect(screen.getByRole("status")).toBeInTheDocument());
    await waitFor(() =>
      expect(
        pushed()
          .map((entry) => String(entry.event))
          .filter((name) => name.startsWith("funding_buy")),
      ).toEqual(["funding_buy_settled"]),
    );
  });

  // @rule R8
  it("[R8] never puts the wallet address in the payload", async () => {
    renderStep({ probeCoverage: vi.fn(async () => ({ status: "uncovered" as const })) });

    await waitFor(() => expect(pushed().length).toBeGreaterThan(0));
    expect(JSON.stringify(pushed())).not.toMatch(/0x[0-9a-fA-F]{40}/);
  });
});
