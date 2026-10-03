/**
 * @id PP-MGR-MOD-005
 * @name NameDraftDialog tests
 * @implements-rules-version v1 (POO-2122 rules v1)
 * @analytics-events none, the dialog reports its outcomes upward and the shell emits them
 *
 * [R7] the two ways out and the two modes; [R8] the name rule: the primary is never disabled, the
 * click is what surfaces the error, and a storage failure keeps the dialog and the draft.
 */
import { describe, expect, it, vi } from "vitest";
import {
  renderWithProviders,
  screen,
  userEvent,
  waitFor,
} from "../../../../../tests/utils/renderWithProviders";
import { NameDraftDialog, type NameDraftDialogProps } from "./NameDraftDialog";

function setup(over: Partial<NameDraftDialogProps> = {}) {
  const props: NameDraftDialogProps = {
    open: true,
    mode: "exit",
    counts: { networks: 3, protocols: 4, tokens: 3 },
    position: { index: 3, count: 5 },
    onSave: vi.fn().mockResolvedValue({ ok: true }),
    onSaved: vi.fn(),
    onBlocked: vi.fn(),
    onClose: vi.fn(),
    ...over,
  };
  renderWithProviders(<NameDraftDialog {...props} />);
  return props;
}

describe("NameDraftDialog", () => {
  // @rule R7
  it("[R7] prints what the draft already holds and where the manager is", () => {
    setup();

    expect(screen.getByRole("heading", { name: "Name your draft" })).toBeInTheDocument();
    expect(
      screen.getByText("Saved so far: 3 networks, 4 protocols, 3 tokens · Mandate, step 3 of 5"),
    ).toBeInTheDocument();
  });

  // @rule R8
  it("[R8] counts what is typed against the ceiling", async () => {
    setup();
    expect(screen.getByText("0 / 50")).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("Draft name"), "ETH and BTC on Arbitrum");

    expect(screen.getByText("23 / 50")).toBeInTheDocument();
  });

  // @rule R8
  it("[R8] an empty name: the primary still presses, and the press is what explains", async () => {
    const props = setup();

    await userEvent.click(screen.getByRole("button", { name: "Save and exit" }));

    expect(screen.getByText("Give the draft a name")).toBeInTheDocument();
    expect(props.onBlocked).toHaveBeenCalledTimes(1);
    expect(props.onSave).not.toHaveBeenCalled();
  });

  // @rule R8
  it("[R8] a name outside 10 to 50 characters is refused with the same copy Review uses", async () => {
    const props = setup();

    await userEvent.type(screen.getByLabelText("Draft name"), "short");
    await userEvent.click(screen.getByRole("button", { name: "Save and exit" }));

    expect(screen.getByText("Name must be 10–50 characters.")).toBeInTheDocument();
    expect(props.onBlocked).toHaveBeenCalledTimes(1);
    expect(props.onSave).not.toHaveBeenCalled();
  });

  // @rule R8
  it("[R8] the helper turns destructive while the name is out of range, before any click", async () => {
    setup();

    const helper = screen.getByText("10 to 50 characters, same rule as the strategy name.");
    expect(helper.className).not.toContain("text-destructive");

    await userEvent.type(screen.getByLabelText("Draft name"), "short");

    expect(helper.className).toContain("text-destructive");
  });

  // @rule R7
  it("[R7] a valid name saves and hands the outcome back to the shell", async () => {
    const props = setup();

    await userEvent.type(screen.getByLabelText("Draft name"), "ETH and BTC on Arbitrum");
    await userEvent.click(screen.getByRole("button", { name: "Save and exit" }));

    await waitFor(() => expect(props.onSaved).toHaveBeenCalledTimes(1));
    expect(props.onSave).toHaveBeenCalledWith("ETH and BTC on Arbitrum");
    expect(props.onBlocked).not.toHaveBeenCalled();
  });

  // @rule R7
  it("[R7] a storage failure keeps the dialog open and says the choices are still there", async () => {
    const props = setup({ onSave: vi.fn().mockResolvedValue({ ok: false, error: "storage" }) });

    await userEvent.type(screen.getByLabelText("Draft name"), "ETH and BTC on Arbitrum");
    await userEvent.click(screen.getByRole("button", { name: "Save and exit" }));

    expect(
      await screen.findByText("Couldn't save the draft. Your choices are still here; try again."),
    ).toBeInTheDocument();
    expect(props.onSaved).not.toHaveBeenCalled();
    expect(props.onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Name your draft" })).toBeInTheDocument();
  });

  // @rule R7
  it("[R7] Keep editing leaves without saving", async () => {
    const props = setup();

    await userEvent.click(screen.getByRole("button", { name: "Keep editing" }));

    expect(props.onClose).toHaveBeenCalledTimes(1);
    expect(props.onSave).not.toHaveBeenCalled();
  });

  // @rule R7
  it("[R7] Esc leaves without saving", async () => {
    const props = setup();

    await userEvent.keyboard("{Escape}");

    await waitFor(() => expect(props.onClose).toHaveBeenCalledTimes(1));
    expect(props.onSave).not.toHaveBeenCalled();
  });

  // @rule R6
  it("[R6] the complete mode continues into Build instead of exiting", () => {
    setup({ mode: "complete" });

    expect(screen.getByRole("button", { name: "Save and continue" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save and exit" })).not.toBeInTheDocument();
  });

  // @rule R8
  it("[R8] the primary shows it is working while the save is in flight", async () => {
    let release: (value: { ok: true }) => void = () => {};
    const pending = new Promise<{ ok: true }>((resolve) => {
      release = resolve;
    });
    setup({ onSave: vi.fn().mockReturnValue(pending) });

    await userEvent.type(screen.getByLabelText("Draft name"), "ETH and BTC on Arbitrum");
    await userEvent.click(screen.getByRole("button", { name: "Save and exit" }));

    const primary = screen.getByRole("button", { name: "Save and exit" });
    await waitFor(() => expect(primary).toHaveAttribute("aria-busy", "true"));
    release({ ok: true });
  });
});
