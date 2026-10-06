import { renderHook } from "@testing-library/react";
import { expect, it } from "vitest";
import { useOverviewSetup } from "./useOverviewSetup";

// @rule R1, R5
it("does not dereference a missing initial snapshot when disconnected", () => {
  const { result } = renderHook(() => useOverviewSetup(undefined));
  expect(result.current?.draftStatus).toBe("available");
});
