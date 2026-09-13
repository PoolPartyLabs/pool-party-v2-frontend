/**
 * @id PP-DEP-SCR-001
 * @name Deposit flow — tests
 *
 * MOCK MODE, which since POO-1513 is also the "the provider returned no methods" configuration: the
 * live list and the quote are real, session-gated calls, so with `isMockMode` on there is no list, no
 * charge and no method label. That is deliberately not a blocker (POO-1576 Q3), and this suite is what
 * pins it. The live-list behaviour itself lives in `DepositScreen.methods.test.tsx`.
 *
 * Behavior: the fiat path runs amount → method dialog → review → success. The crypto path (POO-604):
 * the STANDALONE path is terminal at receive (address only, no manual confirm, no webhook); the manual
 * "I've sent the funds" confirm → waiting → success shows ONLY under the invest top-up context, where
 * it is the resume trigger. Uses fireEvent for the dialog/step flow.
 */
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  renderWithProviders,
  screen,
  waitFor,
  within,
} from "../../../tests/utils/renderWithProviders";
import { DepositScreen } from "./DepositScreen";

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

// The crypto-receive address is the connected wallet (useAuth); mock it. `auth.address` is mutable
// so a test can exercise the no-wallet empty state.
const auth = vi.hoisted(() => ({
  address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2" as `0x${string}` | undefined,
  isLoading: false,
}));
vi.mock("@/lib/auth/useAuth", () => ({
  useAuth: () => ({ address: auth.address, isLoading: auth.isLoading }),
}));

/** The connected (checksummed) address the screen shows on the crypto path. */
const ADDRESS = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";

beforeEach(() => {
  window.dataLayer = [];
  auth.address = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
  auth.isLoading = false;
});

