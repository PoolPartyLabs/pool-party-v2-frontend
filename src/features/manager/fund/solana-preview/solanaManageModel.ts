/**
 * @id PP-MGR-LIB-071
 * @name solanaManageModel
 * @description Independent local instance, canonical snapshot, draft and operation ownership.
 * @linear https://linear.app/yeildbay/issue/POO-2291
 * @figma https://www.figma.com/design/jjOf5DL9uVEB7WBR9nGb4A?node-id=8679-546
 * @implements-rules-version v1 (POO-2291)
 * @analytics-events none, pure local state; the preview host owns intent/navigation events.
 */
import { z } from "zod";
import { type PreviewEdit, parseAllocation } from "./previewModel";
import type { SolanaAmount, SolanaSource, SolanaToken } from "./solanaSchemas";
import {
  solanaAddressSchema,
  solanaAmountSchema,
  solanaClusterSchema,
  solanaRawAmountSchema,
  solanaSourceSchema,
  solanaTokenSchema,
  USDC_MINT,
} from "./solanaSchemas";

export type SolanaManageProtocol = "orca" | "raydium" | "kamino" | "holding" | "jupiter";
export interface SolanaManageConfig extends PreviewEdit {
  /** Canonical ticks only. The host's protocol range validator owns domain/grid validation. */
  range: { tickLower: number; tickUpper: number; displayInverted: boolean } | null;
}
export interface SolanaManageIdentity {
  protocol: Exclude<SolanaManageProtocol, "jupiter">;
  cluster: "mainnet-beta" | "devnet" | "testnet";
  program: string;
  venue: string;
  positionId: string;
  assets: SolanaToken[];
}
export interface SolanaManageSnapshot {
  identity: SolanaManageIdentity;
  snapshotId: string;
  config: SolanaManageConfig;
  source: SolanaSource;
  freshness: "fresh" | "stale" | "unknown";
  /** Independent received quantities. Null means missing, never zero or inferred income. */
  values: {
    principal: SolanaAmount[] | null;
    interest: SolanaAmount[] | null;
    fees: SolanaAmount[] | null;
    rewards: SolanaAmount[] | null;
  };
}
export interface SolanaManageCurrent {
  status: "available" | "stale" | "unavailable";
  snapshot: SolanaManageSnapshot | null;
  reason?: string;
}
export interface SolanaManagePreview {
  status: "available" | "unavailable";
  preview?: {
    localId: string;
    identity: SolanaManageIdentity;
    baseSnapshotId: string;
    draftRevision: number;
    mode: "move" | "future";
    previewId: string;
    validUntil: string;
    snapshot: SolanaManageSnapshot;
  };
  reason?: string;
}
export interface SolanaManageJournalEntry {
  operationId: string;
  localId: string;
  identity: SolanaManageIdentity;
  intentRevision: number;
  status: "pending" | "unknown" | "partial" | "confirmed" | "failed";
  signature: string | null;
  checkpoints: {
    id: string;
    status: "pending" | "confirmed" | "failed";
    signature: string | null;
  }[];
}
interface SolanaManageDraft {
  config: SolanaManageConfig;
  revision: number;
  mode: "move" | "future" | null;
  baseSnapshotId: string | null;
  baseFingerprint: string | null;
}
interface SolanaManageInstance {
  localId: string;
  protocol: SolanaManageProtocol;
  localConfig: SolanaManageConfig;
  current: SolanaManageCurrent;
  draft: SolanaManageDraft;
  conflict: "snapshot-changed" | "current-unavailable" | null;
  preview: SolanaManagePreview;
}
export interface SolanaManageState {
  instances: Record<string, SolanaManageInstance>;
  selection: { nodeId: string; localId: string | null } | null;
  journal: Record<string, SolanaManageJournalEntry>;
}
export type SolanaManageAction =
  | {
      type: "sync-drawing";
      inputs: { localId: string; protocol: SolanaManageProtocol; config: SolanaManageConfig }[];
    }
  | { type: "select"; selection: SolanaManageState["selection"] }
  | { type: "edit"; localId: string; patch: Partial<SolanaManageConfig> }
  | { type: "choose"; localId: string; mode: "move" | "future" }
  | { type: "back" | "discard" | "rebase" | "apply-local" | "remove"; localId: string }
  | { type: "reconcile"; localId: string; current: SolanaManageCurrent }
  | { type: "preview"; localId: string; read: SolanaManagePreview; now: string }
  | { type: "journal"; entry: SolanaManageJournalEntry };
const idSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .refine((id) => !["__proto__", "constructor", "prototype"].includes(id));
const protocolSchema = z.enum(["orca", "raydium", "kamino", "holding", "jupiter"]);
const configSchema = z
  .object({
    allocation: z.string().max(128),
    pair: z.enum(["SOL / USDC", "USDC / SOL"]),
    range: z
      .object({
        tickLower: z.number().safe(),
        tickUpper: z.number().safe(),
        displayInverted: z.boolean(),
      })
      .strict()
      .nullable(),
  })
  .strict();
const identitySchema = z
  .object({
    protocol: z.enum(["orca", "raydium", "kamino", "holding"]),
    cluster: solanaClusterSchema,
    program: solanaAddressSchema,
    venue: solanaAddressSchema,
    positionId: solanaAddressSchema,
    assets: z.array(solanaTokenSchema).min(1).max(16),
  })
  .strict()
  .superRefine((identity, ctx) => {
    if (
      identity.assets.some((token) => token.cluster !== identity.cluster) ||
      new Set(identity.assets.map(tokenIdentityKey)).size !== identity.assets.length ||
      (identity.protocol === "kamino" &&
        (identity.assets.length !== 1 ||
          identity.assets[0]?.kind !== "spl" ||
          identity.assets[0].mint !== USDC_MINT ||
          identity.cluster !== "mainnet-beta"))
    )
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Canonical asset context mismatch" });
  });
const amountList = z
  .array(
    solanaAmountSchema.refine(
      (amount) =>
        solanaRawAmountSchema.safeParse(amount.raw).success &&
        BigInt(amount.raw) <= BigInt("18446744073709551615"),
      "Physical token quantity exceeds u64",
    ),
  )
  .max(64)
  .nullable();
const snapshotSchema = z
  .object({
    identity: identitySchema,
    snapshotId: idSchema,
    config: configSchema,
    source: solanaSourceSchema,
    freshness: z.enum(["fresh", "stale", "unknown"]),
    values: z
      .object({
        principal: amountList,
        interest: amountList,
        fees: amountList,
        rewards: amountList,
      })
      .strict(),
  })
  .strict();
const previewSchema = z
  .object({
    localId: idSchema,
    identity: identitySchema,
    baseSnapshotId: idSchema,
    draftRevision: z.number().int().nonnegative().safe(),
    mode: z.enum(["move", "future"]),
    previewId: idSchema,
    validUntil: z.string().datetime({ offset: true }),
    snapshot: snapshotSchema,
  })
  .strict();
const checkpointSchema = z
  .object({
    id: idSchema,
    status: z.enum(["pending", "confirmed", "failed"]),
    signature: z.string().min(1).max(128).nullable(),
  })
  .strict();
const journalSchema = z
  .object({
    operationId: idSchema,
    localId: idSchema,
    identity: identitySchema,
    intentRevision: z.number().int().nonnegative().safe(),
    status: z.enum(["pending", "unknown", "partial", "confirmed", "failed"]),
    signature: z.string().min(1).max(128).nullable(),
    checkpoints: z.array(checkpointSchema).max(64),
  })
  .strict();
