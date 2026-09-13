/** @id PP-CP-LIB-021 @name Cash+ local operation transport @implements-rules-version v1 */

import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  type Abi,
  type Address,
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  defineChain,
  type Hex,
  http,
  keccak256,
  type TransactionReceipt,
} from "viem";
import {
  type CashPlusDeployment,
  parseCashPlusDeployment,
} from "../../src/lib/cash-plus/config/deployments";
import { B, requireLocalForkUrl } from "./compiler";
import { acquireSignerLock, reconcilePending, releaseSignerLock } from "./journal";
export const root = process.cwd();
export const local = resolve(root, "scripts/cash-plus/.local");
export const contractsRoot = resolve(
  process.env.CASH_PLUS_CONTRACTS_ROOT ?? resolve(root, "../cash-plus-contracts/contracts"),
);
export const ZERO = "0x0000000000000000000000000000000000000000" as Address;
export const official = {
  usdc: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
  secondary: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9",
  aqua: "0x1111113CCf1426A8E30e2bfF5E005d929bF6a90a",
  router: "0x111111338c5091E8440b67B168bAe16a668AC0De",
  pool: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
  aUsdc: "0x724dc807b04555b71ed48a6896b6F41593b8C637",
  aSecondary: "0x6ab707Aca953eDAeFBc4fD23bA73294241490620",
  usdcFeed: "0x50834F3163758fcC1Df9973b6e91f0F0F0434aD3",
  secondaryFeed: "0x3f3f5dF88dC9F13eac63DF89EC16ef6e7E25DdE7",
  sequencer: "0xFdB631F5EE196F0ed6FAa767959853A9F217697D",
} as const;
export const upstreamCommit = "32c687c2b73101fc26549e48fa1ff8a4d73afbac";
export const artifactNames = [
  "CashPlusVault",
  "CashPlusAaveAdapter",
  "CashPlusPricing",
  "CashPlusProgramFactory",
  "CashPlusOracle",
  "CashPlusLens",
  "CashPlusDeploymentFactory",
] as const;
export type Artifact = { abi: Abi; bytecode: { object: Hex }; deployedBytecode: { object: Hex } };
export type Actors = {
  governance: Address;
  investor: Address;
  keeper: Address;
  guardian: Address;
  counterparty: Address;
};
export type Operation = { label: string; hash: Hex; block: string; gas: string; events: unknown[] };
export type RunState = {
  runId: string;
  rpcUrl: string;
  sourceBlock: string;
  actors: Actors;
  deployment?: CashPlusDeployment;
  pending: Record<string, { hash: Hex; label: string }>;
  operations: Operation[];
  orders: Record<string, { maker: Address; traits: string; data: Hex; deadline: string }>;
  abiHashes: Record<string, string>;
  forkInstanceId: string;
  fixture: Record<string, string>;
};
export const stringify = (value: unknown) =>
  JSON.stringify(value, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2);
export const artifact = (name: string): Artifact =>
  JSON.parse(
    readFileSync(resolve(contractsRoot, "out", `${name}.sol`, `${name}.json`), "utf8"),
  ) as Artifact;
