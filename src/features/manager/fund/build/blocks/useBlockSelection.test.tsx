/**
 * @id PP-MGR-HOK-009
 * @name useBlockSelection tests
 * @implements-rules-version v1 (POO-2155 rules v1)
 * @analytics-events none, a state hook under test
 *
 * The selection of the Build canvas and its guard (slice S5, POO-2155; I5, heads-up HU3): one id or
 * null, every change asked of the registered guards, a refusing guard keeping the selection and
 * hearing `onRefused`, and `guardLeave` for every way out of the step. The paths that reach it (a
 * card, a share label, the background, a new block, a remove) are tested with the controller.
 */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, type Mock, vi } from "vitest";
import { type RefusedChange, useBlockSelection } from "./useBlockSelection";

/** A guard that always answers `allow`, recording what it was asked. */
function guard(allow: boolean): {
  allowChange: Mock<(next: string | null) => boolean>;
  onRefused: Mock<() => void>;
} {
  return { allowChange: vi.fn((_next: string | null) => allow), onRefused: vi.fn() };
}

describe("useBlockSelection", () => {
  it("starts with nothing selected and holds one id at a time", () => {
    // @rule I5
    const { result } = renderHook(() => useBlockSelection());
    expect(result.current.selectedId).toBeNull();
    let ok = false;
    act(() => {
      ok = result.current.select("a");
    });
    expect(ok).toBe(true);
    expect(result.current.selectedId).toBe("a");
    act(() => {
      result.current.select("b");
    });
    expect(result.current.selectedId).toBe("b");
    act(() => {
      result.current.select(null);
    });
    expect(result.current.selectedId).toBeNull();
  });

  it("asks every registered guard about every change, with the next id", () => {
    // @rule HU3
    const { result } = renderHook(() => useBlockSelection());
    const first = guard(true);
    const second = guard(true);
    act(() => {
      result.current.registerGuard(first);
      result.current.registerGuard(second);
    });
    act(() => {
      result.current.select("a");
    });
    expect(first.allowChange).toHaveBeenCalledWith("a");
    expect(second.allowChange).toHaveBeenCalledWith("a");
    act(() => {
      result.current.select(null);
    });
    expect(first.allowChange).toHaveBeenLastCalledWith(null);
  });

  it("keeps the selection when a guard refuses, and tells only that guard", () => {
    // @rule HU3
    // @rule I5
    const { result } = renderHook(() => useBlockSelection());
    act(() => {
      result.current.select("a");
    });
    const yes = guard(true);
    const no = guard(false);
    act(() => {
      result.current.registerGuard(yes);
      result.current.registerGuard(no);
    });
    let ok = true;
    act(() => {
      ok = result.current.select("b");
    });
    expect(ok).toBe(false);
    expect(result.current.selectedId).toBe("a");
    expect(no.onRefused).toHaveBeenCalledTimes(1);
    expect(yes.onRefused).not.toHaveBeenCalled();
  });

  it("asks nobody when the id does not change", () => {
    // @rule HU3
    const { result } = renderHook(() => useBlockSelection());
    act(() => {
      result.current.select("a");
    });
    const no = guard(false);
    act(() => {
      result.current.registerGuard(no);
    });
    let ok = false;
    act(() => {
      ok = result.current.select("a");
    });
    expect(ok).toBe(true);
    expect(no.allowChange).not.toHaveBeenCalled();
  });

  it("stops asking a guard once it unregisters", () => {
    // @rule HU3
    const { result } = renderHook(() => useBlockSelection());
    const no = guard(false);
    let unregister = () => {};
    act(() => {
      unregister = result.current.registerGuard(no);
    });
    act(() => {
      unregister();
    });
    act(() => {
      result.current.select("a");
    });
    expect(result.current.selectedId).toBe("a");
    expect(no.allowChange).not.toHaveBeenCalled();
  });

  it("runs the way out only when every guard allows leaving", () => {
    // @rule HU3
    const { result } = renderHook(() => useBlockSelection());
    const proceed = vi.fn();
    act(() => {
      result.current.guardLeave(proceed);
    });
    expect(proceed).toHaveBeenCalledTimes(1);

    const no = guard(false);
    act(() => {
      result.current.registerGuard(no);
    });
    act(() => {
      result.current.guardLeave(proceed);
    });
    expect(proceed).toHaveBeenCalledTimes(1);
    expect(no.allowChange).toHaveBeenCalledWith(null);
    expect(no.onRefused).toHaveBeenCalledTimes(1);
  });

  it("[P6] hands a refused select its resume, which selects once the guard allows", () => {
    // @rule P6
    // @rule HU3
    const { result } = renderHook(() => useBlockSelection());
    act(() => {
      result.current.select("a");
    });
    let allow = false;
    let kept: RefusedChange | null = null;
    act(() => {
      result.current.registerGuard({
        allowChange: () => allow,
        onRefused: (change) => {
          kept = change;
        },
      });
    });
    act(() => {
      result.current.select("b");
    });
    expect(result.current.selectedId).toBe("a");
    expect(kept).not.toBeNull();

    // Still refused: the resume asks the guards again, so nothing moves.
    act(() => {
      (kept as RefusedChange | null)?.resume();
    });
    expect(result.current.selectedId).toBe("a");

    allow = true;
    act(() => {
      (kept as RefusedChange | null)?.resume();
    });
    expect(result.current.selectedId).toBe("b");
  });

  it("[P6] hands a refused way out its resume, which is the way out itself", () => {
    // @rule P6
    // @rule HU3
    const { result } = renderHook(() => useBlockSelection());
    const proceed = vi.fn();
    let kept: RefusedChange | null = null;
    act(() => {
      result.current.registerGuard({
        allowChange: () => false,
        onRefused: (change) => {
          kept = change;
        },
      });
    });
    act(() => {
      result.current.guardLeave(proceed);
    });
    expect(proceed).not.toHaveBeenCalled();

    act(() => {
      (kept as RefusedChange | null)?.resume();
    });
    expect(proceed).toHaveBeenCalledTimes(1);
  });

  it("[P6] a select refused to null resumes to null (the canvas background)", () => {
    // @rule P6
    const { result } = renderHook(() => useBlockSelection("a"));
    let allow = false;
    let kept: RefusedChange | null = null;
    act(() => {
      result.current.registerGuard({
        allowChange: () => allow,
        onRefused: (change) => {
          kept = change;
        },
      });
    });
    act(() => {
      result.current.select(null);
    });
    expect(result.current.selectedId).toBe("a");
    allow = true;
    act(() => {
      (kept as RefusedChange | null)?.resume();
    });
    expect(result.current.selectedId).toBeNull();
  });

  it("keeps the same function identities across renders", () => {
    // @rule HU3
    const { result, rerender } = renderHook(() => useBlockSelection());
    const { select, registerGuard, guardLeave } = result.current;
    act(() => {
      result.current.select("a");
    });
    rerender();
    expect(result.current.select).toBe(select);
    expect(result.current.registerGuard).toBe(registerGuard);
    expect(result.current.guardLeave).toBe(guardLeave);
  });
});
