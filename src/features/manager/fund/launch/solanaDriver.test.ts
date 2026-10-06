import { beforeEach, expect, it, vi } from "vitest";
import { createJournal, type LaunchDriver } from "./journal";
import type { LaunchStep, SolanaLaunchStep } from "./plan";
import {
  createChainLaunchDriver,
  retrySolanaReceive,
  type SolanaLaunchBackend,
} from "./solanaDriver";

const flags = vi.hoisted(() => ({ enabled: true }));
vi.mock("@/lib/features", () => ({ isFeatureEnabled: () => flags.enabled }));
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
    genesisHash: vi.fn(async () => "mainnet"),
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
