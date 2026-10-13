/**
 * @id PP-MGR-LIB-102 (POO-2262)
 * @name sendSolanaTransaction
 * @implements-rules-version DEC-190 (founder ruling, unversioned)
 */
import {
  assertIsFullySignedTransaction,
  getBase58Decoder,
  getBase64Decoder,
  getCompiledTransactionMessageDecoder,
  getSignatureFromTransaction,
  getTransactionDecoder,
  type ReadonlyUint8Array,
} from "@solana/kit";

/** `getGenesisHash` of Solana mainnet-beta: the full 44-character hash, not the CAIP-2 reference. */
export const SOLANA_MAINNET_GENESIS_HASH = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
/**
 * Lighthouse, the assertion program Phantom may append to a transaction before signing it
 * (docs.phantom.com/developer-powertools/lighthouse). The only program a wallet may add.
 */
export const LIGHTHOUSE_PROGRAM = "L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95";
export const COMPUTE_BUDGET_PROGRAM = "ComputeBudget111111111111111111111111111111";
/** Ceiling on a priority fee: 1,000,000 micro-lamports per CU (0.0014 SOL at 1.4M CU). */
export const MAX_MICRO_LAMPORTS_PER_CU = BigInt(1_000_000);
/** Ceiling on the priority fee a wallet may add: 0.01 SOL. */
const MAX_PRIORITY_FEE_LAMPORTS = BigInt(10_000_000);

export interface SolanaLifetime {
  blockhash: string;
  lastValidBlockHeight: bigint;
}
/** An unsigned transaction and the lifetime its builder chose. The builder owns the blockhash. */
export interface SolanaBuiltTransaction {
  bytes: Uint8Array;
  lifetime: SolanaLifetime;
}
export interface SolanaTransactionRpc {
  genesisHash(): Promise<string>;
  blockHeight(): Promise<bigint>;
  send(bytes: Uint8Array): Promise<string>;
  status(signature: string): Promise<"success" | "reverted" | "unknown">;
}

/**
 * A failure that provably happened before any broadcast: the transaction never reached a leader, so
 * the step can be rebuilt and signed again without a double-spend risk (F5 of the 2026-10-09 sweep).
 */
export class SolanaNotSubmittedError extends Error {
  readonly notSubmitted = true;
}
export function isSolanaNotSubmitted(error: unknown): boolean {
  return error instanceof SolanaNotSubmittedError;
}
function notSubmitted(code: string): never {
  throw new SolanaNotSubmittedError(code);
}

/** JSON-RPC codes for a transaction the node refused before forwarding it to a leader. */
const PREFLIGHT_REFUSALS = new Set([-32002, -32003, -32013, -32015]);
function rpcErrorCode(error: unknown): number | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current && typeof current === "object"; depth += 1) {
    const nested = (current as { context?: { __code?: unknown } }).context?.__code;
    if (typeof nested === "number") return nested;
    const direct = (current as { code?: unknown }).code;
    if (typeof direct === "number") return direct;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}
const stableCode = (error: unknown, fallback: string) =>
  error instanceof Error && /^[A-Z][A-Z0-9_]{2,63}$/.test(error.message) ? error.message : fallback;

type CompiledMessage = ReturnType<
  ReturnType<typeof getCompiledTransactionMessageDecoder>["decode"]
>;
/** Each instruction by program address, resolved accounts with their writability, and data. */
function resolvedInstructions(message: CompiledMessage) {
  const { numSignerAccounts, numReadonlySignerAccounts, numReadonlyNonSignerAccounts } =
    message.header;
  const total = message.staticAccounts.length;
  const accounts = message.staticAccounts.map((account, index) => {
    const writable =
      index < numSignerAccounts
        ? index < numSignerAccounts - numReadonlySignerAccounts
        : index < total - numReadonlyNonSignerAccounts;
    return `${account}:${writable ? "w" : "r"}`;
  });
  const lookups = ("addressTableLookups" in message && message.addressTableLookups) || [];
  for (const lookup of lookups)
    for (const index of lookup.writableIndexes)
      accounts.push(`${lookup.lookupTableAddress}#${index}:w`);
  for (const lookup of lookups)
    for (const index of lookup.readonlyIndexes)
      accounts.push(`${lookup.lookupTableAddress}#${index}:r`);
  const resolve = (index: number) => {
    const account = accounts[index];
    if (account === undefined) throw new Error("UNSAFE_SOLANA_TRANSACTION");
    return account;
  };
  return message.instructions.map((instruction) => {
    const indices = instruction.accountIndices ?? [];
    const data = instruction.data ?? new Uint8Array();
    return {
      program: message.staticAccounts[instruction.programAddressIndex],
      indices,
      data,
      key: [
        resolve(instruction.programAddressIndex),
        ...indices.map(resolve),
        Array.from(data, (byte) => byte.toString(16).padStart(2, "0")).join(""),
      ].join("|"),
    };
  });
}
type ResolvedInstruction = ReturnType<typeof resolvedInstructions>[number];
/** A well-formed SetComputeUnitLimit or SetComputeUnitPrice, or null. */
function computeBudget({
  indices,
  data,
}: ResolvedInstruction): { limit?: bigint; price?: bigint } | null {
  if (indices.length) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (data[0] === 2 && data.length === 5) return { limit: BigInt(view.getUint32(1, true)) };
  if (data[0] === 3 && data.length === 9) return { price: view.getBigUint64(1, true) };
  return null;
}

