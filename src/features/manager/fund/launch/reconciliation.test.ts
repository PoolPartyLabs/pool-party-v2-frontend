import {
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionData,
  parseAbi,
  type TransactionReceipt,
} from "viem";
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
    expect(
      matchLaunchSubmission(bridge, receipt(bridgeLog()), { ...context, tokenOut: token }),
    ).toMatchObject({
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
    const allocationAbi = parseAbi(["event AllocatedToHubSpokeVault(uint256 amount)"]);
    const allocationReceipt = () =>
      receipt(
        {
          address: core,
          topics: encodeEventTopics({ abi: allocationAbi, eventName: "AllocatedToHubSpokeVault" }),
          data: encodeAbiParameters([{ type: "uint256" }], [BigInt(5700000)]),
        },
        { transactionHash: key, blockNumber: BigInt(511641950) },
      );
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
    journal.checkpoints.create = {
      stepId: "create",
      chain: 42161,
      status: "confirmed",
      data: {
        provision: {
          mandate: {
            usdc: token,
            spokes: [{ chainId: "4663", spokeToken: token }],
            bridgeAdapters: [{ chainId: "42161", spokeChainId: "4663", adapter }],
          },
        },
      },
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
        transactionHash === key ? allocationReceipt() : receipt(bridgeLog()),
      ),
      transaction: vi.fn(async () => ({
        from: manager,
        to: core,
        input: encodeFunctionData({
          abi: parseAbi([
            "function sendToSpoke(uint256 spokeIndex, uint256 usdcAmount, uint256 bridgeRank, bytes bridgeData) returns (bytes32 transitId)",
          ]),
          functionName: "sendToSpoke",
          args: [BigInt(0), BigInt(3800000), BigInt(0), "0x"],
        }),
        value: BigInt(0),
      })),
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
  it("R3 refuses a unique readable match when another candidate receipt is unavailable", async () => {
    const { driver, journal, wallet, checkpoint } = setupBridge();
    mocks.candidates.mockResolvedValue({ ok: true, data: { hashes: [hash, transitId] } });
    const read = wallet.receipt.getMockImplementation()!;
    wallet.receipt.mockImplementation(async (chain, tx) =>
      tx === transitId ? (null as unknown as TransactionReceipt) : read(chain, tx),
    );
    await expect(driver.reconcile(bridge, checkpoint, journal)).rejects.toThrow(
      "SUBMISSION_RECONCILIATION_REQUIRED",
    );
    expect(checkpoint.txHash).toBeUndefined();
  });
  it("R3 rejects legacy bridge recovery with an unrelated allocation boundary", async () => {
    const { driver, journal, wallet, checkpoint } = setupBridge();
    wallet.receipt.mockResolvedValue(receipt(bridgeLog(), { transactionHash: key }));
    await expect(driver.reconcile(bridge, checkpoint, journal)).rejects.toThrow(
      "SUBMISSION_RECONCILIATION_REQUIRED",
    );
    expect(checkpoint.txHash).toBeUndefined();
  });
  it("R3 never falls back to older creation evidence when the allocation receipt is invalid", async () => {
    const { driver, journal, wallet, checkpoint } = setupBridge();
    journal.steps.unshift({ id: "create", kind: "create", chain: 42161, dependencies: [] });
    journal.steps.find((step) => step.id === "allocate")!.dependencies = ["create"];
    journal.checkpoints.create!.txHash = transitId;
    wallet.receipt.mockImplementation(async (_chain, tx) =>
      tx === transitId
        ? receipt({}, { transactionHash: transitId, blockNumber: BigInt(511641900) })
        : receipt(bridgeLog(), { transactionHash: tx }),
    );
    await expect(driver.reconcile(bridge, checkpoint, journal)).rejects.toThrow(
      "SUBMISSION_RECONCILIATION_REQUIRED",
    );
    expect(checkpoint.txHash).toBeUndefined();
    expect(wallet.send).not.toHaveBeenCalled();
  });
  it("R3 rejects a legacy bridge transaction with another bridge rank or calldata", async () => {
    const { driver, journal, wallet, checkpoint } = setupBridge();
    wallet.transaction.mockResolvedValue({
      from: manager,
      to: core,
      input: encodeFunctionData({
        abi: parseAbi([
          "function sendToSpoke(uint256 spokeIndex, uint256 usdcAmount, uint256 bridgeRank, bytes bridgeData) returns (bytes32 transitId)",
        ]),
        functionName: "sendToSpoke",
        args: [BigInt(0), BigInt(3800000), BigInt(1), "0x"],
      }),
      value: BigInt(0),
    });
    await expect(driver.reconcile(bridge, checkpoint, journal)).rejects.toThrow(
      "SUBMISSION_RECONCILIATION_REQUIRED",
    );
    expect(checkpoint.txHash).toBeUndefined();
  });

  function savedStep(kind: LaunchStep["kind"], chain: 42161 | 4663 = 42161) {
    const { journal, wallet, driver } = setupBridge();
    const step: LaunchStep = {
      ...bridge,
      id: "saved",
      kind,
      chain,
      dependencies: [],
      protocol: "uniswap-v4",
      config: { poolId: key },
    };
    const target = core;
    let data = "0x1234";
    let log: unknown = bridgeLog();
    const provision = {
      predictedAddresses: {
        coreVault: adapter,
        fundId: key,
        chains: [{ chainId: "4663", spokeVault: adapter }],
      },
      mandateHash: key,
    };
    if (kind === "allocate") {
      const abi = parseAbi(["event AllocatedToHubSpokeVault(uint256 amount)"]);
      log = {
        address: core,
        topics: encodeEventTopics({ abi, eventName: "AllocatedToHubSpokeVault" }),
        data: encodeAbiParameters([{ type: "uint256" }], [BigInt(3800000)]),
      };
    }
    if (kind === "approve") {
      data = encodeFunctionData({
        abi: parseAbi(["function approve(address spender, uint256 value) returns (bool)"]),
        functionName: "approve",
        args: [adapter, BigInt(3800000)],
      });
      const abi = parseAbi([
        "event Approval(address indexed owner, address indexed spender, uint256 value)",
      ]);
      log = {
        address: core,
        topics: encodeEventTopics({
          abi,
          eventName: "Approval",
          args: { owner: manager, spender: adapter },
        }),
        data: encodeAbiParameters([{ type: "uint256" }], [BigInt(3800000)]),
      };
    }
    if (kind === "create") {
      const abi = parseAbi([
        "event FundSeeded(address indexed manager, uint256 usdcAmount, uint256 flowFee, uint256 shares)",
      ]);
      log = {
        address: adapter,
        topics: encodeEventTopics({ abi, eventName: "FundSeeded", args: { manager } }),
        data: encodeAbiParameters(
          [{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }],
          [BigInt(9500000), BigInt(0), BigInt(9)],
        ),
      };
    }
    if (kind === "spoke") {
      const abi = parseAbi([
        "event SpokeCreated(bytes32 indexed fundId, uint256 indexed chainId, address indexed manager, bytes32 mandateHash, (uint256 chainId, address spokeVault, address uniswapV4Adapter, address aaveV3Adapter, address acrossBridgeAdapter, address uniswapV3SwapAdapter) addresses)",
      ]);
      log = {
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
      };
    }
    if (kind === "swap") {
      data = encodeFunctionData({
        abi: parseAbi([
          "function swap(address swapAdapter, address tokenIn, address tokenOut, uint256 amountIn, uint16 maxLossBps, bytes route) returns (uint256 amountOut)",
        ]),
        functionName: "swap",
        args: [adapter, token, adapter, BigInt(3800000), 100, "0x"],
      });
      const abi = parseAbi([
        "event Swapped(address indexed adapter, address indexed tokenIn, address indexed tokenOut, uint256 amountIn, uint256 amountOut, uint256 spotOut, uint16 maxLossBps, uint256 minOut)",
      ]);
      log = {
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
      };
    }
    if (kind === "open") {
      const abi = parseAbi([
        "event PositionOpened(address indexed adapter, bytes32 indexed positionKey, bytes32 indexed poolKey, uint256 used0, uint256 used1)",
      ]);
      log = {
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
      };
      mocks.positions.mockResolvedValue({
        ok: true,
        data: { positions: [{ chainId: chain, positionKey: key, status: "open" }] },
      });
    }
    mocks.fund.mockResolvedValue({
      ok: true,
      data: {
        chains: [
          {
            chainId: String(chain),
            spokeVault: core,
            uniswapV4Adapter: adapter,
            aaveV3Adapter: adapter,
          },
        ],
      },
    });
    journal.steps = [step];
    journal.checkpoints = {
      create: { stepId: "create", chain: 42161, status: "confirmed", data: { provision } },
    };
    const built = { from: manager, to: target, chainId: chain, data, value: "0" };
    const checkpoint = {
      stepId: step.id,
      chain,
      status: "signing" as const,
      data: { provision, submission: { fromBlock: "511641950", transaction: built } },
    };
    journal.checkpoints[step.id] = checkpoint;
    wallet.receipt.mockResolvedValue(receipt(log));
    const transaction = vi.fn(async () => ({
      from: manager,
      to: target,
      input: data,
      value: BigInt(0),
    }));
    Object.assign(wallet, { transaction });
    return { step, journal, driver, checkpoint, transaction, wallet };
  }
  it.each([
    ["approve", 42161],
    ["create", 42161],
    ["spoke", 4663],
    ["allocate", 42161],
    ["bridge", 42161],
    ["swap", 42161],
    ["swap", 4663],
    ["open", 42161],
    ["open", 4663],
  ] as const)("R2 recovers saved %s on %s through full driver identity and calldata validation", async (kind, chain) => {
    const { step, journal, driver, checkpoint, transaction, wallet } = savedStep(kind, chain);
    expect(await driver.reconcile(step, checkpoint, journal)).toBe(true);
    expect(checkpoint).toMatchObject({ txHash: hash, receiptStatus: "success" });
    expect(transaction).toHaveBeenCalledWith(chain, hash);
    expect(wallet.send).not.toHaveBeenCalled();
  });
  it.each([
    { from: adapter },
    { to: adapter },
    { input: "0x9876" },
    { value: BigInt(1) },
  ])("R3 rejects each mismatched saved transaction identity field", async (mismatch) => {
    const { step, journal, driver, checkpoint, transaction } = savedStep("bridge");
    transaction.mockResolvedValue({
      from: manager,
      to: core,
      input: "0x1234",
      value: BigInt(0),
      ...mismatch,
    });
    await expect(driver.reconcile(step, checkpoint, journal)).rejects.toThrow(
      "SUBMISSION_RECONCILIATION_REQUIRED",
    );
    expect(checkpoint).not.toHaveProperty("txHash");
  });
  it("R3 refuses a readable matching receipt when another matching calldata lookup is unavailable", async () => {
    const { step, journal, driver, checkpoint, transaction, wallet } = savedStep("bridge");
    mocks.candidates.mockResolvedValue({ ok: true, data: { hashes: [hash, transitId] } });
    wallet.receipt.mockImplementation(async (_chain, tx) =>
      receipt(bridgeLog(), { transactionHash: tx }),
    );
    transaction
      .mockResolvedValueOnce({ from: manager, to: core, input: "0x1234", value: BigInt(0) })
      .mockResolvedValueOnce(null as never);
    await expect(driver.reconcile(step, checkpoint, journal)).rejects.toThrow(
      "SUBMISSION_RECONCILIATION_REQUIRED",
    );
    expect(checkpoint).not.toHaveProperty("txHash");
  });
});
