/**
 * @id PP-STR-LIB-018 (POO-1037)
 * @name awaitBridgeSettlement tests
 * @implements-rules-version v1
 * @hackathon POO-1022 (Universal Funding)
 *
 * The arrival detector's spec, one describe per business rule. Fake timers drive the real backoff
 * (both `setTimeout` and `Date.now` are faked), so the delays asserted here are the delays that ship.
 * The only injected dependency is the balance reader. No network, no wallet, no React.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  awaitBridgeSettlement,
  BRIDGE_POLL_MAX_DELAY_MS,
  BRIDGE_POLL_MIN_DELAY_MS,
  BRIDGE_SETTLE_CEILING_MS,
  type BridgeArrival,
} from "./awaitBridgeSettlement";

const ARBITRUM = 42161;
const USDC_ARBITRUM = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
const OWNER = "0xC3673ADc0000000000000000000000000000BEEF";

/** The user already holds 1 USDC on the destination chain before this bridge starts. */
const BASELINE = "1000000";
/** The bridge's floor: 2996 USDC (6 decimals). */
const MIN_AMOUNT_OUT = "2996000000";
/** Baseline + exactly the floor: the smallest balance that counts as arrival. */
const ARRIVED = "2997000000";

function arrival(overrides: Partial<BridgeArrival> = {}): BridgeArrival {
  return {
    chainId: ARBITRUM,
    token: USDC_ARBITRUM,
    owner: OWNER,
    baseline: BASELINE,
    minAmountOut: MIN_AMOUNT_OUT,
    ...overrides,
  };
}

/**
 * A queued balance reader. A `"!message"` entry throws instead of returning, and the LAST entry
 * repeats forever, so a test that runs to the ceiling never trips over an exhausted queue (which
 * would be indistinguishable from the transient-failure path it is not testing).
 */
function reader(queue: string[]) {
  // Fake timers do not zero the clock, so observations are recorded RELATIVE to this reader, which
  // is built in the same tick as the call under test.
  const createdAt = Date.now();
  const at: number[] = [];
  const pending = [...queue];
  const readTokenBalance = vi.fn(async () => {
    at.push(Date.now() - createdAt);
    const next = pending.length > 1 ? (pending.shift() as string) : (pending[0] as string);
    if (next.startsWith("!")) throw new Error(next.slice(1));
    return next;
  });
  return { readTokenBalance, at };
}

/** Gaps between consecutive observations, which is what "poll with backoff" means concretely. */
function gaps(at: number[]): number[] {
  return at.map((value, index) => (index === 0 ? value : value - (at[index - 1] as number)));
}

/**
 * Run the poller to completion under fake timers. One generous advance covers every case: once the
 * poller resolves it schedules no further timer, so over-advancing is inert.
 */
async function runToCompletion<T>(promise: Promise<T>): Promise<T> {
  await vi.advanceTimersByTimeAsync(BRIDGE_SETTLE_CEILING_MS + BRIDGE_POLL_MAX_DELAY_MS);
  return promise;
}

