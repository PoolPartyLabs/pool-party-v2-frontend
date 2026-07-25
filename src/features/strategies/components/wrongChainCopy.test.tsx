/**
 * @id PP-STR-MOD-008 (POO-1026)
 * @name wrongChain error copy
 * @implements-rules-version v1
 * @hackathon POO-1022 (Universal Funding)
 *
 * Rules under test (POO-1026 rules v1):
 *   [R3] the network name derives from the chain config (`src/lib/chains/config.ts`), never a local
 *        literal, so adding a chain never means editing copy in a second place
 *   [R4] an unknown or unsupported chain id degrades to the network-less variant. This is the
 *        failure the rule exists for: interpolating an unresolved name would render
 *        "Switch it to undefined and try again", which is worse than saying nothing specific.
 */
import { arbitrum, base, polygon } from "viem/chains";
import { describe, expect, it } from "vitest";
import type { TxError } from "@/lib/tx/diagnostics";
import { renderWithProviders, screen } from "../../../../tests/utils/renderWithProviders";
import { useTxErrorBody } from "./TransactionErrorActions";

/**
 * A probe rather than `renderHook`: the RTL `renderHook` re-exported by the test utils is NOT
 * wrapped in the app providers, and `useTxErrorBody` needs the next-intl context.
 */
function Body({ error }: { error: TxError }) {
  return <p data-testid="body">{useTxErrorBody(error)}</p>;
}

function bodyFor(error: TxError): string {
  renderWithProviders(<Body error={error} />);
  return screen.getByTestId("body").textContent ?? "";
}

function wrongChainError(targetChainId?: number): TxError {
  return {
    code: "WRONG_CHAIN",
    message: "chain mismatch",
    kind: "wrongChain",
    ...(targetChainId != null ? { targetChainId } : {}),
  };
}

describe("wrongChain error copy (POO-1026)", () => {
  // [R3] Each supported chain resolves to its configured name.
  it.each([
    [arbitrum.id, arbitrum.name],
    [base.id, base.name],
    [polygon.id, polygon.name],
  ])("names the target network for chain %i", (chainId, expected) => {
    const body = bodyFor(wrongChainError(chainId));
    expect(body).toContain(expected);
    expect(body).not.toContain("undefined");
  });

  // [R4] An unsupported chain must not leak "undefined" into user-facing copy.
  it("degrades to the network-less variant for an unsupported chain", () => {
    const body = bodyFor(wrongChainError(1));
    expect(body).not.toContain("undefined");
    expect(body).toContain("Switch networks in your wallet");
  });

  // [R4] Same when the error carries no chain id at all.
  it("degrades to the network-less variant when no chain id is present", () => {
    const body = bodyFor(wrongChainError());
    expect(body).not.toContain("undefined");
    expect(body).toContain("Switch networks in your wallet");
  });

  // Regression guard: wrongChain must not have displaced the generic body.
  it("keeps the generic body for an unclassified error", () => {
    const body = bodyFor({ code: "-32603", message: "boom", kind: "unknown" });
    expect(body).toBe("Your transaction didn't go through and no funds were moved.");
  });
});
