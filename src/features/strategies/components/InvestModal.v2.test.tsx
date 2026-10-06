/** @id PP-STR-MOD-001 @implements-rules-version v1 (POO-2248) */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  renderWithProviders,
  screen,
} from "../../../../tests/utils/renderWithProviders";
import { InvestModal } from "./InvestModal";

const mocks = vi.hoisted(() => ({
  prepare: vi.fn(),
  confirm: vi.fn(),
  reset: vi.fn(),
  reconcile: vi.fn(),
  refresh: vi.fn(),
  evaluate: vi.fn(() => true),
  track: vi.fn(),
  phase: "idle",
  approvalRequired: false,
  verified: true,
  done: null as (() => void) | null,
}));
vi.mock("@/features/funds/useFundInvest", () => ({
  useFundInvest: () => ({
    ...mocks,
    errorCode: null,
    preview: null,
    records: [],
    snapshot: mocks.verified
      ? {
          wallet: "0x1111111111111111111111111111111111111111",
          fund: { state: "Open", mandate: { minFirstDeposit: "10000000" } },
          holder: { shares: "0" },
        }
      : null,
  }),
}));
vi.mock("../hooks/useProvisioningGate", () => ({
  useProvisioningGate: () => ({
    input: {},
    context: null,
    status: "ready",
    locked: false,
    setLocked: vi.fn(),
    reset: vi.fn(),
    evaluate: mocks.evaluate,
  }),
}));
vi.mock("@/lib/analytics/useAnalytics", () => ({ useAnalytics: () => ({ track: mocks.track }) }));
vi.mock("./ProvisioningPanel", () => ({
  ProvisioningPanel: ({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) => {
    mocks.done = onDone;
    return (
      <div>
        Shared provisioning
        <button type="button" onClick={onDone}>
          Finish funding
        </button>
        <button type="button" onClick={onCancel}>
          Cancel funding
        </button>
      </div>
    );
  },
}));
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  Link: "a",
}));

function modal(balance = 2.01632) {
  return (
    <InvestModal
      family="v2"
      walletAddress="0x1111111111111111111111111111111111111111"
      open
      onOpenChange={vi.fn()}
      balance={balance}
      fund={{
        core: "0x2222222222222222222222222222222222222222",
        name: "Buildathon Strategy",
        minFirstDepositRaw: "10000000",
        holderSharesRaw: "0",
      }}
    />
  );
}
function open(balance = 2.01632) {
  return renderWithProviders(modal(balance));
}
describe("V2 Invest provisioning regression (POO-2248)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.phase = "idle";
    mocks.verified = true;
    mocks.done = null;
    mocks.approvalRequired = false;
    mocks.evaluate.mockReturnValue(true);
  });
  it("opens shared provisioning for 15 USDC with only 2.01632 available", () => {
    open();
    fireEvent.change(screen.getByLabelText("Amount to invest"), { target: { value: "15" } });
    const button = screen.getByRole("button", { name: "Deposit & invest" });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(mocks.evaluate).toHaveBeenCalledWith(15);
    expect(screen.getByText("Shared provisioning")).toBeInTheDocument();
    expect(mocks.prepare).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Finish funding" }));
    expect(mocks.prepare).toHaveBeenCalledWith("15000000");
    expect(mocks.confirm).not.toHaveBeenCalled();
    expect(mocks.track).not.toHaveBeenCalledWith("strategy_invest_completed", expect.anything());
  });
  it("invalidates funding and ignores late completion when the verified session disappears", () => {
    const view = open();
    fireEvent.change(screen.getByLabelText("Amount to invest"), { target: { value: "15" } });
    fireEvent.click(screen.getByRole("button", { name: "Deposit & invest" }));
    const staleDone = mocks.done;
    mocks.verified = false;
    view.rerender(modal());
    expect(screen.queryByText("Shared provisioning")).not.toBeInTheDocument();
    act(() => staleDone?.());
    expect(mocks.prepare).not.toHaveBeenCalled();
    mocks.verified = true;
    view.rerender(modal());
    act(() => staleDone?.());
    expect(mocks.prepare).not.toHaveBeenCalled();
  });
  it("ignores funding completion after the host unmounts", () => {
    const view = open();
    fireEvent.change(screen.getByLabelText("Amount to invest"), { target: { value: "15" } });
    fireEvent.click(screen.getByRole("button", { name: "Deposit & invest" }));
    const staleDone = mocks.done;
    view.unmount();
    act(() => staleDone?.());
    expect(mocks.prepare).not.toHaveBeenCalled();
  });
  it("preserves the amount when cancelling funding", () => {
    open();
    fireEvent.change(screen.getByLabelText("Amount to invest"), { target: { value: "15" } });
    fireEvent.click(screen.getByRole("button", { name: "Deposit & invest" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel funding" }));
    expect(screen.getByLabelText("Amount to invest")).toHaveValue("15");
    expect(mocks.prepare).not.toHaveBeenCalled();
  });
  it("keeps Max below the first-deposit minimum without a blanket unavailable CTA", () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: "Max" }));
    expect(screen.getByText("Minimum investment is $10.00")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Invest" })).toBeDisabled();
    expect(mocks.evaluate).not.toHaveBeenCalled();
  });
  it("prepares a typed deposit when the wallet needs no funding", () => {
    mocks.evaluate.mockReturnValue(false);
    open(100);
    fireEvent.change(screen.getByLabelText("Amount to invest"), { target: { value: "15" } });
    fireEvent.click(screen.getByRole("button", { name: "Invest" }));
    expect(mocks.prepare).toHaveBeenCalledWith("15000000");
    expect(mocks.confirm).not.toHaveBeenCalled();
  });
  it("reconciles an unknown transaction instead of offering another deposit", () => {
    mocks.phase = "unknown";
    open();
    expect(screen.queryByLabelText("Amount to invest")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Check transaction status" }));
    expect(mocks.reconcile).toHaveBeenCalledOnce();
    expect(mocks.prepare).not.toHaveBeenCalled();
  });
});
