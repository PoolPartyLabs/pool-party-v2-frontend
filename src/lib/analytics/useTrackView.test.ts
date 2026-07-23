/**
 * @id PP-CORE-HOK-012
 * @name useTrackView.test
 * @implements-rules-version v1
 * Unit tests for useTrackView: fires once on mount, never on re-render, forwards params.
 */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useTrackView } from "./useTrackView";

describe("useTrackView", () => {
  beforeEach(() => {
    window.dataLayer = [];
  });

  it("fires the event once on mount", () => {
    renderHook(() => useTrackView("home_viewed"));
    const fired = window.dataLayer?.filter((entry) => entry.event === "home_viewed") ?? [];
    expect(fired).toHaveLength(1);
  });

  it("does not re-fire on re-render", () => {
    const { rerender } = renderHook(() => useTrackView("portfolio_viewed"));
    rerender();
    rerender();
    const fired = window.dataLayer?.filter((entry) => entry.event === "portfolio_viewed") ?? [];
    expect(fired).toHaveLength(1);
  });

  it("forwards params to the push", () => {
    renderHook(() => useTrackView("position_detail_viewed", { position_id: "pos_1" }));
    expect(window.dataLayer).toContainEqual(
      expect.objectContaining({ event: "position_detail_viewed", position_id: "pos_1" }),
    );
  });
});
