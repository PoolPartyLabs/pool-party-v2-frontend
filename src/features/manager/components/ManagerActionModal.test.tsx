/**
 * @id PP-MGR-MOD-002
 * @name ManagerActionModal.test
 * Behavior: renders title, description, detail rows and the gas note; Cancel closes; Confirm runs
 * `onConfirm` — a returned message shows the in-dialog success view (Done closes), `undefined`
 * closes directly, and a rejection shows the shared error line without closing.
 */
import { describe, expect, it, vi } from "vitest";
import {
  renderWithProviders,
  screen,
  userEvent,
} from "../../../../tests/utils/renderWithProviders";
import { ManagerActionModal } from "./ManagerActionModal";

function baseProps(overrides: Partial<Parameters<typeof ManagerActionModal>[0]> = {}) {
  return {
    open: true,
    onOpenChange: vi.fn(),
    title: "Collect fees?",
    description: "Sends fees to your balance.",
    details: [{ label: "Uncollected fees", value: "$842.19" }],
    gasCostUsd: 0.42,
    confirmLabel: "Collect fees",
    onConfirm: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("ManagerActionModal", () => {
  it("renders the title, description, details and gas note", () => {
    renderWithProviders(<ManagerActionModal {...baseProps()} />);

    expect(screen.getByText("Collect fees?")).toBeInTheDocument();
    expect(screen.getByText("Sends fees to your balance.")).toBeInTheDocument();
    expect(screen.getByText("Uncollected fees")).toBeInTheDocument();
    expect(screen.getByText("$842.19")).toBeInTheDocument();
    expect(screen.getByText(/You pay the network gas/)).toBeInTheDocument();
  });

  // @rule POO-807 R1: this modal hand-rolls its header/success, so it mounts the MOCK indicator
  // itself — visible next to the title in mock mode (tests run in mock mode; real-mode absence is
  // guarded in the MockBadge unit test).
  it("[POO-807] shows the MOCK badge next to the title in mock mode", () => {
    renderWithProviders(<ManagerActionModal {...baseProps()} />);
    expect(screen.getByTestId("mock-badge")).toHaveTextContent("MOCK");
  });

  it("renders a detail row whose value is a node (e.g. a logo/badge), not just a string", () => {
    renderWithProviders(
      <ManagerActionModal
        {...baseProps({
          details: [{ label: "Network", value: <span data-testid="net-badge">Arbitrum</span> }],
        })}
      />,
    );

    expect(screen.getByText("Network")).toBeInTheDocument();
    expect(screen.getByTestId("net-badge")).toHaveTextContent("Arbitrum");
  });

  it("cancel closes without running the action", async () => {
    const user = userEvent.setup();
    const props = baseProps();
    renderWithProviders(<ManagerActionModal {...props} />);

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(props.onConfirm).not.toHaveBeenCalled();
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
  });

  it("confirm with a returned message shows the success view; Done closes", async () => {
    const user = userEvent.setup();
    const props = baseProps({
      onConfirm: vi.fn(async () => "Collected $842.19 to your balance."),
    });
    renderWithProviders(<ManagerActionModal {...props} />);

    await user.click(screen.getByRole("button", { name: "Collect fees" }));

    expect(props.onConfirm).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Collected $842.19 to your balance.")).toBeInTheDocument();
    // The confirm form is gone in the success view.
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
  });

  it("confirm resolving undefined closes directly (caller owns the outcome)", async () => {
    const user = userEvent.setup();
    const props = baseProps();
    renderWithProviders(<ManagerActionModal {...props} />);

    await user.click(screen.getByRole("button", { name: "Collect fees" }));

    expect(props.onConfirm).toHaveBeenCalledTimes(1);
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
    expect(screen.queryByRole("button", { name: "Done" })).not.toBeInTheDocument();
  });

  // @rule POO-524 R1 — the modal stays generic: extra receipt content (seed rows + Fee row on the
  // launch confirm) arrives through a children slot rendered with the confirm form, not hardcoded.
  it("renders the children slot alongside the details in the confirm view (POO-524 R1)", () => {
    renderWithProviders(
      <ManagerActionModal {...baseProps()}>
        <div data-testid="confirm-extra-rows">extra rows</div>
      </ManagerActionModal>,
    );

    expect(screen.getByTestId("confirm-extra-rows")).toBeInTheDocument();
    // Still renders next to the regular details, in the confirm (not success) view.
    expect(screen.getByText("Uncollected fees")).toBeInTheDocument();
  });

  // POO-550: the optional header settings gear (Launch strategy hosts the slippage/deadline controls
  // at the point of signing). Absent by default; when wired, clicking it opens the caller's settings.
  it("[POO-550] shows no settings gear by default", () => {
    renderWithProviders(<ManagerActionModal {...baseProps()} />);
    expect(screen.queryByRole("button", { name: "Transaction settings" })).not.toBeInTheDocument();
  });

  it("[POO-550] renders the settings gear and calls onOpenSettings when clicked", async () => {
    const user = userEvent.setup();
    const onOpenSettings = vi.fn();
    renderWithProviders(
      <ManagerActionModal
        {...baseProps({ onOpenSettings, settingsLabel: "Transaction settings" })}
      />,
    );
    const gear = screen.getByRole("button", { name: "Transaction settings" });
    await user.click(gear);
    expect(onOpenSettings).toHaveBeenCalledOnce();
  });

  it("a failed action shows the shared error and stays open", async () => {
    const user = userEvent.setup();
    const props = baseProps({
      onConfirm: vi.fn(async () => {
        throw new Error("boom");
      }),
    });
    renderWithProviders(<ManagerActionModal {...props} />);

    await user.click(screen.getByRole("button", { name: "Collect fees" }));

    expect(
      await screen.findByText("Something went wrong. No funds were moved."),
    ).toBeInTheDocument();
    expect(props.onOpenChange).not.toHaveBeenCalledWith(false);
    // Still confirmable after the error.
    expect(screen.getByRole("button", { name: "Collect fees" })).toBeEnabled();
  });
});
