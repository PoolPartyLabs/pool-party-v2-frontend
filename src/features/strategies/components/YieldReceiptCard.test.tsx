/**
 * @id PP-STR-CMP-006
 * @name YieldReceiptCard — tests
 * Behavior: renders the receipt anatomy (R3) with the gain / loss treatment (R6) and never shows
 * a percent or principal figure (R1). POO-906 [R1]: the DISPLAYED link is shortened (long path
 * segments middle-truncated, host + full `?ref=` kept) and renders on a single line, no wrap.
 */
import { describe, expect, it } from "vitest";
import { renderWithProviders, screen, within } from "../../../../tests/utils/renderWithProviders";
import { truncateDisplayLink, YieldReceiptCard } from "./YieldReceiptCard";

/** A real pool-scoped referral link (host + 42-char strategy address + ref code). */
const LONG_LINK =
  "v2.dev.pool-party.xyz/strategies/0x357d1E34aBcD9915ef33CAdd8888ffFF00001111?ref=Surfista";
const LONG_LINK_DISPLAY = "v2.dev.pool-party.xyz/strategies/0x357d...?ref=Surfista";

function renderCard(amountUsd: number, referralLink = "app.pool-party.xyz?ref=maria2026") {
  return renderWithProviders(
    <YieldReceiptCard
      strategyName="Stable Yield"
      riskLabel="Conservative"
      amountUsd={amountUsd}
      period="30d"
      referralLink={referralLink}
    />,
  );
}

describe("YieldReceiptCard", () => {
  // @rule R3 — required elements: brand, kicker, strategy + risk, amount, call, referral link
  it("renders the receipt anatomy", () => {
    renderCard(612.5);
    const card = screen.getByTestId("yield-receipt-card");
    expect(within(card).getByText("Pool Party")).toBeInTheDocument();
    expect(within(card).getByText("Yield Receipt")).toBeInTheDocument();
    expect(within(card).getAllByText("Stable Yield").length).toBeGreaterThanOrEqual(2);
    expect(within(card).getByText("Conservative")).toBeInTheDocument();
    expect(within(card).getByText("in fees & yield")).toBeInTheDocument();
    expect(within(card).getByText("Invest with me")).toBeInTheDocument();
    expect(within(card).getByText("app.pool-party.xyz?ref=maria2026")).toBeInTheDocument();
    expect(within(card).getByText("Last 30 days")).toBeInTheDocument();
  });

  // @rule R6 — gain green, loss red, same layout
  it("tones the amount by sign", () => {
    renderCard(612.5);
    expect(screen.getByText("+$612.50")).toHaveClass("text-success");
  });

  it("renders a negative amount with the loss treatment", () => {
    renderCard(-321.4);
    expect(screen.getByText("-$321.40")).toHaveClass("text-destructive");
  });

  // @rule R1 — no percent anywhere on the card
  it("never renders a percent sign", () => {
    renderCard(612.5);
    const card = screen.getByTestId("yield-receipt-card");
    expect(within(card).queryByText(/%/)).not.toBeInTheDocument();
  });

  // @rule POO-906 R1 — the DISPLAYED link is shortened and single-line (never the raw wrapping url)
  it("[R1] renders the shortened strategy referral link on a single line", () => {
    renderCard(612.5, LONG_LINK);
    const card = screen.getByTestId("yield-receipt-card");
    expect(within(card).queryByText(LONG_LINK)).not.toBeInTheDocument();
    const link = within(card).getByText(LONG_LINK_DISPLAY);
    expect(link).toHaveClass("whitespace-nowrap");
  });
});

describe("truncateDisplayLink", () => {
  // @rule POO-906 R1 — middle-truncate the path segment, keep the host and the full ?ref=
  it("[R1] shortens a long path segment while keeping the host and the full ?ref= visible", () => {
    expect(truncateDisplayLink(LONG_LINK)).toBe(LONG_LINK_DISPLAY);
  });

  it("[R1] leaves a host-only referral link untouched", () => {
    expect(truncateDisplayLink("app.pool-party.xyz?ref=maria2026")).toBe(
      "app.pool-party.xyz?ref=maria2026",
    );
  });

  it("[R1] keeps short path segments whole and strips the scheme from an absolute url", () => {
    expect(truncateDisplayLink("https://app.pool-party.xyz/strategies/abc?ref=x")).toBe(
      "app.pool-party.xyz/strategies/abc?ref=x",
    );
  });

  it("[R1] returns an unparseable link verbatim rather than throwing", () => {
    expect(truncateDisplayLink("::::")).toBe("::::");
  });
});
