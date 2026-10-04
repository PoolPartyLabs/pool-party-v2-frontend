import { encodeAbiParameters, encodeEventTopics, parseAbi, type TransactionReceipt } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createLaunchDriver, type FrozenLaunch } from "./driver";
import { createJournal, runLaunch } from "./journal";
import type { LaunchStep } from "./plan";
import { matchLaunchSubmission } from "./reconciliation";

const mocks = vi.hoisted(() => ({ candidates: vi.fn(), fund: vi.fn(), positions: vi.fn() }));
vi.mock("@/lib/api/v2/launchReconciliationActions", () => ({
  readLaunchSubmissionCandidatesAction: mocks.candidates,
}));
vi.mock("@/lib/api/v2/launchActions", () => ({
  readLaunchFundAction: mocks.fund,
  readLaunchPositionsAction: mocks.positions,
}));
vi.mock("@/lib/api/v2/actions", () => ({}));

const core = "0xa653F620EA8F5539Ed4bB55bE2977262FBa1F2dC";
const manager = `0x${"12".repeat(20)}` as const;
const adapter = `0x${"34".repeat(20)}` as const;
const token = `0x${"56".repeat(20)}` as const;
const key = `0x${"ab".repeat(32)}` as const;
const hash = "0x96f43b187fa38a88b333bbea45804f76aac6088305c216784a68d1399f0f171b";
const transitId = "0xbbb950252f3c4c56b599c30238bd56e9d295c8bc5ce842a58219f49a94323ee3";
const bridgeAbi = parseAbi([
  "event SentToSpoke(bytes32 indexed transitId, uint256 indexed spokeIndex, (uint256 destinationChainId, address bridgeAdapter, address escrow, address inputToken, address outputToken, uint256 amountSent, uint256 amountToArrive, bytes32 bridgeRef, uint64 sentAt, uint32 fillDeadline, uint8 kind, uint8 state) transit, uint256 hubChainId)",
]);
function receipt(log: unknown, overrides: Record<string, unknown> = {}) {
  return {
    status: "success",
    from: manager,
    to: core,
    transactionHash: hash,
    blockNumber: BigInt(511641955),
    logs: [log],
    ...overrides,
  } as unknown as TransactionReceipt;
}
function bridgeLog(amount = BigInt(3800000), spokeIndex = BigInt(0), destination = BigInt(4663)) {
  return {
    address: core,
    topics: encodeEventTopics({
      abi: bridgeAbi,
      eventName: "SentToSpoke",
      args: { transitId, spokeIndex },
    }),
    data: encodeAbiParameters(
      [
        {
          type: "tuple",
          components: [
            { type: "uint256", name: "destinationChainId" },
            { type: "address", name: "bridgeAdapter" },
            { type: "address", name: "escrow" },
            { type: "address", name: "inputToken" },
            { type: "address", name: "outputToken" },
            { type: "uint256", name: "amountSent" },
            { type: "uint256", name: "amountToArrive" },
            { type: "bytes32", name: "bridgeRef" },
            { type: "uint64", name: "sentAt" },
            { type: "uint32", name: "fillDeadline" },
            { type: "uint8", name: "kind" },
            { type: "uint8", name: "state" },
          ],
        },
        { type: "uint256" },
      ],
      [
        {
          destinationChainId: destination,
          bridgeAdapter: adapter,
          escrow: adapter,
          inputToken: token,
          outputToken: token,
          amountSent: amount,
          amountToArrive: amount,
          bridgeRef: key,
          sentAt: BigInt(1791115200),
          fillDeadline: 300,
          kind: 0,
          state: 1,
        },
        BigInt(42161),
      ],
    ),
  };
}
const bridge: LaunchStep = {
  id: "bridge",
  kind: "bridge",
  chain: 42161,
  dependencies: ["allocate"],
  sharePct: 40,
};
const context = {
  vault: core,
  manager,
  fromBlock: BigInt(511641950),
  amount: "3800000",
  adapter,
  tokenIn: token,
  tokenOut: adapter,
  poolKey: key,
};

