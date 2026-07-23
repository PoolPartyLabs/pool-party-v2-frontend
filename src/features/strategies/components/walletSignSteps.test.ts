/**
 * @id PP-CORE-MOD-009
 * @name walletSignSteps.test
 * Unit tests for the wallet-signing step builder (POO-295): variable N, approve-per-token order,
 * optional permit, always-terminal confirm.
 */
import { describe, expect, it } from "vitest";
import { buildWalletSignSteps } from "./walletSignSteps";

describe("buildWalletSignSteps", () => {
  it("builds a single confirm step when nothing else is required", () => {
    const steps = buildWalletSignSteps({ confirm: "collect" });
    expect(steps).toEqual([{ key: "confirm:collect", kind: "confirm", confirm: "collect" }]);
  });

  it("prepends one approve step per token, in order", () => {
    const steps = buildWalletSignSteps({ approvals: ["USDC", "WETH"], confirm: "addLiquidity" });
    expect(steps.map((s) => s.key)).toEqual([
      "approve:USDC",
      "approve:WETH",
      "confirm:addLiquidity",
    ]);
    expect(steps[0]).toMatchObject({ kind: "approve", token: "USDC" });
    expect(steps[1]).toMatchObject({ kind: "approve", token: "WETH" });
  });

  it("inserts the permit step between approvals and the confirm", () => {
    const steps = buildWalletSignSteps({
      approvals: ["USDC"],
      permit2: true,
      confirm: "addLiquidity",
    });
    expect(steps.map((s) => s.kind)).toEqual(["approve", "permit", "confirm"]);
  });

  it("supports a permit-only (no approve) transaction", () => {
    const steps = buildWalletSignSteps({ permit2: true, confirm: "withdraw" });
    expect(steps.map((s) => s.key)).toEqual(["permit", "confirm:withdraw"]);
  });

  it("always ends with the confirm step carrying its kind", () => {
    const steps = buildWalletSignSteps({ approvals: ["USDC"], confirm: "compound" });
    const last = steps.at(-1);
    expect(last).toMatchObject({ kind: "confirm", confirm: "compound" });
  });

  it("inserts the build step after permit and before confirm", () => {
    const steps = buildWalletSignSteps({
      approvals: ["USDC"],
      permit2: true,
      build: true,
      confirm: "addLiquidity",
    });
    expect(steps.map((s) => s.kind)).toEqual(["approve", "permit", "build", "confirm"]);
    expect(steps[2]).toEqual({ key: "build", kind: "build" });
  });

  it("supports a build-only (no approve/permit) transaction", () => {
    const steps = buildWalletSignSteps({ build: true, confirm: "moveRange" });
    expect(steps.map((s) => s.key)).toEqual(["build", "confirm:moveRange"]);
  });

  it("carries the new confirm kinds (moveRange, closePosition)", () => {
    expect(buildWalletSignSteps({ confirm: "moveRange" }).at(-1)).toMatchObject({
      confirm: "moveRange",
    });
    expect(buildWalletSignSteps({ confirm: "closePosition" }).at(-1)).toMatchObject({
      confirm: "closePosition",
    });
  });

  it("omitting build is unchanged (backward-compatible)", () => {
    const steps = buildWalletSignSteps({ approvals: ["USDC"], permit2: true, confirm: "invest" });
    expect(steps.map((s) => s.kind)).toEqual(["approve", "permit", "confirm"]);
  });
});
