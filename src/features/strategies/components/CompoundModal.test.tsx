/**
 * @id PP-STR-MOD-006
 * @name CompoundModal — tests
 * Behavior: shows the available yield reinvested into the position, then runs
 * confirm → pending → success. Uses fireEvent for the dialog flow (see InvestModal.test).
 *
 * POO-499 R5a MIGRATION: Compound moved from a setTimeout + settleOutcome timer mock to a single-step
 * mock useWalletSignFlow (like CollectModal). These tests are rewritten from the fake-timer
 * (advanceTimersByTime) pattern to the runner's real-timer findBy pattern, asserting the SAME
 * observable behavior (same phases + outcomes + 1.2s beat) — the preservation guarantee. They also
 * cover the new slippage auto-retry orchestration.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Position, Strategy } from "@/lib/schemas";
import { revalidateStrategiesAction } from "@/lib/strategies/revalidateStrategies";
import {
  fireEvent,
  renderWithProviders,
  screen,
} from "../../../../tests/utils/renderWithProviders";
import { CompoundModal } from "./CompoundModal";
import { settleOutcome, settleTxError } from "./settle";

vi.mock("./settle", () => {
  const settleOutcome = vi.fn(() => "success");
  return {
    settleOutcome,
    // POO-499 R6: the mock confirm reads slippage through this. Delegates to settleOutcome for
    // slippage > 0.1% (so `settleOutcome.mockReturnValueOnce("error")` still forces a failure) and
    // forces "error" at/below 0.1% (the deterministic slippage-failure demo trigger).
    settleOutcomeForSlippage: vi.fn((slippagePct: number) =>
      slippagePct <= 0.1 ? "error" : settleOutcome(),
    ),
    settleTxError: vi.fn(() => ({ code: "-32603", message: "execution reverted: mock" })),
    settleTxHash: vi.fn(() => "0xMOCK00000000000000000000000000000000MOCK"),
  };
});

// The success path invalidates the catalog (revalidateTag throws "static generation store missing"
// in vitest) and refreshes the router; mock both so the success view renders in tests.
vi.mock("@/lib/strategies/revalidateStrategies", () => ({
  revalidateStrategiesAction: vi.fn(async () => {}),
}));
vi.mock("@/lib/portfolio/revalidatePositions", () => ({
  revalidatePositionsAction: vi.fn(async () => {}),
}));

vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const strategy: Strategy = {
  id: "s1",
  name: "Stable Yield",
  manager: "Pool Party Labs",
  riskLevel: 2,
  minInvestment: 50,
  tvl: 1_000_000,
  investors: 100,
  estReturn: 8,
  rateType: "APY",
  status: "active",
  // POO-514 R2: the receipt explorer link derives from the strategy's network.
  network: "base",
};

const position: Position = {
  id: "p1",
  strategyId: "s1",
  invested: 1800,
  currentValue: 2050,
  totalYield: 250,
  available: 120,
  reinvestment: "auto-compound",
  status: "active",
};

describe("CompoundModal", () => {
  beforeEach(() => {
    window.dataLayer = [];
    // Reset the settle mocks to happy-path defaults so a forced outcome can't leak between tests.
    vi.mocked(settleOutcome).mockReturnValue("success");
    vi.mocked(settleTxError).mockReturnValue({
      code: "-32603",
      message: "execution reverted: mock",
    });
  });

  // PRESERVATION (POO-499 R5a): the migrated single-step runner keeps the SAME confirm → pending →
  // success behavior (same 1.2s beat, same receipt) as the old setTimeout timer mock.
  it("shows the available yield and compounds to success", async () => {
    renderWithProviders(
      <CompoundModal open onOpenChange={vi.fn()} strategy={strategy} position={position} />,
    );
    expect(screen.getByText("Available to compound")).toBeInTheDocument();
    // POO-385 R2: the hero is USDC-primary with the USD value discreet.
    expect(screen.getByText("≈ $250.00")).toBeInTheDocument();
    // POO-385 R3 (POO-384 parity): the CTA shows the backend-net `available` ($250.00), NOT the
    // fee-net figure — the informational DEX+protocol fees are not subtracted from the headline.
    fireEvent.click(screen.getByRole("button", { name: "Compound $250.00" }));
    expect(screen.getByText("Continue in your wallet")).toBeInTheDocument();
    expect(
      (await screen.findAllByText("Yield compounded", undefined, { timeout: 3000 })).length,
    ).toBeGreaterThanOrEqual(1);
    // The success body + receipt amount also stay on `available` ($250.00), not the fee-net figure.
    expect(screen.getByText("$250.00 was reinvested into Stable Yield.")).toBeInTheDocument();
    // @rule R8 — the standardized success receipt: Strategy + Date + Transaction (hash)
    expect(screen.getByText("Date")).toBeInTheDocument();
    expect(screen.getByText("Transaction")).toBeInTheDocument();
    expect(screen.getByText("0xMOCK…MOCK")).toBeInTheDocument();
  });

  // @rule POO-514 R1/R2 — the compound receipt (mock-only executor today; the real one is gated by
  // POO-511) shows the flow hash + the shared explorer link on the strategy's network.
  it("[POO-514 R2] success receipt links the explorer /tx/ URL on the strategy network", async () => {
    renderWithProviders(
      <CompoundModal open onOpenChange={vi.fn()} strategy={strategy} position={position} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Compound $250.00" }));
    expect(
      (await screen.findAllByText("Yield compounded", undefined, { timeout: 3000 })).length,
    ).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("0xMOCK…MOCK")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View on explorer" })).toHaveAttribute(
      "href",
      "https://basescan.org/tx/0xMOCK00000000000000000000000000000000MOCK",
    );
  });

  // PRESERVATION: success still calls onChanged + invalidates the catalog (unchanged from the timer mock).
  it("on success calls onChanged + invalidates the catalog so the detail refreshes", async () => {
    const onChanged = vi.fn();
    renderWithProviders(
      <CompoundModal
        open
        onOpenChange={vi.fn()}
        strategy={strategy}
        position={position}
        onChanged={onChanged}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Compound $250.00" }));
    await screen.findAllByText("Yield compounded", undefined, { timeout: 3000 });
    expect(onChanged).toHaveBeenCalled();
    expect(revalidateStrategiesAction).toHaveBeenCalled();
  });

  // PRESERVATION: a failed settle still shows the error view and Try again recovers to success.
  it("shows the error state and can retry on a failed settle", async () => {
    vi.mocked(settleOutcome).mockReturnValueOnce("error"); // default settleTxError = unknown kind
    renderWithProviders(
      <CompoundModal open onOpenChange={vi.fn()} strategy={strategy} position={position} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Compound $250.00" }));
    expect(
      (await screen.findAllByText("Something went wrong", undefined, { timeout: 3000 })).length,
    ).toBeGreaterThanOrEqual(1);
    // A non-slippage failure never auto-retries (no tx_slippage_retry event).
    expect(
      (window.dataLayer ?? []).filter(
        (e) => (e as { event?: string }).event === "tx_slippage_retry",
      ),
    ).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(
      (await screen.findAllByText("Yield compounded", undefined, { timeout: 3000 })).length,
    ).toBeGreaterThanOrEqual(1);
    // @rule R2 — the raw error message must NEVER reach analytics
    expect(JSON.stringify(window.dataLayer ?? [])).not.toContain("execution reverted");
  });

  // POO-499 R2: a slippage failure then the ONE automatic retry then success — no error view.
  it("[POO-499 R2] auto-retries once on a slippage failure and reaches success", async () => {
    vi.mocked(settleOutcome).mockReturnValueOnce("error");
    vi.mocked(settleTxError).mockReturnValue({
      code: "-32603",
      message: "execution reverted: slippage tolerance exceeded - minimum output amount not met",
    });
    renderWithProviders(
      <CompoundModal open onOpenChange={vi.fn()} strategy={strategy} position={position} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Compound $250.00" }));
    expect(
      await screen.findByText(/Retrying at the current price/i, undefined, { timeout: 3000 }),
    ).toBeInTheDocument();
    expect(
      (await screen.findAllByText("Yield compounded", undefined, { timeout: 3000 })).length,
    ).toBeGreaterThanOrEqual(1);
    const retries = (window.dataLayer ?? []).filter(
      (e) => (e as { event?: string }).event === "tx_slippage_retry",
    );
    expect(retries).toHaveLength(1);
    expect(retries[0]).toMatchObject({ flow: "compound", strategy_id: "s1" });
  });

  // POO-499 R3: two slippage failures show the slippage error view and open settings.
  it("[POO-499 R3] two slippage failures show the slippage error view and open settings", async () => {
    vi.mocked(settleOutcome).mockReturnValue("error");
    vi.mocked(settleTxError).mockReturnValue({
      code: "-32603",
      message: "execution reverted: slippage tolerance exceeded - minimum output amount not met",
    });
    renderWithProviders(
      <CompoundModal open onOpenChange={vi.fn()} strategy={strategy} position={position} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Compound $250.00" }));
    expect(
      (await screen.findAllByText("Price moved too much", undefined, { timeout: 4000 })).length,
    ).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/moved beyond your max slippage.*again/i)).toBeInTheDocument();
    expect(screen.getByText("Max slippage")).toBeInTheDocument();
  });

  // @rule R3 — consolidated Fee line is INFORMATIONAL (not subtracted from the headline); the
  // "compound at least" line applies ONLY the slippage haircut (POO-384 parity).
  it("(R3) keeps the Fee line informational and the 'at least' line on the slippage-only haircut", () => {
    renderWithProviders(
      <CompoundModal open onOpenChange={vi.fn()} strategy={strategy} position={position} />,
    );
    expect(screen.getByText("Est. fee")).toBeInTheDocument();
    // The info trigger's accessible name carries the DEX + Protocol + Network + Total breakdown
    // (pct-free label, POO-504 R3).
    const tip = screen.getByRole("button", { name: /Protocol fee/ });
    expect(tip).toHaveAccessibleName(/Estimated gas \(network fee\)/);
    expect(screen.getByText("You will compound at least")).toBeInTheDocument();
    // available = 250; default slippage = 2% (POO-463 R2) → at-least = 250 * 0.98 = 245 (fees NOT subtracted).
    expect(screen.getByText("245 USDC ($245.00)")).toBeInTheDocument();
  });

  // @rule R4 — the ⚙ gear opens Slippage + Deadline only (no Receive-as; compound stays in position).
  it("(R4) opens Slippage + Deadline from the gear, with no Receive-as", () => {
    renderWithProviders(
      <CompoundModal open onOpenChange={vi.fn()} strategy={strategy} position={position} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Transaction settings" }));
    expect(screen.getByText("Max slippage")).toBeInTheDocument();
    expect(screen.getByText("Transaction deadline")).toBeInTheDocument();
    expect(screen.queryByText("Receive as")).not.toBeInTheDocument();
  });
});
