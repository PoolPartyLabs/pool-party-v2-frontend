/**
 * @id PP-CORE-CMP-016
 * @name Toast.test
 * @implements-rules-version v1
 * Behavior tests for the Toast primitive (Toaster mounts without crashing; toast API is callable).
 */
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
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
});
