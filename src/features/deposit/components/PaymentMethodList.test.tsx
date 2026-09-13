/**
 * @id PP-DEP-CMP-005 — tests
 * @name PaymentMethodList — tests
 * @implements-rules-version v2 (POO-1643 rules v1) · v1 (POO-1609 rules v1)
 *
 * POO-1643 adds the logo block at the bottom: the row now renders the vendor's own mark, through our
 * own origin, and the assertion that used to say "render no remote image at all" is inverted rather
 * than deleted, because the property it protected (no request reaches Paybis from the buyer's
 * browser) is unchanged and is now met by proxying instead of by omission.
 *
 * POO-1609 (murilo, 2026-08-14, second and standing reversal): the charge is never raised. A method
 * whose minimum exceeds the order renders BLOCKED: shown, in position, unselectable, `method.blocked`
 * replacing `method.minimum`, `aria-disabled="true"` rather than `disabled` (still focusable/tabbable
 * — a method the buyer cannot reach and cannot hear announced is worse than one they can hear is
 * unavailable and why). Activating it still calls `onSelect`: the list owns no state and fires no
 * analytics itself (POO-1612), so the parent decides whether an activation is a real selection or a
 * blocked-intent event.
 */
import { describe, expect, it, vi } from "vitest";
import type { OnRampPaymentMethod } from "@/lib/onramp/schemas";
import {
  fireEvent,
  renderWithProviders,
  screen,
} from "../../../../tests/utils/renderWithProviders";
import { PaymentMethodList } from "./PaymentMethodList";

const CARD: OnRampPaymentMethod = {
  paymentMethod: "poolparty-credit-card",
  displayName: "Credit Card",
  minUsd: 10,
  minCurrencyCode: "USD",
};
const BANK: OnRampPaymentMethod = {
  paymentMethod: "poolparty-bank",
  displayName: "Bank transfer",
  minUsd: 500,
  minCurrencyCode: "USD",
};