/** Why a wallet-returned message differs unsafely from the built one, or null when it is safe. */
function signedMessageMismatch(
  unsignedBytes: ReadonlyUint8Array,
  signedBytes: ReadonlyUint8Array,
): string | null {
  const decoder = getCompiledTransactionMessageDecoder();
  const unsigned = decoder.decode(unsignedBytes);
  const signed = decoder.decode(signedBytes);
  const lookups = (message: CompiledMessage) =>
    JSON.stringify(("addressTableLookups" in message && message.addressTableLookups) || []);
  const signers = unsigned.header.numSignerAccounts;
  if (unsigned.version !== 0 || signed.version !== 0) return "version";
  if (signed.lifetimeToken !== unsigned.lifetimeToken) return "blockhash";
  if (lookups(signed) !== lookups(unsigned)) return "lookups";
  if (
    signers === 0 ||
    signed.header.numSignerAccounts !== signers ||
    signed.header.numReadonlySignerAccounts !== unsigned.header.numReadonlySignerAccounts ||
    unsigned.staticAccounts
      .slice(0, signers)
      .some((account, index) => signed.staticAccounts[index] !== account)
  )
    return "signers";
  const built = resolvedInstructions(unsigned);
  const sent = resolvedInstructions(signed);
  const isPayload = (instruction: ResolvedInstruction) =>
    instruction.program !== COMPUTE_BUDGET_PROGRAM && instruction.program !== LIGHTHOUSE_PROGRAM;
  const payload = (list: ResolvedInstruction[]) => list.filter(isPayload).map(({ key }) => key);
  if (payload(sent).join("\n") !== payload(built).join("\n")) return "payload";
  const firstPayload = sent.findIndex(isPayload);
  if (
    sent.some(
      (instruction, position) =>
        instruction.program === LIGHTHOUSE_PROGRAM &&
        (firstPayload < 0 ||
          position < firstPayload ||
          instruction.indices.some((index) => index > 0 && index < signers)),
    )
  )
    return "lighthouse";
  const budget = (list: ResolvedInstruction[]) =>
    list.filter((instruction) => instruction.program === COMPUTE_BUDGET_PROGRAM).map(computeBudget);
  const sentBudget = budget(sent);
  const limits = sentBudget.flatMap((entry) => (entry?.limit === undefined ? [] : [entry.limit]));
  const prices = sentBudget.flatMap((entry) => (entry?.price === undefined ? [] : [entry.price]));
  if (sentBudget.includes(null) || limits.length > 1 || prices.length > 1) return "compute_budget";
  const builtLimit = budget(built).find((entry) => entry?.limit !== undefined)?.limit;
  const limit = limits[0];
  if (
    (limit !== undefined && limit > BigInt(1_400_000)) ||
    (builtLimit !== undefined && (limit === undefined || limit < builtLimit))
  )
    return "compute_unit_limit";
  const price = prices[0] ?? BigInt(0);
  if (price > MAX_MICRO_LAMPORTS_PER_CU) return "compute_unit_price";
  // Without a limit instruction the runtime grants 200k CU per other instruction, up to 1.4M.
  const effectiveLimit =
    limit ?? BigInt(Math.min(1_400_000, 200_000 * (sent.length - sentBudget.length)));
  if (price * effectiveLimit > MAX_PRIORITY_FEE_LAMPORTS * BigInt(1_000_000)) return "priority_fee";
  return null;
}

/**
 * The wallet may return a recompiled message: Phantom adds Lighthouse assertions (new readonly
 * accounts, renumbered indices) and may add a priority fee or raise the compute-unit limit. Accept
 * that and nothing else: same version, blockhash, lookups and signers; the built non-budget
 * instructions unchanged and in order (program, accounts by address and writability, data);
 * Lighthouse only after the first of them, touching no signer but the fee payer; compute budget
 * only one unit limit (never lowered, at most 1.4M) and one unit price (at most
 * MAX_MICRO_LAMPORTS_PER_CU, fee at most 0.01 SOL). Anything else is unsafe and provably unsent,
 * logged with both messages (public data) so the wallet's change can be read.
 */
