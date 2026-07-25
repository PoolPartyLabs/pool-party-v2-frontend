import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { toFunctionSelector } from "viem";
import { describe, expect, it } from "vitest";
import {
  AQUA_REGISTRY,
  AQUA_SWAP_VM_ROUTER,
  assertNotDeadGeneration,
  DEAD_GEN1_ROUTER,
  MAKER_HOOK_SELECTOR,
  MAKER_HOOK_SIGNATURE,
} from ".";

/**
 * SRV-R4 is enforced by the `server-only` marker package: importing a module that carries it
 * from a client component is a BUILD error in Next. That guarantee is only as good as our
 * discipline in putting the import on every file, so this test checks it mechanically.
 *
 * `db/schema.ts` is the one deliberate exception: drizzle-kit reads it from a plain Node
 * process to generate migrations, and it declares table shapes only, holding no secret and
 * opening no connection. The module that actually connects (`db/client.ts`) is guarded.
 */

const AQUA_ROOT = join(process.cwd(), "src/lib/aqua");
const EXEMPT = new Set(["db/schema.ts"]);

function moduleFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return moduleFiles(full);
    if (!entry.name.endsWith(".ts")) return [];
    if (entry.name.endsWith(".test.ts")) return [];
    return [full];
  });
}

describe("aqua module server-only guard", () => {
  const files = moduleFiles(AQUA_ROOT);

  it("finds the module files", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)("%s imports server-only", (file) => {
    const key = relative(AQUA_ROOT, file);
    const source = readFileSync(file, "utf8");
    if (EXEMPT.has(key)) {
      // The exemption is only safe while the file stays inert.
      expect(source).not.toMatch(/process\.env/);
      expect(source).not.toMatch(/postgres\(/);
      return;
    }
    expect(source).toMatch(/^import "server-only";/m);
  });

  it("never reads AQUA_DATABASE_URL outside config/env.ts", () => {
    const offenders = files
      .filter((file) => relative(AQUA_ROOT, file) !== "config/env.ts")
      .filter((file) => readFileSync(file, "utf8").includes("AQUA_DATABASE_URL"));
    expect(offenders).toEqual([]);
  });
});

describe("aqua address config", () => {
  it("exposes the gen-2 pair", () => {
    expect(AQUA_REGISTRY).toBe("0x1111113CCf1426A8E30e2bfF5E005d929bF6a90a");
    expect(AQUA_SWAP_VM_ROUTER).toBe("0x1111113Db0e0ef9D0E3A50d5f094a3a57a26C0DE");
  });

  it("refuses the dead gen-1 deployment, case-insensitively", () => {
    expect(() => assertNotDeadGeneration(DEAD_GEN1_ROUTER)).toThrow(/dead gen-1/);
    expect(() => assertNotDeadGeneration(DEAD_GEN1_ROUTER.toUpperCase())).toThrow(/dead gen-1/);
  });

  it("accepts the gen-2 pair", () => {
    expect(() => assertNotDeadGeneration(AQUA_REGISTRY)).not.toThrow();
    expect(() => assertNotDeadGeneration(AQUA_SWAP_VM_ROUTER)).not.toThrow();
  });
});

describe("measured maker hook (VLT-R9 v2)", () => {
  /**
   * The selector is the thing the router actually dispatches on, and it was measured off the
   * live router. Deriving it here means an edit to the signature can never silently leave the
   * constant pointing at a function nobody calls.
   */
  it("selector is the keccak of the signature we publish", () => {
    expect(toFunctionSelector(MAKER_HOOK_SIGNATURE)).toBe(MAKER_HOOK_SELECTOR);
  });

  it("is the 9-argument form, not the 2-argument one the frozen list originally named", () => {
    const args = MAKER_HOOK_SIGNATURE.slice(
      MAKER_HOOK_SIGNATURE.indexOf("(") + 1,
      MAKER_HOOK_SIGNATURE.lastIndexOf(")"),
    ).split(",");
    expect(args).toHaveLength(9);
    expect(MAKER_HOOK_SIGNATURE.startsWith("preTransferOut(")).toBe(true);
    // tokenOut and amountOut are what the vault needs to know to cover the fill.
    expect(args[3]).toBe("address");
    expect(args[5]).toBe("uint256");
  });
});
