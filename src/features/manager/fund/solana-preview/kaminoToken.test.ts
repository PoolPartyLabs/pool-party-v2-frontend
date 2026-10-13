/**
 * @id PP-MGR-LIB-098
 * @name kaminoToken tests
 * @implements-rules-version v1 (POO-2351)
 * @analytics-events none, pure helpers.
 *
 * R4: the token options of the Kamino Lend panel. R5: the token that the Kamino block keeps, and
 * how a saved pair reads as a token. R6: the panel has a token for every mandate with USDC.
 */
import { describe, expect, it } from "vitest";
import { isConfigFor } from "../build/plan/blockConfig";
import {
  createEmptyDraft,
  type MandateDraft,
  type MandateTokenRef,
  withNetworks,
} from "../mandateDraft";
import {
  KAMINO_CATALOG_ID,
  kaminoConfigFor,
  kaminoTokenLogo,
  kaminoTokenOf,
  kaminoTokenOptions,
} from "./kaminoToken";
import { buildSolanaBuilderCatalog } from "./solanaBuilderRuntime";
import { USDC_MINT, WSOL_MINT } from "./solanaSchemas";

function token(symbol: string, address: string, network = "solana"): MandateTokenRef {
  return { address, symbol, name: symbol, network, logoUrl: null } as MandateTokenRef;
}

function draftWith(...tokens: MandateTokenRef[]): MandateDraft {
  const base = withNetworks(
    createEmptyDraft("2026-10-13T00:00:00.000Z", "poo-2351"),
    ["solana"],
    buildSolanaBuilderCatalog(),
  );
  return { ...base, tokens };
}

describe("POO-2351 R4: the token select of the Kamino Lend panel", () => {
  // @rule R4
  it("[R4] offers USDC alone when the mandate has neither SOL nor WSOL on Solana", () => {
    expect(kaminoTokenOptions(draftWith(token("USDC", USDC_MINT)))).toEqual(["USDC"]);
    expect(kaminoTokenOptions(draftWith())).toEqual(["USDC"]);
  });

  // @rule R4
  it("[R4] adds SOL when the mandate has WSOL on Solana, by mint or by symbol", () => {
    expect(kaminoTokenOptions(draftWith(token("WSOL", WSOL_MINT)))).toEqual(["USDC", "SOL"]);
    expect(kaminoTokenOptions(draftWith(token("SOL", "native-sol")))).toEqual(["USDC", "SOL"]);
    expect(
      kaminoTokenOptions(draftWith(token("USDC", USDC_MINT), token("WSOL", WSOL_MINT))),
    ).toEqual(["USDC", "SOL"]);
  });

  // @rule R4
  it("[R4] ignores a SOL token of another network", () => {
    expect(kaminoTokenOptions(draftWith(token("WSOL", WSOL_MINT, "arbitrum")))).toEqual(["USDC"]);
  });
});

describe("POO-2351 R5: the token that the Kamino block keeps", () => {
  // @rule R5
  it("[R5] reads a saved pair as its first token", () => {
    expect(kaminoTokenOf({ catalogId: KAMINO_CATALOG_ID, pair: "USDC / SOL" })).toBe("USDC");
    expect(kaminoTokenOf({ catalogId: KAMINO_CATALOG_ID, pair: "SOL / USDC" })).toBe("SOL");
  });

  // @rule R5
  it("[R5] reads the saved token before the pair, and a block without config as USDC", () => {
    expect(kaminoTokenOf({ catalogId: KAMINO_CATALOG_ID, pair: "USDC / SOL", token: "SOL" })).toBe(
      "SOL",
    );
    expect(kaminoTokenOf(null)).toBe("USDC");
  });

  // @rule R5
  it("[R5] writes a config with the token, a matching pair and a valid shape", () => {
    const usdc = kaminoConfigFor("USDC");
    const sol = kaminoConfigFor("SOL");
    expect(usdc).toEqual({ catalogId: KAMINO_CATALOG_ID, pair: "USDC / SOL", token: "USDC" });
    expect(sol).toEqual({ catalogId: KAMINO_CATALOG_ID, pair: "SOL / USDC", token: "SOL" });
    expect(isConfigFor("solanaKaminoSupply", usdc)).toBe(true);
    expect(isConfigFor("solanaKaminoSupply", sol)).toBe(true);
    expect(isConfigFor("solanaKaminoSupply", { ...sol, token: "ETH" })).toBe(false);
    expect(isConfigFor("solanaKaminoSupply", { ...sol, token: "USDC" })).toBe(false);
    expect(
      isConfigFor("solanaKaminoSupply", { catalogId: KAMINO_CATALOG_ID, pair: "SOL / USDC" }),
    ).toBe(true);
    expect(isConfigFor("solanaRaydiumPool", { ...sol, catalogId: "x", token: "SOL" })).toBe(false);
  });
});

describe("POO-2351 R6: the Kamino panel is never unavailable", () => {
  // @rule R6
  it("[R6] always has a token option and a config for it", () => {
    const [first] = kaminoTokenOptions(draftWith());
    expect(first).toBe("USDC");
    expect(kaminoConfigFor(first ?? "USDC").catalogId).toBe(KAMINO_CATALOG_ID);
  });
});

describe("POO-2351 R4: the logo of a token option", () => {
  // @rule R4
  it("[R4] draws SOL with the Solana mark and USDC with the token logo function", () => {
    expect(kaminoTokenLogo("SOL")).toMatchObject({ symbol: "SOL", network: "solana" });
    expect(kaminoTokenLogo("SOL").logoUrl).toBeTruthy();
    expect(kaminoTokenLogo("USDC")).toEqual({ symbol: "USDC", network: "solana" });
  });
});