describe("awaitBridgeSettlement", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  describe("[R1] arrival is a destination-chain balance DELTA against a pre-broadcast baseline", () => {
    it("settles once the delta reaches the leg's floor, on the third observation", async () => {
      const { readTokenBalance } = reader([BASELINE, BASELINE, ARRIVED]);

      const result = await runToCompletion(awaitBridgeSettlement(arrival(), { readTokenBalance }));

      expect(result.settled).toBe(true);
      expect(result.polls).toBe(3);
      expect(result.delta).toBe(MIN_AMOUNT_OUT);
      expect(readTokenBalance).toHaveBeenCalledTimes(3);
      // Read on the DESTINATION chain, for the token the bridge delivers.
      expect(readTokenBalance).toHaveBeenLastCalledWith({
        chainId: ARBITRUM,
        token: USDC_ARBITRUM,
        owner: OWNER,
      });
    });

    it("does not report arrival for a user who already held the destination token", async () => {
      // The absolute test (`balance >= minAmountOut`) would settle on the FIRST read here, which is
      // the exact way a bridge can be declared complete before any money has moved.
      const alreadyRich = "5000000000";
      const { readTokenBalance } = reader([alreadyRich]);

      const result = await runToCompletion(
        awaitBridgeSettlement(arrival({ baseline: alreadyRich }), { readTokenBalance }),
      );

      expect(result.settled).toBe(false);
    });

    it("rejects a baseline it cannot parse rather than treating it as zero", async () => {
      const { readTokenBalance } = reader([ARRIVED]);

      await expect(
        awaitBridgeSettlement(arrival({ baseline: "not-a-number" }), { readTokenBalance }),
      ).rejects.toMatchObject({ cause: { code: "PROVISIONING_INVALID_AMOUNT" } });
      expect(readTokenBalance).not.toHaveBeenCalled();
    });
  });

  describe("[R2] polls with backoff, never a tight loop", () => {
    it("backs off from the floor delay up to the ceiling delay", async () => {
      const { readTokenBalance, at } = reader([
        BASELINE,
        BASELINE,
        BASELINE,
        BASELINE,
        BASELINE,
        BASELINE,
        ARRIVED,
      ]);

      await runToCompletion(awaitBridgeSettlement(arrival(), { readTokenBalance }));

      // First observation is immediate (the source receipt already cost seconds), then 3s, 6s, 12s,
      // 24s, and capped at 30s from there on.
      expect(gaps(at)).toEqual([0, 3_000, 6_000, 12_000, 24_000, 30_000, 30_000]);
      expect(BRIDGE_POLL_MIN_DELAY_MS).toBe(3_000);
      expect(BRIDGE_POLL_MAX_DELAY_MS).toBe(30_000);
    });

    it("sizes the first window from the quote's estimatedFillTimeMs", async () => {
      // Base to Arbitrum USDC measured ~1000ms live: waiting the full floor delay would be three
      // times the whole transfer. A fast quote may not lengthen the window, only shorten it.
      const { readTokenBalance, at } = reader([BASELINE, BASELINE, ARRIVED]);

      await runToCompletion(awaitBridgeSettlement(arrival({ etaMs: 1_000 }), { readTokenBalance }));

      expect(gaps(at)).toEqual([0, 1_000, 2_000]);
    });

    it("never lets a long ETA stretch the window past the ceiling delay", async () => {
      const { readTokenBalance, at } = reader([BASELINE, ARRIVED]);

      await runToCompletion(
        awaitBridgeSettlement(arrival({ etaMs: 5 * 60_000 }), { readTokenBalance }),
      );

      expect(gaps(at)).toEqual([0, BRIDGE_POLL_MAX_DELAY_MS]);
    });
  });

  describe("[R3] polling is bounded and never fakes success", () => {
    it("degrades to unsettled at the ceiling instead of spinning forever", async () => {
      const { readTokenBalance } = reader([BASELINE]);

      const result = await runToCompletion(awaitBridgeSettlement(arrival(), { readTokenBalance }));

      expect(result).toMatchObject({ settled: false, reason: "ceiling" });
      expect(result.waitedMs).toBeGreaterThanOrEqual(BRIDGE_SETTLE_CEILING_MS);
      // Bounded work, not a busy loop: 10 minutes of >=3s windows cannot exceed a few dozen reads.
      expect(result.polls).toBeLessThan(40);
      // Nothing is left scheduled, so the wait cannot resume behind the user's back.
      expect(vi.getTimerCount()).toBe(0);
    });

    it("does not settle on a zero floor with nothing delivered", async () => {
      // A degenerate `minAmountOut` must not turn "no arrival" into success: the delta itself has to
      // be positive for anything to have arrived.
      const { readTokenBalance } = reader([BASELINE]);

      const result = await runToCompletion(
        awaitBridgeSettlement(arrival({ minAmountOut: "0" }), { readTokenBalance }),
      );

      expect(result.settled).toBe(false);
    });
  });

  describe("[R4] a transient read failure is non-fatal", () => {
    it("retries in the next window and still settles", async () => {
      const { readTokenBalance } = reader(["!RPC 503", BASELINE, ARRIVED]);

      const result = await runToCompletion(awaitBridgeSettlement(arrival(), { readTokenBalance }));

      expect(result.settled).toBe(true);
      expect(result.polls).toBe(3);
    });

    it("keeps the last known delta when a later read fails, and reports the failure at the ceiling", async () => {
      const partial = "1500000000";
      const { readTokenBalance } = reader([partial, "!RPC 503"]);

      const result = await runToCompletion(awaitBridgeSettlement(arrival(), { readTokenBalance }));

      expect(result.settled).toBe(false);
      // The last SUCCESSFUL observation stands; a failed read overwrites nothing.
      expect(result.delta).toBe("1499000000");
      expect(result).toMatchObject({ lastError: expect.stringContaining("RPC 503") });
    });

    it("treats an unparseable balance as a failed observation, not as zero", async () => {
      const { readTokenBalance } = reader(["<html>gateway timeout</html>", BASELINE, ARRIVED]);

      const result = await runToCompletion(awaitBridgeSettlement(arrival(), { readTokenBalance }));

      expect(result.settled).toBe(true);
      expect(result.polls).toBe(3);
    });

    it("treats an EMPTY balance body as a failed observation, not as zero", async () => {
      // `BigInt("")` is `0n`, so an empty body is the one junk response that could silently pass for
      // a real balance and rewrite a partial arrival into "the money went backwards". It must land
      // on the failure path like any other unparseable read.
      const partial = "1500000000";
      const { readTokenBalance } = reader([partial, ""]);

      const result = await runToCompletion(awaitBridgeSettlement(arrival(), { readTokenBalance }));

      expect(result.settled).toBe(false);
      expect(result.delta).toBe("1499000000");
      expect(result).toMatchObject({ lastError: expect.stringContaining("empty") });
    });
  });
});
