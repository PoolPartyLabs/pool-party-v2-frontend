/** @id PP-CP-SCR-001 @name Cash+ page integration tests @implements-rules-version v1 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CashPlusController } from "@/lib/cash-plus/types";
import { CASH_PLUS_PREVIEW_OWNER, CASH_PLUS_PREVIEW_SNAPSHOT } from "@/mocks/data/cashPlus";
import {
  renderWithProviders,
  screen,
  userEvent,
  waitFor,
} from "../../../../tests/utils/renderWithProviders";
import { CashPlusView } from "./CashPlusView";

function controller(overrides: Partial<CashPlusController> = {}): CashPlusController {
  return {
    snapshot: CASH_PLUS_PREVIEW_SNAPSHOT,
    status: "ready",
    wallet: {
      connected: true,
      address: CASH_PLUS_PREVIEW_OWNER,
      correctChain: true,
      balanceAssets: BigInt("2500000000"),
    },
    transaction: { phase: "idle", kind: "deposit" },
    review: vi.fn(),
    confirm: vi.fn(),
    resetTransaction: vi.fn(),
    refresh: vi.fn(),
    connect: vi.fn(),
    switchNetwork: vi.fn(),
    ...overrides,
  };
}
beforeEach(() => localStorage.clear());
describe("CashPlusView", () => {
  // @rule CP-UI09: show a safe unavailable state without a fake balance or raw RPC details.
  it("shows an explicit error and retries without leaking the raw failure", async () => {
    const user = userEvent.setup();
    const c = controller({ snapshot: null, status: "error", error: "rpc-private-token-sensitive" });
    renderWithProviders(<CashPlusView controller={c} />);
    expect(screen.getByRole("alert")).toHaveTextContent("We couldn't load Cash+");
    expect(screen.queryByText("$100,012.34")).toBeNull();
    expect(screen.queryByText("rpc-private-token-sensitive")).toBeNull();
    await user.click(screen.getAllByRole("button", { name: "Refresh" }).at(-1) as HTMLElement);
    expect(c.refresh).toHaveBeenCalledOnce();
  });
  // @rule CP-TX08: dismissing a pending operation preserves its identity and permits receipt reopening.
  it("preserves a pending transaction when the sheet is dismissed", async () => {
    const user = userEvent.setup();
    const c = controller({
      transaction: { phase: "pending", kind: "deposit", hash: `0x${"1".repeat(64)}` },
    });
    renderWithProviders(<CashPlusView controller={c} />);
    await user.click(screen.getAllByRole("button", { name: "Close" }).at(-1) as HTMLElement);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(c.resetTransaction).not.toHaveBeenCalled();
    expect(screen.getByText("Transaction submitted")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Transaction details" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(c.confirm).not.toHaveBeenCalled();
  });
  // @rule CP-D05: earlier history is an explicit bounded action instead of an unbounded automatic scan.
  it("offers the controller's bounded history action when history is partial", async () => {
    const user = userEvent.setup();
    const loadEarlierHistory = vi.fn().mockResolvedValue(undefined);
    renderWithProviders(
      <CashPlusView
        controller={controller({
          snapshot: { ...CASH_PLUS_PREVIEW_SNAPSHOT, historyPartial: true },
          loadEarlierHistory,
        })}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Load earlier activity" }));
    expect(loadEarlierHistory).toHaveBeenCalledOnce();
  });
});