const absentCurrent = (reason = "not-integrated"): SolanaManageCurrent => ({
  status: "unavailable",
  snapshot: null,
  reason,
});
const absentPreview = (reason = "not-integrated"): SolanaManagePreview => ({
  status: "unavailable",
  reason,
});
function tokenIdentityKey(token: SolanaToken): string {
  return `${token.cluster}:${token.kind}:${token.kind === "spl" ? token.mint : "native-SOL"}`;
}
function tokenKey(token: SolanaToken): string {
  return `${tokenIdentityKey(token)}:${token.decimals}:${token.unit}`;
}
/** Identity normalization never lowercases Solana addresses or substitutes a pool for a position. */
export function solanaManageIdentityKey(identity: SolanaManageIdentity): string | null {
  const parsed = identitySchema.safeParse(identity);
  if (!parsed.success) return null;
  const value = parsed.data;
  return JSON.stringify([
    value.protocol,
    value.cluster,
    value.program,
    value.venue,
    value.positionId,
    value.assets.map(tokenKey),
  ]);
}
function sameConfig(left: SolanaManageConfig, right: SolanaManageConfig): boolean {
  return (
    parseAllocation(left.allocation) === parseAllocation(right.allocation) &&
    left.pair === right.pair &&
    left.range?.tickLower === right.range?.tickLower &&
    left.range?.tickUpper === right.range?.tickUpper &&
    Boolean(left.range) === Boolean(right.range) &&
    (parseAllocation(left.allocation) !== null || left.allocation === right.allocation)
  );
}
/** Syntax only. Aggregate allocation, protocol grid, mandate and execution are host-owned. */
function validConfig(config: SolanaManageConfig, protocol: SolanaManageProtocol): boolean {
  const parsed = configSchema.safeParse(config);
  if (!parsed.success || parseAllocation(config.allocation) === null) return false;
  if (protocol !== "orca" && protocol !== "raydium") return config.range === null;
  return (
    config.range === null ||
    (Number.isSafeInteger(config.range.tickLower) &&
      Number.isSafeInteger(config.range.tickUpper) &&
      config.range.tickLower < config.range.tickUpper)
  );
}
function validSnapshot(value: SolanaManageSnapshot, protocol: SolanaManageProtocol): boolean {
  const parsed = snapshotSchema.safeParse(value);
  if (
    !parsed.success ||
    value.identity.protocol !== protocol ||
    !validConfig(value.config, protocol)
  )
    return false;
  return Object.entries(value.values).every(
    ([kind, amounts]) =>
      amounts === null ||
      amounts.every(
        (amount) =>
          amount.token.cluster === value.identity.cluster &&
          (value.identity.assets.some((asset) => tokenKey(asset) === tokenKey(amount.token)) ||
            kind === "rewards"),
      ),
  );
}
function normalizeCurrent(
  read: SolanaManageCurrent,
  protocol: SolanaManageProtocol,
): SolanaManageCurrent {
  if (read.status === "unavailable") return absentCurrent(read.reason);
  if (!read.snapshot || !validSnapshot(read.snapshot, protocol))
    return absentCurrent("invalid-snapshot");
  const fresh = read.status === "available" && read.snapshot.freshness === "fresh";
  return {
    ...structuredClone(read),
    status: fresh ? "available" : "stale",
    reason: fresh ? read.reason : "source-not-fresh",
  };
}
function fingerprint(read: SolanaManageCurrent): string | null {
  const snapshot = read.status === "available" ? read.snapshot : null;
  return snapshot
    ? JSON.stringify([
        solanaManageIdentityKey(snapshot.identity),
        snapshot.snapshotId,
        snapshot.config.allocation,
        snapshot.config.pair,
        snapshot.config.range?.tickLower,
        snapshot.config.range?.tickUpper,
        snapshot.source,
        snapshot.values,
      ])
    : null;
}
function validTime(value: string): number | null {
  if (!z.string().datetime({ offset: true }).safeParse(value).success) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}