export function exportAbis(): void {
  for (const name of artifactNames) {
    const exportedName = `${name[0]?.toLowerCase()}${name.slice(1)}Abi`;
    const target = resolve(root, "src/lib/cash-plus/abi", `${name}.ts`);
    writeFileSync(
      target,
      `/** Generated from the companion Solidity artifact. Regenerate with cash-plus:export. */\nexport const ${exportedName} = ${stringify(artifact(name).abi)} as const;\n`,
    );
  }
  execFileSync("pnpm", ["exec", "biome", "format", "--write", "src/lib/cash-plus/abi"], {
    cwd: root,
    stdio: "ignore",
  });
}
export function loadState(): RunState {
  return JSON.parse(readFileSync(resolve(local, "state.json"), "utf8")) as RunState;
}
export function saveState(state: RunState, clearedPending: Address[] = []): void {
  mkdirSync(local, { recursive: true });
  let lock: ReturnType<typeof acquireSignerLock> | undefined;
  for (let attempt = 0; attempt < 80 && !lock; attempt += 1) {
    try {
      lock = acquireSignerLock(resolve(local, "state.lock"));
    } catch (error) {
      if (!(error instanceof Error) || error.message !== "SIGNER_ALREADY_RUNNING") throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
  }
  if (!lock) throw new Error("STATE_JOURNAL_BUSY");
  try {
    const path = resolve(local, "state.json");
    const previous = existsSync(path)
      ? (JSON.parse(readFileSync(path, "utf8")) as RunState)
      : undefined;
    if (previous?.runId === state.runId) {
      state.operations = [
        ...new Map(
          [...previous.operations, ...state.operations].map((op) => [op.hash, op]),
        ).values(),
      ];
      state.orders = { ...previous.orders, ...state.orders };
      state.pending = { ...previous.pending, ...state.pending };
      for (const account of clearedPending) delete state.pending[account.toLowerCase()];
    }
    const temporary = resolve(local, `state-${process.pid}.tmp`);
    writeFileSync(temporary, stringify(state));
    renameSync(temporary, path);
  } finally {
    releaseSignerLock(lock);
  }
}
export function newState(
  rpcUrl: string,
  sourceBlock: string,
  actors: Actors,
  forkInstanceId: string,
): RunState {
  return {
    runId: randomUUID(),
    rpcUrl,
    sourceBlock,
    actors,
    pending: {},
    operations: [],
    orders: {},
    abiHashes: Object.fromEntries(
      artifactNames.map((n) => [
        n,
        createHash("sha256")
          .update(JSON.stringify(artifact(n).abi))
          .digest("hex"),
      ]),
    ),
    forkInstanceId,
    fixture: {
      seedUsdc: "1000000000",
      sponsorSecondaryDonation: "100000000",
      baseSpreadBps: "5",
      maxFillBps: "100",
      dailyBudgetBps: "2000",
      hotUsdcBps: "500",
      hotSecondaryBps: "0",
      contractFees: "0",
    },
  };
}
export function buildContracts(): void {
  execFileSync("forge", ["build", "--sizes"], {
    cwd: contractsRoot,
    env: { ...process.env, FOUNDRY_PROFILE: "cashplus" },
    stdio: "inherit",
  });
}
export function clients(rpcUrl: string) {
  requireLocalForkUrl(rpcUrl);
  const chain = defineChain({
    id: 31337,
    name: "Cash+ Arbitrum fork",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  });
  const transport = http(rpcUrl, { retryCount: 2, retryDelay: 500, timeout: 30_000 });
  return {
    publicClient: createPublicClient({ chain, transport }),
    wallet: createWalletClient({ chain, transport }),
  };
}
export async function rpc<T>(url: string, method: string, params: unknown[] = []): Promise<T> {
  requireLocalForkUrl(url);
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const data = (await response.json()) as { result?: T; error?: { message: string } };
  if (!response.ok || data.error || data.result === undefined)
    throw new Error(`RPC_${method}: ${data.error?.message ?? response.status}`);
  return data.result;
}
const validatedForkInstances = new Set<string>();
export async function assertFork(url: string, expectedInstance?: string) {
  const c = clients(url);
  if ((await c.publicClient.getChainId()) !== 31337) throw new Error("LOCAL_FORK_CHAIN_REQUIRED");
  const metadata = await rpc<{
    instanceId: string;
    forkedNetwork?: { chainId: number; forkBlockNumber: number; forkBlockHash: Hex };
  }>(url, "anvil_metadata");
  if (!metadata.forkedNetwork) throw new Error("ARBITRUM_FORK_REQUIRED");
  // Anvil 1.0 reports the overridden local chainId in forkedNetwork. Prove origin with the source block hash instead.
  if (!validatedForkInstances.has(metadata.instanceId)) {
    const source = createPublicClient({
      transport: http("https://arb1.arbitrum.io/rpc", { retryCount: 2, timeout: 30_000 }),
    });
    if ((await source.getChainId()) !== 42161) throw new Error("SOURCE_CHAIN_MISMATCH");
    const original = await source.getBlock({
      blockNumber: B(metadata.forkedNetwork.forkBlockNumber),
    });
    if (original.hash !== metadata.forkedNetwork.forkBlockHash)
      throw new Error("SOURCE_BLOCK_HASH_MISMATCH");
    validatedForkInstances.add(metadata.instanceId);
  }
  if (expectedInstance && metadata.instanceId !== expectedInstance)
    throw new Error("FORK_RESET_DETECTED_REDEPLOY_WITH_NEW_RUN");
  return metadata;
}
export async function read(
  address: Address,
  abi: Abi,
  functionName: string,
  args: readonly unknown[] = [],
): Promise<unknown> {
  const state = loadState();
  return clients(state.rpcUrl).publicClient.readContract({ address, abi, functionName, args });
}
export async function resumePending(account: Address): Promise<void> {
  const state = loadState();
  const pending = state.pending[account.toLowerCase()];
  if (!pending) return;
  const receipt = await reconcilePending(pending, (hash) =>
    clients(state.rpcUrl).publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 }),
  );
  const latest = loadState();
  delete latest.pending[account.toLowerCase()];
  saveState(latest, [account]);
  if (receipt) recordReceipt(pending.label, receipt);
  console.log(`Reconciled prior ${pending.label}: ${pending.hash}`);
}
function recordReceipt(label: string, receipt: TransactionReceipt): void {
  const state = loadState();
  if (state.operations.some((op) => op.hash === receipt.transactionHash)) return;
  const decoded: unknown[] = [];
  for (const log of receipt.logs)
    for (const name of artifactNames) {
      try {
        const e = decodeEventLog({ abi: artifact(name).abi, data: log.data, topics: log.topics });
        decoded.push({ address: log.address, ...e });
        break;
      } catch {
        /* Other protocols are retained in raw receipt. */
      }
    }
  state.operations.push({
    label,
    hash: receipt.transactionHash,
    block: receipt.blockNumber.toString(),
    gas: receipt.gasUsed.toString(),
    events: decoded,
  });
  saveState(state);
  writeFileSync(resolve(local, `${receipt.transactionHash}.json`), stringify(receipt));
}
export async function transact(
  account: Address,
  address: Address,
  abi: Abi,
  functionName: string,
  args: readonly unknown[] = [],
  label = functionName,
): Promise<TransactionReceipt> {
  const state = loadState();
  await assertFork(state.rpcUrl, state.forkInstanceId);
  mkdirSync(local, { recursive: true });
  const lock = resolve(local, `${account.toLowerCase()}.lock`);
  const acquired = acquireSignerLock(lock);
  try {
    await resumePending(account);
    const c = clients(state.rpcUrl);
    const { request } = await c.publicClient.simulateContract({
      address,
      abi,
      functionName,
      args,
      account,
    });
    const estimate = await c.publicClient.estimateContractGas({
      address,
      abi,
      functionName,
      args,
      account,
    });
    const gas = estimate + (estimate + B(3)) / B(4);
    const hash = await c.wallet.writeContract({ ...request, gas });
    const pending = loadState();
    pending.pending[account.toLowerCase()] = { hash, label };
    saveState(pending);
    console.log(`${label}: submitted ${hash}`);
    const receipt = await c.publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 });
    if (receipt.status !== "success") throw new Error(`TRANSACTION_REVERTED ${hash}`);
    const finished = loadState();
    delete finished.pending[account.toLowerCase()];
    saveState(finished, [account]);
    recordReceipt(label, receipt);
    return receipt;
  } finally {
    releaseSignerLock(acquired);
  }
}
export async function deployment(): Promise<CashPlusDeployment> {
  const state = loadState();
  const d = parseCashPlusDeployment(state.deployment);
  await assertFork(state.rpcUrl, state.forkInstanceId);
  return d;
}
export async function codeHash(address: Address): Promise<Hex> {
  const state = loadState();
  const code = await clients(state.rpcUrl).publicClient.getCode({ address });
  if (!code || code === "0x") throw new Error(`MISSING_CODE ${address}`);
  return keccak256(code);
}
export const stateExists = () => existsSync(resolve(local, "state.json"));
export async function deployArtifact(account: Address, name: string): Promise<Address> {
  const state = loadState();
  await assertFork(state.rpcUrl, state.forkInstanceId);
  const lock = acquireSignerLock(resolve(local, `${account.toLowerCase()}.lock`));
  try {
    await resumePending(account);
    const c = clients(state.rpcUrl);
    const a = artifact(name);
    const gas = await c.publicClient.estimateGas({ account, data: a.bytecode.object });
    const hash = await c.wallet.deployContract({
      account,
      abi: a.abi,
      bytecode: a.bytecode.object,
      gas: gas + gas / B(4),
    });
    const pending = loadState();
    pending.pending[account.toLowerCase()] = { hash, label: `deploy ${name}` };
    saveState(pending);
    const receipt = await c.publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 });
    if (receipt.status !== "success" || !receipt.contractAddress)
      throw new Error(`DEPLOY_FAILED ${hash}`);
    const finished = loadState();
    delete finished.pending[account.toLowerCase()];
    saveState(finished, [account]);
    recordReceipt(`deploy ${name}`, receipt);
    return receipt.contractAddress;
  } finally {
    releaseSignerLock(lock);
  }
}
