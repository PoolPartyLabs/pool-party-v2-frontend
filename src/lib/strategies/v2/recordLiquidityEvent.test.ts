/**
 * @id PP-STR-LIB-010 (POO-719 · POO-868)
 * @name recordLiquidityEvent tests
 * @implements-rules-version v2 (POO-719) · signature drop: POO-868 v2
 *
 * The fire-and-forget ledger callback: posts `{txHash, network}` with NO wallet signature (POO-868
 * [R1][R3] — the operation was already signed on-chain; the API derives everything from the
 * receipt); EVERY failure resolves `false` and never throws — the user's confirmed on-chain
 * operation must never be blocked ([R12]; POO-822 heals).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { recordLiquidityEvent } from "./recordLiquidityEvent";
import { recordLiquidityEventAction } from "./strategiesV2Actions";

vi.mock("./strategiesV2Actions", () => ({
  recordLiquidityEventAction: vi.fn(async () => undefined),
}));

const TX = `0x${"1".repeat(64)}`;
const POSITION_ID = `0x${"ab".repeat(32)}`;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("recordLiquidityEvent (POO-719 rules-v2 · POO-868 rules-v2)", () => {
  it("posts the plain txHash body to the ledger action with no signature", async () => {
    const ok = await recordLiquidityEvent({
      strategyRef: POSITION_ID,
      txHash: TX,
      network: "arbitrum",
    });

    expect(ok).toBe(true);
    expect(recordLiquidityEventAction).toHaveBeenCalledTimes(1);
    expect(recordLiquidityEventAction).toHaveBeenCalledWith(POSITION_ID, {
      txHash: TX,
      network: "arbitrum",
    });
  });

  it("swallows an upstream action failure: resolves false, never throws", async () => {
    vi.mocked(recordLiquidityEventAction).mockRejectedValueOnce(new Error("503 price unavailable"));

    const ok = await recordLiquidityEvent({
      strategyRef: POSITION_ID,
      txHash: TX,
      network: "arbitrum",
    });

    expect(ok).toBe(false);
  });
});
