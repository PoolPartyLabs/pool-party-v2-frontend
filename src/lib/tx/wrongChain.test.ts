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
 *
 * Two classification decisions are pinned here on purpose, because both read as surprises:
 *   - a DECLINED corrective switch classifies as `wrongChain`, not `userRejected` — the choke point
 *     catches the wallet's 4001 and re-throws it under the WRONG_CHAIN code, and "switch it to X"
 *     is precisely that user's remedy;
 *   - a build-vs-target mismatch (`BUILD_TARGET_MISMATCH`) classifies as `unknown`, because the
 *     wallet may be on the right chain and telling that user to switch networks is misleading.
 */
import { arbitrum, base, polygon } from "viem/chains";
import { describe, expect, it } from "vitest";
import { classifyTxError, toTxError } from "./diagnostics";
import {
  BUILD_TARGET_MISMATCH_CODE,
  type Eip1193Provider,
  sendBuiltTransaction,
  TransactionError,
  WRONG_CHAIN_CODE,
} from "./sendTransaction";

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

  /**
   * [R1/R2] Built the way `assertProviderOnChain` actually builds it: the choke point CATCHES the
   * wallet's 4001 rejection of the corrective switch and re-throws with the WRONG_CHAIN code, the
   * target chain, and the original rejection as `cause`. So the nested 4001 and its "user rejected"
   * message are both reachable here, and the stable code still wins.
   *
   * This is deliberate, not a misclassification: the person who just declined the switch prompt is
   * exactly the person whose remedy is "switch it to Arbitrum and try again", so the actionable,
   * network-named copy beats a generic "you declined this". Production emits no USER_REJECTED on
   * this path at all.
   */
  it("classifies a declined corrective switch as wrongChain, carrying the target chain", () => {
    const declined = Object.assign(new Error("User rejected the request."), { code: 4001 });
    const error = new TransactionError(
      "Wallet is on chain 137 but this transaction targets chain 42161",
      { code: WRONG_CHAIN_CODE, targetChainId: arbitrum.id, cause: declined },
    );
    expect(classifyTxError(error)).toBe("wrongChain");
    const txError = toTxError(error);
    expect(txError.kind).toBe("wrongChain");
    expect(txError.targetChainId).toBe(arbitrum.id);
  });

  /**
   * The build-vs-target mismatch is a server/client build bug, NOT a wallet state: the wallet can be
   * sitting on the correct chain. Rendering "switch networks in your wallet" there points the user
   * at something they cannot fix, so it carries its own code, stays out of the catalog, and its
   * message is worded to dodge the `targets chain \d+` pattern. Asserted against the error the real
   * choke point throws, so the wording guard is real and not a restatement of the test's own fixture.
   */
  it("does not classify a build-vs-target mismatch as wrongChain", async () => {
    const unreachableWallet: Eip1193Provider = {
      request: async () => {
        throw new Error("the wallet must never be reached for a build/target mismatch");
      },
    };
    const error = await sendBuiltTransaction(
      unreachableWallet,
      { tx: { to: "0xc", data: "0xd", value: "0" }, chainId: arbitrum.id },
      "0xWALLET",
      base.id,
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TransactionError);
    expect(error).toMatchObject({ cause: { code: BUILD_TARGET_MISMATCH_CODE } });
    expect(classifyTxError(error)).toBe("unknown");
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
