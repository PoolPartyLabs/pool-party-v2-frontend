/**
 * @id PP-CORE-LIB-012 (POO-1026)
 * @name wrongChain error classification
 * @implements-rules-version v1
 * @hackathon POO-1022 (Universal Funding)
 *
 * `WRONG_CHAIN` is thrown by the single broadcast choke point (`sendTransaction.ts`) but was absent
 * from the error catalog, so a chain mismatch classified as `"unknown"` and the user saw the generic
 * "didn't go through" copy. A rail that switches networks between legs of a cross-chain plan cannot
 * ship with that: "switch to Arbitrum" is the whole remedy.
 *
 * Rules under test (POO-1026 rules v1):
 *   [R1] `TxErrorKind` gains `wrongChain`; the `WRONG_CHAIN` code maps to it
 *   [R2] the error carries the TARGET chain id, so copy can name the network
 *   [R4] an unknown or unsupported chain id degrades to generic copy, never "Switch to undefined"
 *
 * [R3] (the name derives from the chain config, not a local literal) and [R5] (11 locales) are
 * covered in `TransactionErrorActions` and by `pnpm i18n:check`.
 */
import { arbitrum, base, polygon } from "viem/chains";
import { describe, expect, it } from "vitest";
import { classifyTxError, toTxError } from "./diagnostics";
import { TransactionError, WRONG_CHAIN_CODE } from "./sendTransaction";

describe("wrongChain classification (POO-1026)", () => {
  // [R1] The stable backend/choke-point code is the primary classification source.
  it("classifies the WRONG_CHAIN code as wrongChain", () => {
    const error = new TransactionError(
      "Wallet is on chain 137 but this transaction targets chain 42161",
      {
        code: WRONG_CHAIN_CODE,
        targetChainId: arbitrum.id,
      },
    );
    expect(classifyTxError(error)).toBe("wrongChain");
  });

  // [R2] The target chain rides on the error, so the copy layer never has to parse a message.
  it.each([
    ["Arbitrum", arbitrum.id],
    ["Base", base.id],
    ["Polygon", polygon.id],
  ])("carries the target chain id for %s", (_name, chainId) => {
    const error = new TransactionError("chain mismatch", {
      code: WRONG_CHAIN_CODE,
      targetChainId: chainId,
    });
    const txError = toTxError(error);
    expect(txError.kind).toBe("wrongChain");
    expect(txError.targetChainId).toBe(chainId);
  });

  // [R4] Absent chain id is a legitimate state (a hand-built error), not a crash.
  it("omits the target chain id when the error does not carry one", () => {
    const error = new TransactionError("chain mismatch", { code: WRONG_CHAIN_CODE });
    const txError = toTxError(error);
    expect(txError.kind).toBe("wrongChain");
    expect(txError.targetChainId).toBeUndefined();
  });

  // [R1] The message-pattern fallback catches a wallet-side mismatch that carries no stable code.
  it("classifies a chain-mismatch message with no code", () => {
    expect(classifyTxError(new Error("chain mismatch: wallet is on the wrong network"))).toBe(
      "wrongChain",
    );
  });

  // Precedence guard: a user rejecting the corrective switch prompt is a rejection, not a mismatch.
  // The switch prompt is a wallet dialog, so this is the common real-world overlap.
  it("prefers userRejected when the corrective switch was declined", () => {
    const error = new TransactionError(
      "Wallet is on chain 137 but this transaction targets chain 42161",
      {
        code: "USER_REJECTED",
        targetChainId: arbitrum.id,
      },
    );
    expect(classifyTxError(error)).toBe("userRejected");
  });

  // Regression guard: adding wrongChain must not shadow the existing kinds.
  it.each([
    ["SLIPPAGE_EXCEEDED", "slippage"],
    ["DEADLINE_EXPIRED", "deadlineExpired"],
    ["INSUFFICIENT_FUNDS", "insufficientFunds"],
  ])("leaves %s classifying as %s", (code, kind) => {
    expect(classifyTxError(new TransactionError("x", { code }))).toBe(kind);
  });
});
