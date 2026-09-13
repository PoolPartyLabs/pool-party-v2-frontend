/**
 * @id PP-STR-CMP-024
 * @name ProvisioningCostBreakdown — tests
 * @implements-rules-version v1
 * @hackathon POO-1022 (Universal Funding)
 *
 * Rules under test (POO-1040 rules v1):
 *   [R1] per source and in aggregate: swap cost, bridge fee, gas per on-chain leg, price impact,
 *        slippage allowance, and "You pay"
 *   [R2] "You pay" is the quote's OWN `totalPayUsd`, never a second derivation
 *   [R3] a "Buy crypto instead" CTA sits alongside as a peer option, handing off to /deposit
 *   [R4] the quote TTL is surfaced; on expiry the breakdown re-quotes and visibly updates
 *   [R5] fee figures come from real quotes only; no hardcoded fee model
 *   [R6] hero figures visible, fee detail behind Show more
 *   [R8] per-leg gas renders at a precision that keeps it non-zero, itemized (never a sum)
 *
 * POO-1380 rules v1 (the buy-crypto CTA names the amount):
 *   [R1] a finite positive `buyAmountUsd` makes the CTA read "Buy {formatUsd(amount)}"
 *   [R3] an unresolved amount (undefined / NaN / Infinity / zero / negative) degrades the CTA back
 *        to the current wording, never "Buy undefined", "Buy $NaN", or a bare currency symbol
 *
 * Presentational: every case is a hand-built plan, no network and no server action.
 */
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CROSS_CHAIN_PLAN,
  FIXTURE_TTL_MS,
  GAS_TOP_UP_PLAN,
  SAME_CHAIN_PLAN,
} from "@/lib/provisioning/fixtures/pricedPlans";
import type { ProvisioningPlan } from "@/lib/provisioning/types";
import {
  act,
  renderWithProviders,
  screen,
  userEvent,
} from "../../../../../tests/utils/renderWithProviders";
import { ProvisioningCostBreakdown } from "./ProvisioningCostBreakdown";