describe("launch submission event identity [POO-2222 rules-v1]", () => {
  it("R1 recovers Rafael's exact bridge amount, block, hash and transit", () => {
    expect(matchLaunchSubmission(bridge, receipt(bridgeLog()), context)).toMatchObject({
      transitId,
    });
  });
  it.each([
    ["amount", bridgeLog(BigInt(5700000))],
    ["spoke", bridgeLog(BigInt(3800000), BigInt(1))],
    ["chain", bridgeLog(BigInt(3800000), BigInt(0), BigInt(42161))],
    ["emitter", { ...bridgeLog(), address: adapter }],
  ])("R3 rejects a bridge with mismatched %s", (_name, log) => {
    expect(matchLaunchSubmission(bridge, receipt(log), context)).toBeNull();
  });
  it.each([
    { status: "reverted" },
    { from: adapter },
    { blockNumber: BigInt(511641949) },
    { to: adapter },
  ])("R3 rejects unsuccessful, stale, wrong-manager or wrong-target evidence", (overrides) => {
    expect(matchLaunchSubmission(bridge, receipt(bridgeLog(), overrides), context)).toBeNull();
  });
  it("R2 recovers only an exact hub allocation", () => {
    const abi = parseAbi(["event AllocatedToHubSpokeVault(uint256 amount)"]);
    const mined = receipt({
      address: core,
      topics: encodeEventTopics({ abi, eventName: "AllocatedToHubSpokeVault" }),
      data: encodeAbiParameters([{ type: "uint256" }], [BigInt(3800000)]),
    });
    expect(matchLaunchSubmission({ ...bridge, kind: "allocate" }, mined, context)).toMatchObject({
      allocated: "3800000",
      allocatedVault: core,
    });
    expect(
      matchLaunchSubmission({ ...bridge, kind: "allocate" }, mined, { ...context, amount: "1" }),
    ).toBeNull();
  });
  it.each([
    42161, 4663,
  ] as const)("R2 recovers vault swap on chain %s with exact tokens, adapter and spend", (chain) => {
    const abi = parseAbi([
      "event Swapped(address indexed adapter, address indexed tokenIn, address indexed tokenOut, uint256 amountIn, uint256 amountOut, uint256 spotOut, uint16 maxLossBps, uint256 minOut)",
    ]);
    const mined = receipt({
      address: core,
      topics: encodeEventTopics({
        abi,
        eventName: "Swapped",
        args: { adapter, tokenIn: token, tokenOut: adapter },
      }),
      data: encodeAbiParameters(
        [
          { type: "uint256" },
          { type: "uint256" },
          { type: "uint256" },
          { type: "uint16" },
          { type: "uint256" },
        ],
        [BigInt(3800000), BigInt(10), BigInt(10), 100, BigInt(9)],
      ),
    });
    const step = { ...bridge, kind: "swap" as const, chain };
    expect(matchLaunchSubmission(step, mined, context)).toMatchObject({
      swapped: { amountIn: "3800000" },
    });
    expect(matchLaunchSubmission(step, mined, { ...context, tokenOut: token })).toBeNull();
    expect(matchLaunchSubmission(step, mined, { ...context, amount: "1" })).toBeNull();
  });
  it.each([
    42161, 4663,
  ] as const)("R2 recovers open only for the expected adapter and pool on %s", (chain) => {
    const abi = parseAbi([
      "event PositionOpened(address indexed adapter, bytes32 indexed positionKey, bytes32 indexed poolKey, uint256 used0, uint256 used1)",
    ]);
    const mined = receipt({
      address: core,
      topics: encodeEventTopics({
        abi,
        eventName: "PositionOpened",
        args: { adapter, positionKey: key, poolKey: key },
      }),
      data: encodeAbiParameters(
        [{ type: "uint256" }, { type: "uint256" }],
        [BigInt(10), BigInt(0)],
      ),
    });
    expect(matchLaunchSubmission({ ...bridge, kind: "open", chain }, mined, context)).toEqual({
      positionKey: key,
    });
    expect(
      matchLaunchSubmission({ ...bridge, kind: "open", chain }, mined, {
        ...context,
        adapter: token,
      }),
    ).toBeNull();
  });
  it("R2 recovers spoke creation only for this fund, mandate, manager and predicted vault", () => {
    const abi = parseAbi([
      "event SpokeCreated(bytes32 indexed fundId, uint256 indexed chainId, address indexed manager, bytes32 mandateHash, (uint256 chainId, address spokeVault, address uniswapV4Adapter, address aaveV3Adapter, address acrossBridgeAdapter, address uniswapV3SwapAdapter) addresses)",
    ]);
    const mined = receipt({
      address: core,
      topics: encodeEventTopics({
        abi,
        eventName: "SpokeCreated",
        args: { fundId: key, chainId: BigInt(4663), manager },
      }),
      data: encodeAbiParameters(
        [
          { type: "bytes32" },
          {
            type: "tuple",
            components: [
              { type: "uint256", name: "chainId" },
              ...[
                "spokeVault",
                "uniswapV4Adapter",
                "aaveV3Adapter",
                "acrossBridgeAdapter",
                "uniswapV3SwapAdapter",
              ].map((name) => ({ type: "address", name })),
            ],
          },
        ],
        [
          key,
          {
            chainId: BigInt(4663),
            spokeVault: adapter,
            uniswapV4Adapter: adapter,
            aaveV3Adapter: adapter,
            acrossBridgeAdapter: adapter,
            uniswapV3SwapAdapter: adapter,
          },
        ],
      ),
    });
    const identity = { ...context, fundId: key, mandateHash: key, core: adapter };
    const step = { ...bridge, kind: "spoke" as const, chain: 4663 as const };
    expect(matchLaunchSubmission(step, mined, identity)).toEqual({});
    expect(matchLaunchSubmission(step, mined, { ...identity, core: token })).toBeNull();
    expect(matchLaunchSubmission(step, mined, { ...identity, mandateHash: hash })).toBeNull();
  });
  it("R2 recovers approval only for the exact owner, spender and amount", () => {
    const abi = parseAbi([
      "event Approval(address indexed owner, address indexed spender, uint256 value)",
    ]);
    const mined = receipt({
      address: core,
      topics: encodeEventTopics({
        abi,
        eventName: "Approval",
        args: { owner: manager, spender: adapter },
      }),
      data: encodeAbiParameters([{ type: "uint256" }], [BigInt(3800000)]),
    });
    const step = { ...bridge, kind: "approve" as const };
    expect(matchLaunchSubmission(step, mined, { ...context, spender: adapter })).toEqual({});
    expect(matchLaunchSubmission(step, mined, { ...context, spender: token })).toBeNull();
  });
  it("R2 recovers creation only from the predicted Core's seed receipt", () => {
    const abi = parseAbi([
      "event FundSeeded(address indexed manager, uint256 usdcAmount, uint256 flowFee, uint256 shares)",
    ]);
    const mined = receipt({
      address: adapter,
      topics: encodeEventTopics({ abi, eventName: "FundSeeded", args: { manager } }),
      data: encodeAbiParameters(
        [{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }],
        [BigInt(9500000), BigInt(0), BigInt(9)],
      ),
    });
    const step = { ...bridge, kind: "create" as const };
    expect(matchLaunchSubmission(step, mined, { ...context, core: adapter })).toMatchObject({
      seeded: { principal: "9500000", core: adapter },
    });
    expect(matchLaunchSubmission(step, mined, { ...context, core: token })).toBeNull();
  });
  it("R3 refuses ambiguous duplicate matching events", () => {
    expect(
      matchLaunchSubmission(
        bridge,
        receipt(bridgeLog(), { logs: [bridgeLog(), bridgeLog()] }),
        context,
      ),
    ).toBeNull();
  });
});

