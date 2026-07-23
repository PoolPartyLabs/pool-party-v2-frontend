/**
 * @id PP-REW (POO-210)
 * @name Rewards write submitters tests
 * @implements-rules-version v1
 *
 * [R1][R3] Server-side POSTs to the analytics indexer with discriminated outcomes
 * the UI maps to states (awarded / already-claimed / invalid-signature; played /
 * no-tries / already-played-recently / error).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AnalyticsError } from "@/lib/analytics-api/client";

const analyticsFetch = vi.fn();
vi.mock("@/lib/analytics-api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/analytics-api/client")>();
  return { ...actual, analyticsFetch: (...args: unknown[]) => analyticsFetch(...args) };
});

async function importWrites() {
  vi.resetModules();
  return import("./writes");
}

describe("submitDailyQuack", () => {
  beforeEach(() => analyticsFetch.mockReset());

  it("[R1] POSTs the signed payload and returns awarded with pointsAwarded", async () => {
    analyticsFetch.mockResolvedValueOnce({ pointsAwarded: 10 });
    const { submitDailyQuack } = await importWrites();

    const out = await submitDailyQuack({ wallet: "0xabc", signature: "0xsig", date: "2026-06-10" });

    expect(out).toEqual({ status: "awarded", quacksAwarded: 10 });
    const [path, opts] = analyticsFetch.mock.calls[0] as [
      string,
      { method: string; body: unknown },
    ];
    expect(path).toBe("points/quacks/daily");
    expect(opts.method).toBe("POST");
    expect(opts.body).toEqual({ wallet: "0xabc", signature: "0xsig", date: "2026-06-10" });
  });

  it("[R3] passes through the updated streak when the backend returns it (POO-763)", async () => {
    analyticsFetch.mockResolvedValueOnce({
      pointsAwarded: 10,
      streak: { days: 4, multiplier: 1.3 },
    });
    const { submitDailyQuack } = await importWrites();

    const out = await submitDailyQuack({ wallet: "0xabc", signature: "0xsig", date: "2026-06-10" });

    expect(out).toEqual({
      status: "awarded",
      quacksAwarded: 10,
      streak: { days: 4, multiplier: 1.3 },
    });
  });

  it("[R1] 409 ALREADY_CLAIMED -> already_claimed (not an error)", async () => {
    analyticsFetch.mockRejectedValueOnce(new AnalyticsError(409, "ALREADY_CLAIMED", "dup"));
    const { submitDailyQuack } = await importWrites();

    expect(await submitDailyQuack({ wallet: "0xa", signature: "s", date: "d" })).toEqual({
      status: "already_claimed",
    });
  });

  it("[R1] 401 INVALID_SIGNATURE -> invalid_signature", async () => {
    analyticsFetch.mockRejectedValueOnce(new AnalyticsError(401, "INVALID_SIGNATURE", "bad"));
    const { submitDailyQuack } = await importWrites();

    expect(await submitDailyQuack({ wallet: "0xa", signature: "s", date: "d" })).toEqual({
      status: "invalid_signature",
    });
  });

  it("[R1] any other error -> error", async () => {
    analyticsFetch.mockRejectedValueOnce(new AnalyticsError(500, "SYSTEM_INTERNAL", "boom"));
    const { submitDailyQuack } = await importWrites();

    expect(await submitDailyQuack({ wallet: "0xa", signature: "s", date: "d" })).toEqual({
      status: "error",
    });
  });
});

describe("submitDuckShootPlay", () => {
  beforeEach(() => analyticsFetch.mockReset());

  it("[R3] maps a successful play to the DuckShootResult", async () => {
    analyticsFetch.mockResolvedValueOnce({
      outcome: { value: 300, label: "300%" },
      quacksAwarded: 1500,
      triesRemaining: 2,
    });
    const { submitDuckShootPlay } = await importWrites();

    const out = await submitDuckShootPlay("0xabc");

    expect(out).toEqual({
      status: "played",
      result: { hitIndex: 4, multiplierPct: 300, quacksWon: 1500, triesLeft: 2 },
    });
    const [path, opts] = analyticsFetch.mock.calls[0] as [string, { body: unknown }];
    expect(path).toBe("points/duck-shoot/play");
    expect(opts.body).toEqual({ wallet: "0xabc" });
  });

  it("[R3] 400 NO_TRIES -> no_tries", async () => {
    analyticsFetch.mockRejectedValueOnce(new AnalyticsError(400, "NO_TRIES", "none"));
    const { submitDuckShootPlay } = await importWrites();
    expect(await submitDuckShootPlay("0xa")).toEqual({ status: "no_tries" });
  });

  it("[R3] 429 ALREADY_PLAYED_RECENTLY -> already_played_recently", async () => {
    analyticsFetch.mockRejectedValueOnce(
      new AnalyticsError(429, "ALREADY_PLAYED_RECENTLY", "slow down"),
    );
    const { submitDuckShootPlay } = await importWrites();
    expect(await submitDuckShootPlay("0xa")).toEqual({ status: "already_played_recently" });
  });

  it("[R3] any other error -> error", async () => {
    analyticsFetch.mockRejectedValueOnce(new AnalyticsError(500, "SYSTEM_INTERNAL", "boom"));
    const { submitDuckShootPlay } = await importWrites();
    expect(await submitDuckShootPlay("0xa")).toEqual({ status: "error" });
  });
});

describe("submitGrantDuckShootTry (POO-764)", () => {
  beforeEach(() => analyticsFetch.mockReset());

  it("[R1] POSTs {wallet, txHash} and returns granted with the remaining counts", async () => {
    analyticsFetch.mockResolvedValueOnce({ triesRemaining: 3, weeklyTriesLeft: 4 });
    const { submitGrantDuckShootTry } = await importWrites();

    const out = await submitGrantDuckShootTry({ wallet: "0xabc", txHash: "0xhash" });

    expect(out).toEqual({ status: "granted", triesRemaining: 3, weeklyTriesLeft: 4 });
    const [path, opts] = analyticsFetch.mock.calls[0] as [
      string,
      { method: string; body: unknown },
    ];
    expect(path).toBe("points/duck-shoot/grant-try");
    expect(opts.method).toBe("POST");
    expect(opts.body).toEqual({ wallet: "0xabc", txHash: "0xhash" });
  });

  it("[R1] maps the known backend errors to discriminated outcomes", async () => {
    const { submitGrantDuckShootTry } = await importWrites();

    analyticsFetch.mockRejectedValueOnce(new AnalyticsError(409, "TX_ALREADY_USED", "dup"));
    expect(await submitGrantDuckShootTry({ wallet: "0xa", txHash: "0x1" })).toEqual({
      status: "tx_already_used",
    });

    analyticsFetch.mockRejectedValueOnce(new AnalyticsError(404, "TX_NOT_FOUND_FOR_WALLET", "lag"));
    expect(await submitGrantDuckShootTry({ wallet: "0xa", txHash: "0x2" })).toEqual({
      status: "tx_not_found",
    });

    analyticsFetch.mockRejectedValueOnce(new AnalyticsError(409, "WEEKLY_CAP_REACHED", "cap"));
    expect(await submitGrantDuckShootTry({ wallet: "0xa", txHash: "0x3" })).toEqual({
      status: "weekly_cap_reached",
    });
  });

  it("maps any other error to error", async () => {
    analyticsFetch.mockRejectedValueOnce(new AnalyticsError(500, "SYSTEM_INTERNAL", "boom"));
    const { submitGrantDuckShootTry } = await importWrites();
    expect(await submitGrantDuckShootTry({ wallet: "0xa", txHash: "0x9" })).toEqual({
      status: "error",
    });
  });
});
