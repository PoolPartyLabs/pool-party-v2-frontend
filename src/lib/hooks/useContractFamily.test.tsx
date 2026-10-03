/**
 * @id PP-CORE-HOK-038
 * @name useContractFamily - tests
 * @implements-rules-version v1
 *
 * POO-2120 [R2]. Behaviour: the contract family defaults to V1, survives a reload under
 * `pp.contractFamily`, reports when it has finished reading that store, refuses anything it did
 * not write, follows the value across tabs, and never throws when storage is gone.
 *
 * The `hydrated` assertions are the reason this file renders a probe component instead of leaning
 * only on `renderHook`: effects flush inside `act`, so by the time `renderHook` returns, hydration
 * has already happened. Recording every render is the only way to pin what the FIRST one showed,
 * which is the render that has to match the server HTML.
 */
import { act, cleanup, render, renderHook, screen } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  __resetContractFamilyStoreForTests,
  CONTRACT_FAMILY_STORAGE_KEY,
  type ContractFamily,
  useContractFamily,
} from "./useContractFamily";

afterEach(() => {
  // Unmount FIRST, before the store is dropped. The reset simulates a fresh page load, and a fresh
  // page load has no mounted consumers: since the hook re-reads whenever it is not hydrated, a
  // consumer still mounted here would hear the reset and immediately hydrate again from the store
  // this hook is about to clear, handing the next test a `hydrated: true` it never asked for.
  // Testing Library's own auto-cleanup runs after this hook, which is too late to decide the order.
  cleanup();
  // Unstub BEFORE clearing, so a test that replaced the store does not leave the real one dirty.
  vi.unstubAllGlobals();
  window.localStorage.clear();
  // The family and the hydration flag are MODULE state now (one value per tab, see the hook's
  // header), so clearing storage is not enough: the next test must start from a fresh page load.
  __resetContractFamilyStoreForTests();
  vi.restoreAllMocks();
});

/**
 * Replace the whole store with one that cannot be read or written, the private-mode shape.
 *
 * jsdom's `localStorage` is a Proxy, so `vi.spyOn(window.localStorage, "setItem")` does not take and
 * a test written that way asserts nothing: the object has to be replaced. Returns the refusing
 * `setItem`, so a test can prove the write was attempted.
 */
function stubFailingStorage() {
  const setItem = vi.fn(() => {
    throw new Error("QuotaExceededError");
  });
  vi.stubGlobal("localStorage", {
    getItem: () => {
      throw new Error("SecurityError");
    },
    setItem,
    removeItem: () => {},
    clear: () => {},
    key: () => null,
    length: 0,
  });
  return setItem;
}

/**
 * Two independent consumers of the REAL hook, side by side: one that writes and one that only
 * reads, which is exactly the header toggle and the route switch.
 *
 * The mount counters carry the "without a remount" half of the claim. A choice that reached the
 * other component only because the tree was torn down and rebuilt would show a second mount, and
 * that is not a fix: the live page never remounts when a header button is pressed.
 */
function renderTwoConsumers() {
  const mounts = { writer: 0, reader: 0 };
  let choose: ((next: ContractFamily) => void) | null = null;

  function Writer() {
    const { family, setFamily } = useContractFamily();
    choose = setFamily;
    useEffect(() => {
      mounts.writer += 1;
    }, []);
    return <span data-testid="writer">{family}</span>;
  }

  function Reader() {
    const { family } = useContractFamily();
    useEffect(() => {
      mounts.reader += 1;
    }, []);
    return <span data-testid="reader">{family}</span>;
  }

  render(
    <>
      <Writer />
      <Reader />
    </>,
  );

  return {
    mounts,
    writer: () => screen.getByTestId("writer").textContent,
    reader: () => screen.getByTestId("reader").textContent,
    choose: (next: ContractFamily) =>
      act(() => {
        choose?.(next);
      }),
  };
}

/** Every render of a probe mounting the hook, in order. */
function renderProbe() {
  const seen: Array<{ family: ContractFamily; hydrated: boolean }> = [];
  function Probe() {
    const { family, hydrated } = useContractFamily();
    seen.push({ family, hydrated });
    return null;
  }
  render(<Probe />);
  return seen;
}

