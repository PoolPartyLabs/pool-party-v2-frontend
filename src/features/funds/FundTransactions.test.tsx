import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  renderWithProviders,
  screen,
  userEvent,
  waitFor,
} from "../../../tests/utils/renderWithProviders";

const mocks = vi.hoisted(() => ({
  build: vi.fn(),
  load: vi.fn(),
  send: vi.fn(),
  receipt: vi.fn(),
  execute: vi.fn(),
  request: vi.fn(),
  reportStart: vi.fn(),
  reportPoll: vi.fn(),
  toast: vi.fn(),
}));
vi.mock("sonner", () => ({
  Toaster: () => <div data-testid="fund-toaster" />,
  toast: Object.assign(mocks.toast, { dismiss: vi.fn() }),
}));
vi.mock("@/lib/services", () => ({ isMockMode: false }));
vi.mock("@privy-io/react-auth", () => ({
  useWallets: () => ({
    wallets: [
      {
        address: `0x${"1".repeat(40)}`,
        switchChain: vi.fn(),
        getEthereumProvider: async () => ({ request: mocks.request }),
      },
    ],
  }),
}));
vi.mock("@/lib/tx/sendTransaction", async (original) => ({
  ...(await original<typeof import("@/lib/tx/sendTransaction")>()),
  sendBuiltTransaction: mocks.send,
  waitForReceipt: mocks.receipt,
  executeBuiltTransaction: mocks.execute,
}));
vi.mock("./fundActions", () => ({
  buildFundAction: mocks.build,
  loadFundAction: mocks.load,
  pollFundReportAction: mocks.reportPoll,
  startFundReportAction: mocks.reportStart,
}));

import { mockFund, mockFundBuild, mockHolder, mockWallet } from "@/mocks/data/v2Funds";
import { FundActionsPanel } from "./FundActionsPanel";