describe("DepositScreen (fiat)", () => {
  // @rule POO-729 R2: every deposit is received-fixed — you receive exactly what you entered.
  // @rule POO-1513 S3: with no quote there is no charge to print, and the row says so instead of
  // showing the deleted local fee model's figure.
  it("runs amount → method → review → success", () => {
    renderWithProviders(<DepositScreen investContext={null} />);

    expect(screen.getByRole("heading", { name: "Deposit" })).toBeInTheDocument();

    // Amount → open the method dialog (only one "Continue" while the dialog is closed).
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Payment method")).toBeInTheDocument();

    // Method → Review.
    fireEvent.click(within(dialog).getByRole("button", { name: "Continue" }));
    expect(screen.getByText("You'll receive")).toBeInTheDocument();
    // Received-fixed (POO-729): you receive exactly what you entered.
    expect(screen.getByText("100 USDC")).toBeInTheDocument();
    // POO-1513 S3: no quote, so no charge. The old `$102.00` / `$2.00` pair came from the deleted
    // local fee model, which priced `bank: 0` and then let the buyer be charged a card at ~2.78%.
    expect(screen.getByText("Shown at checkout")).toBeInTheDocument();
    expect(screen.queryByText("Paybis fee")).toBeNull();

    // Confirm → Success.
    fireEvent.click(screen.getByRole("button", { name: "Confirm & pay" }));
    expect(screen.getByRole("heading", { name: "Deposit confirmed" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Invest now" })).toBeInTheDocument();

    expect(window.dataLayer).toContainEqual(expect.objectContaining({ event: "deposit_started" }));
    expect(window.dataLayer).toContainEqual(
      expect.objectContaining({ event: "deposit_submitted", value: 100 }),
    );
    expect(window.dataLayer).toContainEqual(
      expect.objectContaining({ event: "deposit_completed", value: 100 }),
    );
  });

  /**
   * @rule POO-1576 Q3 — an empty or unreadable list informs and does not block. It also never
   * fabricates a method: the funnel events carry no `deposit_method` rather than the `"pix"` the
   * deleted constant used to assert for every buyer on earth.
   */
  it("informs and still continues when the provider returned no methods", () => {
    renderWithProviders(<DepositScreen investContext={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/Paybis did not return/)).toBeInTheDocument();
    expect(within(dialog).queryByRole("radio")).toBeNull();

    fireEvent.click(within(dialog).getByRole("button", { name: "Continue" }));
    expect(screen.getByText("Choose how to pay")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Confirm & pay" }));
    expect(screen.getByRole("heading", { name: "Deposit confirmed" })).toBeInTheDocument();
    expect(JSON.stringify(window.dataLayer)).not.toContain("deposit_method");
  });

  /**
   * POO-1513: mock mode is this repo's visual harness (premise 2), and the picker was invisible in
   * it. The live list and the quote are gated on `!isMockMode && fiatOnRamp`, there is no mock for
   * `getOnRampPaymentMethodsAction`, and the modal has no story, so there was NO configuration in
   * which the designed rows could be seen at all.
   *
   * The fixture resolves after a simulated round trip rather than synchronously, which is what keeps
   * the informational state above reachable: "still resolving" and "unreadable" render the same
   * caption by design, and a synchronous fixture would have made the first of those impossible to
   * see and silently deleted the assertions that pin it.
   */
  it("renders the mocked list in mock mode, after the informational state", async () => {
    renderWithProviders(<DepositScreen investContext={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/Paybis did not return/)).toBeInTheDocument();

    // A card, a bank transfer and a local rail, so the rows, the default and the blocked-row
    // treatment (POO-1609) are all exercisable by hand.
    expect(await within(dialog).findByRole("radio", { name: /Credit Card/ })).toBeChecked();
    expect(within(dialog).getByRole("radio", { name: /SEPA Bank Transfer/ })).toBeInTheDocument();
    expect(within(dialog).getByRole("radio", { name: /iDEAL/ })).toBeInTheDocument();
    // SEPA's EUR 200 floor exceeds its own mocked EUR ~92.69 charge on the default $100 order, so it
    // renders BLOCKED rather than showing a minimum a buyer could pick their way past.
    //
    // AWAITED, and the await is the assertion's own subject rather than ceremony: this block is
    // TIER 1, so it needs the QUOTE, which lands on a later commit than the methods list the
    // `findBy` above settles on. Sampled synchronously it reads the tier-2 answer instead (SEPA's
    // floor is EUR and the entered amount is USDC, so with no charge yet the comparison is refused
    // and the row is legitimately NOT blocked) — a real state this screen passes through, not a
    // wrong one. Same failure class as POO-1610's flake in this file, but introduced here: this
    // assertion is new on this branch, so it is this lane's to settle, not that issue's.
    await within(dialog).findByText("Paybis needs at least €200.00.");
    expect(within(dialog).queryByText("Minimum €200.00")).toBeNull();
    // In the buyer's own resolved currency (POO-1512), never assumed dollars.
    expect(within(dialog).getByText("Minimum €20.00")).toBeInTheDocument();
  });

  /**
   * POO-1613: the resolved currency is named, and mock mode (the only configuration in which this
   * control can be seen by hand) offers the full browse-44 control. Picking a new one re-labels
   * the flow AND clears the selection (POO-1576 Q4 / R3: "one rule, now user-triggerable").
   */
  it("names the resolved currency and lets the buyer browse + pick another (mock mode)", async () => {
    renderWithProviders(<DepositScreen investContext={null} />);
    // Pick iDEAL, then dismiss the dialog (Escape): the currency control lives on the amount step
    // underneath, and a modal dialog hides the rest of the page from the accessibility tree while
    // it is open, so this is the real sequence a buyer would need too, not just this test.
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    const dialog = screen.getByRole("dialog");
    await within(dialog).findByRole("radio", { name: /Credit Card/ });
    fireEvent.click(within(dialog).getByRole("radio", { name: /iDEAL/ }));
    expect(within(dialog).getByRole("radio", { name: /iDEAL/ })).toBeChecked();
    fireEvent.keyDown(document.body, { key: "Escape", code: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    const trigger = screen.getByRole("button", { name: /EUR/ });
    expect(trigger).toHaveTextContent("Euro");
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("option", { name: /Brazilian Real/ }));
    expect(screen.getByRole("button", { name: /BRL/ })).toHaveTextContent("Brazilian Real");

    // The currency moved, so the prior pick (a EUR-only-in-spirit local rail) is retired exactly as
    // it already is when the real resolution changes (`resolvedCurrencyRef`, DepositScreen.tsx).
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    const reopened = screen.getByRole("dialog");
    await waitFor(() => {
      expect(within(reopened).getByRole("radio", { name: /Credit Card/ })).toBeChecked();
    });
    expect(within(reopened).getByRole("radio", { name: /iDEAL/ })).not.toBeChecked();
  });

  /**
   * ...and the two surfaces downstream of the list, which were equally blank: the review printed
   * "Shown at checkout" for everyone and the receipt omitted its Amount row entirely.
   */
  it("prices the review and the receipt from the mocked quote in mock mode", async () => {
    renderWithProviders(<DepositScreen investContext={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    const dialog = screen.getByRole("dialog");
    await within(dialog).findByRole("radio", { name: /Credit Card/ });
    // Settle the quote effect BEFORE leaving the dialog. `findBy*` runs with act disabled and drains
    // with exactly ONE setTimeout(0), so the list can be on screen while the CHARGE it triggers is
    // still a commit behind; the review then reads "Shown at checkout" and the assertion below flakes
    // under load. `act` is the settle that works here, `waitFor` is not (it re-samples the same
    // too-early value). Measured 2 failures in 4 full-suite runs before this.
    await act(async () => {});
    fireEvent.click(within(dialog).getByRole("button", { name: "Continue" }));

    expect(screen.getByText("Paying with Credit Card")).toBeInTheDocument();
    // AWAITED, not sampled: the charge rides a second round trip (the mock quote) behind the list,
    // so "the review prices from the quote" is a claim about the settled screen, not about the first
    // commit after the list lands. Asserting it synchronously flaked 2 runs in 4 under full-suite
    // load. The neighbouring `queryByText` still proves the placeholder is GONE once it has.
    expect(await screen.findByText("€94.56")).toBeInTheDocument();
    expect(screen.queryByText("Shown at checkout")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Confirm & pay/ }));
    expect(screen.getByRole("heading", { name: "Deposit confirmed" })).toBeInTheDocument();
    expect(screen.getByText("Amount")).toBeInTheDocument();
    expect(screen.getByText("€94.56")).toBeInTheDocument();
  });

  // @rule POO-1614: the Review's charge panel prints the vendor's charge and nothing else. The
  // deleted row was a hardcoded "1 USDC ≈ $1.00", the same class of defect as the deleted
  // PROCESSING_RATES fee model above: a static literal on a screen that otherwise formats
  // everything in the buyer's own currency. Counting the panel's children (not just asserting the
  // old row's text is gone) is what stops a *different* phantom row from coming back unnoticed.
  it("renders exactly one row in the review's charge panel (POO-1614)", async () => {
    renderWithProviders(<DepositScreen investContext={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    const dialog = screen.getByRole("dialog");
    await within(dialog).findByRole("radio", { name: /Credit Card/ });
    // Settle the quote effect BEFORE leaving the dialog. `findBy*` runs with act disabled and drains
    // with exactly ONE setTimeout(0), so the list can be on screen while the CHARGE it triggers is
    // still a commit behind; the review then reads "Shown at checkout" and the assertion below flakes
    // under load. `act` is the settle that works here, `waitFor` is not (it re-samples the same
    // too-early value). Measured 2 failures in 4 full-suite runs before this.
    await act(async () => {});
    fireEvent.click(within(dialog).getByRole("button", { name: "Continue" }));

    const chargePanel = screen.getByText("You pay").closest("div")?.parentElement;
    expect(chargePanel?.children).toHaveLength(1);
    expect(screen.queryByText("Exchange rate")).toBeNull();
  });

  // @rule POO-1617: the receipt links the BUYER'S OWN wallet address on the explorer, not a
  // transaction. POO-1129 reconciles the on-ramp from the observed balance delta, never from a
  // submitted transaction, so there is structurally no hash to link. The copy says "wallet" rather
  // than promising a transaction the link cannot open.
  it("links the receipt to the wallet's own address on the explorer, not a transaction (POO-1617)", () => {
    renderWithProviders(<DepositScreen investContext={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: /Confirm & pay/ }));

    const link = screen.getByRole("link", { name: "View wallet on explorer" });
    expect(link).toHaveAttribute("href", `https://basescan.org/address/${ADDRESS}`);
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("enforces the $10 minimum deposit", () => {
    renderWithProviders(<DepositScreen investContext={null} />);
    const input = screen.getByLabelText("You're adding");
    fireEvent.change(input, { target: { value: "5" } });
    expect(screen.getByText("Minimum deposit is $10.00")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
  });

  // @rule POO-727 R1/R2: above the $200,000 cap the amount is blocked with a max hint.
  it("enforces the $200,000 maximum deposit", () => {
    renderWithProviders(<DepositScreen investContext={null} />);
    const input = screen.getByLabelText("You're adding");
    fireEvent.change(input, { target: { value: "200001" } });
    expect(screen.getByText("Maximum deposit is $200,000.00")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
  });

  // @rule POO-727 R1: the bounds are INCLUSIVE — exactly $10 and exactly $200,000 are allowed.
  it("allows the exact $10 and $200,000 boundaries", () => {
    renderWithProviders(<DepositScreen investContext={null} />);
    const input = screen.getByLabelText("You're adding");
    fireEvent.change(input, { target: { value: "10" } });
    expect(screen.getByRole("button", { name: "Continue" })).not.toBeDisabled();
    fireEvent.change(input, { target: { value: "200000" } });
    expect(screen.getByRole("button", { name: "Continue" })).not.toBeDisabled();
  });

  /**
   * @rule POO-729 R2 (POO-1513 review, F6): Success mirrors Review, INCLUDING what it does not know.
   *
   * The receipt's "Amount" is what the buyer was charged, and with no quote this screen has no such
   * figure: it printed `formatUsd(amount)`, which is the USDC they RECEIVE, under a label that
   * claims it is what they paid. It is the deleted fee model's mistake one screen later, and the row
   * below already says the received figure honestly. Same posture as the method row beside it: a
   * claim we cannot substantiate is omitted, never guessed. A real settlement or a real quote charge
   * still prints (`DepositScreen.realOnRamp.test.tsx`).
   */
  it("mirrors the received-fixed amounts on the success screen, and claims no charge it has not got", () => {
    renderWithProviders(<DepositScreen investContext={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm & pay" }));
    expect(screen.getByRole("heading", { name: "Deposit confirmed" })).toBeInTheDocument();
    expect(screen.getByText("100 USDC")).toBeInTheDocument(); // Received
    expect(screen.queryByText("Amount")).toBeNull();
    expect(screen.queryByText("$100.00")).toBeNull();
  });
});

describe("DepositScreen (crypto)", () => {
  /** Enter the crypto path and confirm the (pre-selected or picked) network. */
  function openCryptoAndPick(name: string) {
    fireEvent.click(screen.getAllByRole("button", { name: "Deposit crypto" })[0] as HTMLElement);
    fireEvent.click(screen.getByRole("radio", { name }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  }

  // @rule POO-728 R1: the picker opens with Arbitrum pre-selected and Continue enabled (no forced choice).
  it("[POO-728] defaults the network to Arbitrum so Continue is enabled, then warns for it", () => {
    renderWithProviders(<DepositScreen investContext={null} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Deposit crypto" })[0] as HTMLElement);

    // Arbitrum is pre-selected and Continue is enabled on open.
    expect(screen.getByRole("radio", { name: "Arbitrum" })).toBeChecked();
    const continueBtn = screen.getByRole("button", { name: "Continue" });
    expect(continueBtn).not.toBeDisabled();
    fireEvent.click(continueBtn);

    // The address shows immediately with the Arbitrum loss-of-funds warning.
    expect(screen.getByText(ADDRESS)).toBeInTheDocument();
    expect(
      screen.getByText(
        "Send USDC on Arbitrum only. Sending on another network may result in permanent loss.",
      ),
    ).toBeInTheDocument();
  });

  // @rule POO-728 R2: the user can still switch the network; the warning names the chosen one.
  it("[POO-728] still lets the user switch the network, updating the warning", () => {
    renderWithProviders(<DepositScreen investContext={null} />);
    openCryptoAndPick("Base");
    expect(
      screen.getByText(
        "Send USDC on Base only. Sending on another network may result in permanent loss.",
      ),
    ).toBeInTheDocument();
  });

  // @rule POO-604: no on-chain watcher / webhook — the standalone crypto path is TERMINAL at receive.
  it("standalone crypto path is terminal: address only, no manual confirm (POO-604)", () => {
    renderWithProviders(<DepositScreen investContext={null} />);
    openCryptoAndPick("Ethereum");
    expect(screen.getByText("Scan to deposit")).toBeInTheDocument();
    expect(screen.getByText(ADDRESS)).toBeInTheDocument();

    // No webhook/auto-detect → no "I've sent the funds" confirm and no waiting/success on the
    // standalone path; the deposit reflects in the wallet balance on the next refetch.
    expect(screen.queryByRole("button", { name: "I've sent the funds" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Check back in a few minutes" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Deposit received" })).toBeNull();

    // Entering the path still fires the analytics start; there is no completion event.
    expect(window.dataLayer).toContainEqual(
      expect.objectContaining({ event: "deposit_crypto_started" }),
    );
    expect(window.dataLayer).not.toContainEqual(
      expect.objectContaining({ event: "deposit_crypto_completed" }),
    );
  });

  it("shows the connect-wallet empty state when no wallet is connected", () => {
    auth.address = undefined;
    renderWithProviders(<DepositScreen investContext={null} />);
    openCryptoAndPick("Base");
    expect(
      screen.getByText("Connect your wallet to see your deposit address."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Scan to deposit")).toBeNull();
  });

  it("shows a loading state (not the empty state) while the wallet is connecting", () => {
    auth.address = undefined;
    auth.isLoading = true;
    renderWithProviders(<DepositScreen investContext={null} />);
    openCryptoAndPick("Base");
    // Connecting wallet: neither the address UI nor the no-wallet copy — just the spinner.
    expect(screen.queryByText("Connect your wallet to see your deposit address.")).toBeNull();
    expect(screen.queryByText("Scan to deposit")).toBeNull();
  });
});

describe("DepositScreen (invest top-up)", () => {
  it("shows the context banner and prefills the shortfall", () => {
    renderWithProviders(
      <DepositScreen
        investContext={{ strategyId: "s1", strategyName: "Stable Yield", shortfall: 150 }}
      />,
    );
    expect(screen.getByText("Investing in Stable Yield · add $150.00")).toBeInTheDocument();
  });

  // @rule POO-1374: the confirm gate compares at CENT precision, the precision the screen shows.
  //
  // `shortfall` can carry SUB-CENT precision (it is `Number.parseFloat` of a URL param). The field is
  // prefilled with `toText(shortfall)`, which ROUNDS to 2dp, so 55.2049 becomes 55.2. The raw
  // comparison then read `55.2 < 55.2049` and disabled the button, while BOTH figures rendered as
  // $55.20: the copy told the user they needed exactly what they already had.
  it("keeps confirm enabled when the amount matches the shortfall to the cent", () => {
    renderWithProviders(
      <DepositScreen
        investContext={{
          strategyId: "s1",
          strategyName: "Stable Yield",
          shortfall: 55.2049,
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Continue" }));

    const confirm = screen.getByRole("button", { name: /Confirm/ });
    expect(confirm).not.toBeDisabled();
  });

  // The gate must still BLOCK a genuine shortfall, so the fix cannot be "always allow".
  it("still blocks confirm when the amount is genuinely below the shortfall", () => {
    renderWithProviders(
      <DepositScreen
        investContext={{ strategyId: "s1", strategyName: "Stable Yield", shortfall: 150 }}
      />,
    );
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "149" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Continue" }));

    expect(screen.getByRole("button", { name: /Confirm/ })).toBeDisabled();
  });

  // Received is FIXED at the shortfall. What "You pay" costs is the provider's to state (POO-1513 S3),
  // so with no quote it is not stated at all rather than modelled.
  it("uses received-fixed math: receive = exact shortfall", () => {
    renderWithProviders(
      <DepositScreen
        investContext={{ strategyId: "s1", strategyName: "Stable Yield", shortfall: 150 }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Continue" }));
    expect(screen.getByText("You'll receive")).toBeInTheDocument();
    expect(screen.getByText("150 USDC")).toBeInTheDocument();
    expect(screen.getByText("Shown at checkout")).toBeInTheDocument();
    expect(screen.queryByText("$152.27")).toBeNull();
  });

  // @rule POO-494 R1: a strategy-name lookup miss never drops the context — generic banner, same math.
  it("keeps the context with generic copy when the strategy name is unknown", () => {
    renderWithProviders(
      <DepositScreen investContext={{ strategyId: "s1", strategyName: null, shortfall: 150 }} />,
    );
    expect(screen.getByText("Add $150.00 to fund this investment")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Continue" }));
    expect(screen.getByText("150 USDC")).toBeInTheDocument();
  });

  // @rule POO-494 R4: the review blocks confirm while the entered amount is below the shortfall.
  it("blocks confirm when the amount falls below the shortfall", () => {
    renderWithProviders(
      <DepositScreen
        investContext={{ strategyId: "s1", strategyName: "Stable Yield", shortfall: 150 }}
      />,
    );
    fireEvent.change(screen.getByLabelText("You're adding"), { target: { value: "100" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Continue" }));
    expect(
      screen.getByText("You need at least $150.00 to fund this investment."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm & pay" })).toBeDisabled();
  });

  // @rule POO-494 R5: the crypto path honors the top-up context (banner + shortfall-consistent mock).
  it("honors the top-up context on the crypto path", () => {
    vi.useFakeTimers();
    try {
      renderWithProviders(
        <DepositScreen
          investContext={{
            strategyId: "s1",
            strategyName: "Stable Yield",
            shortfall: 97.93,
            investAmount: 100,
          }}
        />,
      );
      fireEvent.click(screen.getAllByRole("button", { name: "Deposit crypto" })[0] as HTMLElement);
      expect(screen.getByText("Investing in Stable Yield · add $97.93")).toBeInTheDocument();
      // POO-728: Arbitrum is pre-selected, but the user can still switch to Base here.
      fireEvent.click(screen.getByRole("radio", { name: "Base" }));
      fireEvent.click(screen.getByRole("button", { name: "Continue" }));
      // POO-604: the manual confirm shows ONLY under the invest context — here it is the resume trigger.
      fireEvent.click(screen.getByRole("button", { name: "I've sent the funds" }));
      act(() => {
        vi.advanceTimersByTime(2600);
      });
      expect(screen.getByRole("heading", { name: "Deposit received" })).toBeInTheDocument();
      expect(window.dataLayer).toContainEqual(
        expect.objectContaining({ event: "deposit_crypto_completed", token_amount: 97.93 }),
      );
      expect(screen.getByRole("link", { name: "Invest now" })).toHaveAttribute(
        "href",
        "/strategies/s1?invest=100",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("deep-links Invest now back to Confirm with the committed amount (POO-281 R3)", () => {
    renderWithProviders(
      <DepositScreen
        investContext={{
          strategyId: "s1",
          strategyName: "Stable Yield",
          shortfall: 150,
          investAmount: 250,
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm & pay" }));
    // Success "Invest now" returns to the strategy with ?invest= so Invest reopens at Confirm & sign.
    expect(screen.getByRole("link", { name: "Invest now" })).toHaveAttribute(
      "href",
      "/strategies/s1?invest=250",
    );
  });

  /** Runs the fiat flow (default prefill) through to the success screen. */
  function completeFiatDeposit() {
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm & pay" }));
  }

  // @rule POO-520 R1: a manager-console top-up returns to the console manage view with the
  // add-liquidity (invest) modal re-armed there, amount preserved.
  it("returns a manager-origin top-up to the console manage view (POO-520 R1)", () => {
    renderWithProviders(
      <DepositScreen
        investContext={{
          strategyId: "s1",
          strategyName: "Stable Yield",
          shortfall: 150,
          investAmount: 250,
          origin: "manager",
        }}
      />,
    );
    completeFiatDeposit();
    expect(screen.getByRole("link", { name: "Invest now" })).toHaveAttribute(
      "href",
      "/manager?manage=s1&invest=250",
    );
  });

  // @rule POO-520 R1: without a committed amount the return still lands on the manage view (no
  // invest param, so nothing is armed), mirroring the investor fallback.
  it("returns a manager-origin top-up without an amount to the bare manage view (POO-520 R1)", () => {
    renderWithProviders(
      <DepositScreen
        investContext={{
          strategyId: "s1",
          strategyName: "Stable Yield",
          shortfall: 150,
          origin: "manager",
        }}
      />,
    );
    completeFiatDeposit();
    expect(screen.getByRole("link", { name: "Invest now" })).toHaveAttribute(
      "href",
      "/manager?manage=s1",
    );
  });

  // @rule POO-520 R2: an explicit investor origin keeps the current strategy-detail return.
  it("keeps the investor return target for an investor-origin context (POO-520 R2)", () => {
    renderWithProviders(
      <DepositScreen
        investContext={{
          strategyId: "s1",
          strategyName: "Stable Yield",
          shortfall: 150,
          investAmount: 250,
          origin: "investor",
        }}
      />,
    );
    completeFiatDeposit();
    expect(screen.getByRole("link", { name: "Invest now" })).toHaveAttribute(
      "href",
      "/strategies/s1?invest=250",
    );
  });
});
