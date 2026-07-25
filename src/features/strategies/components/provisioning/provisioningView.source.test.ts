/**
 * @id PP-CORE-LIB-018 (POO-1041)
 * @name provisioningView network-name drift guard
 * @implements-rules-version v1
 * @hackathon POO-1022 (Universal Funding)
 *
 * A source-level drift guard, not a behavioral test, mirroring `provisioningSeam.test.ts`.
 *
 * [R3] of POO-1041: network names derive from `src/lib/chains/config.ts`. The mapper used to hold
 * its own `{ 8453: "Base", 42161: "Arbitrum", 137: "Polygon" }`, one of several such maps in the
 * repository, and the failure mode is silent: adding a chain to the config leaves this map behind,
 * so a real plan bridging to the new network renders "Move to " with a hole where its name should
 * be. No rendering test catches that, because the chain that would expose it does not exist yet.
 * Only the source does.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const MAPPER = join(__dirname, "provisioningView.ts");

/**
 * Strip comments before asserting: the prose legitimately names the networks while explaining why
 * the literal map was removed, and a comment is not shipped copy.
 */
function code(): string {
  return readFileSync(MAPPER, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("provisioningView network names (POO-1041 [R3])", () => {
  it.each([
    "Arbitrum",
    "Base",
    "Polygon",
    "Ethereum",
  ])("does not hardcode the network name %s", (network) => {
    expect(code()).not.toContain(`"${network}`);
  });

  it("resolves names through the shared chain config", () => {
    expect(code()).toMatch(
      /import\s*\{[^}]*chainDisplayName[^}]*\}\s*from\s*"@\/lib\/chains\/config"/,
    );
  });
});
