// @vitest-environment node
/** @id PP-CP-LIB-024 @name Cash+ operator safety tests @implements-rules-version v1 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Address, decodeAbiParameters, type Hex, keccak256, parseAbiParameters } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  B,
  canonicalTraits,
  compileOrder,
  encodeOrder,
  orderHash,
  requireLocalForkUrl,
  takerTraits,
} from "../../scripts/cash-plus/compiler";
import {
  archivePreviousRun,
  historicalForkStateUnavailable,
  unusedForkPort,
} from "../../scripts/cash-plus/fresh-fork";
import {
  acquireSignerLock,
  reconcilePending,
  releaseSignerLock,
} from "../../scripts/cash-plus/journal";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
describe("Cash+ canonical encoder", () => {
  const vault = "0x1111111111111111111111111111111111111111" as Address;
  const pricing = "0x2222222222222222222222222222222222222222" as Address;
  const parameters = {
    policyVersion: B(1),
    deadline: B(1700000000),
    salt: `0x${"ab".repeat(32)}` as Hex,
    usdcVirtualBalance: B(100),
    secondaryVirtualBalance: B(100),
  };
  it("encodes official Aqua indexes, argument widths and full order hash", () => {
    const order = compileOrder(vault, pricing, parameters);
    expect(order.traits).toBe(canonicalTraits);
    expect(order.data).toBe(
      `0x0d05006553f100201c${"22".repeat(20)}00000000000000011420${"ab".repeat(32)}`,
    );
    expect((order.data.length - 2) / 2).toBe(71);
    const [decoded] = decodeAbiParameters(
      parseAbiParameters("(address maker,uint256 traits,bytes data)"),
      encodeOrder(order),
    );
    expect(decoded).toEqual(order);
    expect(orderHash(order)).toBe(keccak256(encodeOrder(order)));
    expect(orderHash(order)).not.toBe(keccak256(order.data));
  });
  it("rejects an over-wide deadline and malformed salt", () => {
    expect(() =>
      compileOrder(vault, pricing, { ...parameters, deadline: B(2) ** B(40) }),
    ).toThrow();
    expect(() => compileOrder(vault, pricing, { ...parameters, salt: "0xab" })).toThrow(
      "INVALID_CANONICAL_SALT",
    );
  });
  it("packs input first, no callback, exact-input push with threshold and deadline", () => {
    const bytes = takerTraits(B(100), B(1700000000));
    expect(bytes.slice(42, 46)).toBe("0061");
    expect((bytes.length - 2) / 2).toBe(59);
    expect(bytes.slice(-10)).toBe("006553f100");
    expect(takerTraits(B(100), B(1700000000), false).slice(42, 46)).toBe("0041");
  });
});
describe("operator boundaries and restart", () => {
  it.each([
    "https://arb1.arbitrum.io/rpc",
    "http://example.com:8550",
    "https://localhost:8550",
    "http://user:secret@localhost:8550",
    "http://127.0.0.1:8550?key=secret",
  ])("refuses non-local or credential-bearing RPC %s", (url) => {
    expect(() => requireLocalForkUrl(url)).toThrow("LOCAL_FORK_REQUIRED");
  });
  it("accepts only local HTTP endpoints", () => {
    expect(requireLocalForkUrl("http://127.0.0.1:8550")).toBe("http://127.0.0.1:8550/");
  });
  it("blocks a second signer process and releases the lock", () => {
    const dir = mkdtempSync(join(tmpdir(), "cashplus-lock-"));
    dirs.push(dir);
    const path = join(dir, "signer.lock");
    const lock = acquireSignerLock(path);
    expect(() => acquireSignerLock(path)).toThrow("SIGNER_ALREADY_RUNNING");
    releaseSignerLock(lock);
    releaseSignerLock(acquireSignerLock(path));
  });
  it("recovers a stale lock only after proving the previous process is absent", () => {
    const dir = mkdtempSync(join(tmpdir(), "cashplus-lock-"));
    dirs.push(dir);
    const path = join(dir, "signer.lock");
    writeFileSync(path, JSON.stringify({ pid: 2147483647 }));
    releaseSignerLock(acquireSignerLock(path));
  });
  it("reconciles a pending receipt, preserving timeout and revert as failures", async () => {
    const pending = { hash: `0x${"01".repeat(32)}` as Hex, label: "park" };
    const wait = vi.fn(async () => ({ status: "success" }));
    expect(await reconcilePending(pending, wait)).toEqual({ status: "success" });
    expect(wait).toHaveBeenCalledOnce();
    await expect(
      reconcilePending(pending, async () => {
        throw new Error("timeout");
      }),
    ).rejects.toThrow("timeout");
    await expect(reconcilePending(pending, async () => ({ status: "reverted" }))).rejects.toThrow(
      "PENDING_TRANSACTION_REVERTED",
    );
    expect(await reconcilePending(undefined, wait)).toBeUndefined();
    expect(wait).toHaveBeenCalledOnce();
  });
  it("refuses an occupied fork port without touching the existing server", async () => {
    const server = createServer();
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    try {
      const endpoint = server.address();
      if (!endpoint || typeof endpoint === "string") throw new Error("TEST_SERVER_ADDRESS");
      await expect(unusedForkPort(String(endpoint.port))).rejects.toThrow("FORK_PORT_IN_USE");
      expect(server.listening).toBe(true);
      await expect(unusedForkPort("443")).rejects.toThrow("FORK_PORT_REQUIRES_INTEGER");
    } finally {
      await new Promise<void>((done) => server.close(() => done()));
    }
  });
  it("archives receipts and manifest, leaving source files unchanged and rejecting pending writes", () => {
    const dir = mkdtempSync(join(tmpdir(), "cashplus-archive-"));
    dirs.push(dir);
    const source = join(dir, "local");
    const archives = join(dir, "runs");
    const manifest = join(dir, "deployment.json");
    mkdirSync(source);
    const state = { runId: "test-run", actors: { keeper: "0xabc" }, pending: {} };
    const stateText = JSON.stringify(state);
    writeFileSync(join(source, "state.json"), stateText);
    writeFileSync(join(source, "receipt.json"), "receipt-evidence");
    writeFileSync(manifest, "manifest-evidence");
    const archive = archivePreviousRun(source, manifest, archives);
    expect(archive).toBeDefined();
    if (!archive) throw new Error("TEST_ARCHIVE_MISSING");
    expect(readFileSync(join(archive, "receipt.json"), "utf8")).toBe("receipt-evidence");
    expect(readFileSync(join(archive, "deployment.json"), "utf8")).toBe("manifest-evidence");
    expect(readFileSync(join(source, "state.json"), "utf8")).toBe(stateText);
    expect(existsSync(join(archive, "state.lock"))).toBe(false);
    const lock = acquireSignerLock(join(source, "0xabc.lock"));
    try {
      expect(() => archivePreviousRun(source, manifest, archives)).toThrow(
        "SIGNER_ALREADY_RUNNING",
      );
    } finally {
      releaseSignerLock(lock);
    }
    writeFileSync(
      join(source, "state.json"),
      JSON.stringify({ ...state, pending: { "0xabc": { hash: "0x01" } } }),
    );
    expect(() => archivePreviousRun(source, manifest, archives)).toThrow(
      "PENDING_OPERATIONS_RECONCILE",
    );
    expect(existsSync(join(source, "state.lock"))).toBe(false);
    expect(readFileSync(join(archive, "state.json"), "utf8")).toBe(stateText);
  });
  it("distinguishes expired historical storage from a policy rejection", () => {
    expect(historicalForkStateUnavailable(new Error("metadata is not found, 482538129"))).toBe(
      true,
    );
    expect(historicalForkStateUnavailable(new Error("missing trie node"))).toBe(true);
    expect(historicalForkStateUnavailable(new Error("FillLimit"))).toBe(false);
  });
});