/**
 * One mounted consumer, with its render history AND its mount count.
 *
 * Separate from both probes above: `renderProbe` cannot say whether the component remounted, and
 * `renderTwoConsumers` does not expose `hydrated`. The reset case needs both halves.
 */
function renderLiveProbe() {
  const seen: Array<{ family: ContractFamily; hydrated: boolean }> = [];
  let mounts = 0;

  function Probe() {
    const { family, hydrated } = useContractFamily();
    seen.push({ family, hydrated });
    useEffect(() => {
      mounts += 1;
    }, []);
    return null;
  }

  render(<Probe />);
  return { last: () => seen.at(-1), mounts: () => mounts };
}

describe("useContractFamily", () => {
  // @rule R2
  it("defaults to v1 and writes nothing when the store is empty", () => {
    const { result } = renderHook(() => useContractFamily());
    expect(result.current.family).toBe("v1");
    expect(window.localStorage.getItem(CONTRACT_FAMILY_STORAGE_KEY)).toBeNull();
  });

  // @rule R2. `hydrated` is false on the server and on the first client render, true once the
  // persisted value has been read, EVEN when nothing was stored. "Nothing stored" is an answer, not
  // a pending state: a consumer that waited for a value would skeleton forever on a fresh browser.
  it("reports hydrated false on the first render, then true, with an empty store", () => {
    const seen = renderProbe();
    expect(seen[0]).toEqual({ family: "v1", hydrated: false });
    expect(seen.at(-1)).toEqual({ family: "v1", hydrated: true });
  });

  // @rule R2
  it("persists a change under pp.contractFamily and exposes it", () => {
    const { result } = renderHook(() => useContractFamily());
    act(() => result.current.setFamily("v2"));
    expect(result.current.family).toBe("v2");
    expect(window.localStorage.getItem(CONTRACT_FAMILY_STORAGE_KEY)).toBe(JSON.stringify("v2"));
  });

  // @rule R2
  it("hydrates a stored family, after a first render that still shows v1", () => {
    window.localStorage.setItem(CONTRACT_FAMILY_STORAGE_KEY, JSON.stringify("v2"));
    const seen = renderProbe();
    // No flash of V2: the first render is the server's answer, v1 (R3 depends on this).
    expect(seen[0]).toEqual({ family: "v1", hydrated: false });
    expect(seen.at(-1)).toEqual({ family: "v2", hydrated: true });
  });

  // @rule R2. A malformed payload resolves to v1 AND still finishes hydrating: the read is over,
  // it just produced nothing usable.
  it("falls back to v1 when the stored JSON is malformed", () => {
    window.localStorage.setItem(CONTRACT_FAMILY_STORAGE_KEY, "{ not json");
    const { result } = renderHook(() => useContractFamily());
    expect(result.current.family).toBe("v1");
    expect(result.current.hydrated).toBe(true);
  });

  // @rule R2. Valid JSON that is not one of the two families is malformed just the same. A
  // hand-edited devtools value must not become a third branch nothing in the app can render.
  it.each([
    JSON.stringify("v3"),
    JSON.stringify(2),
    JSON.stringify({ family: "v2" }),
    "null",
  ])("falls back to v1 for the unrecognised stored value %s", (stored) => {
    window.localStorage.setItem(CONTRACT_FAMILY_STORAGE_KEY, stored);
    const { result } = renderHook(() => useContractFamily());
    expect(result.current.family).toBe("v1");
  });

  // @rule R2
  it("follows the family across tabs via the storage event", () => {
    const { result } = renderHook(() => useContractFamily());
    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: CONTRACT_FAMILY_STORAGE_KEY,
          newValue: JSON.stringify("v2"),
        }),
      );
    });
    expect(result.current.family).toBe("v2");
  });

  // @rule R2. Another key's event is not ours.
  it("ignores a storage event for a different key", () => {
    const { result } = renderHook(() => useContractFamily());
    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: "pp.sidebar.collapsed",
          newValue: JSON.stringify("v2"),
        }),
      );
    });
    expect(result.current.family).toBe("v1");
  });

  // @rule R2. A cross-tab payload we cannot read leaves the family alone rather than resetting it.
  it("ignores a malformed cross-tab payload", () => {
    const { result } = renderHook(() => useContractFamily());
    act(() => result.current.setFamily("v2"));
    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", { key: CONTRACT_FAMILY_STORAGE_KEY, newValue: "{ not json" }),
      );
    });
    expect(result.current.family).toBe("v2");
  });

  // @rule R2 (error behaviour). Storage unavailable (private mode, quota, blocked site data) is
  // in-memory state and a v1 default, never a throw. A header toggle must not take the app down.
  it("never throws when localStorage is unavailable, and still updates in memory", () => {
    stubFailingStorage();
    const { result } = renderHook(() => useContractFamily());
    expect(result.current.family).toBe("v1");
    expect(result.current.hydrated).toBe(true);
    expect(() => act(() => result.current.setFamily("v2"))).not.toThrow();
    expect(result.current.family).toBe("v2");
  });

  // @rule R2 (the defect this store exists for). The choice is ONE value shared by the tab, not a
  // copy per component. The header is the only writer and the builder and the drafts slot only
  // read, so a per-component `useState` meant a manager pressed V2 and the builder below did not
  // change until the page remounted, which is the one thing the toggle is for.
  it("shows one consumer's choice to the other, in the same tab, with no remount", () => {
    const probe = renderTwoConsumers();
    expect(probe.writer()).toBe("v1");
    expect(probe.reader()).toBe("v1");

    probe.choose("v2");

    expect(probe.writer()).toBe("v2");
    expect(probe.reader()).toBe("v2");
    expect(probe.mounts).toEqual({ writer: 1, reader: 1 });
  });

  // @rule R2 (error behaviour). A refused write still has to apply for EVERY consumer, not only
  // for the component that called `setFamily`. Otherwise the one browser where storage is blocked
  // gets a header that says V2 over a builder that is still V1.
  it("shares the in-memory fallback with every consumer when the write is refused", () => {
    const refused = stubFailingStorage();

    const probe = renderTwoConsumers();
    probe.choose("v2");

    // The write really was attempted and really was refused, so the assertions below are about the
    // fallback rather than about a store that quietly worked.
    expect(refused).toHaveBeenCalledWith(CONTRACT_FAMILY_STORAGE_KEY, JSON.stringify("v2"));
    expect(probe.writer()).toBe("v2");
    expect(probe.reader()).toBe("v2");
    expect(probe.mounts).toEqual({ writer: 1, reader: 1 });
  });

  /**
   * @rule R2 (the C2 defect). A reset while a consumer is mounted must heal itself.
   *
   * `__resetContractFamilyStoreForTests` drops the family and sets `hydrated` back to false, then
   * notifies. The read lived in a MOUNT-ONLY effect, so the already-mounted consumer re-rendered
   * with `hydrated: false` and nothing ever read storage again: it sat on its unknown-state branch
   * until something remounted it. Storybook is where that bites, because two story files reset the
   * store from a decorator and a decorator can re-render without remounting its child (an args or
   * globals update), so the toggle stayed stranded for the rest of the preview session.
   */
  it("re-reads the store after a reset, with no remount", () => {
    window.localStorage.setItem(CONTRACT_FAMILY_STORAGE_KEY, JSON.stringify("v2"));
    const probe = renderLiveProbe();
    expect(probe.last()).toEqual({ family: "v2", hydrated: true });

    act(() => {
      __resetContractFamilyStoreForTests();
    });

    expect(probe.last()).toEqual({ family: "v2", hydrated: true });
    expect(probe.mounts()).toBe(1);
  });

  // The same heal with nothing stored: the read finishes and reports itself finished, rather than
  // leaving the consumer waiting for a value that is never coming.
  it("finishes hydrating again after a reset with an empty store", () => {
    const probe = renderLiveProbe();

    act(() => {
      __resetContractFamilyStoreForTests();
    });

    expect(probe.last()).toEqual({ family: "v1", hydrated: true });
    expect(probe.mounts()).toBe(1);
  });

  // @rule R2. The cross-tab path keeps working for every consumer, which is what it already did.
  it("follows a cross-tab storage event in every consumer", () => {
    const probe = renderTwoConsumers();
    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: CONTRACT_FAMILY_STORAGE_KEY,
          newValue: JSON.stringify("v2"),
        }),
      );
    });

    expect(probe.writer()).toBe("v2");
    expect(probe.reader()).toBe("v2");
  });
});
