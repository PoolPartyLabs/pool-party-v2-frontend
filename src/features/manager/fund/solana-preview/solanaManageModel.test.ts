/**
 * @id PP-MGR-LIB-071
 * @name solanaManageModel tests
 * @implements-rules-version v1 (POO-2291)
 */
import { describe, expect, it } from "vitest";
import {
  createSolanaManageState,
  type SolanaManageConfig,
  type SolanaManageCurrent,
  type SolanaManageIdentity,
  type SolanaManageJournalEntry,
  type SolanaManagePreview,
  selectSolanaManageView,
  solanaManageIdentityKey,
  solanaManageReducer,
} from "./solanaManageModel";
import { USDC_MINT, WSOL_MINT } from "./solanaSchemas";

function present<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("Missing test fixture value");
  return value;
}
const now = "2026-10-08T10:00:00Z";
const identity: SolanaManageIdentity = {
  protocol: "orca",
  cluster: "mainnet-beta",
  program: WSOL_MINT,
  venue: USDC_MINT,
  positionId: "11111111111111111111111111111111",
  assets: [
    {
      kind: "spl",
      network: "solana",
      cluster: "mainnet-beta",
      symbol: "WSOL",
      mint: WSOL_MINT,
      decimals: 9,
      unit: "base-units",
    },
    {
      kind: "spl",
      network: "solana",
      cluster: "mainnet-beta",
      symbol: "USDC",
      mint: USDC_MINT,
      decimals: 6,
      unit: "base-units",
    },
  ],
};
const source = {
  kind: "observed" as const,
  source: "injected verified position read",
  sourceAsOf: "2026-10-08T09:59:00Z",
  slot: "9007199254740993123456",
  commitment: "confirmed" as const,
};
const config: SolanaManageConfig = {
  allocation: "30",
  pair: "SOL / USDC",
  range: { tickLower: -64, tickUpper: 64, displayInverted: false },
};
function state() {
  return createSolanaManageState([
    { localId: "preview-1", protocol: "orca", config },
    { localId: "preview-2", protocol: "orca", config },
  ]);
}
function current(position = identity): SolanaManageCurrent {
  return structuredClone({
    status: "available",
    snapshot: {
      identity: position,
      snapshotId: "position-1",
      config,
      source,
      freshness: "fresh",
      values: {
        principal: [{ token: present(identity.assets[0]), raw: "9007199254740993" }],
        interest: null,
        fees: [{ token: present(identity.assets[1]), raw: "0" }],
        rewards: null,
      },
    },
  });
}
function reconciled() {
  return solanaManageReducer(state(), {
    type: "reconcile",
    localId: "preview-1",
    current: current(),
  });
}
function chosen() {
  let s = reconciled();
  s = solanaManageReducer(s, { type: "edit", localId: "preview-1", patch: { allocation: "40" } });
  return solanaManageReducer(s, { type: "choose", localId: "preview-1", mode: "move" });
}
function preview(s = chosen()): SolanaManagePreview {
  return {
    status: "available",
    preview: {
      localId: "preview-1",
      identity,
      baseSnapshotId: "position-1",
      draftRevision: present(s.instances["preview-1"]).draft.revision,
      mode: "move",
      previewId: "supplied-preview-7",
      validUntil: "2026-10-08T10:05:00Z",
      snapshot: {
        ...present(current().snapshot),
        snapshotId: "after-7",
        config: { ...config, allocation: "40" },
        values: {
          principal: [{ token: present(identity.assets[0]), raw: "1" }],
          interest: null,
          fees: null,
          rewards: null,
        },
      },
    },
  };
}
const journal: SolanaManageJournalEntry = {
  operationId: "operation-1",
  localId: "preview-1",
  identity,
  intentRevision: 1,
  status: "unknown",
  signature: null,
  checkpoints: [{ id: "close", status: "confirmed", signature: "confirmed-close-signature" }],
};

