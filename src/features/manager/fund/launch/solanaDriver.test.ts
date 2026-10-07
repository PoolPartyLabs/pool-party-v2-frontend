import { beforeEach, expect, it, vi } from "vitest";
import { SOLANA_LP_CHOICES } from "@/lib/solana/lpChoices";
import type { SolanaApiSignedQuote } from "@/lib/solana/swap";
import { createJournal, type LaunchDriver } from "./journal";
import type { LaunchStep, SolanaLaunchStep } from "./plan";
import {
  createChainLaunchDriver,
  retrySolanaReceive,
  type SolanaLaunchBackend,
} from "./solanaDriver";

const flags = vi.hoisted(() => ({ enabled: true }));
const transport = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("@/lib/features", () => ({ isFeatureEnabled: () => flags.enabled }));
vi.mock("@/lib/solana/transaction", () => ({ sendSolanaTransaction: transport.send }));
const arrival: SolanaLaunchStep = {
  id: "solana:arrival",
  kind: "solana-arrival",
  chain: "solana:mainnet",
  chainKind: "svm",
  group: "solana",
  dependencies: [],
};
function setup() {
  const evm: LaunchDriver<LaunchStep> = {
    build: vi.fn(async () => ({ complete: true })),
    send: vi.fn(async () => "0xhash"),
    receipt: vi.fn(async () => ({ status: "success" as const })),
    reconcile: vi.fn(async () => false),
    complete: vi.fn(async () => {}),
  };
  const backend: SolanaLaunchBackend = {
    build: vi.fn(async () => new Uint8Array()),
    credited: vi.fn(async () => ({ credited: false })),
    reportReady: vi.fn(async () => false),
    attestation: vi.fn(async () => ({ message: "0x01", attestation: "0x02" })),
    receiveAndCredit: vi.fn(async () => {}),
    complete: vi.fn(async () => {}),
  };
  const rpc = {
    genesisHash: vi.fn(async () => "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp"),
    latestBlockhash: vi.fn(),
    send: vi.fn(),
    status: vi.fn(async () => "unknown" as const),
  };
  const driver = createChainLaunchDriver({
    evm,
    backend,
    rpc,
    solanaAddress: "key",
    signTransaction: vi.fn(),
    verifyBinding: vi.fn(async () => {}),
  });
  return { driver, evm, backend, rpc, journal: createJournal("fund", "manager", {}, [arrival]) };
}
beforeEach(() => {
  flags.enabled = true;
  transport.send.mockReset();
  transport.send.mockImplementation(async (input) => {
    await input.build({ blockhash: "fresh", lastValidBlockHeight: BigInt(10) });
    return "signature";
  });
});
it("delegates EVM steps unchanged", async () => {
  const { driver, evm, journal } = setup();
  const step: LaunchStep = { id: "spoke", kind: "spoke", chain: 4663, dependencies: [] };
  await driver.build(step, journal);
  expect(evm.build).toHaveBeenCalledWith(step, journal);
});
it("keeps arrival pending until credit evidence exists", async () => {
  const { driver, backend, journal } = setup();
  expect((await driver.build(arrival, journal)).complete).toBe(false);
  vi.mocked(backend.credited).mockResolvedValue({ credited: true, amount: "49990000" });
  expect(await driver.build(arrival, journal)).toMatchObject({
    complete: true,
    data: { credited: "49990000" },
  });
});
it("does not accept a mint or credit boolean without an amount", async () => {
  const { driver, backend, journal } = setup();
  vi.mocked(backend.credited).mockResolvedValue({ credited: true });
  await expect(driver.build(arrival, journal)).rejects.toThrow("SOLANA_CREDIT_EVIDENCE_REQUIRED");
});
it("manual receive uses API evidence but does not mark arrival confirmed", async () => {
  const { backend, journal } = setup();
  await retrySolanaReceive(backend, journal);
  expect(backend.receiveAndCredit).toHaveBeenCalledWith(journal, {
    message: "0x01",
    attestation: "0x02",
  });
  expect(journal.checkpoints).toEqual({});
});
it("rejects unavailable attestations without receiving", async () => {
  const { backend, journal } = setup();
  vi.mocked(backend.attestation).mockResolvedValue({ message: "", attestation: "PENDING" });
  await expect(retrySolanaReceive(backend, journal)).rejects.toThrow("CCTP_ATTESTATION_REQUIRED");
  expect(backend.receiveAndCredit).not.toHaveBeenCalled();
});
it("looks up historical SVM signatures rather than EVM receipts", async () => {
  const { driver, evm, rpc } = setup();
  expect(await driver.receipt("solana:mainnet", "signature")).toEqual({ status: "unknown" });
  expect(rpc.status).toHaveBeenCalledWith("signature");
  expect(evm.receipt).not.toHaveBeenCalled();
});
it("fails closed when the feature flag is off", async () => {
  flags.enabled = false;
  const { driver, journal } = setup();
  await expect(driver.build(arrival, journal)).rejects.toThrow("SOLANA_DISABLED");
});

