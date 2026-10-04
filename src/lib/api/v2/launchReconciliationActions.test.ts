import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readLaunchSubmissionCandidatesAction } from "./launchReconciliationActions";

const mocks = vi.hoisted(() => ({
  wallet: vi.fn(),
  auth: vi.fn(),
  identity: vi.fn(),
  enabled: vi.fn(),
  fetch: vi.fn(),
  head: vi.fn(),
  logs: vi.fn(),
  client: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({
  getSessionWallet: mocks.wallet,
  getAuthHeader: mocks.auth,
}));
vi.mock("@/lib/api/client", () => ({ apiFetch: mocks.identity }));
vi.mock("@/lib/features", () => ({ isFeatureEnabled: mocks.enabled }));
vi.mock("viem", async (importOriginal) => ({
  ...(await importOriginal<typeof import("viem")>()),
  createPublicClient: mocks.client,
}));

const core = `0x${"12".repeat(20)}`;
const wallet = `0x${"34".repeat(20)}`;
const factory = `0x${"56".repeat(20)}`;
const hash = `0x${"ab".repeat(32)}`;
const otherHash = `0x${"cd".repeat(32)}`;
const cursor = `100:0x${"ef".repeat(32)}`;
const input = { chainId: 42161 as const, address: core, mode: "api" as const };
const rpcInput = { ...input, mode: "rpc" as const, fromBlock: "100" };
const response = (data: unknown, status = 200) =>
  new Response(JSON.stringify({ data }), {
    status,
    headers: { "x-pool-party-protocol": "v2" },
  });
const leg = (transactionHash = hash, blockNumber = "100") => ({
  protocolVersion: "v2",
  transactionHash,
  blockNumber,
  timestamp: "2026-10-04T00:00:00.000Z",
});
const transit = (legs: Record<string, unknown>, sourceChainId = "42161") => ({
  protocolVersion: "v2",
  core,
  sourceChainId,
  destinationChainId: sourceChainId === "42161" ? "4663" : "42161",
  legs,
});
const page = (items: unknown[] = [], nextCursor: string | null = null) => ({
  protocolVersion: "v2",
  items,
  nextCursor,
  coverage: ["42161", "4663"].map((chainId) => ({
    protocolVersion: "v2",
    chainId,
    nextBlock: "125",
    headBlock: "124",
    complete: true,
  })),
});

describe("launch submission candidate reads", () => {
  afterEach(() => {
    vi.useRealTimers();
  });
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal("fetch", mocks.fetch);
    vi.stubEnv("PP_API_URL", "https://api.example.test");
    vi.stubEnv("PP_API_KEY", "api-secret");
    mocks.enabled.mockReturnValue(true);
    mocks.wallet.mockResolvedValue(wallet);
    mocks.auth.mockResolvedValue({ Authorization: "Bearer session-secret" });
    mocks.identity.mockResolvedValue({ walletAddress: wallet });
    mocks.fetch.mockResolvedValue(response({ protocolVersion: "v2", manager: wallet }));
    mocks.client.mockReturnValue({ getBlockNumber: mocks.head, getLogs: mocks.logs });
    mocks.head.mockResolvedValue(BigInt(124));
    mocks.logs.mockResolvedValue([]);
  });

  it("[R1] requires the feature, verified session, and fund manager before discovery", async () => {
    mocks.enabled.mockReturnValue(false);
    expect(await readLaunchSubmissionCandidatesAction(core, input)).toEqual({
      ok: false,
      error: { status: 404, code: "V2_UNAVAILABLE" },
    });
    expect(mocks.identity).not.toHaveBeenCalled();
    mocks.enabled.mockReturnValue(true);
    mocks.wallet.mockResolvedValue(null);
    expect(await readLaunchSubmissionCandidatesAction(core, input)).toMatchObject({
      ok: false,
      error: { status: 401 },
    });
    mocks.wallet.mockResolvedValue(wallet);
    mocks.identity.mockResolvedValue({ walletAddress: factory });
    expect(await readLaunchSubmissionCandidatesAction(core, input)).toMatchObject({
      ok: false,
      error: { status: 401 },
    });
    mocks.identity.mockResolvedValue({ walletAddress: wallet });
    mocks.fetch.mockResolvedValue(response({ protocolVersion: "v2", manager: factory }));
    expect(await readLaunchSubmissionCandidatesAction(core, input)).toMatchObject({
      ok: false,
      error: { status: 403 },
    });
    expect(mocks.logs).not.toHaveBeenCalled();
  });

  it("[R1] rejects missing bearer credentials and sanitizes identity failures", async () => {
    mocks.auth.mockResolvedValue({});
    expect(await readLaunchSubmissionCandidatesAction(core, rpcInput)).toMatchObject({
      ok: false,
      error: { status: 401 },
    });
    mocks.auth.mockResolvedValue({ Authorization: "Bearer session-secret" });
    mocks.identity.mockRejectedValue(new Error("session-secret"));
    const result = await readLaunchSubmissionCandidatesAction(core, rpcInput);
    expect(result).toMatchObject({ ok: false, error: { status: 401 } });
    expect(JSON.stringify(result)).not.toContain("secret");
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("[R2] reads actual paginated transit history, filters leg chain and lower block, deduplicates hashes", async () => {
    mocks.fetch
      .mockResolvedValueOnce(response({ protocolVersion: "v2", manager: wallet }))
      .mockResolvedValueOnce(
        response(
          page(
            [
              transit({
                sent: leg(),
                deposited: leg(),
                filled: leg(otherHash),
                expired: leg(hash, "99"),
              }),
              transit({ sent: leg(otherHash), credited: leg(otherHash, "110") }, "4663"),
            ],
            cursor,
          ),
        ),
      )
      .mockResolvedValueOnce(response(page([transit({ sent: leg() })])));
    expect(
      await readLaunchSubmissionCandidatesAction(core, { ...input, fromBlock: "100" }),
    ).toEqual({
      ok: true,
      data: { hashes: [hash, otherHash] },
    });
    expect(mocks.fetch).toHaveBeenNthCalledWith(
      2,
      `https://api.example.test/api/v2/funds/${core}/transits?limit=50`,
      expect.objectContaining({ method: "GET", body: undefined, cache: "no-store" }),
    );
    expect(mocks.fetch).toHaveBeenNthCalledWith(
      3,
      `https://api.example.test/api/v2/funds/${core}/transits?limit=50&cursor=${encodeURIComponent(cursor)}`,
      expect.anything(),
    );
    expect(mocks.client).not.toHaveBeenCalled();
  });

  it("[R2] includes destination history on the spoke without confusing source blocks", async () => {
    mocks.fetch
      .mockResolvedValueOnce(response({ protocolVersion: "v2", manager: wallet }))
      .mockResolvedValueOnce(
        response(
          page([
            transit({
              sent: leg(hash, "9999999"),
              filled: leg(otherHash, "105"),
              credited: leg(otherHash, "106"),
            }),
          ]),
        ),
      );
    expect(
      await readLaunchSubmissionCandidatesAction(core, {
        ...input,
        chainId: 4663,
        fromBlock: "100",
      }),
    ).toEqual({
      ok: true,
      data: { hashes: [otherHash] },
    });
  });

  it("[R2] supports broad bounded API discovery without a lower block and never auto-falls back", async () => {
    mocks.fetch
      .mockResolvedValueOnce(response({ protocolVersion: "v2", manager: wallet }))
      .mockResolvedValueOnce(response(page()));
    expect(await readLaunchSubmissionCandidatesAction(core, input)).toEqual({
      ok: true,
      data: { hashes: [] },
    });
    expect(mocks.client).not.toHaveBeenCalled();
  });

  it("[R2] ignores foreign fund history and null legs, and normalizes hashes", async () => {
    mocks.fetch
      .mockResolvedValueOnce(response({ protocolVersion: "v2", manager: wallet }))
      .mockResolvedValueOnce(
        response(
          page([
            { ...transit({ sent: leg(otherHash) }), core: factory },
            transit({ sent: leg(`0x${"AB".repeat(32)}`), deposited: null, filled: null }),
          ]),
        ),
      );
    expect(await readLaunchSubmissionCandidatesAction(core, input)).toEqual({
      ok: true,
      data: { hashes: [hash] },
    });
  });

  it.each(
    [
      [
        {
          protocolVersion: "v2",
          chainId: "42161",
          nextBlock: "100",
          headBlock: "124",
          complete: false,
        },
      ],
      [
        {
          protocolVersion: "v2",
          chainId: "4663",
          nextBlock: "125",
          headBlock: "124",
          complete: true,
        },
      ],
      [],
      [
        {
          protocolVersion: "v2",
          chainId: "42161",
          nextBlock: "100",
          headBlock: "124",
          complete: true,
        },
      ],
    ].map((coverage) => ({ coverage })),
  )("[R2] rejects a single indexed match when relevant-chain coverage is incomplete: %j", async ({
    coverage,
  }) => {
    mocks.fetch
      .mockResolvedValueOnce(response({ protocolVersion: "v2", manager: wallet }))
      .mockResolvedValueOnce(response({ ...page([transit({ sent: leg() })]), coverage }));
    expect(await readLaunchSubmissionCandidatesAction(core, input)).toEqual({
      ok: false,
      error: { status: 503, code: "V2_RECONCILIATION_INCOMPLETE" },
    });
    expect(mocks.client).not.toHaveBeenCalled();
  });

  it("[R2] requires only the relevant chain to be complete", async () => {
    mocks.fetch
      .mockResolvedValueOnce(response({ protocolVersion: "v2", manager: wallet }))
      .mockResolvedValueOnce(
        response({
          ...page([transit({ sent: leg() })]),
          coverage: [
            {
              protocolVersion: "v2",
              chainId: "42161",
              nextBlock: "125",
              headBlock: "124",
              complete: true,
            },
            {
              protocolVersion: "v2",
              chainId: "4663",
              nextBlock: "100",
              headBlock: "124",
              complete: false,
            },
          ],
        }),
      );
    expect(await readLaunchSubmissionCandidatesAction(core, input)).toEqual({
      ok: true,
      data: { hashes: [hash] },
    });
  });

  it("[R2] caps API candidates at 250 unique hashes across all pages", async () => {
    const hashes = Array.from(
      { length: 250 },
      (_, index) => `0x${(index + 1).toString(16).padStart(64, "0")}`,
    );
    const pages = Array.from({ length: 5 }, (_, index) =>
      page(
        hashes
          .slice(index * 50, index * 50 + 50)
          .map((entry) => transit({ sent: leg(entry), deposited: leg(entry) })),
        index === 4 ? null : `${index + 1}:0x${"ef".repeat(32)}`,
      ),
    );
    mocks.fetch.mockResolvedValueOnce(response({ protocolVersion: "v2", manager: wallet }));
    for (const payload of pages) mocks.fetch.mockResolvedValueOnce(response(payload));
    expect(await readLaunchSubmissionCandidatesAction(core, input)).toEqual({
      ok: true,
      data: { hashes },
    });
    mocks.fetch.mockResolvedValueOnce(response({ protocolVersion: "v2", manager: wallet }));
    for (const [index, payload] of pages.entries()) {
      if (index === 4)
        payload.items = payload.items.map((item, itemIndex) =>
          itemIndex === 49 ? transit({ sent: leg(hashes[249]), deposited: leg(otherHash) }) : item,
        );
      mocks.fetch.mockResolvedValueOnce(response(payload));
    }
    expect(await readLaunchSubmissionCandidatesAction(core, input)).toEqual({
      ok: false,
      error: { status: 503, code: "V2_RECONCILIATION_INCOMPLETE" },
    });
  });

  it.each([
    "wallet",
    "identity",
    "fetch",
  ] as const)("[R2] bounds stalled authorization/API %s and cleans deadline timers", async (method) => {
    vi.useFakeTimers();
    mocks[method].mockImplementation(() => new Promise(() => {}));
    let outcome: unknown;
    void readLaunchSubmissionCandidatesAction(core, input).then((result) => {
      outcome = result;
    });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(outcome).toEqual({
      ok: false,
      error: { status: 503, code: "V2_RECONCILIATION_INCOMPLETE" },
    });
    expect(vi.getTimerCount()).toBe(0);
    expect(mocks.client).not.toHaveBeenCalled();
  });

  it("[R2] shares the API deadline with authorization and never starts another page after expiry", async () => {
    vi.useFakeTimers();
    mocks.identity.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve({ walletAddress: wallet }), 5_000);
        }),
    );
    mocks.fetch.mockImplementation(
      () =>
        new Promise((resolve) => {
          const payload =
            mocks.fetch.mock.calls.length === 1
              ? { protocolVersion: "v2", manager: wallet }
              : page([transit({ sent: leg() })], cursor);
          setTimeout(() => resolve(response(payload)), 6_000);
        }),
    );
    let outcome: unknown;
    void readLaunchSubmissionCandidatesAction(core, input).then((result) => {
      outcome = result;
    });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(outcome).toEqual({
      ok: false,
      error: { status: 503, code: "V2_RECONCILIATION_INCOMPLETE" },
    });
    expect(mocks.fetch).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(mocks.fetch).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("[R2] sanitizes API errors without preventing explicit RPC fallback", async () => {
    mocks.fetch
      .mockResolvedValueOnce(response({ protocolVersion: "v2", manager: wallet }))
      .mockResolvedValueOnce(response({ message: "api-secret" }, 503));
    expect(await readLaunchSubmissionCandidatesAction(core, input)).toEqual({
      ok: false,
      error: { status: 503, code: "V2_REQUEST_FAILED" },
    });
    expect(mocks.client).not.toHaveBeenCalled();
    expect(await readLaunchSubmissionCandidatesAction(core, rpcInput)).toEqual({
      ok: true,
      data: { hashes: [] },
    });
  });

  it("[R2] fails closed when five pages leave unseen history or cursors repeat", async () => {
    mocks.fetch.mockResolvedValueOnce(response({ protocolVersion: "v2", manager: wallet }));
    for (let index = 1; index <= 5; index++)
      mocks.fetch.mockResolvedValueOnce(
        response(page([transit({ sent: leg() })], `${index}:0x${"ef".repeat(32)}`)),
      );
    expect(await readLaunchSubmissionCandidatesAction(core, input)).toEqual({
      ok: false,
      error: { status: 503, code: "V2_RECONCILIATION_INCOMPLETE" },
    });
    expect(mocks.fetch).toHaveBeenCalledTimes(6);
    mocks.fetch.mockClear();
    mocks.fetch
      .mockResolvedValueOnce(response({ protocolVersion: "v2", manager: wallet }))
      .mockImplementation(async () => response(page([], cursor)));
    expect(await readLaunchSubmissionCandidatesAction(core, input)).toEqual({
      ok: false,
      error: { status: 503, code: "V2_RECONCILIATION_INCOMPLETE" },
    });
    expect(mocks.fetch).toHaveBeenCalledTimes(3);
  });

  it.each([
    page([], "malformed-secret"),
    page([transit({ sent: leg("not-a-hash") })]),
    page([transit({ sent: leg(hash, "-1") })]),
    page([
      transit({
        sent: { transactionHash: hash, blockNumber: "100", timestamp: "2026-10-04T00:00:00.000Z" },
      }),
    ]),
    page(Array.from({ length: 51 }, () => transit({}))),
    { protocolVersion: "v1", items: [], nextCursor: null },
  ])("[R2] fails closed on malformed API history: %j", async (payload) => {
    mocks.fetch
      .mockResolvedValueOnce(response({ protocolVersion: "v2", manager: wallet }))
      .mockResolvedValueOnce(response(payload));
    const result = await readLaunchSubmissionCandidatesAction(core, input);
    expect(result).toMatchObject({ ok: false });
    expect(JSON.stringify(result)).not.toContain("secret");
    expect(mocks.client).not.toHaveBeenCalled();
  });

  it("[R3] scans all target logs in inclusive chunks of ten blocks", async () => {
    mocks.logs.mockResolvedValue([
      { transactionHash: hash, address: factory, blockNumber: BigInt(100), removed: false },
      { transactionHash: hash, address: factory, blockNumber: BigInt(100), removed: false },
    ]);
    expect(
      await readLaunchSubmissionCandidatesAction(core, { ...rpcInput, address: factory }),
    ).toEqual({
      ok: true,
      data: { hashes: [hash] },
    });
    expect(mocks.logs.mock.calls.map(([query]) => query)).toEqual([
      { address: factory, fromBlock: BigInt(100), toBlock: BigInt(109) },
      { address: factory, fromBlock: BigInt(110), toBlock: BigInt(119) },
      { address: factory, fromBlock: BigInt(120), toBlock: BigInt(124) },
    ]);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.client).toHaveBeenCalledWith(
      expect.objectContaining({ chain: expect.objectContaining({ id: 42161 }) }),
    );
  });

  it("[R3] caps total scanning at 2,000 blocks starting at the trusted lower bound", async () => {
    mocks.head.mockResolvedValue(BigInt(2099));
    expect(await readLaunchSubmissionCandidatesAction(core, rpcInput)).toMatchObject({ ok: true });
    expect(mocks.logs).toHaveBeenCalledTimes(200);
    expect(mocks.logs).toHaveBeenLastCalledWith({
      address: core,
      fromBlock: BigInt(2090),
      toBlock: BigInt(2099),
    });
  });

  it("[R3] rejects a truncated RPC window instead of returning a partial match", async () => {
    mocks.head.mockResolvedValue(BigInt(2100));
    mocks.logs.mockResolvedValue([{ transactionHash: hash, address: core, removed: false }]);
    expect(await readLaunchSubmissionCandidatesAction(core, rpcInput)).toEqual({
      ok: false,
      error: { status: 503, code: "V2_RECONCILIATION_INCOMPLETE" },
    });
    expect(mocks.logs).not.toHaveBeenCalled();
  });

  it("[R3] accepts 250 unique RPC candidates but fails closed on candidate 251", async () => {
    mocks.head.mockResolvedValue(BigInt(100));
    const logs = Array.from({ length: 250 }, (_, index) => ({
      transactionHash: `0x${(index + 1).toString(16).padStart(64, "0")}`,
      address: core,
      removed: false,
    }));
    mocks.logs.mockResolvedValue([...logs, logs[0]]);
    expect(await readLaunchSubmissionCandidatesAction(core, rpcInput)).toEqual({
      ok: true,
      data: { hashes: logs.map((log) => log.transactionHash) },
    });
    mocks.fetch.mockResolvedValue(response({ protocolVersion: "v2", manager: wallet }));
    mocks.logs.mockResolvedValue([...logs, { ...logs[0], transactionHash: otherHash }]);
    expect(await readLaunchSubmissionCandidatesAction(core, rpcInput)).toEqual({
      ok: false,
      error: { status: 503, code: "V2_RECONCILIATION_INCOMPLETE" },
    });
  });

  it.each([
    "head",
    "logs",
  ] as const)("[R3] times out stalled RPC %s within 20 seconds", async (method) => {
    vi.useFakeTimers();
    mocks[method].mockImplementation(() => new Promise(() => {}));
    const result = readLaunchSubmissionCandidatesAction(core, rpcInput);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(await result).toEqual({
      ok: false,
      error: { status: 503, code: "V2_RECONCILIATION_INCOMPLETE" },
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("[R3] applies one shared deadline across sequential chunks and discards partial hashes", async () => {
    vi.useFakeTimers();
    mocks.logs.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(
            () => resolve([{ transactionHash: hash, address: core, removed: false }]),
            11_000,
          );
        }),
    );
    const result = readLaunchSubmissionCandidatesAction(core, rpcInput);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(await result).toEqual({
      ok: false,
      error: { status: 503, code: "V2_RECONCILIATION_INCOMPLETE" },
    });
    expect(mocks.logs).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(mocks.logs).toHaveBeenCalledTimes(2);
  });

  it.each([
    undefined,
    "0",
    "-1",
    "latest",
    "1.2",
    "9".repeat(79),
  ])("[R3] refuses an absent or invalid RPC lower bound: %j", async (fromBlock) => {
    expect(
      await readLaunchSubmissionCandidatesAction(core, { ...rpcInput, fromBlock }),
    ).toMatchObject({ ok: false });
    expect(mocks.logs).not.toHaveBeenCalled();
    expect(mocks.head).not.toHaveBeenCalled();
  });

  it("[R3] handles a future lower bound without log reads and sanitizes RPC failures", async () => {
    mocks.head.mockResolvedValue(BigInt(99));
    expect(await readLaunchSubmissionCandidatesAction(core, rpcInput)).toEqual({
      ok: true,
      data: { hashes: [] },
    });
    expect(mocks.logs).not.toHaveBeenCalled();
    mocks.head.mockRejectedValue(new Error("https://rpc.test/api-secret"));
    const result = await readLaunchSubmissionCandidatesAction(core, rpcInput);
    expect(result).toEqual({ ok: false, error: { status: 503, code: "V2_UNAVAILABLE" } });
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("[R3] excludes removed, wrong-address, and malformed RPC hashes", async () => {
    mocks.head.mockResolvedValue(BigInt(100));
    mocks.logs.mockResolvedValue([
      { transactionHash: hash, address: core, removed: true },
      { transactionHash: hash, address: factory, removed: false },
      { transactionHash: "invalid", address: core, removed: false },
      { transactionHash: otherHash, address: core, removed: false },
    ]);
    expect(await readLaunchSubmissionCandidatesAction(core, rpcInput)).toEqual({
      ok: true,
      data: { hashes: [otherHash] },
    });
  });

  it("[R4] allows verified precreation RPC on the supplied factory without fund lookup", async () => {
    expect(
      await readLaunchSubmissionCandidatesAction(core, {
        ...rpcInput,
        chainId: 4663,
        address: factory,
        preCreation: true,
      }),
    ).toEqual({
      ok: true,
      data: { hashes: [] },
    });
    expect(mocks.identity).toHaveBeenCalledWith(
      "users/me",
      expect.objectContaining({
        headers: { Authorization: "Bearer session-secret" },
      }),
    );
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.client).toHaveBeenCalledWith(
      expect.objectContaining({ chain: expect.objectContaining({ id: 4663 }) }),
    );
  });

  it("[R4] returns empty precreation API candidates after verifying session identity", async () => {
    expect(
      await readLaunchSubmissionCandidatesAction(core, { ...input, preCreation: true }),
    ).toEqual({ ok: true, data: { hashes: [] } });
    expect(mocks.identity).toHaveBeenCalledWith(
      "users/me",
      expect.objectContaining({
        headers: { Authorization: "Bearer session-secret" },
      }),
    );
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.client).not.toHaveBeenCalled();
  });

  it("[R4] rejects unauthenticated precreation API and RPC reads", async () => {
    mocks.wallet.mockResolvedValue(null);
    expect(
      await readLaunchSubmissionCandidatesAction(core, { ...input, preCreation: true }),
    ).toMatchObject({ ok: false, error: { status: 401 } });
    expect(
      await readLaunchSubmissionCandidatesAction(core, { ...rpcInput, preCreation: true }),
    ).toMatchObject({ ok: false, error: { status: 401 } });
    expect(mocks.client).not.toHaveBeenCalled();
  });

  it.each([
    { ...rpcInput, chainId: 1 },
    { ...rpcInput, address: "https://private.test" },
    { ...rpcInput, mode: "auto" },
    { ...rpcInput, preCreation: "true" },
  ])("[R5] validates the entire read input: %j", async (invalid) => {
    expect(await readLaunchSubmissionCandidatesAction(core, invalid)).toMatchObject({
      ok: false,
      error: { status: 400 },
    });
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.client).not.toHaveBeenCalled();
  });
});
