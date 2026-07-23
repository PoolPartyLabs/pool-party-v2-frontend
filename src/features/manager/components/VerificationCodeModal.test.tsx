/**
 * POO-745 [R4]/[R6]: the verification-code modal renders the returned one-time code and offers a
 * working copy-to-clipboard control. The FE owns the copy (not the server `message`).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  renderWithProviders,
  screen,
} from "../../../../tests/utils/renderWithProviders";
import { VerificationCodeModal } from "./VerificationCodeModal";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("VerificationCodeModal", () => {
  it("renders the returned code in the prominent chip and in the instruction copy", () => {
    renderWithProviders(<VerificationCodeModal open onOpenChange={() => {}} code="K7QF2M9X" />);
    expect(screen.getByTestId("verification-code")).toHaveTextContent("K7QF2M9X");
    // The exact R4 sentence carries the code inline too.
    expect(screen.getByText(/following code: K7QF2M9X/)).toBeInTheDocument();
  });

  it("copies the code to the clipboard and confirms with a 'Copied' label", async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    renderWithProviders(<VerificationCodeModal open onOpenChange={() => {}} code="K7QF2M9X" />);
    fireEvent.click(screen.getByRole("button", { name: /copy code/i }));

    expect(writeText).toHaveBeenCalledWith("K7QF2M9X");
    expect(await screen.findByText(/copied/i)).toBeInTheDocument();
  });

  it("closes via the Done button", () => {
    const onOpenChange = vi.fn();
    renderWithProviders(<VerificationCodeModal open onOpenChange={onOpenChange} code="K7QF2M9X" />);
    fireEvent.click(screen.getByRole("button", { name: /done/i }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
