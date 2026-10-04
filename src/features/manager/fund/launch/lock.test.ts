import { afterEach, describe, expect, it, vi } from "vitest";
import { withLaunchLock } from "./lock";

describe("cross-tab launch ownership [R3]", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("refuses an occupied draft before doing any wallet work", async () => {
    const work = vi.fn();
    vi.stubGlobal("navigator", {
      locks: {
        request: async (
          _key: string,
          _options: unknown,
          callback: (lock: null) => Promise<unknown>,
        ) => callback(null),
      },
    });
    await expect(withLaunchLock("draft", work)).rejects.toThrow("LAUNCH_ALREADY_RUNNING");
    expect(work).not.toHaveBeenCalled();
  });
  it("fails closed when browser-wide locks are unavailable", async () => {
    vi.stubGlobal("navigator", {});
    await expect(withLaunchLock("draft", async () => {})).rejects.toThrow(
      "LAUNCH_LOCK_UNAVAILABLE",
    );
  });
  it("runs only under the exclusive draft lock", async () => {
    vi.stubGlobal("navigator", {
      locks: {
        request: async (
          _key: string,
          _options: unknown,
          callback: (lock: object) => Promise<unknown>,
        ) => callback({}),
      },
    });
    expect(await withLaunchLock("draft", async () => "done")).toBe("done");
  });
});