describe("driver submission recovery [POO-2222 rules-v1]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.candidates.mockResolvedValue({ ok: true, data: { hashes: [hash] } });
  });
  function setupBridge() {
    const journal = createJournal(
      "rafael",
      manager,
      { request: { manager }, review: {} } as FrozenLaunch,
      [{ id: "allocate", kind: "allocate", chain: 42161, dependencies: [], sharePct: 60 }, bridge],
    );
    journal.addresses.coreVault = core;
    journal.principal = "9500000";
    journal.checkpoints.allocate = {
      stepId: "allocate",
      chain: 42161,
      status: "confirmed",
      txHash: key,
    };
    journal.checkpoints.bridge = {
      stepId: "bridge",
      chain: 42161,
      status: "signing",
      error: "SUBMISSION_RECONCILIATION_REQUIRED",
    };
    const wallet = {
      sign: vi.fn(),
      send: vi.fn(),
      receipt: vi.fn(async (_chain: number, transactionHash: string) =>
        transactionHash === key
          ? receipt({}, { transactionHash: key, blockNumber: BigInt(511641950) })
          : receipt(bridgeLog()),
      ),
    };
    return {
      journal,
      wallet,
      driver: createLaunchDriver(wallet),
      checkpoint: journal.checkpoints.bridge!,
    };
  }
  it("R1 automatically confirms Rafael's legacy signing checkpoint from API transit receipt, without resubmission", async () => {
    const { journal, wallet, driver, checkpoint } = setupBridge();
    const storage = { getItem: vi.fn(() => null), setItem: vi.fn() };
    await runLaunch(journal, storage, driver, undefined, undefined, Infinity, true);
    expect(checkpoint).toMatchObject({
      status: "confirmed",
      txHash: hash,
      receiptStatus: "success",
      data: { transitId, receipt: { transitId, blockNumber: "511641955" } },
    });
    expect(mocks.candidates).toHaveBeenCalledTimes(1);
    expect(mocks.candidates).toHaveBeenCalledWith(
      core,
      expect.objectContaining({ mode: "api", fromBlock: "511641950", address: core }),
    );
    expect(wallet.send).not.toHaveBeenCalled();
    expect(JSON.parse(storage.setItem.mock.calls.at(-1)![1]).checkpoints.bridge.txHash).toBe(hash);
  });
  it("R1 falls back to bounded RPC only when API has no matching evidence", async () => {
    const { journal, driver, checkpoint } = setupBridge();
    mocks.candidates.mockResolvedValueOnce({ ok: true, data: { hashes: [] } });
    expect(await driver.reconcile(bridge, checkpoint, journal)).toBe(true);
    expect(mocks.candidates.mock.calls.map((call) => call[1].mode)).toEqual(["api", "rpc"]);
  });
  it.each([
    "none",
    "wrong amount",
    "reverted",
    "ambiguous",
  ])("R3 never resends or confirms %s evidence", async (scenario) => {
    const { journal, driver, wallet, checkpoint } = setupBridge();
    if (scenario === "none") mocks.candidates.mockResolvedValue({ ok: true, data: { hashes: [] } });
    if (scenario === "wrong amount")
      wallet.receipt.mockImplementation(async (_chain, tx) =>
        tx === key
          ? receipt({}, { transactionHash: key, blockNumber: BigInt(511641950) })
          : receipt(bridgeLog(BigInt(5700000))),
      );
    if (scenario === "reverted")
      wallet.receipt.mockImplementation(async (_chain, tx) =>
        tx === key
          ? receipt({}, { transactionHash: key, blockNumber: BigInt(511641950) })
          : receipt(bridgeLog(), { status: "reverted" }),
      );
    if (scenario === "ambiguous") {
      mocks.candidates.mockResolvedValue({ ok: true, data: { hashes: [hash, transitId] } });
      wallet.receipt.mockImplementation(async (_chain, tx) =>
        tx === key
          ? receipt({}, { transactionHash: key, blockNumber: BigInt(511641950) })
          : receipt(bridgeLog(), { transactionHash: tx }),
      );
    }
    await expect(driver.reconcile(bridge, checkpoint, journal)).rejects.toThrow(
      "SUBMISSION_RECONCILIATION_REQUIRED",
    );
    expect(checkpoint.txHash).toBeUndefined();
    expect(wallet.send).not.toHaveBeenCalled();
  });
  it("R4 persists a wallet-returned hash before signature analytics throws", async () => {
    const { wallet } = setupBridge();
    wallet.send.mockResolvedValue(hash);
    const submitted = vi.fn();
    const driver = createLaunchDriver(wallet, () => {
      expect(submitted).toHaveBeenCalledWith(hash);
      throw new Error("ANALYTICS_FAILED");
    });
    await expect(
      driver.send(
        bridge,
        { from: manager, to: core, chainId: 42161, value: "0", data: "0x1234" },
        submitted,
      ),
    ).rejects.toThrow("ANALYTICS_FAILED");
  });
});
