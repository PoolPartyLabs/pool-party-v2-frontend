/**
 * @id PP-MGR-CMP-061
 * @name panelIds tests
 * @implements-rules-version v1 (POO-2187 rules v1)
 * @analytics-events none, pure functions under test
 *
 * The ids a panel body writes (review M3 of PR #54): the mandate rows' canonical keys, which the
 * reducer stores since PA1, and the shell's normalisation that turns a row id or another casing
 * into them, inside the block's network only.
 */
import { describe, expect, it } from "vitest";
import type { MandateDraft } from "../../mandateDraft";
import { makeTestDraft, TEST_ASSET_KEYS, TEST_POOL_IDS } from "../plan/planTestKit";
import { makeRealModeDraft, REAL_POOL_ID, realPoolRow } from "../plan/realPoolTestKit";
import { canonicalPanelConfig, panelAssetKey, panelPoolId } from "./panelIds";

describe("panelPoolId and panelAssetKey (M3)", () => {
  it("names a real pool by its bare PoolId, never its row id, and a mock pool by its id", () => {
    // @rule M3
    const real = realPoolRow();
    expect(real.id).toContain(":");
    expect(panelPoolId(real)).toBe(REAL_POOL_ID);
    const mock = makeTestDraft().pools[0];
    if (!mock) throw new Error("fixture");
    expect(panelPoolId(mock)).toBe(TEST_POOL_IDS.arbitrum);
  });

  it("names an asset network:address, lowercase", () => {
    // @rule M3
    expect(panelAssetKey({ network: "arbitrum", address: "0xAbCd" })).toBe("arbitrum:0xabcd");
  });
});

describe("canonicalPanelConfig (M3, enforced by the shell)", () => {
  const real: MandateDraft = makeRealModeDraft();

  it("turns a real row's id, or its PoolId in another case, into the bare PoolId", () => {
    // @rule M3
    const row = realPoolRow();
    const where = { draft: real, network: row.network };
    expect(canonicalPanelConfig({ poolId: row.id, slippagePct: 2 }, where)).toEqual({
      poolId: REAL_POOL_ID,
      slippagePct: 2,
    });
    expect(canonicalPanelConfig({ poolId: REAL_POOL_ID.toUpperCase() }, where).poolId).toBe(
      REAL_POOL_ID,
    );
  });

  it("matches only inside the block's network, and leaves an id the mandate lacks as written", () => {
    // @rule M3
    // @rule P1
    const draft = makeTestDraft();
    expect(
      canonicalPanelConfig({ poolId: TEST_POOL_IDS.arbitrum }, { draft, network: "robinhood" })
        .poolId,
    ).toBe(TEST_POOL_IDS.arbitrum);
    expect(
      canonicalPanelConfig({ poolId: "0xnot-in-the-mandate" }, { draft, network: "arbitrum" }),
    ).toEqual({ poolId: "0xnot-in-the-mandate" });
  });

  it("turns an asset key in another case into tokenKey", () => {
    // @rule M3
    const draft = makeTestDraft();
    expect(
      canonicalPanelConfig(
        { assetKey: TEST_ASSET_KEYS.usdcArbitrum.toUpperCase() },
        { draft, network: "arbitrum" },
      ),
    ).toEqual({ assetKey: TEST_ASSET_KEYS.usdcArbitrum });
  });
});
