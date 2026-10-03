/**
 * @id PP-CORE-CMP-016
 * @name Toast.test
 * @implements-rules-version v1
 * Behavior tests for the Toast primitive (Toaster mounts without crashing; toast API is callable).
 */
import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Toaster, toast } from "./Toast";

describe("Toast", () => {
  it("renders the themed Toaster without crashing", () => {
    expect(() => render(<Toaster />)).not.toThrow();
  });

  it("exposes toast as a callable imperative API", () => {
    expect(typeof toast).toBe("function");
  });

  it("exposes the success, error, and info variant helpers as functions", () => {
    expect(typeof toast.success).toBe("function");
    expect(typeof toast.error).toBe("function");
    expect(typeof toast.info).toBe("function");
  });

  describe("typography (POO-2173 review F3)", () => {
    afterEach(() => {
      act(() => {
        toast.dismiss();
      });
    });

    /** Fires a toast and returns the list element sonner draws it in. */
    async function listWithToast() {
      render(<Toaster />);
      act(() => {
        toast("Draft saved");
      });
      await screen.findByText("Draft saved");
      const list = document.querySelector<HTMLElement>("[data-sonner-toaster]");
      if (!list) throw new Error("sonner drew a toast but no toaster list");
      return list;
    }

    it("sets the app font on the toaster, so toasts do not fall back to sonner's system font", async () => {
      const list = await listWithToast();

      // sonner's injected stylesheet gives `[data-sonner-toaster]` a system font stack. That rule is
      // unlayered, so a utility class cannot beat it; the inline style on the list can.
      expect(list.style.fontFamily).toContain("var(--font-poppins)");
    });

    it("keeps a system fallback behind the app font", async () => {
      const list = await listWithToast();

      expect(list.style.fontFamily).toMatch(/var\(--font-poppins\),.*sans-serif/);
    });
  });
});