describe("PaymentMethodList — blocked row (POO-1609)", () => {
  it("tier 1: blocks a row whose OWN quoted charge is below its OWN floor", () => {
    renderWithProviders(
      <PaymentMethodList
        methods={[CARD, BANK]}
        onSelect={vi.fn()}
        charges={{ [BANK.paymentMethod]: { amount: 104, currencyCode: "USD" } }}
        enteredAmount={100}
      />,
    );
    expect(screen.getByText("Paybis needs at least $500.00.")).toBeInTheDocument();
    expect(screen.queryByText("Minimum $500.00")).toBeNull();
    const radio = screen.getByRole("radio", { name: /Bank transfer/ });
    expect(radio).toHaveAttribute("aria-disabled", "true");
    expect(radio).not.toBeDisabled();
  });

  // Figma frame 2: the gas-first buyer, no charges anywhere. Blocking still applies via tier 2.
  it("tier 2: blocks on the ENTERED amount when the row was never quoted (gas-first)", () => {
    renderWithProviders(
      <PaymentMethodList methods={[CARD, BANK]} onSelect={vi.fn()} enteredAmount={100} />,
    );
    expect(screen.getByText("Paybis needs at least $500.00.")).toBeInTheDocument();
    expect(screen.queryByText(/You pay/)).toBeNull();
  });

  it("does not block a row the order can reach", () => {
    renderWithProviders(
      <PaymentMethodList methods={[CARD, BANK]} onSelect={vi.fn()} enteredAmount={600} />,
    );
    expect(screen.queryByText(/needs at least/)).toBeNull();
    expect(screen.getByText("Minimum $500.00")).toBeInTheDocument();
  });

  /**
   * D3: never hidden and never reordered. A blocked row is still an option the vendor serves, just
   * not at this size, so dropping it (or sorting it to the bottom) hides the fact that the method
   * exists and what it would take to reach it. Asserted on the rendered ORDER rather than on
   * presence alone, because a "tidy" reorder passes a presence-only check.
   */
  it("renders in its own position, neither hidden nor sorted to the bottom", () => {
    renderWithProviders(
      // BANK is blocked at this order, and it is deliberately FIRST in the provider's own list.
      <PaymentMethodList methods={[BANK, CARD]} onSelect={vi.fn()} enteredAmount={100} />,
    );
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(2);
    expect(radios[0]).toHaveAccessibleName(/Bank transfer/);
    expect(radios[1]).toHaveAccessibleName(/Credit Card/);
  });

  it("cannot become the selection, even if `value` names it", () => {
    renderWithProviders(
      <PaymentMethodList
        methods={[CARD, BANK]}
        value={BANK.paymentMethod}
        onSelect={vi.fn()}
        enteredAmount={100}
      />,
    );
    expect(screen.getByRole("radio", { name: /Bank transfer/ })).not.toBeChecked();
  });

  // POO-1612: the list owns no state and fires no analytics. Activating a blocked row still calls
  // the ONE onSelect handler, so the HOST decides whether this was a pick or a blocked intent.
  it("still calls onSelect when a blocked row is activated, so the host can report the refusal", () => {
    const onSelect = vi.fn();
    renderWithProviders(
      <PaymentMethodList methods={[CARD, BANK]} onSelect={onSelect} enteredAmount={100} />,
    );
    fireEvent.click(screen.getByRole("radio", { name: /Bank transfer/ }));
    expect(onSelect).toHaveBeenCalledWith("poolparty-bank");
  });

  it("stays in the tab order (no `disabled` attribute) so it can be reached and announced", () => {
    renderWithProviders(
      <PaymentMethodList methods={[CARD, BANK]} onSelect={vi.fn()} enteredAmount={100} />,
    );
    const radio = screen.getByRole("radio", { name: /Bank transfer/ }) as HTMLInputElement;
    expect(radio.disabled).toBe(false);
  });

  it("keeps a normal, selectable row unaffected", () => {
    const onSelect = vi.fn();
    renderWithProviders(
      <PaymentMethodList
        methods={[CARD, BANK]}
        value={CARD.paymentMethod}
        onSelect={onSelect}
        enteredAmount={600}
      />,
    );
    const cardRadio = screen.getByRole("radio", { name: /Credit Card/ });
    expect(cardRadio).toBeChecked();
    expect(cardRadio).not.toHaveAttribute("aria-disabled");
    // Click the OTHER row: an already-checked radio fires no native change event on re-click.
    fireEvent.click(screen.getByRole("radio", { name: /Bank transfer/ }));
    expect(onSelect).toHaveBeenCalledWith("poolparty-bank");
  });
});

/**
 * POO-1603 [R3] / POO-1622 [R6] (rules v2): the vendor's own labels, printed as they come.
 *
 * `labels` has reached `OnRampPaymentMethod` since POO-1603 and nothing has ever rendered it. This
 * chip is cherry-picked from the closed #893, the only implementation of the field that exists.
 *
 * Settled by the live sandbox capture (14/08), not by the frame: Paybis' whole vocabulary is
 * `instant`, `low-fee` and `high-approval-rate`, all three POSITIVE, and a slow rail simply OMITS
 * `instant` rather than declaring itself slow. So there is nothing here to protect a buyer from, no
 * honest way to print "1-2 business days" out of this payload, and nothing of ours to translate.
 *
 * D1 makes this chip the ONLY thing in the slot: our own "Best price" superlative was deleted from
 * beside the charge, and what the vendor says about its own method took its place.
 */
