/**
 * @id PP-MGR-SCR-009
 * @name SolanaPreviewErrorBoundary tests
 * @implements-rules-version v2 (POO-2281)
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import {
  SolanaPreviewErrorBoundary,
  SolanaPreviewRenderBoundary,
} from "./SolanaPreviewErrorBoundary";

const { track } = vi.hoisted(() => ({ track: vi.fn() }));
vi.mock("@/lib/analytics/useAnalytics", () => ({ useAnalytics: () => ({ track }) }));

// @rule R9: only genuine failures emit bounded error metadata, never exception contents.
it("emits one bounded app error without leaking exception text", () => {
  track.mockClear();
  const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  function Drawing(): never {
    throw new Error("wallet-sensitive render failure");
  }
  try {
    render(
      <SolanaPreviewRenderBoundary hasLocalChanges fallback={() => <p>Retry drawing</p>}>
        <Drawing />
      </SolanaPreviewRenderBoundary>,
    );
    expect(track).toHaveBeenCalledExactlyOnceWith("solana_preview_error", {
      error_code: "SOLANA_PREVIEW_RENDER_FAILED",
      error_origin: "app",
      has_local_changes: true,
    });
    expect(JSON.stringify(track.mock.calls)).not.toContain("wallet-sensitive");
  } finally {
    consoleSpy.mockRestore();
  }
});

it("reports only a real rendering failure and retries the same local subtree", () => {
  const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  const onError = vi.fn();
  let fail = true;
  function Drawing() {
    if (fail) throw new Error("test-only render failure");
    return <p>Recovered drawing</p>;
  }
  try {
    render(
      <SolanaPreviewErrorBoundary
        onError={onError}
        fallback={(retry) => (
          <button type="button" onClick={retry}>
            Retry drawing
          </button>
        )}
      >
        <Drawing />
      </SolanaPreviewErrorBoundary>,
    );
    expect(onError).toHaveBeenCalledOnce();
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry drawing" }));
    expect(screen.getByText("Recovered drawing")).toBeVisible();
    expect(onError).toHaveBeenCalledOnce();
  } finally {
    consoleSpy.mockRestore();
  }
});