describe("POO-2291 S6 independent local Manage ownership", () => {
  // @rule R8: synchronize drawing baselines without manufacturing canonical reads or clearing ownership.
  it("synchronizes added/removed drawing instances while retaining an independent draft and journal", () => {
    const prior = solanaManageReducer(chosen(), { type: "journal", entry: journal });
    const next = solanaManageReducer(prior, {
      type: "sync-drawing",
      inputs: [
        { localId: "preview-1", protocol: "orca", config: { ...config, allocation: "35" } },
        { localId: "preview-3", protocol: "raydium", config: { ...config, allocation: "0" } },
      ],
    });
    expect(selectSolanaManageView(next, "preview-1", now).draft.config.allocation).toBe("40");
    expect(selectSolanaManageView(next, "preview-1", now).draft.mode).toBe("move");
    expect(next.instances["preview-1"]?.localConfig.allocation).toBe("35");
    expect(selectSolanaManageView(next, "preview-1", now).current.snapshot).toEqual(
      selectSolanaManageView(prior, "preview-1", now).current.snapshot,
    );
    expect(next.instances["preview-2"]).toBeUndefined();
    expect(selectSolanaManageView(next, "preview-3", now).current.status).toBe("unavailable");
    expect(next.journal).toEqual(prior.journal);
  });
  // @rule R8: unchanged drawing sync preserves the exact draft revision/review binding.
  it("is idempotent for identical drawing baselines and updates only clean local drafts", () => {
    const inputs = [
      { localId: "preview-1", protocol: "orca" as const, config },
      { localId: "preview-2", protocol: "orca" as const, config },
    ];
    const prior = chosen();
    expect(solanaManageReducer(prior, { type: "sync-drawing", inputs })).toBe(prior);
    const next = solanaManageReducer(state(), {
      type: "sync-drawing",
      inputs: inputs.map((input) => ({ ...input, config: { ...config, allocation: "45" } })),
    });
    expect(selectSolanaManageView(next, "preview-1", now).draft.config.allocation).toBe("45");
    expect(selectSolanaManageView(next, "preview-1", now).dirty).toBe(false);
    const owner = present(next.instances["preview-1"]);
    expect(owner.localConfig).not.toBe(owner.draft.config);
    owner.draft.config.allocation = "55";
    expect(owner.localConfig.allocation).toBe("45");
    expect(config.allocation).toBe("30");
  });
  // @rule R8: a drawing baseline that reaches the draft ends its obsolete intent binding.
  it("ends the local mode and preview when a synchronized baseline matches the draft", () => {
    const prior = solanaManageReducer(
      solanaManageReducer(chosen(), { type: "journal", entry: journal }),
      { type: "preview", localId: "preview-1", read: preview(), now },
    );
    const next = solanaManageReducer(prior, {
      type: "sync-drawing",
      inputs: [
        { localId: "preview-1", protocol: "orca", config: { ...config, allocation: "40" } },
        { localId: "preview-2", protocol: "orca", config },
      ],
    });
    const before = selectSolanaManageView(prior, "preview-1", now);
    const after = selectSolanaManageView(next, "preview-1", now);
    expect(after.dirty).toBe(false);
    expect(after.draft.mode).toBeNull();
    expect(after.draft.revision).toBe(before.draft.revision + 1);
    expect(after.after.status).toBe("unavailable");
    expect(after.current).toEqual(before.current);
    expect(next.journal).toEqual(prior.journal);
  });
  // @rule R2/R3: physical token observations fit u64, independently of generic source slot bounds.
  it.each([
    "principal",
    "interest",
    "fees",
    "rewards",
  ] as const)("accepts u64 max and rejects max+1 for Current %s", (field) => {
    for (const raw of ["18446744073709551615", "18446744073709551616"]) {
      const read = current();
      present(read.snapshot).values[field] = [{ token: present(identity.assets[0]), raw }];
      const next = solanaManageReducer(state(), {
        type: "reconcile",
        localId: "preview-1",
        current: read,
      });
      expect(selectSolanaManageView(next, "preview-1", now).current.status).toBe(
        raw.endsWith("15") ? "available" : "unavailable",
      );
    }
  });
  // @rule R2/R8: After uses the same physical u64 boundary, never a wider simulated amount.
  it("accepts u64 max and rejects max+1 for After without changing Current", () => {
    for (const raw of ["18446744073709551615", "18446744073709551616"]) {
      const s = chosen();
      const read = preview(s);
      present(read.preview).snapshot.values.principal = [
        { token: present(identity.assets[0]), raw },
      ];
      const next = solanaManageReducer(s, { type: "preview", localId: "preview-1", read, now });
      expect(selectSolanaManageView(next, "preview-1", now).after.status).toBe(
        raw.endsWith("15") ? "available" : "unavailable",
      );
      expect(
        selectSolanaManageView(next, "preview-1", now).current.snapshot?.values.principal?.[0]?.raw,
      ).toBe("9007199254740993");
    }
  });
  // @rule R2: one mint cannot acquire two canonical decimal definitions in an identity.
  it("rejects a duplicate SPL mint even when its decimals differ", () => {
    const original = present(identity.assets[0]);
    if (original.kind !== "spl") throw new Error("Expected SPL test asset");
    const asset = { ...original, mint: "11111111111111111111111111111111" };
    expect(
      solanaManageIdentityKey({ ...identity, assets: [asset, { ...asset, decimals: 6 }] }),
    ).toBeNull();
  });
  // @rule R3: reward-only assets never become principal through shared array identity.
  it("rejects non-position principal even if its array aliases the rewards array", () => {
    const read = current();
    const values = present(read.snapshot).values;
    const reward = [
      {
        token: { ...present(identity.assets[0]), mint: "11111111111111111111111111111111" },
        raw: "1",
      },
    ];
    values.principal = reward;
    values.rewards = reward;
    const next = solanaManageReducer(state(), {
      type: "reconcile",
      localId: "preview-1",
      current: read,
    });
    expect(selectSolanaManageView(next, "preview-1", now).current.status).toBe("unavailable");
  });
  // @rule R1,R3,R8: local drawing never supplies a position, current holdings, After or execution.
  it("keeps canonical null editable with unavailable Current/After and transaction details", () => {
    let s = state();
    s = solanaManageReducer(s, { type: "edit", localId: "preview-1", patch: { allocation: "45" } });
    s = solanaManageReducer(s, { type: "choose", localId: "preview-1", mode: "future" });
    const view = selectSolanaManageView(s, "preview-1", now);
    expect(view.draft.config.allocation).toBe("45");
    expect(view.draft.mode).toBe("future");
    expect(view.current.status).toBe("unavailable");
    expect(view.after.status).toBe("unavailable");
    expect(view.canConfirm).toBe(false);
    expect(view.transactionDetails.status).toBe("unavailable");
  });
  // @rule R2,R8: canonical position identity is separate from catalog/pool/local instance.
  it("distinguishes case-sensitive positions, programs, venues, clusters and native SOL", () => {
    const key = solanaManageIdentityKey(identity);
    expect(key).not.toContain("preview-1");
    for (const changed of [
      { ...identity, positionId: WSOL_MINT },
      { ...identity, venue: WSOL_MINT },
      { ...identity, program: USDC_MINT },
      {
        ...identity,
        cluster: "devnet" as const,
        assets: identity.assets.map((token) => ({ ...token, cluster: "devnet" as const })),
      },
      { ...identity, positionId: WSOL_MINT.replace("So", "so") },
      {
        ...identity,
        assets: [
          {
            kind: "native" as const,
            network: "solana" as const,
            cluster: "mainnet-beta" as const,
            symbol: "SOL" as const,
            decimals: 9 as const,
            unit: "lamports" as const,
          },
          present(identity.assets[1]),
        ],
      },
    ])
      expect(solanaManageIdentityKey(changed)).not.toBe(key);
    expect(solanaManageIdentityKey({ ...identity, positionId: "0x123" })).toBeNull();
  });
  // @rule R8: selecting any node does not own another instance's editor or operation.
  it("preserves independent same-pool drafts and modes across position and flow selection", () => {
    let s = reconciled();
    s = solanaManageReducer(s, {
      type: "reconcile",
      localId: "preview-2",
      current: current({ ...identity, positionId: WSOL_MINT }),
    });
    s = solanaManageReducer(s, { type: "edit", localId: "preview-1", patch: { allocation: "40" } });
    s = solanaManageReducer(s, { type: "choose", localId: "preview-1", mode: "move" });
    const first = present(s.instances["preview-1"]).draft;
    s = solanaManageReducer(s, {
      type: "select",
      selection: { nodeId: "position:preview-2", localId: "preview-2" },
    });
    s = solanaManageReducer(s, { type: "edit", localId: "preview-2", patch: { allocation: "20" } });
    s = solanaManageReducer(s, { type: "choose", localId: "preview-2", mode: "future" });
    s = solanaManageReducer(s, {
      type: "select",
      selection: { nodeId: "fees:preview-2", localId: null },
    });
    expect(s.selection).toEqual({ nodeId: "fees:preview-2", localId: null });
    expect(present(s.instances["preview-1"]).draft).toEqual(first);
    expect(present(s.instances["preview-2"]).draft.mode).toBe("future");
    expect(present(s.instances["preview-2"]).draft.config.allocation).toBe("20");
  });
  it("uses one exclusive mode, and Back preserves the edited config", () => {
    let s = chosen();
    s = solanaManageReducer(s, { type: "choose", localId: "preview-1", mode: "future" });
    expect(present(s.instances["preview-1"]).draft.mode).toBe("future");
    const edited = present(s.instances["preview-1"]).draft.config;
    s = solanaManageReducer(s, { type: "back", localId: "preview-1" });
    expect(present(s.instances["preview-1"]).draft.mode).toBeNull();
    expect(present(s.instances["preview-1"]).draft.config).toEqual(edited);
  });
  // @rule R3,R8: independent supplied preview is bound to the current base and draft intention.
  it("exposes exact injected Current/After without mutating Current or confirming", () => {
    const s = chosen(),
      supplied = preview(s);
    const next = solanaManageReducer(s, {
      type: "preview",
      localId: "preview-1",
      read: supplied,
      now,
    });
    const view = selectSolanaManageView(next, "preview-1", now);
    expect(view.current.snapshot?.values.principal?.[0]?.raw).toBe("9007199254740993");
    expect(view.after.snapshot?.values.principal?.[0]?.raw).toBe("1");
    expect(view.current.snapshot?.config.allocation).toBe("30");
    expect(view.draft.config.allocation).toBe("40");
    expect(view.after.snapshot?.config.allocation).toBe("40");
    expect(view.current.snapshot?.values.interest).toBeNull();
    expect(view.current.snapshot?.values.fees?.[0]?.raw).toBe("0");
    expect(view.canConfirm).toBe(false);
  });
  it.each([
    "localId",
    "identity",
    "base",
    "revision",
    "mode",
    "stale",
    "expiry",
    "source",
    "afterIdentity",
    "afterConfig",
  ])("rejects an injected preview with mismatched %s", (field) => {
    const s = chosen(),
      p = preview(s);
    if (!p.preview) throw new Error("fixture");
    if (field === "localId") p.preview.localId = "preview-2";
    if (field === "identity") p.preview.identity = { ...identity, positionId: WSOL_MINT };
    if (field === "base") p.preview.baseSnapshotId = "old-current";
    if (field === "revision") p.preview.draftRevision++;
    if (field === "mode") p.preview.mode = "future";
    if (field === "stale") p.preview.snapshot.freshness = "stale";
    if (field === "expiry") p.preview.validUntil = now;
    if (field === "source") Object.assign(p.preview.snapshot.source, { sourceAsOf: "not-a-date" });
    if (field === "afterIdentity") p.preview.snapshot.identity = { ...identity, venue: WSOL_MINT };
    if (field === "afterConfig") p.preview.snapshot.config.allocation = "10";
    const next = solanaManageReducer(s, { type: "preview", localId: "preview-1", read: p, now });
    expect(selectSolanaManageView(next, "preview-1", now).after.status).toBe("unavailable");
  });
  it("preserves the canonical intention when only quote display orientation changes", () => {
    let s = chosen();
    s = solanaManageReducer(s, { type: "preview", localId: "preview-1", read: preview(s), now });
    const revision = present(s.instances["preview-1"]).draft.revision;
    s = solanaManageReducer(s, {
      type: "edit",
      localId: "preview-1",
      patch: { range: { ...present(config.range), displayInverted: true } },
    });
    expect(present(s.instances["preview-1"]).draft.revision).toBe(revision);
    expect(selectSolanaManageView(s, "preview-1", now).after.status).toBe("available");
    expect(present(s.instances["preview-1"]).draft.config.range?.tickLower).toBe(-64);
  });
  it("invalidates After after a material draft change without changing Current", () => {
    let s = chosen();
    s = solanaManageReducer(s, { type: "preview", localId: "preview-1", read: preview(s), now });
    s = solanaManageReducer(s, { type: "edit", localId: "preview-1", patch: { allocation: "41" } });
    const view = selectSolanaManageView(s, "preview-1", now);
    expect(view.after.status).toBe("unavailable");
    expect(view.current.snapshot?.config.allocation).toBe("30");
    expect(view.draft.revision).toBeGreaterThan(1);
  });
  it("does not display After against a Current source timestamp in the future", () => {
    let s = state();
    const read = current();
    present(read.snapshot).source.sourceAsOf = "2026-10-08T10:01:00Z";
    s = solanaManageReducer(s, { type: "reconcile", localId: "preview-1", current: read });
    s = solanaManageReducer(s, { type: "edit", localId: "preview-1", patch: { allocation: "40" } });
    s = solanaManageReducer(s, { type: "choose", localId: "preview-1", mode: "move" });
    s = solanaManageReducer(s, { type: "preview", localId: "preview-1", read: preview(s), now });
    expect(selectSolanaManageView(s, "preview-1", now).after.status).toBe("unavailable");
  });
  it.each(["amount", "cluster", "nonLpRange"])("fails closed for malformed Current %s", (field) => {
    const read = current(),
      snapshot = present(read.snapshot);
    if (field === "amount")
      present(snapshot.values.principal)[0] = { token: present(identity.assets[0]), raw: "1e18" };
    if (field === "cluster")
      snapshot.identity.assets[0] = { ...present(identity.assets[0]), cluster: "devnet" };
    if (field === "nonLpRange") snapshot.identity.protocol = "holding";
    const s = solanaManageReducer(state(), {
      type: "reconcile",
      localId: "preview-1",
      current: read,
    });
    expect(selectSolanaManageView(s, "preview-1", now).current.status).toBe("unavailable");
  });
  it("does not renew preview expiry through selection or an unchanged read", () => {
    let s = chosen();
    s = solanaManageReducer(s, { type: "preview", localId: "preview-1", read: preview(s), now });
    const revision = present(s.instances["preview-1"]).draft.revision;
    s = solanaManageReducer(s, { type: "select", selection: { nodeId: "cash", localId: null } });
    s = solanaManageReducer(s, { type: "reconcile", localId: "preview-1", current: current() });
    expect(present(s.instances["preview-1"]).draft.revision).toBe(revision);
    expect(selectSolanaManageView(s, "preview-1", now).after.status).toBe("available");
    expect(selectSolanaManageView(s, "preview-1", "2026-10-08T10:05:00Z").after.status).toBe(
      "unavailable",
    );
  });
  it.each([
    "snapshot",
    "identity",
    "config",
    "source",
    "unavailable",
    "stale",
  ])("preserves edited draft plus conflict and invalidates After on changed %s", (field) => {
    let s = chosen();
    s = solanaManageReducer(s, { type: "preview", localId: "preview-1", read: preview(s), now });
    const draft = present(s.instances["preview-1"]).draft.config;
    let read = current();
    if (!read.snapshot) throw new Error("fixture");
    if (field === "snapshot") read.snapshot.snapshotId = "position-2";
    if (field === "identity") read.snapshot.identity = { ...identity, positionId: WSOL_MINT };
    if (field === "config") read.snapshot.config.allocation = "50";
    if (field === "source") read.snapshot.source = { ...source, slot: "9007199254740993123457" };
    if (field === "unavailable")
      read = { status: "unavailable", snapshot: null, reason: "read-missing" };
    if (field === "stale") read = { ...read, status: "stale" };
    s = solanaManageReducer(s, { type: "reconcile", localId: "preview-1", current: read });
    const view = selectSolanaManageView(s, "preview-1", now);
    expect(view.draft.config).toEqual(draft);
    expect(view.conflict).not.toBeNull();
    expect(view.after.status).toBe("unavailable");
  });
  it("requires explicit rebase to resolve a changed snapshot without losing draft edits", () => {
    let s = chosen();
    const read = current();
    present(read.snapshot).snapshotId = "position-2";
    s = solanaManageReducer(s, { type: "reconcile", localId: "preview-1", current: read });
    expect(present(s.instances["preview-1"]).conflict).not.toBeNull();
    s = solanaManageReducer(s, { type: "rebase", localId: "preview-1" });
    expect(present(s.instances["preview-1"]).draft.config.allocation).toBe("40");
    expect(present(s.instances["preview-1"]).draft.baseSnapshotId).toBe("position-2");
    expect(present(s.instances["preview-1"]).draft.mode).toBeNull();
    expect(present(s.instances["preview-1"]).conflict).toBeNull();
  });
  // @rule R1,R8: local Apply is a reversible draft save, not Current or live policy.
  it("applies local draft settings without replacing Current or manufacturing After", () => {
    let s = chosen();
    const before = present(s.instances["preview-1"]).current;
    s = solanaManageReducer(s, { type: "apply-local", localId: "preview-1" });
    const view = selectSolanaManageView(s, "preview-1", now);
    expect(present(s.instances["preview-1"]).localConfig.allocation).toBe("40");
    expect(view.current).toEqual(before);
    expect(view.after.status).toBe("unavailable");
    expect(view.canConfirm).toBe(false);
    expect(view.dirty).toBe(false);
  });
  it("never applies invalid allocation or a range to non-LP families", () => {
    let s = state();
    s = solanaManageReducer(s, {
      type: "edit",
      localId: "preview-1",
      patch: { allocation: "101" },
    });
    expect(selectSolanaManageView(s, "preview-1", now).localApplyValid).toBe(false);
    s = solanaManageReducer(s, { type: "apply-local", localId: "preview-1" });
    expect(present(s.instances["preview-1"]).localConfig.allocation).toBe("30");
    const kamino = createSolanaManageState([
      { localId: "supply", protocol: "kamino", config: { ...config, range: null } },
    ]);
    const changed = solanaManageReducer(kamino, {
      type: "edit",
      localId: "supply",
      patch: { range: config.range },
    });
    expect(present(changed.instances.supply).draft.config.range).toBeNull();
  });
  // @rule R8: journal data stays owned by operation, never by the selected editor.
  it("retains a pending/unknown journal through selection, discard, remove and Current changes", () => {
    let s = chosen();
    s = solanaManageReducer(s, { type: "journal", entry: journal });
    s = solanaManageReducer(s, {
      type: "select",
      selection: { nodeId: "position:preview-2", localId: "preview-2" },
    });
    s = solanaManageReducer(s, { type: "discard", localId: "preview-1" });
    s = solanaManageReducer(s, {
      type: "reconcile",
      localId: "preview-1",
      current: { status: "unavailable", snapshot: null, reason: "read-failed" },
    });
    s = solanaManageReducer(s, { type: "remove", localId: "preview-1" });
    expect(s.journal["operation-1"]).toEqual(journal);
    expect(selectSolanaManageView(s, "preview-2", now).canConfirm).toBe(false);
  });
  it("rejects reuse of another instance's journal identity and keeps confirmed checkpoints", () => {
    let s = solanaManageReducer(chosen(), { type: "journal", entry: journal });
    s = solanaManageReducer(s, {
      type: "journal",
      entry: { ...journal, localId: "preview-2", checkpoints: [] },
    });
    expect(s.journal["operation-1"]).toEqual(journal);
    s = solanaManageReducer(s, {
      type: "journal",
      entry: { ...journal, status: "pending", checkpoints: [] },
    });
    expect(present(s.journal["operation-1"]).checkpoints).toEqual(journal.checkpoints);
    expect(present(s.journal["operation-1"]).status).toBe("pending");
  });
  it("rejects malformed snapshots instead of making them fresh Current", () => {
    const read = current();
    present(read.snapshot).identity.positionId = "0x123";
    const s = solanaManageReducer(state(), {
      type: "reconcile",
      localId: "preview-1",
      current: read,
    });
    expect(selectSolanaManageView(s, "preview-1", now).current.status).toBe("unavailable");
  });
  it("does not replace a confirmed journal checkpoint or downgrade terminal status", () => {
    let s = solanaManageReducer(chosen(), {
      type: "journal",
      entry: { ...journal, status: "confirmed" },
    });
    s = solanaManageReducer(s, {
      type: "journal",
      entry: {
        ...journal,
        status: "unknown",
        checkpoints: [{ id: "close", status: "pending", signature: null }],
      },
    });
    expect(present(s.journal["operation-1"]).status).toBe("confirmed");
    expect(present(s.journal["operation-1"]).checkpoints).toEqual(journal.checkpoints);
  });
  it("retains distinct null and confirmed zero quantities with fixture source visibly injectable", () => {
    const read = current();
    present(read.snapshot).source = {
      kind: "fixture",
      fixtureId: "illustrative-only",
      sourceAsOf: source.sourceAsOf,
      slot: null,
    };
    const s = solanaManageReducer(state(), {
      type: "reconcile",
      localId: "preview-1",
      current: read,
    });
    const view = selectSolanaManageView(s, "preview-1", now);
    expect(view.current.snapshot?.source.kind).toBe("fixture");
    expect(view.current.snapshot?.values.interest).toBeNull();
    expect(view.current.snapshot?.values.fees?.[0]?.raw).toBe("0");
    expect(view.after.status).toBe("unavailable");
    expect(view.canConfirm).toBe(false);
  });
  it("does not alias or mutate injected state, configs, snapshots and journal entries", () => {
    const s = state(),
      read = current(),
      saved = structuredClone(read);
    const next = solanaManageReducer(s, { type: "reconcile", localId: "preview-1", current: read });
    present(read.snapshot).config.allocation = "80";
    expect(present(next.instances["preview-1"]).current.snapshot?.config.allocation).toBe(
      saved.snapshot?.config.allocation,
    );
    expect(present(s.instances["preview-1"]).current.status).toBe("unavailable");
  });
});
