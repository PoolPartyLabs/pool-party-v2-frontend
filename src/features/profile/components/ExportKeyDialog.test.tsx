/**
 * @id PP-PROF-CMP-009
 * @name ExportKeyDialog — tests
 *
 * The hold-to-reveal export gate. HoldToConfirmButton is mocked to a plain button that fires
 * onComplete on click (the hold mechanics are covered in HoldToConfirmButton.test.tsx), and
 * useExportPrivateKey is swapped per scenario.
 *
 * POO-544 security acceptance (real branch): completing the gate calls Privy exportWallet exactly
 * once, and NOTHING secret ever renders in our DOM or reaches the clipboard.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  renderWithProviders,
  screen,
  waitFor,
} from "../../../../tests/utils/renderWithProviders";
import { ExportKeyDialog } from "./ExportKeyDialog";

// Swappable exporter — set `exporterRef.current` before each render.
const { exporterRef } = vi.hoisted(() => ({
  exporterRef: {
    current: null as
      | { isMock: true; revealMockKey: () => string }
      | { isMock: false; exportReal: () => Promise<void>; canExport: boolean }
      | null,
  },
}));

vi.mock("@/lib/account/useExportPrivateKey", () => ({
  useExportPrivateKey: () => exporterRef.current,
}));

// Replace the press-and-hold control with a plain button that fires onComplete on click.
vi.mock("@/components/ui/HoldToConfirmButton", () => ({
  HoldToConfirmButton: ({
    label,
    onComplete,
    disabled,
  }: {
    label: string;
    onComplete: () => void;
    disabled?: boolean;
  }) => (
    <button type="button" disabled={disabled} onClick={onComplete}>
      {label}
    </button>
  ),
}));

afterEach(() => {
  exporterRef.current = null;
  vi.restoreAllMocks();
});

describe("ExportKeyDialog — mock mode", () => {
  it("shows the risk warning and only reveals the mock key after the hold completes", () => {
    exporterRef.current = { isMock: true, revealMockKey: () => `0xMOCK${"a".repeat(60)}` };
    renderWithProviders(<ExportKeyDialog open onOpenChange={vi.fn()} />);

    // Warning present, key hidden until the gate completes.
    expect(screen.getByText("Reveal private key?")).toBeInTheDocument();
    expect(screen.queryByText(/0xMOCK/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Hold to reveal" }));

    expect(screen.getByText(/^0xMOCKa{60}$/)).toBeInTheDocument();
  });

  it("copies the revealed mock key", () => {
    const writeText = vi.fn();
    Object.assign(navigator, { clipboard: { writeText } });
    exporterRef.current = { isMock: true, revealMockKey: () => `0xMOCK${"b".repeat(60)}` };
    renderWithProviders(<ExportKeyDialog open onOpenChange={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Hold to reveal" }));
    fireEvent.click(screen.getByRole("button", { name: "Copy key" }));
    expect(writeText).toHaveBeenCalledWith(`0xMOCK${"b".repeat(60)}`);
  });
});

describe("ExportKeyDialog — real mode (POO-544 R1/R4)", () => {
  it("closes our dialog first, then hands off to Privy, never rendering a key or touching the clipboard", async () => {
    const writeText = vi.fn();
    Object.assign(navigator, { clipboard: { writeText } });
    const exportReal = vi.fn(async () => {});
    const onOpenChange = vi.fn();
    exporterRef.current = { isMock: false, exportReal, canExport: true };
    renderWithProviders(<ExportKeyDialog open onOpenChange={onOpenChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Hold to reveal" }));

    // Our Radix dialog closes synchronously BEFORE Privy's modal opens (so Privy is never left inert).
    expect(onOpenChange).toHaveBeenCalledWith(false);
    // The Privy hand-off runs on the next tick.
    await waitFor(() => expect(exportReal).toHaveBeenCalledTimes(1));
    // R1: no key-shaped text in our DOM and no clipboard write on the real path.
    expect(screen.queryByText(/0x[a-fA-F0-9]{40,}/)).toBeNull();
    expect(screen.queryByText(/0xMOCK/)).toBeNull();
    expect(writeText).not.toHaveBeenCalled();
  });

  it("shows a static, non-secret error and does not hand off when there is no embedded wallet (R4)", () => {
    const exportReal = vi.fn();
    const onOpenChange = vi.fn();
    exporterRef.current = { isMock: false, exportReal, canExport: false };
    renderWithProviders(<ExportKeyDialog open onOpenChange={onOpenChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Hold to reveal" }));

    expect(
      screen.getByText("Could not export your private key. Please try again."),
    ).toBeInTheDocument();
    // No hand-off, and the dialog stays open.
    expect(exportReal).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
