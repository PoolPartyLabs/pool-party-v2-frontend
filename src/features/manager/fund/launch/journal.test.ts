import { describe, expect, it, vi } from "vitest";
import { createJournal, type LaunchDriver, loadJournal, runLaunch } from "./journal";
import type { LaunchStep } from "./plan";

const steps: LaunchStep[] = [
  { id: "create", kind: "create", chain: 42161, dependencies: [] },
  { id: "discover-hub", kind: "discover", chain: 42161, dependencies: ["create"] },
  { id: "leaf", kind: "open", chain: 42161, dependencies: ["discover-hub"] },
];
const setup = () => {
  const storage = {
    value: null as string | null,
    getItem: () => storage.value,
    setItem: (_key: string, value: string) => {
      storage.value = value;
    },
  };
  const journal = createJournal("draft", "0xManager", { seed: "100" }, steps);
  const driver: LaunchDriver = {
    build: vi.fn(async (step) =>
      step.kind === "discover" ? { complete: true } : { transaction: {} },
    ),
    send: vi.fn(async () => "0xhash"),
    receipt: vi.fn(async () => ({ status: "success" as const })),
    reconcile: vi.fn(async () => false),
    complete: vi.fn(async () => {}),
  };
  return { storage, journal, driver };
};

describe("launch checkpoint state machine [R3, R6]", () => {
  it("persists the submitted hash before signature analytics can throw", async () => {
    const { journal, storage, driver } = setup();
    vi.mocked(driver.send).mockImplementation(async (_step, _transaction, onSubmitted) => {
      onSubmitted?.("0xhash");
      expect(loadJournal(storage, "draft", "0xManager")?.checkpoints.create).toMatchObject({
        status: "submitted",
        txHash: "0xhash",
        receiptStatus: "unknown",
        submissionAttempted: true,
      });
      throw new Error("ANALYTICS_FAILED");
    });
    await runLaunch(journal, storage, driver);
    const recovered = loadJournal(storage, "draft", "0xManager");
    if (!recovered) throw new Error("missing journal");
    await runLaunch(recovered, storage, driver, undefined, undefined, 1);
    expect(driver.send).toHaveBeenCalledTimes(1);
    expect(recovered.checkpoints.create?.status).toBe("confirmed");
  });
  it("persists a hash returned after cancellation without querying receipts", async () => {
    const { journal, storage, driver } = setup();
    const controller = new AbortController();
    vi.mocked(driver.send).mockImplementation(async (_step, _transaction, onSubmitted) => {
      controller.abort();
      onSubmitted?.("0xhash");
      return "0xhash";
    });
    await runLaunch(journal, storage, driver, undefined, controller.signal);
    expect(loadJournal(storage, "draft", "0xManager")?.checkpoints.create).toMatchObject({
      status: "submitted",
      txHash: "0xhash",
    });
    expect(driver.receipt).not.toHaveBeenCalled();
    expect(driver.complete).not.toHaveBeenCalled();
  });
  it("persists an attempted send before the wallet can fail without a hash", async () => {
    const { journal, storage, driver } = setup();
    vi.mocked(driver.send).mockImplementation(async () => {
      expect(loadJournal(storage, "draft", "0xManager")?.checkpoints.create).toMatchObject({
        status: "signing",
        submissionAttempted: true,
      });
      throw new Error("WALLET_SEND_FAILED");
    });
    await runLaunch(journal, storage, driver);
    const recovered = loadJournal(storage, "draft", "0xManager");
    if (!recovered) throw new Error("missing journal");
    await runLaunch(recovered, storage, driver);
    expect(driver.send).toHaveBeenCalledTimes(1);
    expect(driver.build).toHaveBeenCalledTimes(1);
    expect(recovered.checkpoints.create?.error).toBe("SUBMISSION_RECONCILIATION_REQUIRED");
  });
  it.each([
    "USER_REJECTED",
    "LAUNCH_CANCELLED",
  ])("permits an explicit retry after definitive no-broadcast %s across reload", async (code) => {
    const { journal, storage, driver } = setup();
    vi.mocked(driver.send).mockRejectedValueOnce(new Error(code));
    await runLaunch(journal, storage, driver);
    const recovered = loadJournal(storage, "draft", "0xManager");
    if (!recovered) throw new Error("missing journal");
    expect(recovered.checkpoints.create).toMatchObject({
      status: "failed",
      error: code,
      submissionAttempted: false,
    });
    expect(recovered.checkpoints.create?.txHash).toBeUndefined();
    await runLaunch(recovered, storage, driver, undefined, undefined, 1);
    expect(driver.send).toHaveBeenCalledTimes(2);
    expect(recovered.checkpoints.create?.status).toBe("confirmed");
  });
  it.each([
    "USER_REJECTED",
    "LAUNCH_CANCELLED",
  ])("never clears a known submission when a later callback throws %s", async (code) => {
    const { journal, storage, driver } = setup();
    vi.mocked(driver.send).mockImplementationOnce(async (_step, _transaction, onSubmitted) => {
      onSubmitted?.("0xhash");
      throw new Error(code);
    });
    await runLaunch(journal, storage, driver);
    const recovered = loadJournal(storage, "draft", "0xManager");
    if (!recovered) throw new Error("missing journal");
    expect(recovered.checkpoints.create).toMatchObject({
      txHash: "0xhash",
      submissionAttempted: true,
    });
    await runLaunch(recovered, storage, driver, undefined, undefined, 1);
    expect(driver.send).toHaveBeenCalledTimes(1);
    expect(recovered.checkpoints.create?.status).toBe("confirmed");
  });
  it.each([
    "signing",
    "submitted",
    "failed",
  ] as const)("fails closed on legacy %s attempts without a hash", async (status) => {
    const { journal, storage, driver } = setup();
    journal.checkpoints.create = { stepId: "create", chain: 42161, status };
    await runLaunch(journal, storage, driver);
    expect(driver.reconcile).toHaveBeenCalledTimes(1);
    expect(driver.build).not.toHaveBeenCalled();
    expect(driver.send).not.toHaveBeenCalled();
    expect(journal.checkpoints.create?.error).toBe("SUBMISSION_RECONCILIATION_REQUIRED");
  });
  it("reconciles a failed no-hash attempt read-only without rebuilding", async () => {
    const { journal, storage, driver } = setup();
    journal.checkpoints.create = {
      stepId: "create",
      chain: 42161,
      status: "failed",
      submissionAttempted: true,
    };
    vi.mocked(driver.reconcile).mockResolvedValue(true);
    await runLaunch(journal, storage, driver, undefined, undefined, undefined, true);
    expect(journal.checkpoints.create?.status).toBe("confirmed");
    expect(driver.send).not.toHaveBeenCalled();
  });
  it("rejects a corrupt attempted-send marker on reload", () => {
    const { journal, storage } = setup();
    journal.checkpoints.create = {
      stepId: "create",
      chain: 42161,
      status: "failed",
      submissionAttempted: "false" as unknown as boolean,
    };
    storage.value = JSON.stringify(journal);
    expect(() => loadJournal(storage, "draft", "0xManager")).toThrow("INVALID_JOURNAL");
  });
  it("rejects checkpoints whose chain disagrees with the persisted transaction step", () => {
    const { journal, storage } = setup();
    journal.checkpoints.create = { stepId: "create", chain: 4663, status: "signing" };
    storage.value = JSON.stringify(journal);
    expect(() => loadJournal(storage, "draft", "0xManager")).toThrow("INVALID_JOURNAL");
  });
  it("retains submission calldata and block lower bound before invoking the wallet", async () => {
    const { journal, storage, driver } = setup();
    const submission = {
      transaction: { to: "0xvault", data: "0x1234", value: "100" },
      fromBlock: "123",
    };
    vi.mocked(driver.build).mockResolvedValueOnce({
      transaction: submission.transaction,
      data: { submission },
    });
    vi.mocked(driver.send).mockImplementationOnce(async () => {
      expect(
        loadJournal(storage, "draft", "0xManager")?.checkpoints.create?.data?.submission,
      ).toEqual(submission);
      throw new Error("SUBMISSION_RECONCILIATION_REQUIRED");
    });
    await runLaunch(journal, storage, driver);
    expect(
      loadJournal(storage, "draft", "0xManager")?.checkpoints.create?.data?.submission,
    ).toEqual(submission);
  });
  it("does not retry a failed no-hash send for any transaction kind", async () => {
    for (const kind of [
      "approve",
      "create",
      "spoke",
      "allocate",
      "bridge",
      "swap",
      "open",
    ] as const) {
      const { journal, storage, driver } = setup();
      journal.steps = [{ id: "transaction", kind, chain: 42161, dependencies: [] }];
      vi.mocked(driver.send).mockRejectedValue(new Error("WALLET_SEND_FAILED"));
      await runLaunch(journal, storage, driver);
      const recovered = loadJournal(storage, "draft", "0xManager");
      if (!recovered) throw new Error("missing journal");
      await runLaunch(recovered, storage, driver);
      expect(driver.send).toHaveBeenCalledTimes(1);
      expect(recovered.checkpoints.transaction?.error).toBe("SUBMISSION_RECONCILIATION_REQUIRED");
    }
  });
  it.each([
    "soon",
    -1,
    null,
  ])("rejects corrupt persisted discovery retry timestamps: %s", (retryAt) => {
    const { journal, storage } = setup();
    journal.checkpoints.create = {
      stepId: "create",
      chain: 42161,
      status: "waiting",
      retryAt: retryAt as number,
    };
    storage.value = JSON.stringify(journal);
    expect(() => loadJournal(storage, "draft", "0xManager")).toThrow("INVALID_JOURNAL");
  });
  it("continues read-only receipt polling after an independent sibling reverts", async () => {
    const { journal, storage, driver } = setup();
    journal.steps = [
      { id: "bad", kind: "open", chain: 42161, dependencies: [] },
      { id: "leaf", kind: "open", chain: 42161, dependencies: [] },
    ];
    for (const step of journal.steps)
      journal.checkpoints[step.id] = {
        stepId: step.id,
        chain: step.chain,
        status: "waiting",
        txHash: `0x${step.id}`,
        receiptStatus: "unknown",
      };
    vi.mocked(driver.receipt)
      .mockResolvedValueOnce({ status: "reverted" })
      .mockResolvedValueOnce({ status: "success" });
    await runLaunch(journal, storage, driver, undefined, undefined, undefined, true);
    expect(journal.checkpoints.bad?.status).toBe("failed");
    expect(journal.checkpoints.leaf?.status).toBe("confirmed");
    expect(driver.send).not.toHaveBeenCalled();
  });
  it("backoffs pending without metadata and never signs a recovered builder in read-only polling", async () => {
    const { journal, storage, driver } = setup();
    journal.steps = [{ id: "leaf", kind: "open", chain: 42161, dependencies: [] }];
    vi.mocked(driver.build).mockRejectedValueOnce(new Error("V2_DISCOVERY_PENDING"));
    const started = Date.now();
    await runLaunch(journal, storage, driver);
    expect(journal.checkpoints.leaf?.retryAt).toBeGreaterThanOrEqual(started + 2000);
    const checkpoint = journal.checkpoints.leaf;
    if (!checkpoint) throw new Error("missing checkpoint");
    checkpoint.retryAt = 0;
    vi.mocked(driver.build).mockResolvedValueOnce({ transaction: {} });
    await runLaunch(journal, storage, driver, undefined, undefined, undefined, true);
    expect(driver.send).not.toHaveBeenCalled();
    expect(journal.checkpoints.leaf?.status).toBe("idle");
  });
  it("never runs a profile signer from automatic waiting reconciliation", async () => {
    const { journal, storage, driver } = setup();
    journal.steps = [{ id: "profile", kind: "profile", chain: 42161, dependencies: [] }];
    journal.checkpoints.profile = { stepId: "profile", chain: 42161, status: "waiting" };
    await runLaunch(journal, storage, driver, undefined, undefined, undefined, true);
    expect(driver.build).not.toHaveBeenCalled();
    expect(driver.send).not.toHaveBeenCalled();
  });
  it("waits with persisted discovery backoff and does not build before retryAfter", async () => {
    const { journal, storage, driver } = setup();
    journal.steps = [{ id: "leaf", kind: "open", chain: 42161, dependencies: [] }];
    vi.mocked(driver.build).mockRejectedValueOnce(
      Object.assign(new Error("V2_DISCOVERY_PENDING"), { retryAfterSeconds: 2 }),
    );
    const started = Date.now();
    await runLaunch(journal, storage, driver);
    expect(journal.checkpoints.leaf).toMatchObject({ status: "waiting", waitReason: "discovery" });
    expect(journal.checkpoints.leaf?.retryAt).toBeGreaterThanOrEqual(started + 2000);
    await runLaunch(journal, storage, driver);
    expect(driver.build).toHaveBeenCalledTimes(1);
    expect(driver.send).not.toHaveBeenCalled();
  });
  it("polls a submitted sibling despite earlier failure without rebuilding or rebroadcast", async () => {
    const { journal, storage, driver } = setup();
    journal.steps = [
      { id: "bad", kind: "open", chain: 42161, dependencies: [] },
      { id: "leaf", kind: "open", chain: 42161, dependencies: [] },
    ];
    journal.checkpoints.bad = {
      stepId: "bad",
      chain: 42161,
      status: "failed",
      error: "V2_REQUEST_FAILED",
    };
    journal.checkpoints.leaf = {
      stepId: "leaf",
      chain: 42161,
      status: "waiting",
      txHash: "0xknown",
      receiptStatus: "unknown",
    };
    await runLaunch(journal, storage, driver, undefined, undefined, undefined, true);
    expect(journal.checkpoints.leaf?.status).toBe("confirmed");
    expect(journal.checkpoints.bad?.status).toBe("failed");
    expect(driver.build).not.toHaveBeenCalled();
    expect(driver.send).not.toHaveBeenCalled();
  });
  it("keeps a receipt-success position waiting for API verification without rebroadcast", async () => {
    const { journal, storage, driver } = setup();
    journal.steps = [{ id: "leaf", kind: "open", chain: 42161, dependencies: [] }];
    journal.checkpoints.leaf = {
      stepId: "leaf",
      chain: 42161,
      status: "submitted",
      txHash: "0xknown",
    };
    vi.mocked(driver.complete).mockRejectedValueOnce(
      Object.assign(new Error("V2_DISCOVERY_PENDING"), { retryAfterSeconds: 2 }),
    );
    await runLaunch(journal, storage, driver);
    expect(journal.checkpoints.leaf).toMatchObject({ status: "waiting", receiptStatus: "success" });
    journal.checkpoints.leaf.retryAt = 0;
    await runLaunch(journal, storage, driver);
    expect(journal.checkpoints.leaf?.status).toBe("confirmed");
    expect(driver.receipt).toHaveBeenCalledTimes(1);
    expect(driver.build).not.toHaveBeenCalled();
    expect(driver.send).not.toHaveBeenCalled();
  });
  it("blocks an old-journal bridge while an independent hub leaf is pending", async () => {
    const { journal, storage, driver } = setup();
    journal.steps = [
      { id: "leaf", kind: "open", chain: 42161, dependencies: [] },
      { id: "bridge", kind: "bridge", chain: 42161, dependencies: [] },
    ];
    vi.mocked(driver.build).mockResolvedValue({});
    await runLaunch(journal, storage, driver);
    expect(driver.build).toHaveBeenCalledTimes(1);
    expect(journal.checkpoints.bridge).toBeUndefined();
  });
  it("clears a previous error when Retry reconciles the completed step", async () => {
    const { journal, storage, driver } = setup();
    journal.steps = [{ id: "profile", kind: "profile", chain: 42161, dependencies: [] }];
    journal.checkpoints.profile = {
      stepId: "profile",
      chain: 42161,
      status: "failed",
      error: "V2_UNAVAILABLE",
    };
    vi.mocked(driver.reconcile).mockResolvedValueOnce(true);
    await runLaunch(journal, storage, driver);
    expect(journal.checkpoints.profile?.status).toBe("confirmed");
    expect(journal.checkpoints.profile?.error).toBeUndefined();
    expect(driver.build).not.toHaveBeenCalled();
  });
  it.each([
    "V2_DEFERRED",
    "V2_RATE_LIMITED",
  ])("waits for an explicitly deferred report read: %s", async (code) => {
    const { journal, storage, driver } = setup();
    journal.steps = [{ id: "report", kind: "report", chain: 42161, dependencies: [] }];
    vi.mocked(driver.build).mockRejectedValueOnce(new Error(code));
    await runLaunch(journal, storage, driver);
    expect(journal.checkpoints.report?.status).toBe("waiting");
    expect(journal.checkpoints.report?.error).toBeUndefined();
    vi.mocked(driver.build).mockResolvedValueOnce({ complete: true });
    await runLaunch(journal, storage, driver);
    expect(journal.checkpoints.report?.status).toBe("confirmed");
    expect(driver.send).not.toHaveBeenCalled();
  });
  it("does not hide real report failures as normal waits", async () => {
    const { journal, storage, driver } = setup();
    journal.steps = [{ id: "report", kind: "report", chain: 42161, dependencies: [] }];
    vi.mocked(driver.build).mockRejectedValueOnce(new Error("V2_UNAVAILABLE"));
    await runLaunch(journal, storage, driver);
    expect(journal.checkpoints.report).toMatchObject({ status: "failed", error: "V2_UNAVAILABLE" });
    vi.mocked(driver.build).mockResolvedValueOnce({});
    await runLaunch(journal, storage, driver);
    expect(journal.checkpoints.report?.status).toBe("waiting");
    expect(journal.checkpoints.report?.error).toBeUndefined();
  });
  it("R5 notifies mounted lists after a completed journal is persisted", async () => {
    const { journal, driver } = setup();
    const listener = vi.fn();
    window.addEventListener("pp:v2:launch-changed", listener);
    try {
      await runLaunch(journal, localStorage, driver);
      expect(listener).toHaveBeenCalled();
    } finally {
      window.removeEventListener("pp:v2:launch-changed", listener);
    }
  });
  it("advances one ready step for an explicit sign/next action", async () => {
    const { journal, storage, driver } = setup();
    await runLaunch(journal, storage, driver, undefined, undefined, 1);
    expect(journal.checkpoints.create?.status).toBe("confirmed");
    expect(journal.checkpoints["discover-hub"]).toBeUndefined();
  });
  it("continues an independent hub leaf while a report is waiting", async () => {
    const { journal, storage, driver } = setup();
    journal.steps = [
      { id: "report", kind: "report", chain: 42161, dependencies: [] },
      { id: "leaf", kind: "open", chain: 42161, dependencies: [] },
    ];
    vi.mocked(driver.build).mockImplementation(async (step) =>
      step.kind === "report" ? {} : { transaction: {} },
    );
    await runLaunch(journal, storage, driver);
    expect(journal.checkpoints.report?.status).toBe("waiting");
    expect(journal.checkpoints.leaf?.status).toBe("confirmed");
  });
  it("never signs again after an interrupted signing window without a known hash", async () => {
    const { journal, storage, driver } = setup();
    journal.checkpoints.create = { stepId: "create", chain: 42161, status: "signing" };
    await runLaunch(journal, storage, driver);
    expect(driver.send).not.toHaveBeenCalled();
    expect(journal.checkpoints.create?.error).toBe("SUBMISSION_RECONCILIATION_REQUIRED");
  });
  it("persists before building/signing and completes dependency order", async () => {
    const { journal, storage, driver } = setup();
    await runLaunch(journal, storage, driver);
    expect(
      Object.values(journal.checkpoints).every((checkpoint) => checkpoint.status === "confirmed"),
    ).toBe(true);
    expect(loadJournal(storage, "draft", "0xManager")).toEqual(journal);
  });
  it("never rebuilds create after success on reload, including completion failure", async () => {
    const { journal, storage, driver } = setup();
    vi.mocked(driver.complete).mockRejectedValueOnce(new Error("DISCOVERY_UNAVAILABLE"));
    await runLaunch(journal, storage, driver);
    const resumed = loadJournal(storage, "draft", "0xManager")!;
    await runLaunch(resumed, storage, driver);
    expect(
      vi.mocked(driver.build).mock.calls.filter(([step]) => step.kind === "create"),
    ).toHaveLength(1);
    expect(resumed.checkpoints.create?.status).toBe("confirmed");
  });
  it("unknown create receipt blocks later steps and never recreates", async () => {
    const { journal, storage, driver } = setup();
    vi.mocked(driver.receipt).mockResolvedValue({ status: "unknown" });
    await runLaunch(journal, storage, driver);
    await runLaunch(loadJournal(storage, "draft", "0xManager")!, storage, driver);
    expect(driver.build).toHaveBeenCalledTimes(1);
    expect(journal.checkpoints.create?.status).toBe("waiting");
  });
  it("partial open failure retries only the failed leaf from fresh balances", async () => {
    const { journal, storage, driver } = setup();
    vi.mocked(driver.build).mockImplementation(async (step) => {
      if (step.id === "leaf") throw new Error("BALANCE_CHANGED");
      return step.kind === "discover" ? { complete: true } : { transaction: {} };
    });
    await runLaunch(journal, storage, driver);
    vi.mocked(driver.build).mockResolvedValue({ transaction: {} });
    await runLaunch(journal, storage, driver);
    expect(
      vi.mocked(driver.build).mock.calls.filter(([step]) => step.kind === "create"),
    ).toHaveLength(1);
    expect(journal.checkpoints.leaf?.status).toBe("confirmed");
  });
  it("storage failure prevents all signing", async () => {
    const { journal, storage, driver } = setup();
    storage.setItem = () => {
      throw new Error("quota");
    };
    await expect(runLaunch(journal, storage, driver)).rejects.toThrow();
    expect(driver.send).not.toHaveBeenCalled();
  });
  it("corrupt journals fail closed and cancellation does not sign", async () => {
    const { journal, storage, driver } = setup();
    storage.value = "{}";
    expect(() => loadJournal(storage, "draft", "0xManager")).toThrow("INVALID_JOURNAL");
    await runLaunch(journal, storage, driver, undefined, AbortSignal.abort());
    expect(driver.send).not.toHaveBeenCalled();
  });
});