const hash = `0x${"a".repeat(64)}`;
function deferred<Value>() {
  let resolve!: (value: Value) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<Value>((success, failure) => {
    resolve = success;
    reject = failure;
  });
  return { promise, resolve, reject };
}
async function prepare() {
  await userEvent.click(screen.getByRole("button", { name: "Claim payout" }));
  await screen.findByRole("button", { name: "Confirm in wallet" });
  await userEvent.click(screen.getByRole("button", { name: "Confirm in wallet" }));
}
describe("fund broadcast receipts", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.load.mockResolvedValue({ ok: true, data: { fund: mockFund } });
    mocks.build.mockResolvedValue({ ok: true, data: mockFundBuild({ action: "claim-payout" }) });
    mocks.send.mockResolvedValue(hash);
  });
  // @rule R1 @rule R2 @rule R3
  it("links the full hash before receipt confirmation and keeps the mined block after completion", async () => {
    const receipt = deferred<{ blockNumber: number; logs: [] }>();
    mocks.receipt.mockReturnValue(receipt.promise);
    mocks.execute.mockReturnValue(receipt.promise);
    renderWithProviders(
      <FundActionsPanel
        fund={mockFund}
        holder={{ ...mockHolder, claimable: true }}
        wallet={mockWallet}
        refresh={vi.fn()}
      />,
    );
    await prepare();
    expect(screen.getByTestId("fund-toaster")).toBeInTheDocument();
    const link = await screen.findByRole("link", { name: hash });
    expect(link).toHaveAttribute("href", `https://arbiscan.io/tx/${hash}`);
    expect(mocks.toast).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ duration: Infinity }),
    );
    expect(screen.getByText("Pending confirmation")).toBeInTheDocument();
    await act(async () => receipt.resolve({ blockNumber: 1234, logs: [] }));
    await waitFor(() => expect(screen.getByText("Confirmed in block 1234")).toBeInTheDocument());
    expect(screen.getByRole("link", { name: hash })).toHaveAttribute("rel", "noopener noreferrer");
  });
  // @rule R3
  it("keeps an uncertain broadcast pending and removes the stale confirmation button", async () => {
    const receipt = deferred<never>();
    mocks.receipt.mockReturnValue(receipt.promise);
    mocks.execute.mockReturnValue(receipt.promise);
    renderWithProviders(
      <FundActionsPanel
        fund={mockFund}
        holder={{ ...mockHolder, claimable: true }}
        wallet={mockWallet}
        refresh={vi.fn()}
      />,
    );
    await prepare();
    await act(async () => receipt.reject({ code: "TX_CONFIRMATION_UNKNOWN" }));
    expect(await screen.findByRole("link", { name: hash })).toBeInTheDocument();
    expect(screen.getByText("Pending confirmation")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirm in wallet" })).not.toBeInTheDocument();
  });
  // @rule R1 @rule R3
  it("retains approval and action hashes across rebuild and later input edits", async () => {
    const actionHash = `0x${"c".repeat(64)}`;
    const approval = {
      ...mockFundBuild({ action: "deposit", amount: "2000000" }),
      nextAction: "approve",
    };
    mocks.build.mockResolvedValueOnce({ ok: true, data: approval }).mockResolvedValue({
      ok: true,
      data: mockFundBuild({ action: "deposit", amount: "2000000" }),
    });
    mocks.send.mockResolvedValueOnce(hash).mockResolvedValueOnce(actionHash);
    mocks.receipt.mockResolvedValue({ blockNumber: 42, logs: [] });
    const refresh = vi.fn();
    renderWithProviders(
      <FundActionsPanel
        fund={mockFund}
        holder={mockHolder}
        wallet={mockWallet}
        refresh={refresh}
      />,
    );
    await userEvent.type(screen.getByLabelText("Amount (USDC)"), "2");
    await userEvent.click(screen.getByRole("button", { name: "Deposit" }));
    await userEvent.click(await screen.findByRole("button", { name: "Approve and rebuild" }));
    expect(await screen.findByRole("link", { name: hash })).toBeInTheDocument();
    await userEvent.click(await screen.findByRole("button", { name: "Confirm in wallet" }));
    expect(await screen.findByRole("link", { name: actionHash })).toBeInTheDocument();
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    await userEvent.clear(screen.getByLabelText("Amount (USDC)"));
    expect(screen.getByRole("link", { name: hash })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: actionHash })).toBeInTheDocument();
  });
  // @rule R1
  it.each([
    "Instant payout",
    "Standard payout",
    "Withdraw income",
    "Settle income",
    "Exit closed fund",
  ])("links a broadcast from %s", async (label) => {
    mocks.receipt.mockResolvedValue({ blockNumber: 42, logs: [] });
    renderWithProviders(
      <FundActionsPanel
        fund={{ ...mockFund, state: label === "Exit closed fund" ? "Closed" : "Open" }}
        holder={{
          ...mockHolder,
          incomeWithdrawal: ["1000000", true],
          payout: { ...mockHolder.payout, open: false },
        }}
        wallet={mockWallet}
        refresh={vi.fn()}
      />,
    );
    await userEvent.type(screen.getByLabelText("Amount (USDC)"), "2");
    await userEvent.click(screen.getByRole("button", { name: label }));
    await userEvent.click(await screen.findByRole("button", { name: "Confirm in wallet" }));
    expect(await screen.findByRole("link", { name: hash })).toHaveAttribute(
      "href",
      `https://arbiscan.io/tx/${hash}`,
    );
  });
  // @rule R1 @rule R3
  it("renders the reverted receipt and decoded reason while retaining its hash", async () => {
    mocks.receipt.mockRejectedValue({ cause: { code: "TX_REVERTED" } });
    mocks.request.mockRejectedValue(new Error("rpc unavailable"));
    renderWithProviders(
      <FundActionsPanel
        fund={mockFund}
        holder={{ ...mockHolder, claimable: true }}
        wallet={mockWallet}
        refresh={vi.fn()}
      />,
    );
    await prepare();
    expect(await screen.findByText("Reverted")).toBeInTheDocument();
    expect(
      screen.getByText("The transaction reverted. No decoded reason is available."),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: hash })).toBeInTheDocument();
  });
  // @rule R1
  it("clears the previous wallet records and ignores a late receipt for that identity", async () => {
    const receipt = deferred<{ blockNumber: number; logs: [] }>();
    mocks.receipt.mockReturnValue(receipt.promise);
    const props = {
      fund: mockFund,
      holder: { ...mockHolder, claimable: true },
      wallet: mockWallet,
      refresh: vi.fn(),
    };
    const view = renderWithProviders(<FundActionsPanel {...props} />);
    await prepare();
    await screen.findByRole("link", { name: hash });
    view.rerender(<FundActionsPanel {...props} wallet={`0x${"f".repeat(40)}`} />);
    expect(screen.queryByRole("link", { name: hash })).not.toBeInTheDocument();
    await act(async () => receipt.resolve({ blockNumber: 123, logs: [] }));
    expect(screen.queryByRole("link", { name: hash })).not.toBeInTheDocument();
  });
  // @rule R4
  it("shows report-job publication and delivery hashes even if freshness reread fails", async () => {
    const stale = {
      ...mockFund,
      lastReport: {
        protocolVersion: "v2" as const,
        report: { protocolVersion: "v2" as const, sequence: "1", timestamp: "1" },
        ageSeconds: 999999,
      },
    };
    mocks.load.mockResolvedValue({ ok: true, data: { fund: stale } });
    mocks.reportStart.mockResolvedValue({ ok: true, data: { jobId: "report-job" } });
    mocks.reportPoll.mockResolvedValue({
      ok: true,
      data: {
        jobId: "report-job",
        status: "delivered",
        publishTxHash: hash,
        deliveryTxHash: `0x${"d".repeat(64)}`,
        payload: "private admin payload",
      },
    });
    const originalTimeout = globalThis.setTimeout;
    const timeout = vi
      .spyOn(globalThis, "setTimeout")
      .mockImplementation((callback, delay, ...args) =>
        originalTimeout(callback, delay === 15000 ? 0 : delay, ...args),
      );
    try {
      renderWithProviders(
        <FundActionsPanel
          fund={stale}
          holder={{ ...mockHolder, claimable: true }}
          wallet={mockWallet}
          refresh={vi.fn()}
        />,
      );
      await userEvent.click(screen.getByRole("button", { name: "Claim payout" }));
      expect(await screen.findByRole("link", { name: hash })).toHaveAttribute(
        "href",
        `https://robinhoodchain.blockscout.com/tx/${hash}`,
      );
      expect(screen.getByRole("link", { name: `0x${"d".repeat(64)}` })).toHaveAttribute(
        "href",
        `https://arbiscan.io/tx/0x${"d".repeat(64)}`,
      );
      expect(screen.queryByText("private admin payload")).not.toBeInTheDocument();
      expect(mocks.send).not.toHaveBeenCalled();
    } finally {
      timeout.mockRestore();
    }
  });
});