function validPreview(
  instance: SolanaManageInstance,
  read: SolanaManagePreview,
  now: string,
): boolean {
  if (
    read.status !== "available" ||
    !read.preview ||
    !previewSchema.safeParse(read.preview).success
  )
    return false;
  const p = read.preview,
    base = instance.current.snapshot;
  const clock = validTime(now),
    expiry = validTime(p.validUntil),
    sourceTime = validTime(p.snapshot.source.sourceAsOf);
  if (
    !base ||
    instance.current.status !== "available" ||
    base.freshness !== "fresh" ||
    instance.conflict ||
    !validSnapshot(p.snapshot, instance.protocol) ||
    p.snapshot.freshness !== "fresh" ||
    clock === null ||
    expiry === null ||
    sourceTime === null ||
    expiry <= clock ||
    sourceTime > clock
  )
    return false;
  const baseSourceTime = validTime(base.source.sourceAsOf);
  if (baseSourceTime === null || baseSourceTime > clock) return false;
  const identity = solanaManageIdentityKey(base.identity);
  return (
    p.localId === instance.localId &&
    p.baseSnapshotId === base.snapshotId &&
    p.baseSnapshotId === instance.draft.baseSnapshotId &&
    p.snapshot.snapshotId !== base.snapshotId &&
    p.draftRevision === instance.draft.revision &&
    p.mode === instance.draft.mode &&
    solanaManageIdentityKey(p.identity) === identity &&
    solanaManageIdentityKey(p.snapshot.identity) === identity &&
    sameConfig(p.snapshot.config, instance.draft.config) &&
    p.snapshot.source.kind === base.source.kind &&
    instance.draft.baseFingerprint === fingerprint(instance.current)
  );
}
export function createSolanaManageState(
  inputs: { localId: string; protocol: SolanaManageProtocol; config: SolanaManageConfig }[],
): SolanaManageState {
  const instances: Record<string, SolanaManageInstance> = {};
  for (const input of inputs) {
    if (
      !idSchema.safeParse(input.localId).success ||
      !protocolSchema.safeParse(input.protocol).success ||
      !configSchema.safeParse(input.config).success ||
      Object.hasOwn(instances, input.localId)
    )
      continue;
    const config = structuredClone(input.config);
    if (input.protocol !== "orca" && input.protocol !== "raydium") config.range = null;
    instances[input.localId] = {
      localId: input.localId,
      protocol: input.protocol,
      localConfig: structuredClone(config),
      current: absentCurrent(),
      draft: { config, revision: 0, mode: null, baseSnapshotId: null, baseFingerprint: null },
      conflict: null,
      preview: absentPreview(),
    };
  }
  return { instances, selection: null, journal: {} };
}
function updateInstance(
  state: SolanaManageState,
  instance: SolanaManageInstance,
): SolanaManageState {
  return { ...state, instances: { ...state.instances, [instance.localId]: instance } };
}
function withJournal(state: SolanaManageState, input: SolanaManageJournalEntry): SolanaManageState {
  if (
    !journalSchema.safeParse(input).success ||
    new Set(input.checkpoints.map((step) => step.id)).size !== input.checkpoints.length
  )
    return state;
  const previous = state.journal[input.operationId],
    owner = state.instances[input.localId];
  if (previous) {
    if (
      previous.localId !== input.localId ||
      previous.intentRevision !== input.intentRevision ||
      solanaManageIdentityKey(previous.identity) !== solanaManageIdentityKey(input.identity)
    )
      return state;
  } else if (
    !owner ||
    owner.protocol !== input.identity.protocol ||
    (owner.current.snapshot &&
      solanaManageIdentityKey(owner.current.snapshot.identity) !==
        solanaManageIdentityKey(input.identity))
  )
    return state;
  const entry = structuredClone(input);
  if (previous) {
    if (previous.status === "confirmed" || previous.status === "failed")
      entry.status = previous.status;
    entry.signature = previous.signature ?? entry.signature;
    if (previous.signature && input.signature && previous.signature !== input.signature)
      return state;
    const steps = new Map(entry.checkpoints.map((step) => [step.id, step]));
    for (const step of previous.checkpoints) {
      const next = steps.get(step.id);
      if (step.status === "confirmed" || !next) steps.set(step.id, structuredClone(step));
      else if (step.signature) {
        if (next.signature && next.signature !== step.signature) return state;
        next.signature = step.signature;
      }
    }
    entry.checkpoints = [...steps.values()];
  }
  return { ...state, journal: { ...state.journal, [entry.operationId]: entry } };
}
/** No event here executes, signs, retransmits, confirms live policy or updates a balance. */
export function solanaManageReducer(
  state: SolanaManageState,
  action: SolanaManageAction,
): SolanaManageState {
  if (action.type === "sync-drawing") {
    const drawing = createSolanaManageState(action.inputs);
    // A malformed/duplicate drawing batch cannot silently remove an existing owner.
    if (Object.keys(drawing.instances).length !== action.inputs.length) return state;
    let changed = Object.keys(drawing.instances).length !== Object.keys(state.instances).length;
    const instances: SolanaManageState["instances"] = {};
    for (const input of Object.values(drawing.instances)) {
      const previous = state.instances[input.localId];
      if (!previous || previous.protocol !== input.protocol) {
        instances[input.localId] = input;
        changed = true;
      } else if (sameConfig(previous.localConfig, input.localConfig)) {
        instances[input.localId] = previous;
      } else {
        const dirty = !sameConfig(previous.localConfig, previous.draft.config);
        const retainIntent = dirty && !sameConfig(previous.draft.config, input.localConfig);
        instances[input.localId] = {
          ...previous,
          localConfig: input.localConfig,
          draft: retainIntent
            ? previous.draft
            : {
                ...previous.draft,
                config: structuredClone(input.localConfig),
                mode: null,
                revision: previous.draft.revision + 1,
              },
          preview: retainIntent ? previous.preview : absentPreview("drawing-baseline-changed"),
        };
        changed = true;
      }
    }
    if (!changed) return state;
    return {
      ...state,
      instances,
      selection:
        state.selection?.localId && !Object.hasOwn(instances, state.selection.localId)
          ? null
          : state.selection,
    };
  }
  if (action.type === "journal") return withJournal(state, action.entry);
  if (action.type === "select") {
    if (
      action.selection &&
      (!idSchema.safeParse(action.selection.nodeId).success ||
        (action.selection.localId !== null &&
          !Object.hasOwn(state.instances, action.selection.localId)))
    )
      return state;
    return { ...state, selection: structuredClone(action.selection) };
  }
  const instance = Object.hasOwn(state.instances, action.localId)
    ? state.instances[action.localId]
    : undefined;
  if (!instance) return state;
  switch (action.type) {
    case "remove": {
      const instances = { ...state.instances };
      delete instances[action.localId];
      return {
        ...state,
        instances,
        selection: state.selection?.localId === action.localId ? null : state.selection,
      };
    }
    case "edit": {
      const config = { ...instance.draft.config, ...structuredClone(action.patch) };
      if (instance.protocol !== "orca" && instance.protocol !== "raydium") config.range = null;
      if (!configSchema.safeParse(config).success) return state;
      const material = !sameConfig(instance.draft.config, config);
      return updateInstance(state, {
        ...instance,
        draft: {
          ...instance.draft,
          config,
          revision: instance.draft.revision + Number(material),
          mode: sameConfig(config, instance.localConfig) ? null : instance.draft.mode,
        },
        preview: material ? absentPreview("draft-changed") : instance.preview,
      });
    }
    case "choose": {
      if (
        !["move", "future"].includes(action.mode) ||
        sameConfig(instance.localConfig, instance.draft.config)
      )
        return state;
      return updateInstance(state, {
        ...instance,
        draft: {
          ...instance.draft,
          mode: action.mode,
          revision: instance.draft.revision + Number(action.mode !== instance.draft.mode),
        },
        preview:
          action.mode !== instance.draft.mode ? absentPreview("mode-changed") : instance.preview,
      });
    }
    case "back":
      return updateInstance(state, {
        ...instance,
        draft: {
          ...instance.draft,
          mode: null,
          revision: instance.draft.revision + Number(instance.draft.mode !== null),
        },
        preview: absentPreview("mode-changed"),
      });
    case "discard":
      return updateInstance(state, {
        ...instance,
        draft: {
          config: structuredClone(instance.localConfig),
          revision: instance.draft.revision + 1,
          mode: null,
          baseSnapshotId:
            instance.current.status === "available"
              ? (instance.current.snapshot?.snapshotId ?? null)
              : null,
          baseFingerprint: fingerprint(instance.current),
        },
        conflict: null,
        preview: absentPreview("draft-discarded"),
      });
    case "apply-local":
      if (!validConfig(instance.draft.config, instance.protocol) || instance.conflict) return state;
      return updateInstance(state, {
        ...instance,
        localConfig: structuredClone(instance.draft.config),
        draft: { ...instance.draft, mode: null, revision: instance.draft.revision + 1 },
        preview: absentPreview("local-settings-applied"),
      });
    case "rebase":
      if (instance.current.status !== "available" || !instance.current.snapshot) return state;
      return updateInstance(state, {
        ...instance,
        draft: {
          ...instance.draft,
          mode: null,
          baseSnapshotId: instance.current.snapshot.snapshotId,
          baseFingerprint: fingerprint(instance.current),
          revision: instance.draft.revision + 1,
        },
        conflict: null,
        preview: absentPreview("snapshot-rebased"),
      });
    case "reconcile": {
      const current = normalizeCurrent(action.current, instance.protocol),
        stamp = fingerprint(current);
      const first = instance.draft.baseFingerprint === null && instance.current.snapshot === null;
      const changed = stamp !== instance.draft.baseFingerprint;
      const conflict =
        changed && !first
          ? stamp
            ? "snapshot-changed"
            : "current-unavailable"
          : instance.conflict;
      return updateInstance(state, {
        ...instance,
        current,
        conflict,
        draft:
          first && stamp
            ? {
                ...instance.draft,
                baseSnapshotId: current.snapshot?.snapshotId ?? null,
                baseFingerprint: stamp,
              }
            : instance.draft,
        preview: changed && !first ? absentPreview("snapshot-changed") : instance.preview,
      });
    }
    case "preview":
      return updateInstance(state, {
        ...instance,
        preview: validPreview(instance, action.read, action.now)
          ? structuredClone(action.read)
          : absentPreview("invalid-preview"),
      });
  }
}
/** Caller selects a registered local instance; no fallback draft is manufactured for unknown IDs. */
export function selectSolanaManageView(state: SolanaManageState, localId: string, now: string) {
  const instance = Object.hasOwn(state.instances, localId) ? state.instances[localId] : undefined;
  if (!instance) throw new RangeError("Unknown local Manage instance");
  const p = validPreview(instance, instance.preview, now) ? instance.preview.preview : undefined;
  return {
    draft: instance.draft,
    current: instance.current,
    after: p
      ? { status: "available" as const, snapshot: p.snapshot }
      : absentCurrent("preview-unavailable"),
    conflict: instance.conflict,
    dirty: !sameConfig(instance.localConfig, instance.draft.config),
    localApplyValid:
      validConfig(instance.draft.config, instance.protocol) && instance.conflict === null,
    canConfirm: false as const,
    transactionDetails: { status: "unavailable" as const, reason: "local-preview-only" },
  };
}