describe("PaymentMethodList — the vendor's own labels (POO-1603 [R3])", () => {
  /** One method carrying all three: the normal case, not an edge case. */
  const REVOLUT: OnRampPaymentMethod = {
    paymentMethod: "poolparty_bridgerpay_revolutpay",
    displayName: "Revolut Pay",
    minUsd: 10,
    minCurrencyCode: "USD",
    labels: ["high-approval-rate", "instant", "low-fee"],
  };

  it("prints EVERY label on a row, not just the first", () => {
    renderWithProviders(
      <PaymentMethodList methods={[REVOLUT]} onSelect={vi.fn()} enteredAmount={600} />,
    );
    const row = screen.getByRole("radio", { name: /Revolut Pay/ }).closest("label");
    for (const label of ["high-approval-rate", "instant", "low-fee"]) {
      expect(row?.textContent).toContain(label);
    }
  });

  /**
   * Verbatim, with NO branch on the value. POO-1603 made that a contract ("a consumer may RENDER a
   * label and may not BRANCH on one") because the value set is undocumented, so a chip keyed on
   * `"instant"` silently drops whatever Paybis adds next.
   */
  it("renders a label it has never seen, exactly as the vendor wrote it", () => {
    renderWithProviders(
      <PaymentMethodList
        methods={[{ ...CARD, labels: ["brand-new-vendor-tag"] }]}
        onSelect={vi.fn()}
        enteredAmount={600}
      />,
    );
    expect(screen.getByText("brand-new-vendor-tag")).toBeInTheDocument();
  });

  /** A slow rail says nothing about speed, because the VENDOR says nothing about it. */
  it("invents no slowness for a rail that simply omits instant", () => {
    renderWithProviders(
      <PaymentMethodList
        methods={[{ ...BANK, labels: ["low-fee"] }]}
        onSelect={vi.fn()}
        enteredAmount={600}
      />,
    );
    const row = screen.getByRole("radio", { name: /Bank transfer/ }).closest("label");
    expect(row?.textContent).toContain("low-fee");
    expect(row?.textContent).not.toMatch(/business day/i);
    expect(row?.textContent).not.toMatch(/slow|delay/i);
  });

  it("shows no chip at all for a method the vendor sent no labels for", () => {
    renderWithProviders(
      <PaymentMethodList
        methods={[{ ...CARD, labels: undefined }]}
        onSelect={vi.fn()}
        enteredAmount={600}
      />,
    );
    expect(screen.getByRole("radio", { name: /Credit Card/ }).closest("label")?.textContent).toBe(
      "Credit CardMinimum $10.00",
    );
  });

  /** A blocked row is still a row: its labels are the vendor's and the block is ours. */
  it("keeps the vendor's labels on a blocked row", () => {
    renderWithProviders(
      <PaymentMethodList
        methods={[{ ...BANK, labels: ["low-fee"] }]}
        onSelect={vi.fn()}
        enteredAmount={100}
      />,
    );
    const row = screen.getByRole("radio", { name: /Bank transfer/ }).closest("label");
    expect(row?.textContent).toContain("low-fee");
    expect(row?.textContent).toContain("Paybis needs at least $500.00.");
  });

  /**
   * X11 (epic POO-1129), now RESOLVED by POO-1643 rather than avoided.
   *
   * The rule this used to assert was "render no remote image at all", because pointing an `<img>` at
   * `cdn.paybis.com` would disclose, from the buyer's own IP, that they opened a payment picker at a
   * venue they have not chosen. The logo now renders, and the disclosure still does not happen,
   * because every `src` is a RELATIVE path to our own proxy ({@link PP-CORE-SEC-003}).
   */
  it("points the vendor's logo at our own origin, never at the vendor", () => {
    const { container } = renderWithProviders(
      <PaymentMethodList
        methods={[{ ...REVOLUT, icon: "https://cdn.paybis.com/revolut.svg" }]}
        onSelect={vi.fn()}
        enteredAmount={600}
      />,
    );
    const image = container.querySelector("img");
    expect(image?.getAttribute("src")).toMatch(/^\/api\/onramp\/method-icon\?/);
    // The load-bearing half: a relative URL cannot reach another origin, so no request can arrive at
    // Paybis because this list rendered. Asserted on every image, not just the one above.
    expect(container.querySelector('img[src^="http"]')).toBeNull();
    expect(container.querySelector('img[src^="//"]')).toBeNull();
  });
});

