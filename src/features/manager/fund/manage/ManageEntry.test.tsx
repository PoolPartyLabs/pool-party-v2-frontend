/** @id PP-MGR-SCR-004 @implements-rules-version v2 (POO-2226) */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockFund } from "@/mocks/data/v2Funds";
import {
  act,
  renderWithProviders,
  screen,
  userEvent,
  waitFor,
} from "../../../../../tests/utils/renderWithProviders";

const mocks = vi.hoisted(() => ({ load: vi.fn(), wallet: "", signedIn: true }));
vi.mock("@/lib/api/v2/manageActions", () => ({ loadManageFundAction: mocks.load }));
vi.mock("@/lib/auth/useAuth", () => ({ useAuth: () => ({ address: mocks.wallet }) }));
vi.mock("@/lib/auth/useSiweSession", () => ({
  useSiweSession: () => ({ isSignedIn: mocks.signedIn }),
}));
vi.mock("./ManageScreen", () => ({ ManageScreen: () => <div data-testid="manage" /> }));
vi.mock("./ManageBlockPanel", () => ({ ManageBlockPanel: () => null }));

import { ManageEntry } from "./ManageEntry";

const success = () => ({
  ok: true,
  data: { wallet: mockFund.manager, fund: mockFund, balances: [] },
});
describe("authorized Manage entry", () => {
  beforeEach(() => {
    mocks.wallet = mockFund.manager;
    mocks.signedIn = true;
    mocks.load.mockReset().mockResolvedValue(success());
  });
  it("[R1] requires signed-in ownership before mounting controls", async () => {
    mocks.signedIn = false;
    const view = renderWithProviders(<ManageEntry core={mockFund.coreVault} />);
    expect(mocks.load).not.toHaveBeenCalled();
    expect(screen.queryByTestId("manage")).not.toBeInTheDocument();
    mocks.signedIn = true;
    view.rerender(<ManageEntry core={mockFund.coreVault} />);
    expect(await screen.findByTestId("manage")).toBeInTheDocument();
  });
  it("[R1] rejects a mismatched session and suppresses old data on account change", async () => {
    const view = renderWithProviders(<ManageEntry core={mockFund.coreVault} />);
    expect(await screen.findByTestId("manage")).toBeInTheDocument();
    mocks.wallet = `0x${"9".repeat(40)}`;
    view.rerender(<ManageEntry core={mockFund.coreVault} />);
    expect(screen.queryByTestId("manage")).not.toBeInTheDocument();
    expect(
      await screen.findByText("Only this strategy’s manager can manage its positions."),
    ).toBeInTheDocument();
  });
  it("[R8] retries errors and ignores an obsolete core response", async () => {
    mocks.load.mockResolvedValueOnce({ ok: false, error: { status: 503, code: "V2_UNAVAILABLE" } });
    const view = renderWithProviders(<ManageEntry core={mockFund.coreVault} />);
    await userEvent.click(await screen.findByRole("button", { name: "Try again" }));
    expect(await screen.findByTestId("manage")).toBeInTheDocument();
    let resolveOld: (value: unknown) => void = () => {};
    mocks.load.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve;
        }),
    );
    view.rerender(<ManageEntry core={`0x${"8".repeat(40)}`} />);
    await waitFor(() => expect(mocks.load).toHaveBeenCalledTimes(3));
    view.rerender(<ManageEntry core={mockFund.coreVault} />);
    expect(await screen.findByTestId("manage")).toBeInTheDocument();
    await act(async () =>
      resolveOld({ ok: false, error: { status: 403, code: "V2_NOT_MANAGER" } }),
    );
    expect(screen.getByTestId("manage")).toBeInTheDocument();
  });
  it("[R1] reauthenticates the same wallet after sign-out without restoring the old screen", async () => {
    const view = renderWithProviders(<ManageEntry core={mockFund.coreVault} />);
    expect(await screen.findByTestId("manage")).toBeInTheDocument();
    mocks.signedIn = false;
    view.rerender(<ManageEntry core={mockFund.coreVault} />);
    expect(screen.queryByTestId("manage")).not.toBeInTheDocument();
    mocks.load.mockImplementationOnce(() => new Promise(() => {}));
    mocks.signedIn = true;
    view.rerender(<ManageEntry core={mockFund.coreVault} />);
    expect(screen.queryByTestId("manage")).not.toBeInTheDocument();
  });
});

// @rule R6: Authorized loading stays in the Manage shell with skeleton placeholders.
it("POO-2246 [R6] shows a shell skeleton while authorized reads are pending", () => {
  mocks.wallet = mockFund.manager;
  mocks.signedIn = true;
  mocks.load.mockImplementation(() => new Promise(() => {}));
  renderWithProviders(<ManageEntry core={mockFund.coreVault} />);
  expect(document.querySelector("[data-manage-loading]")).toHaveAttribute("aria-busy", "true");
  expect(document.querySelector("[data-manage-grid]")).toBeInTheDocument();
  expect(screen.queryByTestId("manage")).not.toBeInTheDocument();
});