function swapSetup() {
  const state = setup();
  const pool = SOLANA_LP_CHOICES[0];
  if (!pool) throw new Error("FIXTURE_MISSING");
  const step: SolanaLaunchStep = {
    ...arrival,
    id: "solana:ratio",
    kind: "swap-to-ratio",
    config: { poolId: pool.poolId, maxPriceImpactBps: 100 },
  };
  const fund = "0x1111111111111111111111111111111111111111";
  const quote: SolanaApiSignedQuote = {
    version: 1,
    poolId: pool.poolId,
    fund,
    solanaAddress: "key",
    maxPriceImpactBps: 100,
    tokenIn: pool.tokens[1].mint,
    tokenOut: pool.tokens[0].mint,
    amountIn: "1000000",
    minAmountOut: "99",
    referenceAmountOut: "100",
    priceImpactBps: 100,
    expiresAt: 2000000000,
    signedPayload: "0x01",
    signature: "0x02",
  };
  state.journal.frozen = {
    solanaBinding: { manager: "manager", solanaAddress: "key", authorization: { fund } },
    solanaSelection: { raydiumPool: pool.poolId, maxPriceImpactBps: 100 },
  };
  state.backend.quoteSwap = vi.fn(async () => quote);
  state.backend.referencePrice = vi.fn(async () => ({
    status: "available",
    expiresAt: 2000000000,
    marketOpen: true,
  }));
  state.backend.verifySwapQuote = vi.fn(async () => true);
  return { ...state, step, quote };
}
it("fetches and verifies the API quote immediately before building the unsigned swap", async () => {
  const { driver, backend, journal, step, quote } = swapSetup();
  await driver.build(step, journal);
  expect(backend.quoteSwap).not.toHaveBeenCalled();
  await driver.send(step, {}, vi.fn());
  expect(backend.verifySwapQuote).toHaveBeenCalledBefore(vi.mocked(backend.build));
  expect(backend.build).toHaveBeenCalledWith(
    step,
    journal,
    { blockhash: "fresh", lastValidBlockHeight: BigInt(10) },
    quote,
  );
});
it.each([
  "missing",
  "stale",
  "closed",
])("blocks %s oracle data before swap building", async (failure) => {
  const { driver, backend, journal, step } = swapSetup();
  if (failure === "missing") backend.referencePrice = undefined;
  else
    backend.referencePrice = vi.fn(async () => ({
      status: "available",
      expiresAt: failure === "stale" ? 1 : 2000000000,
      marketOpen: failure !== "closed",
    }));
  await driver.build(step, journal);
  await expect(driver.send(step, {}, vi.fn())).rejects.toThrow();
  expect(backend.quoteSwap).not.toHaveBeenCalled();
  expect(backend.build).not.toHaveBeenCalled();
});

it("refuses an edited LP-open pool before building or signing", async () => {
  const { driver, backend, journal, step } = swapSetup();
  step.kind = "raydium-open";
  if (step.config) step.config.poolId = SOLANA_LP_CHOICES[1]?.poolId;
  await driver.build(step, journal);
  await expect(driver.send(step, {}, vi.fn())).rejects.toThrow("SOLANA_API_QUOTE_REQUIRED");
  expect(backend.build).not.toHaveBeenCalled();
});

it("builds the frozen LP-open selection without requesting a swap quote", async () => {
  const { driver, backend, journal, step } = swapSetup();
  step.kind = "raydium-open";
  backend.quoteSwap = undefined;
  backend.verifySwapQuote = undefined;
  await driver.build(step, journal);
  await driver.send(step, {}, vi.fn());
  expect(backend.build).toHaveBeenCalledWith(
    step,
    journal,
    { blockhash: "fresh", lastValidBlockHeight: BigInt(10) },
    undefined,
  );
});

it("prevents mutation of the verified quote during transaction building", async () => {
  const { driver, backend, journal, step } = swapSetup();
  vi.mocked(backend.build).mockImplementation(async (_step, _journal, _lifetime, quote) => {
    if (quote) quote.amountIn = "999999999";
    return new Uint8Array();
  });
  await driver.build(step, journal);
  await expect(driver.send(step, {}, vi.fn())).rejects.toThrow(TypeError);
});
it.each([
  "missing",
  "signature",
  "impact",
  "expiry",
  "tampered-plan",
  "rate-limit",
])("fails closed on %s without building or signing the swap", async (failure) => {
  const { driver, backend, journal, step, quote } = swapSetup();
  if (failure === "missing") backend.quoteSwap = undefined;
  if (failure === "signature" && backend.verifySwapQuote)
    vi.mocked(backend.verifySwapQuote).mockResolvedValue(false);
  if (failure === "impact") quote.priceImpactBps = 101;
  if (failure === "expiry") quote.expiresAt = 1;
  if (failure === "tampered-plan" && step.config) step.config.maxPriceImpactBps = 200;
  if (failure === "rate-limit" && backend.quoteSwap)
    vi.mocked(backend.quoteSwap).mockRejectedValue(new Error("SOLANA_API_RATE_LIMITED"));
  await driver.build(step, journal);
  await expect(driver.send(step, {}, vi.fn())).rejects.toThrow();
  expect(backend.build).not.toHaveBeenCalled();
});