/**
 * POO-1643 [R1]/[R6]/[R7]: the method's own logo, fetched by our server and served from our origin.
 *
 * The four ways a row ends up with no logo are one state to the buyer and four to the code: the
 * vendor sent none, the schema decoded a value it could not vouch for to absence, the proxy refused
 * it, and the image failed in the browser. All four draw the same neutral tile, and none of them
 * draws a broken image.
 */
describe("PaymentMethodList — the vendor's logo, proxied (POO-1643)", () => {
  const WITH_ICON: OnRampPaymentMethod = {
    ...CARD,
    icon: "https://cdn.paybis.com/methods/card.svg",
  };

  // @rule R1
  it("carries the vendor URL through the proxy parameter, so the route can re-validate it", () => {
    const { container } = renderWithProviders(
      <PaymentMethodList methods={[WITH_ICON]} onSelect={vi.fn()} enteredAmount={600} />,
    );
    const src = container.querySelector("img")?.getAttribute("src") ?? "";
    expect(new URL(src, "https://app.pool-party.xyz").searchParams.get("src")).toBe(WITH_ICON.icon);
  });

  // @rule R6 — the vendor sent no icon. `icon` is optional BY CONTRACT (POO-1603 [R4]), so this is
  // the normal case and not a degraded one.
  it("draws the neutral tile and no image when the vendor sent no icon", () => {
    const { container } = renderWithProviders(
      <PaymentMethodList methods={[CARD]} onSelect={vi.fn()} enteredAmount={600} />,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector('[data-testid="payment-method-icon-fallback"]')).not.toBeNull();
  });

  /**
   * @rule R6
   *
   * A consumer may not assume the schema already filtered the value. `PaymentMethodList` takes
   * `OnRampPaymentMethod` as a prop and a caller can construct one by hand, so the refusal is
   * re-derived here rather than inherited.
   */
  it.each([
    ["another origin", "https://evil.tld/x.svg"],
    ["a javascript URL", "javascript:alert(1)"],
    ["a data URL", "data:image/svg+xml,<svg onload=alert(1)/>"],
    ["a blank string", ""],
  ])("falls back to the neutral tile for %s", (_case, icon) => {
    const { container } = renderWithProviders(
      <PaymentMethodList methods={[{ ...CARD, icon }]} onSelect={vi.fn()} enteredAmount={600} />,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector('[data-testid="payment-method-icon-fallback"]')).not.toBeNull();
  });

  /**
   * @rule R6
   *
   * The runtime half, which no amount of validation can cover: the URL was fine and the fetch
   * failed anyway (the CDN 404s, the proxy answers 502, the network drops). The `ManagerAvatar`
   * precedent (PP-MGR-CMP-033, POO-771 R8): recover on `onError`, never leave a broken image.
   */
  it("swaps a broken image for the neutral tile at runtime", () => {
    const { container } = renderWithProviders(
      <PaymentMethodList methods={[WITH_ICON]} onSelect={vi.fn()} enteredAmount={600} />,
    );
    const image = container.querySelector("img");
    expect(image).not.toBeNull();
    if (image) fireEvent.error(image);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector('[data-testid="payment-method-icon-fallback"]')).not.toBeNull();
  });

  /**
   * @rule R7
   *
   * One tile for every method. POO-1603 [R4] exists precisely so the picker stops "inventing a glyph
   * family", so a fallback that branches on the identifier, the display name or a label would
   * reintroduce the thing the real logo replaced.
   */
  it("draws the identical tile for every method, branching on nothing", () => {
    const { container } = renderWithProviders(
      <PaymentMethodList
        methods={[CARD, { ...BANK, labels: ["instant"] }]}
        onSelect={vi.fn()}
        enteredAmount={600}
      />,
    );
    const tiles = [...container.querySelectorAll('[data-testid="payment-method-icon-fallback"]')];
    expect(tiles).toHaveLength(2);
    expect(tiles[0]?.outerHTML).toBe(tiles[1]?.outerHTML);
  });

  /**
   * @rule R7
   *
   * The logo is decorative: the method name sits beside it on the same row and carries the meaning.
   * Matches `TokenLogo` / `ManagerAvatar`, and it is what keeps a screen reader from announcing the
   * same method twice.
   */
  it("keeps the logo decorative, so the row is announced once", () => {
    const withIcon = renderWithProviders(
      <PaymentMethodList methods={[WITH_ICON]} onSelect={vi.fn()} enteredAmount={600} />,
    );
    const image = withIcon.container.querySelector("img");
    expect(image).toHaveAttribute("alt", "");
    expect(image).toHaveAttribute("aria-hidden", "true");
    // Asserted as a DIFFERENCE against the same row without a logo, which is the only honest way to
    // prove the image contributes nothing: the row's own name legitimately carries its minimum too,
    // and the radio's accessible name is computed from the whole enclosing label.
    const announced = screen
      .getByRole("radio", { name: /Credit Card/ })
      .closest("label")?.textContent;
    withIcon.unmount();

    renderWithProviders(
      <PaymentMethodList methods={[CARD]} onSelect={vi.fn()} enteredAmount={600} />,
    );
    expect(screen.getByRole("radio", { name: /Credit Card/ }).closest("label")?.textContent).toBe(
      announced,
    );
    expect(announced).toBe("Credit CardMinimum $10.00");
  });

  // @rule R6 — a blocked row is still a row: the logo is the vendor's and the block is ours.
  it("keeps the logo on a blocked row", () => {
    const { container } = renderWithProviders(
      <PaymentMethodList
        methods={[{ ...BANK, icon: "https://cdn.paybis.com/methods/bank.svg" }]}
        onSelect={vi.fn()}
        enteredAmount={100}
      />,
    );
    expect(container.querySelector("img")?.getAttribute("src")).toMatch(
      /^\/api\/onramp\/method-icon\?/,
    );
    expect(screen.getByText("Paybis needs at least $500.00.")).toBeInTheDocument();
  });
});