vi.mock("@/i18n/navigation", () => ({
  Link: ({
    href,
    children,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

/** The `<dd>` text of the receipt row labelled `label`. */
function rowValue(label: string): string {
  return screen.getByText(label).nextElementSibling?.textContent ?? "";
}

/** The accessible name of a row's info (ⓘ) trigger, i.e. its flat breakdown. */
function rowDetail(label: string): string {
  return screen.getByText(label).querySelector("button")?.getAttribute("aria-label") ?? "";
}

/** `"$1,234.56"` → `1234.56`, so a rendered figure can be reasoned about as money. */
const money = (text: string): number => Number(text.replace(/[$,]/g, ""));

/** Whole cents, because `100 + 0.14 + 1.21` is not `101.35` in IEEE-754. */
const cents = (usd: number): number => Math.round(usd * 100);

/** Reveal the collapsed fee detail. */
async function showMore(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Show more" }));
}

function render(plan: ProvisioningPlan) {
  return renderWithProviders(<ProvisioningCostBreakdown plan={plan} onRequote={() => {}} />);
}

afterEach(() => {
  vi.useRealTimers();
});

// --- [R2] the total identity --------------------------------------------------------------------

describe("the total identity [R1][R2]", () => {
  it.each([
    ["same chain", SAME_CHAIN_PLAN],
    ["cross chain", CROSS_CHAIN_PLAN],
    ["gas top-up", GAS_TOP_UP_PLAN],
  ])("renders the quote's own You pay, and the detail rows add up to it (%s)", async (_n, plan) => {
    const user = userEvent.setup();
    render(plan);

    // [R2] the contract's figure, verbatim.
    expect(money(rowValue("You pay"))).toBe(plan.quote.totalPayUsd);

    await showMore(user);
    const needed = money(rowValue("Amount needed"));
    const fee = money(rowValue("Fee"));
    const buffer = money(rowValue("Price buffer"));

    // The three components a person reads have to equal the total they are asked to approve.
    expect(cents(needed) + cents(fee) + cents(buffer)).toBe(cents(plan.quote.totalPayUsd));
    expect(needed).toBe(plan.quote.shortfallUsd);
  });

  it("falls back to the quote's own components when a plan carries no legs [R2]", async () => {
    // A mock-mode plan: a real quote, nothing to itemize. The table still states what the user
    // pays and what it is made of, rather than showing an empty breakdown under a real total.
    const legless: ProvisioningPlan = {
      needed: true,
      reason: ["usdc"],
      variant: "multi",
      steps: [{ type: "op", key: "op", labelKey: "provisioning.steps.op", amountUsd: 100 }],
      quote: {
        shortfallUsd: 100,
        bufferUsd: 2.5,
        feesUsd: 1.25,
        totalPayUsd: 103.75,
        quotedAt: "2026-07-24T12:00:00.000Z",
        ttlMs: FIXTURE_TTL_MS,
      },
    };
    const user = userEvent.setup();
    render(legless);

    expect(money(rowValue("You pay"))).toBe(103.75);
    await showMore(user);
    expect(
      cents(money(rowValue("Amount needed"))) +
        cents(money(rowValue("Fee"))) +
        cents(money(rowValue("Price buffer"))),
    ).toBe(cents(103.75));
  });
});

// --- [R1] every line, per source and in aggregate ------------------------------------------------

describe("the aggregate lines [R1]", () => {
  it("shows price impact and the slippage allowance from the plan's own quote", async () => {
    const user = userEvent.setup();
    render(CROSS_CHAIN_PLAN);
    await showMore(user);

    // The worst impact across the plan's AMM legs, straight from the quote.
    expect(rowValue("Price impact")).toBe("0.30%");
    // The allowance the plan was quoted with, as a percent and as the dollars it sets aside.
    expect(rowValue("Max. slippage")).toContain("2%");
    expect(money(rowValue("Price buffer"))).toBe(1.21);
  });

  it("shows the swap cost as its own line, outside the total", async () => {
    const user = userEvent.setup();
    render(SAME_CHAIN_PLAN);
    await showMore(user);

    // $100.40 of WETH quoted into 100 USDC: the 40c is paid by receiving less, not by paying more,
    // so it is reported and deliberately not added to what you pay.
    expect(money(rowValue("Conversion cost"))).toBe(0.4);
    expect(cents(money(rowValue("You pay")))).toBe(
      cents(money(rowValue("Amount needed"))) +
        cents(money(rowValue("Fee"))) +
        cents(money(rowValue("Price buffer"))),
    );
  });

  it("shows what each funding source hands over, with its own cost lines [R1]", async () => {
    const user = userEvent.setup();
    render(CROSS_CHAIN_PLAN);
    await showMore(user);

    expect(money(rowValue("From WETH on Polygon"))).toBe(60.5);
    expect(money(rowValue("From USDC on Base"))).toBe(40);
    // Per source: its gas, its bridge fee, its buffer, its conversion cost and its price impact.
    const detail = rowDetail("From WETH on Polygon");
    expect(detail).toContain("Bridge fee $0.06");
    expect(detail).toContain("Price buffer $1.21");
    expect(detail).toContain("Conversion cost $0.50");
    expect(detail).toContain("Price impact 0.30%");
    expect(detail).toContain("Total $1.31");
    expect(rowDetail("From USDC on Base")).toContain("Bridge fee $0.04");
  });
});

// --- the bridge line, which no caller could ever populate before ---------------------------------

describe("the bridge fee [R1][R5]", () => {
  it("shows a real bridge figure in the fee tooltip when the quote priced one", async () => {
    const user = userEvent.setup();
    render(CROSS_CHAIN_PLAN);
    await showMore(user);

    // The canonical tooltip's Bridge line was a "Coming soon" placeholder until POO-1035 gave it a
    // number: $0.06 + $0.04 of quoted Across spread across the two bridge legs.
    const detail = rowDetail("Fee");
    expect(detail).toContain("Bridge fee $0.10");
    expect(detail).not.toContain("Coming soon");
    expect(money(rowValue("Fee"))).toBe(0.14);
  });

  it("shows no bridge line at all on a same-chain plan", async () => {
    const user = userEvent.setup();
    render(SAME_CHAIN_PLAN);
    await showMore(user);

    // Asserted positively too, so "no bridge line" cannot pass by the tooltip being absent.
    expect(rowDetail("Fee")).toBe("Estimated gas (network fee) $0.02");
    expect(screen.queryByText("Coming soon")).not.toBeInTheDocument();
  });

  it("renders no fee or buffer row when no leg quoted a figure [R5]", async () => {
    // Every figure is quote-derived: a plan whose legs priced nothing shows nothing, rather than
    // reintroducing a stand-in fee model.
    const unpriced: ProvisioningPlan = {
      ...SAME_CHAIN_PLAN,
      slippagePct: undefined,
      steps: SAME_CHAIN_PLAN.steps.map((step) =>
        step.leg ? { ...step, leg: { ...step.leg, gasUsd: 0 } } : step,
      ),
      quote: { ...SAME_CHAIN_PLAN.quote, bufferUsd: 0, feesUsd: 0, totalPayUsd: 100 },
    };
    const user = userEvent.setup();
    render(unpriced);
    await showMore(user);

    expect(money(rowValue("You pay"))).toBe(100);
    expect(screen.queryByText("Fee")).not.toBeInTheDocument();
    expect(screen.queryByText("Price buffer")).not.toBeInTheDocument();
    expect(screen.queryByText("Max. slippage")).not.toBeInTheDocument();
    expect(screen.queryByText("Network cost by step")).not.toBeInTheDocument();
  });
});

// --- [R8] per-leg gas ---------------------------------------------------------------------------

describe("per-leg gas [R1][R8]", () => {
  it("keeps a sub-cent L2 leg visible while the aggregate stays in cents", async () => {
    const user = userEvent.setup();
    render(CROSS_CHAIN_PLAN);
    await showMore(user);

    // The Base bridge costs $0.0031. Rounded to cents it would read "$0.00", i.e. free, which it
    // is not. The aggregate network figure stays cents-rounded ($0.04, not $0.0431).
    expect(rowValue("Step 3: Move from Base")).toBe("$0.0031");
    expect(rowValue("Step 1: Convert on Polygon")).toBe("$0.01");
    expect(rowValue("Step 2: Move from Polygon")).toBe("$0.03");
    expect(rowDetail("Fee")).toContain("Estimated gas (network fee) $0.04");
  });

  it("labels the per-leg list as an itemization, not as an addition", async () => {
    const user = userEvent.setup();
    render(CROSS_CHAIN_PLAN);
    await showMore(user);

    // The rows deliberately do NOT sum to the aggregate (different rounding), so the list says so
    // rather than inviting the user to add it up.
    expect(screen.getByText("Network cost by step")).toBeInTheDocument();
    expect(rowDetail("Network cost by step")).toMatch(/rounded to cents/i);
  });

  it("names a gas top-up leg for what it is [R1]", async () => {
    const user = userEvent.setup();
    render(GAS_TOP_UP_PLAN);
    await showMore(user);

    expect(rowValue("Step 1: Cover fees on Polygon")).toBe("$0.0042");
  });
});

// --- [R6] the collapsed-detail convention -------------------------------------------------------

describe("the collapsed-detail convention [R6]", () => {
  it("shows the hero figure and hides the fee detail until Show more", async () => {
    const user = userEvent.setup();
    render(CROSS_CHAIN_PLAN);

    expect(screen.getByText("You pay")).toBeVisible();
    expect(screen.getByText("Fee")).not.toBeVisible();

    await showMore(user);
    expect(screen.getByText("Fee")).toBeVisible();
  });
});

// --- [R3] the alternative -----------------------------------------------------------------------

describe("the buy-crypto alternative [R3]", () => {
  it("offers a peer CTA that hands off to the existing deposit surface", () => {
    render(CROSS_CHAIN_PLAN);

    const cta = screen.getByRole("link", { name: /Buy crypto instead/ });
    expect(cta).toHaveAttribute("href", "/deposit");
    // A peer option, not a detail: it stays visible without opening Show more.
    expect(cta).toBeVisible();
  });

  it("carries the caller's deposit context when it has one", () => {
    renderWithProviders(
      <ProvisioningCostBreakdown
        plan={CROSS_CHAIN_PLAN}
        onRequote={() => {}}
        buyCryptoHref="/deposit?strategy=abc&amount=100"
      />,
    );
    expect(screen.getByRole("link", { name: /Buy crypto instead/ })).toHaveAttribute(
      "href",
      "/deposit?strategy=abc&amount=100",
    );
  });
});

// --- POO-1380 [R1][R3] the buy-crypto CTA names the amount ---------------------------------------

describe("the buy-crypto CTA amount [POO-1380 R1][R3]", () => {
  /** The whole card's text, so a broken interpolation cannot hide behind a role query. */
  function cardText(): string {
    return screen.getByTestId("provisioning-cost-breakdown").textContent ?? "";
  }

  it("[R1] names the amount when a resolved buy amount is supplied", () => {
    renderWithProviders(
      <ProvisioningCostBreakdown
        plan={CROSS_CHAIN_PLAN}
        onRequote={() => {}}
        buyAmountUsd={101.02}
      />,
    );

    // The CTA reads "Buy $101.02" (the amount through `formatUsd`, never a raw number), and it is
    // still the same peer link to the deposit surface.
    const cta = screen.getByRole("link", { name: /Buy \$101\.02/ });
    expect(cta).toHaveAttribute("href", "/deposit");
    expect(cta).toBeVisible();
    // The old wording is gone once a real amount is known.
    expect(screen.queryByRole("link", { name: /Buy crypto instead/ })).not.toBeInTheDocument();
  });

  // @rule POO-1512 [R7]: the CTA prints the charge in the currency it is BILLED in, the same one the
  // FundingRoutePicker buy row names for this same figure. Without it a German buyer saw the row say
  // "208.00 EUR" and this CTA say "Buy $208.00" for the SAME charge.
  it("[POO-1512 R7] names the amount in the charge's own currency", () => {
    renderWithProviders(
      <ProvisioningCostBreakdown
        plan={CROSS_CHAIN_PLAN}
        onRequote={() => {}}
        buyAmountUsd={208}
        buyAmountCurrency="EUR"
      />,
    );

    expect(screen.getByRole("link", { name: /Buy €208\.00/ })).toBeVisible();
    expect(cardText()).not.toMatch(/\$208\.00/);
  });

  it("[R3] degrades to the current wording when the amount is undefined", () => {
    // The live default: the crypto-only cut and mock mode never price the on-ramp quote, so the host
    // passes nothing. The CTA must read the current wording, not a broken interpolation.
    renderWithProviders(<ProvisioningCostBreakdown plan={CROSS_CHAIN_PLAN} onRequote={() => {}} />);

    expect(screen.getByRole("link", { name: /Buy crypto instead/ })).toBeVisible();
    expect(cardText()).not.toMatch(/Buy undefined/);
    expect(cardText()).not.toMatch(/\$NaN/);
    // No bare "Buy $" with nothing (or a non-digit) after it.
    expect(cardText()).not.toMatch(/Buy \$(?!\d)/);
  });

  it.each([
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["zero", 0],
    ["negative", -5],
  ])("[R3] degrades to the current wording when the amount is %s", (_label, amount) => {
    renderWithProviders(
      <ProvisioningCostBreakdown
        plan={CROSS_CHAIN_PLAN}
        onRequote={() => {}}
        buyAmountUsd={amount}
      />,
    );

    expect(screen.getByRole("link", { name: /Buy crypto instead/ })).toBeVisible();
    expect(cardText()).not.toMatch(/Buy undefined/);
    expect(cardText()).not.toMatch(/\$NaN/);
    expect(cardText()).not.toMatch(/Buy \$(?!\d)/);
    expect(cardText()).not.toMatch(/Buy Infinity/);
  });
});

// --- [R4] the TTL loop --------------------------------------------------------------------------

describe("the quote TTL [R4]", () => {
  it("surfaces the window and counts it down", () => {
    vi.useFakeTimers();
    render(CROSS_CHAIN_PLAN);

    expect(screen.getByText("Refreshes in 15s")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(3_000);
    });
    expect(screen.getByText("Refreshes in 12s")).toBeInTheDocument();
  });

  it("re-quotes on expiry and visibly updates before the user can commit", () => {
    vi.useFakeTimers();
    const onRequote = vi.fn();
    const { rerender } = renderWithProviders(
      <ProvisioningCostBreakdown plan={CROSS_CHAIN_PLAN} onRequote={onRequote} />,
    );

    expect(money(rowValue("You pay"))).toBe(101.35);
    expect(onRequote).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(FIXTURE_TTL_MS);
    });
    expect(onRequote).toHaveBeenCalledTimes(1);

    // While the fresh quote is in flight the card says so, rather than presenting a price it knows
    // is stale as if it were current.
    rerender(
      <ProvisioningCostBreakdown plan={CROSS_CHAIN_PLAN} onRequote={onRequote} requoting={true} />,
    );
    expect(screen.getByText("Updating prices")).toBeInTheDocument();
    expect(screen.getByTestId("provisioning-cost-breakdown")).toHaveAttribute("aria-busy", "true");

    // The re-quote lands: a new total, and a full window again.
    const requoted: ProvisioningPlan = {
      ...CROSS_CHAIN_PLAN,
      quote: {
        ...CROSS_CHAIN_PLAN.quote,
        totalPayUsd: 108.42,
        quotedAt: "2026-07-24T12:00:15.000Z",
      },
    };
    rerender(<ProvisioningCostBreakdown plan={requoted} onRequote={onRequote} />);

    expect(money(rowValue("You pay"))).toBe(108.42);
    expect(screen.getByText("Refreshes in 15s")).toBeInTheDocument();
    expect(screen.getByTestId("provisioning-cost-breakdown")).toHaveAttribute("aria-busy", "false");
  });

  it("does not re-quote again while a re-quote is still in flight", () => {
    vi.useFakeTimers();
    const onRequote = vi.fn();
    const { rerender } = renderWithProviders(
      <ProvisioningCostBreakdown plan={CROSS_CHAIN_PLAN} onRequote={onRequote} />,
    );

    act(() => {
      vi.advanceTimersByTime(FIXTURE_TTL_MS);
    });
    expect(onRequote).toHaveBeenCalledTimes(1);

    // The host is slow: it is still fetching, so the plan (and its `quotedAt`) has not changed and
    // nothing remounts. Several windows' worth of time passes with the request still out.
    rerender(
      <ProvisioningCostBreakdown plan={CROSS_CHAIN_PLAN} onRequote={onRequote} requoting={true} />,
    );
    act(() => {
      vi.advanceTimersByTime(FIXTURE_TTL_MS * 3);
    });
    expect(onRequote).toHaveBeenCalledTimes(1);

    // It finally comes back with a fresh quote: a full window, and the loop carries on from there.
    const requoted: ProvisioningPlan = {
      ...CROSS_CHAIN_PLAN,
      quote: { ...CROSS_CHAIN_PLAN.quote, quotedAt: "2026-07-24T12:00:45.000Z" },
    };
    rerender(<ProvisioningCostBreakdown plan={requoted} onRequote={onRequote} />);
    expect(screen.getByText("Refreshes in 15s")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(FIXTURE_TTL_MS);
    });
    expect(onRequote).toHaveBeenCalledTimes(2);
  });

  it("does not re-quote while paused", () => {
    vi.useFakeTimers();
    const onRequote = vi.fn();
    renderWithProviders(
      <ProvisioningCostBreakdown plan={CROSS_CHAIN_PLAN} onRequote={onRequote} active={false} />,
    );

    act(() => {
      vi.advanceTimersByTime(FIXTURE_TTL_MS * 3);
    });
    expect(onRequote).not.toHaveBeenCalled();
  });
});

// --- POO-1575 rules v1: the buy-crypto hint names the methods the buyer can actually use ---------

describe("the buy-crypto hint's payment methods (POO-1575)", () => {
  /** The whole card's text: the hint is a sub-line, not a role, so this is what it is read from. */
  function breakdownText(): string {
    return screen.getByTestId("provisioning-cost-breakdown").textContent ?? "";
  }

  function renderWithMethods(buyMethodNames?: readonly string[]) {
    return renderWithProviders(
      <ProvisioningCostBreakdown
        plan={CROSS_CHAIN_PLAN}
        onRequote={() => {}}
        {...(buyMethodNames === undefined ? {} : { buyMethodNames })}
      />,
    );
  }

  it("[R1][R2] names the resolved methods instead of the shipped 'a card or Pix'", () => {
    renderWithMethods(["Credit Card", "Pix"]);

    expect(breakdownText()).toContain(
      "Pay with Credit Card or Pix and skip moving funds between networks.",
    );
  });

  it("[R1] a buyer whose currency offers no Pix is never told about Pix", () => {
    renderWithMethods(["SEPA transfer"]);

    expect(breakdownText()).toContain("Pay with SEPA transfer and skip moving funds");
    expect(breakdownText()).not.toMatch(/Pix/);
  });

  it("[R3] promises nothing specific when no method resolved", () => {
    // The live default: mock mode and the crypto-only cut never resolve a method list, so the host
    // passes nothing. The hint must keep the true half of its claim and drop the invented half.
    renderWithMethods();

    expect(breakdownText()).toContain("Skip moving funds between networks.");
    expect(breakdownText()).not.toMatch(/Pix|card/i);
  });
});
