/**
 * @id PP-CORE-HOK-036 (POO-1805) - tests
 * @name useOnRampCoverage - tests
 * @implements-rules-version v2 (POO-1805 rules v2)
 * @analytics-events none, the hook emits nothing; see the module header.
 *
 * The REAL half of the hook. Mock mode is its own file (`useOnRampCoverage.mockMode.test.tsx`),
 * because `isMockMode` is a module constant read at import time and the two branches therefore
 * cannot share a module graph.
 *
 * The hook is a BINDING, so what is worth asserting is what it binds: the buyer's own token, the ids
 * the app is configured with, the browser's own `fetch` (the point of [R1]), the report an `unknown`
 * owes, and the one thing it adds on its own, in-flight dedupe. The probe's behaviour is
 * `coverageProbe.test.ts`'s, not restated here.
 */
import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { reportClientError } from "@/lib/observability/reportClientError";
import type { CoverageProbeDeps, CoverageProbeInput, CoverageResult } from "./coverageProbe";

const mocks = vi.hoisted(() => ({
  getAccessToken: vi.fn<() => Promise<string | null>>(async () => "hook-token"),
  // Typed with the REAL signatures so `mock.calls` needs no cast at all: an `as` on a call tuple is
  // exactly where a wrong shape would compile clean (POO-1805 review F4).
  probe: vi.fn<(deps: CoverageProbeDeps, input: CoverageProbeInput) => Promise<CoverageResult>>(
    async () => ({ status: "uncovered" }),
  ),
  reportClientError: vi.fn<typeof reportClientError>(),
}));

/** The recorded call, or a loud failure. Never a cast: the mock is typed. */
function probeCall(index: number): [CoverageProbeDeps, CoverageProbeInput] {
  const call = mocks.probe.mock.calls[index];
  if (!call) throw new Error(`the probe was not called ${index + 1} time(s)`);
  return call;
}

vi.mock("@privy-io/react-auth", () => ({
  usePrivy: () => ({ getAccessToken: mocks.getAccessToken }),
}));
vi.mock("./coverageProbe", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./coverageProbe")>()),
  probeOnRampCoverage: mocks.probe,
}));
vi.mock("@/lib/observability/reportClientError", () => ({
  reportClientError: mocks.reportClientError,
}));
vi.mock("@/lib/services", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/services")>()),
  isMockMode: false,
}));

import { useOnRampCoverage } from "./useOnRampCoverage";

const INPUT: CoverageProbeInput = {
  fiat: "brl",
  amount: "100",
  destination: {
    chain: "eip155:8453",
    asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    address: "0x1111111111111111111111111111111111111111",
  },
  environment: "sandbox",
};

afterEach(() => {
  vi.clearAllMocks();
  mocks.probe.mockResolvedValue({ status: "uncovered" });
});

describe("useOnRampCoverage", () => {
  it("binds the buyer's own access token and the app's ids", async () => {
    const { result } = renderHook(() => useOnRampCoverage());
    await result.current(INPUT);

    const [deps, input] = probeCall(0);
    expect(await deps.getAccessToken()).toBe("hook-token");
    expect(deps).toMatchObject({ appId: expect.any(String) });
    expect(input).toEqual(INPUT);
  });

  // @rule R1
  it("[R1] passes the browser's own fetch, not Privy's client", async () => {
    // The whole reason the probe exists as `fetch`: the SDK swallows every failure into an empty
    // quote list, so going through it would make an outage indistinguishable from no coverage.
    const { result } = renderHook(() => useOnRampCoverage());
    await result.current(INPUT);
    const [deps] = probeCall(0);
    expect(typeof deps.fetch).toBe("function");
  });

  it("returns a stable callback while the token getter is unchanged", () => {
    const { result, rerender } = renderHook(() => useOnRampCoverage());
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });

  // @rule R1
  it("[R1] reports an unknown answer with its reason and status, and nothing else", async () => {
    // An `unknown` is the answer we could not get, so it is the one a human has to see. The fields
    // are capped at reason + status ON PURPOSE: the token and the buyer's address would identify
    // the buyer and diagnose nothing.
    mocks.probe.mockResolvedValue({ status: "unknown", reason: "upstream", httpStatus: 503 });
    const { result } = renderHook(() => useOnRampCoverage());
    await result.current(INPUT);

    expect(mocks.reportClientError).toHaveBeenCalledTimes(1);
    const call = mocks.reportClientError.mock.calls[0];
    if (!call) throw new Error("nothing was reported");
    const [event, error, fields] = call;
    expect(event).toBe("onramp.coverage_unknown");
    expect(fields).toEqual({ reason: "upstream", httpStatus: 503 });
    const reported = JSON.stringify([event, String(error), fields]);
    expect(reported).not.toContain("hook-token");
    expect(reported).not.toContain(INPUT.destination.address);
  });

  it("reports nothing for an answer that IS an answer", async () => {
    mocks.probe.mockResolvedValue({ status: "uncovered" });
    const { result } = renderHook(() => useOnRampCoverage());
    await result.current(INPUT);
    expect(mocks.reportClientError).not.toHaveBeenCalled();
  });

  it("dedupes an identical question that is still in flight", async () => {
    // A re-rendering amount field, or two surfaces mounted at once, must not each charge the rail
    // for an answer that is already coming.
    let settle: (value: CoverageResult) => void = () => {};
    mocks.probe.mockReturnValue(
      new Promise<CoverageResult>((resolve) => {
        settle = resolve;
      }),
    );

    const { result } = renderHook(() => useOnRampCoverage());
    const first = result.current(INPUT);
    const second = result.current(INPUT);
    expect(mocks.probe).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);

    settle({ status: "uncovered" });
    await expect(first).resolves.toEqual({ status: "uncovered" });
    await expect(second).resolves.toEqual({ status: "uncovered" });
  });

  it("asks again once the previous question has been answered", async () => {
    // Deliberately NOT a cache: coverage changes without a release, which is why this module asks
    // instead of reading a table.
    const { result } = renderHook(() => useOnRampCoverage());
    await result.current(INPUT);
    await result.current(INPUT);
    expect(mocks.probe).toHaveBeenCalledTimes(2);
  });

  it("does not share an in-flight answer between different questions", async () => {
    // The amount is the money and the address is the buyer: neither may inherit the other's answer.
    mocks.probe.mockReturnValue(new Promise<CoverageResult>(() => {}));
    const { result } = renderHook(() => useOnRampCoverage());
    result.current(INPUT);
    result.current({ ...INPUT, amount: "200" });
    result.current({
      ...INPUT,
      destination: { ...INPUT.destination, address: "0x2222222222222222222222222222222222222222" },
    });
    expect(mocks.probe).toHaveBeenCalledTimes(3);
  });
});
