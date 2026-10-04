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