function assertSignedMessageMatches(
  unsignedBytes: ReadonlyUint8Array,
  signedBytes: ReadonlyUint8Array,
): void {
  if (
    unsignedBytes.length === signedBytes.length &&
    unsignedBytes.every((byte, index) => byte === signedBytes[index])
  )
    return;
  let reason: string | null;
  try {
    reason = signedMessageMismatch(unsignedBytes, signedBytes);
  } catch {
    reason = "undecodable";
  }
  if (reason === null) return;
  const base64 = getBase64Decoder();
  console.error("[solana] signed message rejected", {
    reason,
    unsigned: base64.decode(unsignedBytes),
    signed: base64.decode(signedBytes),
  });
  notSubmitted("UNSAFE_SOLANA_TRANSACTION");
}

/**
 * DEC-190, API contract §3.1: sign the API-built bytes as they are (the API owns the blockhash),
 * persist the signature BEFORE broadcasting, and never rebuild an uncertain send. Every failure
 * before the broadcast reached a leader is a {@link SolanaNotSubmittedError}.
 */
export async function sendSolanaTransaction(input: {
  walletAddress: string;
  rpc: SolanaTransactionRpc;
  build: () => Promise<SolanaBuiltTransaction>;
  sign: (bytes: Uint8Array) => Promise<Uint8Array>;
  /** Extra local signers (a fresh position NFT mint), applied after the wallet signature. */
  cosign?: (bytes: Uint8Array) => Promise<Uint8Array>;
  persist: (signature: string) => void;
  signal?: AbortSignal;
}): Promise<string> {
  let genesis: string;
  try {
    genesis = await input.rpc.genesisHash();
  } catch {
    notSubmitted("SOLANA_RPC_UNAVAILABLE");
  }
  if (genesis !== SOLANA_MAINNET_GENESIS_HASH) notSubmitted("SOLANA_CLUSTER_MISMATCH");
  if (input.signal?.aborted) notSubmitted("LAUNCH_CANCELLED");
  let built: SolanaBuiltTransaction;
  try {
    built = await input.build();
  } catch (error) {
    notSubmitted(stableCode(error, "SOLANA_BUILD_FAILED"));
  }
  let unsigned: ReturnType<ReturnType<typeof getTransactionDecoder>["decode"]>;
  let lifetimeToken: string;
  let feePayer: string | undefined;
  try {
    unsigned = getTransactionDecoder().decode(built.bytes);
    const message = getCompiledTransactionMessageDecoder().decode(unsigned.messageBytes);
    lifetimeToken = message.lifetimeToken;
    feePayer = message.staticAccounts[0];
  } catch {
    notSubmitted("UNSAFE_SOLANA_TRANSACTION");
  }
  if (feePayer !== input.walletAddress || lifetimeToken !== built.lifetime.blockhash)
    notSubmitted("UNSAFE_SOLANA_TRANSACTION");
  let height: bigint;
  try {
    height = await input.rpc.blockHeight();
  } catch {
    notSubmitted("SOLANA_RPC_UNAVAILABLE");
  }
  if (height >= built.lifetime.lastValidBlockHeight) notSubmitted("SOLANA_BLOCKHASH_EXPIRED");
  if (input.signal?.aborted) notSubmitted("LAUNCH_CANCELLED");
  let signedBytes: Uint8Array;
  try {
    signedBytes = await input.sign(built.bytes);
    if (input.cosign) signedBytes = await input.cosign(signedBytes);
  } catch (error) {
    notSubmitted(stableCode(error, "SOLANA_SIGN_FAILED"));
  }
  let signed: ReturnType<ReturnType<typeof getTransactionDecoder>["decode"]>;
  try {
    signed = getTransactionDecoder().decode(signedBytes);
    assertIsFullySignedTransaction(signed);
  } catch {
    notSubmitted("SOLANA_SIGNATURE_MISSING");
  }
  assertSignedMessageMatches(unsigned.messageBytes, signed.messageBytes);
  const signature = getSignatureFromTransaction(signed);
  input.persist(signature);
  if (input.signal?.aborted) return signature;
  let broadcastSignature: string;
  try {
    broadcastSignature = await input.rpc.send(signedBytes);
  } catch (error) {
    // A preflight refusal never reached a leader: the persisted signature can never land.
    const code = rpcErrorCode(error);
    if (code !== undefined && PREFLIGHT_REFUSALS.has(code))
      throw new SolanaNotSubmittedError("SOLANA_PREFLIGHT_REJECTED");
    throw error;
  }
  if (broadcastSignature !== signature) throw new Error("SOLANA_SIGNATURE_MISMATCH");
  return signature;
}

export const solanaSignatureBytes = (bytes: Uint8Array) => getBase58Decoder().decode(bytes);
