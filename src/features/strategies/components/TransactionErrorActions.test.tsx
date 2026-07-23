/**
 * @id PP-STR-MOD-008
 * @name TransactionErrorActions — tests
 * Behavior (v2, POO-279): the error-details box shows the raw message + Code/Browser/Wallet/OS/
 * Language rows; Copy error writes the FULL payload; Try again retries; Discord opens support.
 */
import { describe, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  renderWithProviders,
  screen,
} from "../../../../tests/utils/renderWithProviders";
import { TransactionErrorActions } from "./TransactionErrorActions";

const error = { code: "-32603", message: "execution reverted: out of ticks" };

describe("TransactionErrorActions", () => {
  it("calls onRetry when Try again is clicked", () => {
    const onRetry = vi.fn();
    renderWithProviders(<TransactionErrorActions onRetry={onRetry} error={error} />);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  // @rule R1 — the box shows the raw message plus the environment rows
  it("renders the error-details box with the diagnostic rows", async () => {
    renderWithProviders(<TransactionErrorActions onRetry={vi.fn()} error={error} />);
    expect(screen.getByText("Error details")).toBeInTheDocument();
    expect(screen.getByText("execution reverted: out of ticks")).toBeInTheDocument();
    expect(screen.getByText("Code")).toBeInTheDocument();
    expect(screen.getByText("-32603")).toBeInTheDocument();
    for (const label of ["Browser", "Wallet", "OS", "Language"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    // Wallet resolves async from the account service mock (embedded).
    expect(await screen.findByText("Privy · Embedded")).toBeInTheDocument();
    // The active app language (test locale is en).
    expect(screen.getByText("English (en)")).toBeInTheDocument();
  });

  // @rule R2 — Copy error copies the full payload (message + code + diagnostics + timestamp)
  it("copies the full error report when the clipboard is available", async () => {
    const writeText = vi.fn();
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    try {
      renderWithProviders(<TransactionErrorActions onRetry={vi.fn()} error={error} />);
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Copy error" }));
      });
      expect(writeText).toHaveBeenCalledTimes(1);
      const payload = writeText.mock.calls[0]?.[0] as string;
      expect(payload).toContain("Message: execution reverted: out of ticks");
      expect(payload).toContain("Code: -32603");
      expect(payload).toContain("Browser:");
      expect(payload).toContain("Language:");
      expect(payload).toContain("Timestamp:");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  // Copy must confirm only on a REAL copy: a rejected write (unfocused document / permission)
  // or an absent Clipboard API keeps the idle label, never a false "Copied".
  it("keeps the idle label when the clipboard write rejects", async () => {
    const writeText = vi.fn(async () => {
      throw new Error("NotAllowedError");
    });
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    try {
      renderWithProviders(<TransactionErrorActions onRetry={vi.fn()} error={error} />);
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Copy error" }));
      });
      expect(writeText).toHaveBeenCalledTimes(1);
      expect(screen.getByRole("button", { name: "Copy error" })).toBeInTheDocument();
      expect(screen.queryByText("Copied")).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  // @rule R3 — Discord stays as the sanctioned second action
  it("opens the Discord invite", () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    renderWithProviders(<TransactionErrorActions onRetry={vi.fn()} error={error} />);
    fireEvent.click(screen.getByRole("button", { name: "Get help on Discord" }));
    expect(open).toHaveBeenCalledWith(
      "https://discord.com/invite/2Tcn6jqGRu",
      "_blank",
      "noopener,noreferrer",
    );
    open.mockRestore();
  });

  it("falls back to the legacy reference when no structured error is provided", () => {
    renderWithProviders(<TransactionErrorActions onRetry={vi.fn()} />);
    expect(screen.getByText("PP-TX-ERR")).toBeInTheDocument();
  });

  // POO-839 R5 — the raw provider message (hex calldata / viem URLs are unbroken tokens far
  // wider than a phone) wraps instead of painting outside the dialog; diagnostics cells shrink.
  it("wraps the raw provider message and lets the diagnostics values shrink", () => {
    const longError = { code: "-32603", message: `0x${"a".repeat(180)}` };
    renderWithProviders(<TransactionErrorActions onRetry={vi.fn()} error={longError} />);
    expect(screen.getByText(longError.message)).toHaveClass("break-words");
    // The Code diagnostics value cell can shrink below its content width.
    expect(screen.getByText("-32603")).toHaveClass("min-w-0");
  });
});
