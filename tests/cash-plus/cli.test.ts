// @vitest-environment node
/** @id PP-CP-LIB-024 @name Cash+ operator safety tests @implements-rules-version v1 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
});
