/**
 * @id PP-DEP-SCR-001
 * @name Deposit flow — tests
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
  // @rule POO-729 R2: every deposit is received-fixed — you receive exactly what you entered
  // (100 USDC) and the Paybis fee is added on top of "You pay" ($102).
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
    // Received-fixed (POO-729): you receive exactly what you entered; the fee is added on top of You pay.
    expect(screen.getByText("100 USDC")).toBeInTheDocument();
    expect(screen.getByText("$102.00")).toBeInTheDocument(); // You pay = $100 received + the $2 service minimum
    expect(screen.getByText("$2.00")).toBeInTheDocument(); // Paybis fee revealed only at Review

    // Confirm → Success.
    fireEvent.click(screen.getByRole("button", { name: "Confirm & pay with Pix" }));
    expect(screen.getByRole("heading", { name: "Deposit confirmed" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Invest now" })).toBeInTheDocument();

    expect(window.dataLayer).toContainEqual(expect.objectContaining({ event: "deposit_started" }));
    expect(window.dataLayer).toContainEqual(
      expect.objectContaining({ event: "deposit_submitted", deposit_method: "pix", value: 102 }),
    );
    expect(window.dataLayer).toContainEqual(
      expect.objectContaining({ event: "deposit_completed", deposit_method: "pix", value: 102 }),
    );
  });

  it("tracks deposit_method_selected when a method is chosen", () => {
    renderWithProviders(<DepositScreen investContext={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("radio", { name: /card/i }));
    expect(window.dataLayer).toContainEqual(
      expect.objectContaining({ event: "deposit_method_selected", deposit_method: "card" }),
    );
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

  // @rule POO-729 R2: Success mirrors Review — same "You pay" ($102) and received (100 USDC).
  it("mirrors the received-fixed amounts on the success screen", () => {
    renderWithProviders(<DepositScreen investContext={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm & pay with Pix" }));
    expect(screen.getByRole("heading", { name: "Deposit confirmed" })).toBeInTheDocument();
    expect(screen.getByText("$102.00")).toBeInTheDocument(); // Amount = You pay
    expect(screen.getByText("100 USDC")).toBeInTheDocument(); // Received
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
    expect(screen.queryByRole("heading", { name: "Waiting for your deposit" })).toBeNull();
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

  it("uses received-fixed math: receive = exact shortfall, fee added on top of you pay", () => {
    renderWithProviders(
      <DepositScreen
        investContext={{ strategyId: "s1", strategyName: "Stable Yield", shortfall: 150 }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Continue" }));
    // Received is FIXED at the shortfall; the Paybis fee is added ON TOP of "You pay".
    expect(screen.getByText("You'll receive")).toBeInTheDocument();
    expect(screen.getByText("150 USDC")).toBeInTheDocument();
    expect(screen.getByText("$152.27")).toBeInTheDocument(); // ceil₂(150 / (1 − 1.49%)), POO-494 R3/R4
    expect(screen.getByText("$2.27")).toBeInTheDocument(); // fee charged on top
  });

  it("re-derives You pay per method while Received stays the shortfall", () => {
    renderWithProviders(
      <DepositScreen
        investContext={{ strategyId: "s1", strategyName: "Stable Yield", shortfall: 150 }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("radio", { name: /card/i }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Continue" }));
    // Card adds the 2.78% processing fee: Received is unchanged, You pay re-derives.
    expect(screen.getByText("150 USDC")).toBeInTheDocument();
    expect(screen.getByText("$156.70")).toBeInTheDocument(); // ceil₂(150 / (1 − 1.49% − 2.78%))
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
    expect(screen.getByText("$152.27")).toBeInTheDocument();
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
    expect(screen.getByRole("button", { name: "Confirm & pay with Pix" })).toBeDisabled();
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
    fireEvent.click(screen.getByRole("button", { name: "Confirm & pay with Pix" }));
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
    fireEvent.click(screen.getByRole("button", { name: "Confirm & pay with Pix" }));
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