/**
 * POO-1630: the buyer can now change the fiat currency on `/deposit`, and the method set is a
 * function of that currency, so every pick re-fetches the list. During that round trip the list is
 * empty AND in flight, and of those two facts only "in flight" is true about the PROVIDER.
 */
describe("PaymentMethodList — a reload is not an outage (POO-1630)", () => {
  it("says the list is coming, instead of accusing the provider of returning nothing", () => {
    renderWithProviders(<PaymentMethodList loading enteredAmount={250} onSelect={vi.fn()} />);

    expect(screen.queryByText(/did not return any payment options/i)).not.toBeInTheDocument();
    // `aria-busy` says to a screen reader what the shimmer says to an eye.
    expect(document.querySelector('[aria-busy="true"]')).toBeInTheDocument();
    expect(screen.getByText(/Loading the payment methods/i)).toBeInTheDocument();
  });

  it("still says the provider returned nothing when nothing is in flight", () => {
    renderWithProviders(<PaymentMethodList enteredAmount={250} onSelect={vi.fn()} />);

    // The empty state is not deleted, only narrowed: with no request outstanding, an empty list IS
    // the provider's answer and saying so is correct.
    expect(screen.getByText(/did not return any payment options/i)).toBeInTheDocument();
  });

  it("prefers real rows over the skeleton the moment they land", () => {
    renderWithProviders(
      <PaymentMethodList
        loading
        methods={[
          {
            paymentMethod: "poolparty-credit-card",
            displayName: "Credit Card",
            minUsd: 10,
            minCurrencyCode: "USD",
          },
        ]}
        enteredAmount={250}
        onSelect={vi.fn()}
      />,
    );

    // A stale `loading` must never hide a list we already have: the skeleton is for the window with
    // NO rows, not for every reload.
    expect(screen.getByRole("radio", { name: /Credit Card/ })).toBeInTheDocument();
  });
});
