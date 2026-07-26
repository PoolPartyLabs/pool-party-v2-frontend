import { describe, expect, it } from "vitest";
import PartyVaultArtifact from "./PartyVault.json";
import { PARTY_VAULT_VIEW_ABI } from "./partyVault";

type AbiEntry = {
  readonly type: string;
  readonly name?: string;
  // Readonly, so the `as const` ABI is assignable without a double cast.
  readonly inputs?: ReadonlyArray<{ readonly type: string }>;
  readonly outputs?: ReadonlyArray<{ readonly type: string }>;
  readonly stateMutability?: string;
};

const artifact = PartyVaultArtifact as AbiEntry[];

/**
 * The const ABI is `readonly` with per-entry literal tuples, so an entry with no inputs types
 * its `inputs` as `readonly []` and mapping it yields `never`. Widening once here keeps the
 * comparison below readable; the const version is still what viem infers from at the call site.
 */
const ours = PARTY_VAULT_VIEW_ABI as readonly AbiEntry[];

/**
 * The narrow const ABI exists for viem's type inference; the JSON artifact is the truth
 * exported from the contracts repo. This keeps them from drifting apart silently.
 *
 * The failure this prevents is specific and nasty: a contract change renames or removes a
 * view, the artifact is re-exported, and the page keeps compiling against a const ABI that
 * describes a function nobody implements. It would only fail at runtime, against mainnet,
 * during the demo.
 */
describe("PartyVault narrow ABI matches the published artifact", () => {
  it.each(
    ours.map((entry) => entry.name),
  )("%s exists in the artifact with a matching signature", (name) => {
    const mine = ours.find((entry) => entry.name === name);
    const theirs = artifact.find((entry) => entry.type === "function" && entry.name === name);

    expect(theirs, `${name} is missing from PartyVault.json`).toBeDefined();
    expect(theirs?.inputs?.map((i) => i.type) ?? []).toEqual(
      mine?.inputs?.map((i) => i.type) ?? [],
    );
    expect(theirs?.outputs?.map((o) => o.type) ?? []).toEqual(
      mine?.outputs?.map((o) => o.type) ?? [],
    );
    expect(theirs?.stateMutability).toBe(mine?.stateMutability);
  });

  it("only declares view functions, since this page never writes", () => {
    for (const entry of ours) {
      expect(entry.stateMutability).toBe("view");
    }
  });

  it("carries the measured maker hook, so the vault we read is the vault Aqua calls", () => {
    const hook = artifact.find((entry) => entry.name === "preTransferOut");
    expect(hook, "PartyVault.json has no preTransferOut").toBeDefined();
    expect(hook?.inputs?.map((i) => i.type)).toEqual([
      "address",
      "address",
      "address",
      "address",
      "uint256",
      "uint256",
      "bytes32",
      "bytes",
      "bytes",
    ]);
  });
});
