/** @id PP-CP-LIB-026 @name Cash+ explicit fresh fork startup @implements-rules-version v1 */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  closeSync,
  cpSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { basename, resolve } from "node:path";
import { createPublicClient, http } from "viem";
import { acquireSignerLock, releaseSignerLock, type SignerLock } from "./journal";
import { assertFork, local, type RunState, root, stringify } from "./runtime";

const pause = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

/** Occupied ports are never reused or reset, including another demo's fork. */
export async function unusedForkPort(requested?: string): Promise<number> {
  const first = requested === undefined ? 8550 : Number(requested);
  if (!Number.isInteger(first) || first < 1024 || first > 65535)
    throw new Error("FORK_PORT_REQUIRES_INTEGER_1024_TO_65535");
  const last = requested === undefined ? first + 20 : first;
  for (let port = first; port <= last; port += 1) {
    const available = await new Promise<boolean>((done, reject) => {
      const server = createServer();
      server.once("error", (error: NodeJS.ErrnoException) => {
        if (error.code === "EADDRINUSE") done(false);
        else reject(error);
      });
      server.listen(port, "127.0.0.1", () => server.close(() => done(true)));
    });
    if (available) return port;
  }
  throw new Error("FORK_PORT_IN_USE_CHOOSE_AN_UNUSED_PORT");
}

/** Keep the previous evidence intact and refuse to abandon an unresolved operator write. */
export function archivePreviousRun(
  stateDirectory = local,
  manifestPath = resolve(root, "src/lib/cash-plus/config/deployment.generated.json"),
  archiveDirectory = resolve(root, "scripts/cash-plus/.runs"),
): string | undefined {
  const statePath = resolve(stateDirectory, "state.json");
  if (!existsSync(statePath)) return undefined;
  const initial = JSON.parse(readFileSync(statePath, "utf8")) as RunState;
  const locks: SignerLock[] = [];
  try {
    for (const account of [...new Set(Object.values(initial.actors))].sort())
      locks.push(acquireSignerLock(resolve(stateDirectory, `${account.toLowerCase()}.lock`)));
    locks.push(acquireSignerLock(resolve(stateDirectory, "state.lock")));
    const current = JSON.parse(readFileSync(statePath, "utf8")) as RunState;
    if (current.runId !== initial.runId) throw new Error("RUN_CHANGED_DURING_ARCHIVE");
    if (Object.keys(current.pending).length > 0)
      throw new Error("PENDING_OPERATIONS_RECONCILE_BEFORE_NEW_RUN");
    const archive = resolve(archiveDirectory, `${current.runId}-${randomUUID()}`);
    mkdirSync(archive, { recursive: true });
    cpSync(stateDirectory, archive, {
      recursive: true,
      filter: (source) => !/\.(lock|tmp)$/.test(basename(source)),
    });
    if (existsSync(manifestPath)) cpSync(manifestPath, resolve(archive, "deployment.json"));
    return archive;
  } finally {
    for (const lock of locks.reverse()) releaseSignerLock(lock);
  }
}

/** Reads the source only; all subsequently exposed write endpoints remain loopback Anvil. */
export async function startFreshFork(portArgument?: string, upstreamArgument?: string) {
  const port = await unusedForkPort(portArgument);
  const upstream = upstreamArgument ?? "https://arb1.arbitrum.io/rpc";
  const source = createPublicClient({
    transport: http(upstream, { retryCount: 0, timeout: 5_000 }),
  });
  if ((await source.getChainId()) !== 42161) throw new Error("SOURCE_CHAIN_MISMATCH");
  const latest = await source.getBlock();
  mkdirSync(local, { recursive: true });
  const logPath = resolve(local, `anvil-${port}-${Date.now()}.log`);
  const log = openSync(logPath, "wx");
  const child = spawn(
    "anvil",
    [
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--chain-id",
      "31337",
      "--fork-url",
      upstream,
      "--fork-block-number",
      latest.number.toString(),
      "--silent",
    ],
    { detached: true, stdio: ["ignore", log, log] },
  );
  closeSync(log);
  let spawnError: Error | undefined;
  child.once("error", (error) => {
    spawnError = error;
  });
  child.unref();
  const rpcUrl = `http://127.0.0.1:${port}`;
  try {
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (spawnError) throw spawnError;
      if (child.exitCode !== null) throw new Error(`ANVIL_START_FAILED_SEE ${logPath}`);
      try {
        const response = await fetch(rpcUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "anvil_metadata", params: [] }),
          signal: AbortSignal.timeout(500),
        });
        const body = (await response.json()) as { result?: unknown };
        ready = response.ok && body.result !== undefined;
      } catch {
        /* The newly spawned server has not bound its port yet. */
      }
      if (ready) break;
      await pause(100);
    }
    if (!ready) throw new Error(`ANVIL_START_TIMEOUT_SEE ${logPath}`);
    const metadata = await assertFork(rpcUrl);
    if (metadata.forkedNetwork?.forkBlockHash !== latest.hash)
      throw new Error("NEW_FORK_SOURCE_HASH_MISMATCH");
    const startup = { rpcUrl, pid: child.pid, sourceBlock: latest.number.toString(), logPath };
    writeFileSync(resolve(local, `anvil-${port}.json`), `${stringify(startup)}\n`);
    return startup;
  } catch (error) {
    child.kill("SIGTERM");
    throw error;
  }
}

export function historicalForkStateUnavailable(error: unknown): boolean {
  return /metadata is not found|missing trie node|historical state (?:is )?unavailable/i.test(
    String(error),
  );
}
