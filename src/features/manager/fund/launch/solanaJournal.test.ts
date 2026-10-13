import { beforeEach, expect, it, vi } from "vitest";
import { solanaBootstrapDigest } from "@/lib/solana/binding";
import { bootstrapChunks } from "@/lib/solana/bootstrap";
import {
  bootstrapAuthorizationFixture,
  bootstrapManifestFixture,
} from "@/lib/solana/bootstrap.fixture";
import { SOLANA_LP_CHOICES } from "@/lib/solana/lpChoices";
import {
  createJournal,
  journalKey,
  type LaunchDriver,
  loadJournal,
  runLaunch,
  saveJournal,
} from "./journal";
import type { LaunchStep, SolanaLaunchStep } from "./plan";
import { createChainLaunchDriver, type SolanaLaunchBackend } from "./solanaDriver";
import { withSolanaLaunchSteps as buildSteps } from "./solanaPlan";

const withSolanaLaunchSteps: typeof buildSteps = (steps, selection) =>
  buildSteps(steps, selection, bootstrapManifestFixture);

vi.mock("@/lib/features", () => ({ isFeatureEnabled: () => true }));
const legacy =
  '{"version":1,"draftId":"fixture","manager":"0xmanager","frozen":{"seed":"100"},"steps":[{"id":"create","kind":"create","chain":42161,"dependencies":[]},{"id":"spoke","kind":"spoke","chain":4663,"dependencies":["create"]}],"checkpoints":{"create":{"stepId":"create","chain":42161,"status":"submitted","txHash":"0xhash","receiptStatus":"unknown","submissionAttempted":true}},"addresses":{}}';
function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}
const svm: SolanaLaunchStep = {
  id: "solana:init",
  kind: "init-solana",
  chain: "solana:mainnet",
  chainKind: "svm",
  group: "solana",
  dependencies: [],
};
function driver(): LaunchDriver {
  return {
    build: vi.fn(async () => ({ transaction: {} })),
    send: vi.fn(async () => "signature"),
    receipt: vi.fn(async () => ({ status: "unknown" as const })),
    reconcile: vi.fn(async () => false),
    complete: vi.fn(async () => {}),
  };
}
beforeEach(() => vi.clearAllMocks());
it("loads and resumes a serialized version-1 journal without chain metadata", async () => {
  const store = storage();
  store.setItem("pp:v2:launch:1:0xmanager:fixture", legacy);
  const journal = loadJournal(store, "fixture", "0xManager");
  expect(journal?.checkpoints.create?.txHash).toBe("0xhash");
  expect(journalKey("fixture", "0xManager")).toBe("pp:v2:launch:1:0xmanager:fixture");
  const wallet = driver();
  if (!journal) throw new Error("FIXTURE_MISSING");
  await runLaunch(journal, store, wallet, undefined, undefined, 1);
  expect(wallet.build).not.toHaveBeenCalled();
  expect(wallet.send).not.toHaveBeenCalled();
});
it("round-trips an SVM signature in the same version and key namespace", () => {
  const store = storage();
  const journal = createJournal("svm", "0xManager", {}, [svm]);
  journal.checkpoints[svm.id] = {
    stepId: svm.id,
    chain: svm.chain,
    chainKind: "svm",
    status: "submitted",
    txHash: "signature",
  };
  saveJournal(store, journal);
  expect(loadJournal(store, "svm", "0xManager")).toEqual(journal);
});
it("persists before broadcast and resumes an uncertain SVM send only by signature", async () => {
  const store = storage();
  const journal = createJournal("svm", "0xManager", {}, [svm]);
  const wallet = driver();
  vi.mocked(wallet.send).mockImplementation(async (_step, _tx, submitted) => {
    submitted?.("signature");
    expect(loadJournal(store, "svm", "0xManager")?.checkpoints[svm.id]?.txHash).toBe("signature");
    throw new Error("NETWORK_FAILED");
  });
  await runLaunch(journal, store, wallet);
  const recovered = loadJournal(store, "svm", "0xManager");
  if (!recovered) throw new Error("JOURNAL_MISSING");
  await runLaunch(recovered, store, wallet);
  expect(wallet.send).toHaveBeenCalledTimes(1);
  expect(wallet.build).toHaveBeenCalledTimes(1);
  expect(wallet.receipt).toHaveBeenCalledWith("solana:mainnet", "signature");
  vi.mocked(wallet.receipt).mockResolvedValue({ status: "success" });
  await runLaunch(recovered, store, wallet);
  expect(recovered.checkpoints[svm.id]?.status).toBe("confirmed");
});
it("rejects chain-kind tampering", () => {
  const store = storage();
  const journal = createJournal("svm", "0xManager", {}, [svm]);
  store.setItem(
    journalKey("svm", "0xManager"),
    JSON.stringify({ ...journal, steps: [{ ...svm, chainKind: "evm" }] }),
  );
  expect(() => loadJournal(store, "svm", "0xManager")).toThrow("INVALID_JOURNAL");
});
it("combines Hub, Robinhood and Solana without replacing EVM steps", () => {
  const evm: LaunchStep[] = [
    { id: "create", kind: "create", chain: 42161, dependencies: [] },
    { id: "discover-hub", kind: "discover", chain: 42161, dependencies: ["create"] },
    { id: "spoke", kind: "spoke", chain: 4663, dependencies: ["discover-hub"] },
    { id: "profile", kind: "profile", chain: 42161, dependencies: ["spoke"] },
    { id: "allocate", kind: "allocate", chain: 42161, dependencies: ["profile"], sharePct: 30 },
    { id: "bridge", kind: "bridge", chain: 42161, dependencies: ["profile"], sharePct: 30 },
  ];
  const plan = withSolanaLaunchSteps(evm, {
    sharePct: 40,
    kamino: true,
    raydiumPool: SOLANA_LP_CHOICES[0]?.poolId,
    maxPriceImpactBps: 100,
  });
  expect(plan.find((step) => step.id === "spoke")).toMatchObject(evm[2] ?? {});
  expect(plan.find((step) => step.id === "create")?.dependencies).toContain("solana:bind");
  expect(plan.find((step) => step.kind === "raydium-open")?.dependencies).toEqual(["solana:ratio"]);
  expect(new Set(plan.map((step) => step.chain))).toEqual(new Set([42161, 4663, "solana:mainnet"]));
  expect(() => withSolanaLaunchSteps(evm, { sharePct: 41, kamino: true })).toThrow(
    "INVALID_ALLOCATION",
  );
});

