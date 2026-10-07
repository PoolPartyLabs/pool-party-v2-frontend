// @vitest-environment node
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { bootstrapAuthorizationFixture } from "./bootstrap.fixture";
import { SOLANA_ACCOUNT_SPACES } from "./costs";
import idl from "./generated/pp_spoke.json";
import {
  deriveSolanaBootstrapPdas,
  requireSolanaSpokeProgram,
  SOLANA_SPOKE_PROGRAM,
  SOLANA_SPOKE_RELEASE,
  solanaBootstrapDiscriminator,
} from "./release";

it("pins the final program and production artifact hashes", () => {
  expect(idl.address).toBe(SOLANA_SPOKE_PROGRAM);
  const json = readFileSync(new URL("./generated/pp_spoke.json", import.meta.url));
  const types = readFileSync(new URL("./generated/pp_spoke.ts", import.meta.url));
  const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
  expect(hash(json)).toBe(SOLANA_SPOKE_RELEASE.copiedIdlSha256);
  expect(hash(json.subarray(0, json.length - 1))).toBe(SOLANA_SPOKE_RELEASE.upstreamIdlSha256);
  expect(hash(types)).toBe(SOLANA_SPOKE_RELEASE.copiedTypesSha256);
  expect(() => requireSolanaSpokeProgram("11111111111111111111111111111111")).toThrow(
    "SOLANA_PROGRAM_MISMATCH",
  );
});

it.each([
  "stage_swap_policy",
  "initialize_fund",
] as const)("uses the released %s discriminator, independently verified against Anchor hashing", (instruction) => {
  expect(solanaBootstrapDiscriminator(instruction)).toEqual(
    new Uint8Array(createHash("sha256").update(`global:${instruction}`).digest().subarray(0, 8)),
  );
});

it("derives production Fund/vault/staging PDAs and namespaces each Fund policy", async () => {
  const manager = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
  expect(await deriveSolanaBootstrapPdas(bootstrapAuthorizationFixture, manager)).toEqual({
    fund: "F7fwcaDdYUzGdF4tqextZqynGGYHce3SuFKVbtoy666s",
    vault: "APiDCHTQLY425WrRHnT9YdPdD7kgjkRuKC1pxziGqdE8",
    stage: "6pEGqTFCjRYs3HWpuNWBaH3NauNqKecGw6Fb3aoBWT6b",
  });
  const changed = await deriveSolanaBootstrapPdas(
    { ...bootstrapAuthorizationFixture, policyHash: `0x${"04".repeat(32)}` },
    manager,
  );
  expect(changed.fund).not.toBe(bootstrapAuthorizationFixture.fundPda);
});

it("reconciles account allocation sizes against the production IDL", () => {
  const bounds: Record<string, number> = {
    "FundState.assets": 3,
    "FundState.venues": 8,
    "FundState.position_registry": 32,
    "FundState.transit_registry": 64,
    "FundState.command_registry": 8,
  };
  const size = (type: unknown, path: string): number => {
    if (typeof type === "string") {
      const primitive: Record<string, number> = {
        bool: 1,
        u8: 1,
        u16: 2,
        u32: 4,
        u64: 8,
        i32: 4,
        i64: 8,
        u128: 16,
        pubkey: 32,
      };
      const bytes = primitive[type];
      if (bytes === undefined) throw new Error(`UNKNOWN_IDL_TYPE:${type}`);
      return bytes;
    }
    if (!type || typeof type !== "object") throw new Error("UNKNOWN_IDL_TYPE");
    if ("array" in type) {
      const [element, count] = type.array as [unknown, number];
      return size(element, path) * count;
    }
    if ("vec" in type) {
      const bound = bounds[path];
      if (bound === undefined) throw new Error(`UNKNOWN_IDL_BOUND:${path}`);
      return 4 + size(type.vec, path) * bound;
    }
    if ("defined" in type) {
      const name = (type.defined as { name: string }).name;
      const definition = idl.types.find((entry) => entry.name === name);
      if (!definition) throw new Error(`UNKNOWN_IDL_TYPE:${name}`);
      return definition.type.fields.reduce(
        (total, field) => total + size(field.type, `${name}.${field.name}`),
        0,
      );
    }
    throw new Error("UNKNOWN_IDL_TYPE");
  };
  for (const [name, bytes] of Object.entries(SOLANA_ACCOUNT_SPACES)) {
    expect(8 + size({ defined: { name } }, name), name).toBe(bytes);
  }
});

it.each([
  -1, 65536, 0.5,
])("refuses aliased spoke index %s in PDA derivation", async (spokeIndex) => {
  await expect(
    deriveSolanaBootstrapPdas(
      { ...bootstrapAuthorizationFixture, spokeIndex },
      "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    ),
  ).rejects.toThrow("SOLANA_BOOTSTRAP_INVALID");
});
