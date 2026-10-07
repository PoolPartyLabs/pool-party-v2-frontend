/** @id PP-MGR-LIB-068 @name manageLendingRisk tests @implements-rules-version v1 */
import { describe, expect, it } from "vitest";
import {
  type LendingRiskIdentity,
  type LendingRiskSnapshot,
  type LendingRiskSource,
  type LendingRiskToken,
  lendingRiskAmountDecimal,
  type ManageLendingRiskOrigin,
  projectManageLendingRisk,
} from "./manageLendingRisk";

const evm = (digit: string) => `0x${digit.repeat(40)}`;
const identity: LendingRiskIdentity = {
  protocol: "aave-v3",
  chainId: 42161,
  core: evm("a"),
  account: evm("b"),
  market: evm("c"),
};
const collateral: LendingRiskToken = {
  network: "evm",
  chainId: 42161,
  address: evm("d"),
  symbol: "WETH",
  decimals: 18,
};
const debt: LendingRiskToken = {
  network: "evm",
  chainId: 42161,
  address: evm("e"),
  symbol: "USDC",
  decimals: 6,
};
const source: LendingRiskSource = {
  kind: "observed",
  reference: "account read",
  asOf: "2026-10-07T21:00:00.123456Z",
  blockOrSlot: "9007199254740993123456",
  freshness: "fresh",
};
const origin: ManageLendingRiskOrigin = {
  identity,
  preview: { id: "draft-7", baseSnapshotId: "account-1" },
};
function snapshot(preview = false): LendingRiskSnapshot {
  const id = preview ? "preview-7" : "account-1",
    scenarioId = preview ? "draft-7" : "current-1";
  return {
    identity: structuredClone(identity),
    snapshotId: id,
    source: { ...source },
    complete: true,
    debt: { status: "confirmed", total: { decimal: "5000", currency: "USD" } },
    scenario: preview
      ? { kind: "preview", id: scenarioId, baseSnapshotId: "account-1", valid: true }
      : { kind: "current", id: scenarioId },
    context: {
      snapshotId: id,
      scenarioId,
      method: "Aave account supplied risk result",
      assumptions: [
        "USD oracle quotes held fixed except WETH",
        "Liquidation thresholds supplied by the market",
      ],
      collateral: [{ token: { ...collateral }, raw: "5000000000000000000" }],
      debt: [{ token: { ...debt }, raw: "5000000000" }],
      oracles: [collateral, debt].map((token) => ({
        token: { ...token },
        decimal: token.symbol === "WETH" ? "3000" : "1",
        unit: "USD-per-token",
        provider: "declared oracle",
        snapshotId: id,
        source: { ...source },
      })),
      parameters: [
        { token: { ...collateral }, liquidationThresholdRatio: "0.8", borrowFactorRatio: null },
        { token: { ...debt }, liquidationThresholdRatio: null, borrowFactorRatio: null },
      ],
    },
    healthFactor: { decimal: preview ? "2.7" : "2.4", unit: "ratio", scenarioId },
    liquidationPrice: {
      status: "available",
      decimal: preview ? "1250.123456789" : "1400.123456789",
      unit: "USD-per-token",
      asset: { ...collateral },
      scenarioId,
    },
  };
}
function kaminoSnapshot(preview = false): LendingRiskSnapshot {
  const kamino: LendingRiskIdentity = {
    protocol: "kamino-lend",
    cluster: "mainnet-beta",
    program: "So11111111111111111111111111111111111111112",
    account: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    market: "11111111111111111111111111111111",
    obligation: "So11111111111111111111111111111111111111112",
  };
  const sol: LendingRiskToken = {
    network: "solana",
    cluster: "mainnet-beta",
    kind: "native",
    symbol: "SOL",
    decimals: 9,
  };
  const usdc: LendingRiskToken = {
    network: "solana",
    cluster: "mainnet-beta",
    kind: "spl",
    mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    symbol: "USDC",
    decimals: 6,
  };
  const s = snapshot(preview);
  s.identity = kamino;
  if (!s.context || s.liquidationPrice?.status !== "available") throw new Error("fixture");
  s.context.method = "Kamino supplied obligation adjusted-collateral result";
  s.context.assumptions = ["SOL quote varies while USDC debt quote and quantities remain fixed"];
  s.context.collateral = [{ token: sol, raw: "1000000000" }];
  s.context.debt = [{ token: usdc, raw: "5000000000" }];
  s.context.oracles = [sol, usdc].map((token) => ({
    token,
    decimal: "1",
    unit: "USD-per-token",
    provider: "declared Kamino oracle",
    snapshotId: s.snapshotId,
    source: { ...source },
  }));
  s.context.parameters = [
    { token: sol, liquidationThresholdRatio: "0.75", borrowFactorRatio: null },
    { token: usdc, liquidationThresholdRatio: null, borrowFactorRatio: "1.1" },
  ];
  s.liquidationPrice.asset = sol;
  return s;
}
function project(
  current = snapshot(),
  after: LendingRiskSnapshot | null = snapshot(true),
  input = origin,
) {
  return projectManageLendingRisk(
    input,
    { status: "ready", snapshot: current },
    { status: after ? "ready" : "unavailable", snapshot: after },
  );
}
function unknown(input: LendingRiskSnapshot) {
  const view = project(input).current;
  expect(view.status).toBe("unavailable");
  expect(view.healthFactor).toBeNull();
  expect(view.liquidationPrice).toBeNull();
}
describe("POO-2290 full account lending risk", () => {
  it("[R1,R2,R4] retains independent supplied metrics, account identity and exact provenance", () => {
    const view = project();
    expect(view.identity).toEqual(identity);
    expect(view.current.healthFactor).toBe("2.4");
    expect(view.after.healthFactor).toBe("2.7");
    expect(view.current.liquidationPrice?.decimal).toBe("1400.123456789");
    expect(view.after.liquidationPrice?.decimal).toBe("1250.123456789");
    expect(view.current.source).toEqual(source);
    expect(view.current.context?.collateral).toHaveLength(1);
  });
  // @rule R1,R2,R4: Aave supplied account risk does not require Kamino's borrow factor.
  it("[R1,R2,R4] exposes Aave Current and After without a Kamino borrow factor (POO-2290)", () => {
    const current = snapshot(),
      after = snapshot(true);
    expect(current.context?.parameters[1]?.borrowFactorRatio).toBeNull();
    const view = project(current, after);
    expect(view.current.status).toBe("ready");
    expect(view.current.healthFactor).toBe("2.4");
    expect(view.current.liquidationPrice?.decimal).toBe("1400.123456789");
    expect(view.after.status).toBe("ready");
    expect(view.after.healthFactor).toBe("2.7");
    expect(view.after.liquidationPrice?.decimal).toBe("1250.123456789");
  });
  it("[R1,R4] accepts Aave risk with no debt borrow-factor parameter row", () => {
    const s = snapshot();
    if (!s.context) throw new Error("fixture");
    s.context.parameters = s.context.parameters.filter(
      (parameter) => parameter.liquidationThresholdRatio !== null,
    );
    expect(project(s).current.healthFactor).toBe("2.4");
  });
  // @rule R1,R4: Kamino adjusted debt needs its declared effective borrow factor.
  it("[R1,R4] keeps Kamino unavailable when its debt borrow factor is missing", () => {
    const s = kaminoSnapshot();
    if (!s.context?.parameters[1]) throw new Error("fixture");
    s.context.parameters[1].borrowFactorRatio = null;
    const view = project(s, null, { identity: s.identity, preview: null });
    expect(view.current.status).toBe("unavailable");
    expect(view.current.healthFactor).toBeNull();
    expect(view.current.liquidationPrice).toBeNull();
  });
  // @rule R1,R2,R4: A declared debt asset can be the variable of a liquidation scenario.
  it("[R1,R2,R4] retains Kamino liquidation prices for a declared volatile debt asset (POO-2290)", () => {
    const current = kaminoSnapshot(),
      after = kaminoSnapshot(true);
    for (const s of [current, after]) {
      if (!s.context || s.liquidationPrice?.status !== "available") throw new Error("fixture");
      const asset = s.context.debt[0]?.token;
      if (!asset) throw new Error("fixture");
      s.context.assumptions = [
        "USDC debt quote varies; SOL collateral quote and quantities held fixed",
      ];
      s.liquidationPrice.asset = asset;
      s.liquidationPrice.decimal = s === current ? "2.4" : "2.7";
    }
    const view = project(current, after, { ...origin, identity: current.identity });
    expect(view.current.liquidationPrice).toEqual({
      decimal: "2.4",
      asset: current.context?.debt[0]?.token,
    });
    expect(view.after.liquidationPrice).toEqual({
      decimal: "2.7",
      asset: after.context?.debt[0]?.token,
    });
    expect(view.current.context?.assumptions).toEqual(current.context?.assumptions);
    expect(view.current.source).toEqual(source);
  });
  it.each([
    "scenario",
    "unit",
    "oracleStale",
    "oracleSnapshot",
    "metadata",
  ])("[R4] suppresses a debt-asset liquidation price for invalid %s", (field) => {
    const s = kaminoSnapshot();
    if (!s.context || s.liquidationPrice?.status !== "available") throw new Error("fixture");
    const token = s.context.debt[0]?.token,
      oracle = s.context.oracles[1];
    if (!token || !oracle) throw new Error("fixture");
    s.liquidationPrice.asset = token;
    s.context.assumptions = ["USDC debt quote varies; collateral held fixed"];
    if (field === "scenario") s.liquidationPrice.scenarioId = "another-scenario";
    if (field === "unit") Object.assign(s.liquidationPrice, { unit: "ratio" });
    if (field === "oracleStale") oracle.source.freshness = "stale";
    if (field === "oracleSnapshot") oracle.snapshotId = "another-snapshot";
    if (field === "metadata") s.liquidationPrice.asset = { ...token, decimals: 9 };
    expect(
      project(s, null, { identity: s.identity, preview: null }).current.liquidationPrice,
    ).toBeNull();
  });
  it("[R3] shows not applicable only for confirmed complete total debt zero", () => {
    const s = snapshot();
    s.debt.total = { decimal: "0.0000", currency: "USD" };
    s.context = null;
    const view = project(s).current;
    expect(view.status).toBe("noDebt");
    expect(view.healthFactor).toBeNull();
    expect(view.liquidationPrice).toBeNull();
  });
  it("[R3] never accepts total zero against a supplied positive aggregate debt", () => {
    const s = snapshot();
    if (s.debt.total) s.debt.total.decimal = "0";
    unknown(s);
  });
  it.each([
    "partial",
    "unavailable",
  ] as const)("[R3] rejects %s debt even when its total is zero", (status) => {
    const s = snapshot();
    s.context = null;
    s.debt = { status, total: { decimal: "0", currency: "USD" } };
    unknown(s);
  });
  it.each([
    "stale",
    "unknown",
  ] as const)("[R3,R4] rejects %s source including supplied zero debt", (freshness) => {
    const s = snapshot();
    s.source.freshness = freshness;
    s.context = null;
    s.debt.total = { decimal: "0", currency: "USD" };
    unknown(s);
  });
  it("[R3] rejects partial account even with confirmed debt zero", () => {
    const s = snapshot();
    s.complete = false;
    s.context = null;
    s.debt.total = { decimal: "0", currency: "USD" };
    unknown(s);
  });
  it("[R2] does not copy Current when After is unavailable", () => {
    const view = project(snapshot(), null);
    expect(view.current.status).toBe("ready");
    expect(view.after.status).toBe("unavailable");
    expect(view.after.healthFactor).toBeNull();
  });
  it("[R2] keeps After unavailable without a verified Current base", () => {
    const view = projectManageLendingRisk(
      origin,
      { status: "unavailable", snapshot: null },
      { status: "ready", snapshot: snapshot(true) },
    );
    expect(view.current.status).toBe("unavailable");
    expect(view.after.status).toBe("unavailable");
    expect(view.after.healthFactor).toBeNull();
  });
  it("[R2] rejects an old preview after Current advances even if the host retains the old preview id", () => {
    const current = snapshot();
    current.snapshotId = "account-2";
    if (!current.context) throw new Error("fixture");
    current.context.snapshotId = "account-2";
    current.context.oracles.forEach((oracle) => {
      oracle.snapshotId = "account-2";
    });
    const view = project(current, snapshot(true));
    expect(view.current.healthFactor).toBe("2.4");
    expect(view.after.status).toBe("unavailable");
    expect(view.after.healthFactor).toBeNull();
  });
  it("[R2] rejects a no-debt preview when Current has a mismatched account", () => {
    const current = snapshot(),
      after = snapshot(true);
    current.identity = { ...identity, account: evm("f") };
    after.context = null;
    after.debt.total = { decimal: "0", currency: "USD" };
    const view = project(current, after);
    expect(view.current.status).toBe("unavailable");
    expect(view.after.status).toBe("unavailable");
  });
  it("[R2] verifies the Current base without requiring Current risk metrics to equal After", () => {
    const current = snapshot();
    current.healthFactor = null;
    current.liquidationPrice = null;
    const view = project(current, snapshot(true));
    expect(view.current.healthFactor).toBeNull();
    expect(view.after.healthFactor).toBe("2.7");
  });
  it.each([
    "previewId",
    "baseSnapshot",
    "invalidPreview",
    "currentCopied",
  ])("[R2] rejects After with %s", (field) => {
    const s = snapshot(true);
    if (s.scenario.kind !== "preview") throw new Error("fixture");
    if (field === "previewId") s.scenario.id = "old-draft";
    if (field === "baseSnapshot") s.scenario.baseSnapshotId = "old-account";
    if (field === "invalidPreview") s.scenario.valid = false;
    if (field === "currentCopied") s.scenario = { kind: "current", id: "current-1" };
    expect(project(snapshot(), s).after.status).toBe("unavailable");
  });
  it("[R2] does not claim preview risk when the host has no validated preview", () => {
    expect(project(snapshot(), snapshot(true), { ...origin, preview: null }).after.status).toBe(
      "unavailable",
    );
  });
  it.each([
    "core",
    "account",
    "market",
    "chainId",
  ])("[R1] fails closed on Aave %s mismatch", (field) => {
    const s = snapshot();
    if (s.identity.protocol !== "aave-v3") throw new Error("fixture");
    if (field === "chainId") s.identity.chainId = 1;
    else s.identity[field as "core" | "account" | "market"] = evm("f");
    unknown(s);
  });
  it("[R1] supports case-insensitive verified EVM addresses", () => {
    const s = snapshot();
    if (s.identity.protocol !== "aave-v3") throw new Error("fixture");
    s.identity.account = `0x${"B".repeat(40)}`;
    expect(project(s).current.status).toBe("ready");
  });
  it("[R1,R3] accepts no fabricated identity when the host has no full account", () => {
    const view = project(snapshot(), null, { identity: null, preview: null });
    expect(view.identity).toBeNull();
    expect(view.current.status).toBe("unavailable");
  });
  it.each([
    "context",
    "oracleMissing",
    "oracleStale",
    "oracleSnapshot",
    "thresholdMissing",
    "contextScenario",
    "contextSnapshot",
    "assumptions",
    "raw",
    "tokenNetwork",
    "duplicateAsset",
  ])("[R1,R4] suppresses metrics for invalid %s", (field) => {
    const s = snapshot(),
      c = s.context;
    if (!c) throw new Error("fixture");
    if (field === "context") s.context = null;
    if (field === "oracleMissing") c.oracles.pop();
    if (field === "oracleStale" && c.oracles[0]) c.oracles[0].source.freshness = "stale";
    if (field === "oracleSnapshot" && c.oracles[0]) c.oracles[0].snapshotId = "old";
    if (field === "thresholdMissing" && c.parameters[0])
      c.parameters[0].liquidationThresholdRatio = null;
    if (field === "contextScenario") c.scenarioId = "wrong";
    if (field === "contextSnapshot") c.snapshotId = "wrong";
    if (field === "assumptions") c.assumptions = [];
    if (field === "raw" && c.collateral[0]) c.collateral[0].raw = "1e18";
    if (field === "tokenNetwork" && c.collateral[0]?.token.network === "evm")
      c.collateral[0].token.chainId = 1;
    if (field === "duplicateAsset" && c.collateral[0]) c.collateral.push(c.collateral[0]);
    unknown(s);
  });
  it.each([
    "NaN",
    "Infinity",
    "-1",
    "1e2",
    "",
    "0",
  ])("[R4] rejects invalid liquidation price %s while retaining valid HF", (decimal) => {
    const s = snapshot();
    if (s.liquidationPrice?.status === "available") s.liquidationPrice.decimal = decimal;
    const view = project(s).current;
    expect(view.liquidationPrice).toBeNull();
    expect(view.healthFactor).toBe("2.4");
  });
  it("[R4] does not expose a universal price for an undeclared asset", () => {
    const s = snapshot();
    if (s.liquidationPrice?.status === "available")
      s.liquidationPrice.asset = { ...debt, address: evm("f") };
    expect(project(s).current.liquidationPrice).toBeNull();
  });
  it("[R4] retains a no-positive-root result without inventing zero", () => {
    const s = snapshot();
    s.liquidationPrice = { status: "no-positive-root", scenarioId: s.scenario.id };
    const view = project(s).current;
    expect(view.liquidationPrice).toBeNull();
    expect(view.noPositiveRoot).toBe(true);
    expect(view.healthFactor).toBe("2.4");
  });
  it("[R4] requires metric units and scenario to match", () => {
    const s = snapshot();
    if (s.healthFactor) s.healthFactor.scenarioId = "other";
    if (s.liquidationPrice?.status === "available")
      s.liquidationPrice.unit = "token-per-USD" as "USD-per-token";
    const view = project(s).current;
    expect(view.healthFactor).toBeNull();
    expect(view.liquidationPrice).toBeNull();
  });
  it.each([
    "2026-02-30T12:00:00Z",
    "2026-10-07T24:00:00Z",
    "no time",
  ])("[R4] rejects invalid source timestamp %s", (asOf) => {
    const s = snapshot();
    s.source.asOf = asOf;
    unknown(s);
  });
  it("[R4] preserves multiple collateral and debt metadata without computing a universal price", () => {
    const s = snapshot(),
      c = s.context;
    if (!c) throw new Error("fixture");
    const second = { ...collateral, address: evm("f"), symbol: "WBTC", decimals: 8 };
    c.collateral.push({ token: second, raw: "100000000" });
    c.oracles.push({
      token: second,
      decimal: "60000",
      unit: "USD-per-token",
      provider: "BTC oracle",
      snapshotId: s.snapshotId,
      source: { ...source },
    });
    c.parameters.push({ token: second, liquidationThresholdRatio: "0.7", borrowFactorRatio: null });
    const view = project(s).current;
    expect(view.context?.collateral).toHaveLength(2);
    expect(view.liquidationPrice?.asset.symbol).toBe("WETH");
  });
  it("[R4] keeps tiny and above-safe-integer units exact", () => {
    expect(lendingRiskAmountDecimal({ token: collateral, raw: "1" })).toBe("0.000000000000000001");
    expect(lendingRiskAmountDecimal({ token: debt, raw: "9007199254740993123456" })).toBe(
      "9007199254740993.123456",
    );
  });
  it("[R1,R4] preserves case-sensitive Kamino obligation and slot", () => {
    const kamino: LendingRiskIdentity = {
      protocol: "kamino-lend",
      cluster: "mainnet-beta",
      program: "So11111111111111111111111111111111111111112",
      account: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      market: "11111111111111111111111111111111",
      obligation: "So11111111111111111111111111111111111111112",
    };
    const s = snapshot();
    s.identity = kamino;
    s.context = null;
    s.debt.total = { decimal: "0", currency: "USD" };
    const input = { identity: kamino, preview: null };
    expect(project(s, null, input).current.status).toBe("noDebt");
    s.identity = { ...kamino, obligation: kamino.obligation.replace("So", "so") };
    expect(project(s, null, input).current.status).toBe("unavailable");
  });
  it.each([
    "loading",
    "error",
    "unavailable",
  ] as const)("[R3,R6] preserves %s read without a synthetic risk", (status) => {
    const view = projectManageLendingRisk(
      origin,
      { status, snapshot: null },
      { status: "unavailable", snapshot: null },
    );
    expect(view.current.status).toBe("unavailable");
    expect(view.current.healthFactor).toBeNull();
  });
  it("[R1,R4] does not mutate injected source objects", () => {
    const s = snapshot(),
      before = structuredClone(s);
    project(s);
    expect(s).toEqual(before);
  });
  it("[R1,R4] accepts supplied Kamino risk with native SOL separate from WSOL and exact USDC", () => {
    const s = kaminoSnapshot(),
      kamino = s.identity;
    const sol = s.context?.collateral[0]?.token;
    if (!sol || !s.context) throw new Error("fixture");
    expect(project(s, null, { identity: kamino, preview: null }).current.status).toBe("ready");
    expect(lendingRiskAmountDecimal({ token: sol, raw: "1" })).toBe("0.000000001");
    const oracle = s.context.oracles[0];
    if (!oracle) throw new Error("fixture");
    oracle.token = {
      network: "solana",
      cluster: "mainnet-beta",
      kind: "spl",
      mint: "So11111111111111111111111111111111111111112",
      symbol: "SOL",
      decimals: 9,
    };
    expect(project(s, null, { identity: kamino, preview: null }).current.status).toBe(
      "unavailable",
    );
  });
  it.each([
    "invalidFactor",
    "extraMalformedOracle",
    "extraMalformedParameter",
    "metadataMismatch",
    "unsignedOverflow",
    "zeroDebtWithInvalidRaw",
  ])("[R3,R4] fails closed on %s", (field) => {
    const s = snapshot(),
      c = s.context;
    if (!c) throw new Error("fixture");
    if (field === "invalidFactor" && c.parameters[1]) c.parameters[1].borrowFactorRatio = "0.5";
    if (field === "extraMalformedOracle" && c.oracles[0])
      c.oracles.push({ ...c.oracles[0], decimal: "NaN" });
    if (field === "extraMalformedParameter" && c.parameters[0])
      c.parameters[0].borrowFactorRatio = "NaN";
    if (field === "metadataMismatch" && c.oracles[0])
      c.oracles[0].token = { ...c.oracles[0].token, decimals: 9 };
    if (field === "unsignedOverflow" && c.collateral[0])
      c.collateral[0].raw = (BigInt(2) ** BigInt(256)).toString();
    if (field === "zeroDebtWithInvalidRaw" && c.debt[0]) {
      c.debt[0].raw = "-1";
      s.debt.total = { decimal: "0", currency: "USD" };
    }
    unknown(s);
  });
  it.each([
    "partial",
    "stale",
    "unconfirmed",
  ])("[R2,R3] cannot use %s Current as a preview base", (field) => {
    const current = snapshot();
    if (field === "partial") current.complete = false;
    if (field === "stale") current.source.freshness = "stale";
    if (field === "unconfirmed") current.debt.status = "partial";
    const view = project(current, snapshot(true));
    expect(view.current.status).toBe("unavailable");
    expect(view.after.status).toBe("unavailable");
    expect(view.after.healthFactor).toBeNull();
  });
});