it.each([
  "stage-solana-config",
  "seal-solana-config",
  "init-solana",
] as const)("reconciles an unknown submitted %s through the real chain driver without replacement", async (kind) => {
  const managerSolana = "11111111111111111111111111111111";
  const chunk = bootstrapChunks(bootstrapManifestFixture)[kind === "seal-solana-config" ? 2 : 0];
  if (!chunk) throw new Error("FIXTURE_MISSING");
  const step: SolanaLaunchStep = {
    ...svm,
    id:
      kind === "init-solana"
        ? svm.id
        : kind === "seal-solana-config"
          ? "solana:seal"
          : "solana:stage:0",
    kind,
    ...(kind !== "init-solana" ? { bootstrapChunk: chunk } : {}),
  };
  const store = storage();
  const journal = createJournal(
    "recovery",
    "manager",
    {
      solanaBootstrap: bootstrapManifestFixture,
      solanaBinding: {
        solanaAddress: managerSolana,
        bootstrapAuthorization: bootstrapAuthorizationFixture,
        bootstrapSignature: "0x01",
      },
    },
    [step],
  );
  journal.checkpoints[step.id] = {
    stepId: step.id,
    chain: step.chain,
    chainKind: "svm",
    status: "submitted",
    txHash: "persisted-signature",
    submissionAttempted: true,
    receiptStatus: "unknown",
  };
  saveJournal(store, journal);
  const recovered = loadJournal(store, "recovery", "manager");
  if (!recovered) throw new Error("FIXTURE_MISSING");
  const state = {
    policyHash: bootstrapManifestFixture.policyHash,
    fundPda: bootstrapAuthorizationFixture.fundPda,
    managerSolana,
    totalLength: 1250,
    payload: kind === "stage-solana-config" ? chunk.chunk : bootstrapManifestFixture.payload,
    sealed: kind !== "stage-solana-config",
    initialized: kind === "init-solana",
    bootstrapDigest: solanaBootstrapDigest(managerSolana, bootstrapAuthorizationFixture),
  };
  const backend: SolanaLaunchBackend = {
    bootstrapState: vi.fn(async () => state),
    validateTransactionIntent: vi.fn(),
    build: vi.fn(),
    credited: vi.fn(),
    reportReady: vi.fn(),
    attestation: vi.fn(),
    receiveAndCredit: vi.fn(),
    complete: vi.fn(),
  };
  const sign = vi.fn();
  const rpc = {
    genesisHash: vi.fn(async () => "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp"),
    latestBlockhash: vi.fn(),
    send: vi.fn(),
    status: vi.fn(async () => "unknown" as const),
  };
  const chain = createChainLaunchDriver({
    evm: driver(),
    solanaAddress: managerSolana,
    rpc,
    backend,
    signTransaction: sign,
    verifyBinding: vi.fn(async () => {}),
  });
  const build = vi.spyOn(chain, "build");
  const send = vi.spyOn(chain, "send");
  const reconcile = vi.spyOn(chain, "reconcile");
  await runLaunch(recovered, store, chain, undefined, undefined, 1, true);
  expect(recovered.checkpoints[step.id]).toMatchObject({
    status: "confirmed",
    txHash: "persisted-signature",
    submissionAttempted: true,
    receiptStatus: "unknown",
  });
  expect(reconcile).toHaveBeenCalledOnce();
  expect(backend.complete).toHaveBeenCalledOnce();
  expect(build).not.toHaveBeenCalled();
  expect(send).not.toHaveBeenCalled();
  expect(backend.build).not.toHaveBeenCalled();
  expect(sign).not.toHaveBeenCalled();
  expect(rpc.send).not.toHaveBeenCalled();
  expect(loadJournal(store, "recovery", "manager")?.checkpoints[step.id]?.txHash).toBe(
    "persisted-signature",
  );
  const checkpoint = recovered.checkpoints[step.id];
  const bootstrapState = backend.bootstrapState;
  if (!checkpoint || !bootstrapState) throw new Error("FIXTURE_MISSING");
  for (const evidence of [null, { ...state, policyHash: `0x${"ff".repeat(32)}` }]) {
    checkpoint.status = "submitted";
    vi.mocked(bootstrapState).mockResolvedValue(evidence);
    await runLaunch(recovered, store, chain);
    expect(recovered.checkpoints[step.id]?.status).not.toBe("confirmed");
    expect(recovered.checkpoints[step.id]?.txHash).toBe("persisted-signature");
    expect(build).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(sign).not.toHaveBeenCalled();
  }
});
