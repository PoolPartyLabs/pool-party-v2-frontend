/**
 * @id PP-MGR-LIB-064
 * @name solanaCatalog tests
 * @description Local protocol family and unavailable-capability regression cases.
 * @figma https://www.figma.com/design/jjOf5DL9uVEB7WBR9nGb4A?node-id=8679-382
 * @linear https://linear.app/yeildbay/issue/POO-2291
 * @implements-rules-version v1 (POO-2291)
 * @analytics-events none, contract tests.
 */
import { describe, expect, it } from "vitest";
import { createPreviewState, PREVIEW_PROTOCOLS, previewReducer } from "./previewModel";
import {
  jupiterInspectionSchema,
  SOLANA_HOLDING_DESCRIPTOR,
  SOLANA_LOCAL_CATALOG,
  SOLANA_LOCAL_PROTOCOLS,
  solanaCatalogEntrySchema,
  solanaLocalInstanceSchema,
} from "./solanaCatalog";
import { USDC_MINT, WSOL_MINT } from "./solanaSchemas";

const absent = { status: "unavailable", reason: "not-integrated", source: null };
const execution = { status: "unavailable", reason: "local-preview-only" };
const observed = {
  kind: "observed",
  source: "account-read",
  sourceAsOf: "2026-10-07T20:00:00Z",
  slot: "1",
  commitment: "confirmed",
};
const fixture = {
  kind: "fixture",
  fixtureId: "catalog-case",
  sourceAsOf: "2026-10-07T20:00:00Z",
  slot: null,
};

describe("typed local Solana catalog", () => {
  // @rule R1/R10: the current menu is consumed from the catalog without new UI modes.
  it("retains the four existing editor choices in order through the real consumer", () => {
    expect(SOLANA_LOCAL_PROTOCOLS).toEqual(["kamino", "jupiter", "raydium", "orca"]);
    expect(PREVIEW_PROTOCOLS).toBe(SOLANA_LOCAL_PROTOCOLS);
    expect(SOLANA_LOCAL_CATALOG).toHaveLength(4);
    for (const entry of SOLANA_LOCAL_CATALOG)
      expect(solanaCatalogEntrySchema.parse(entry)).toEqual(entry);
    expect(PREVIEW_PROTOCOLS).not.toContain("holding");
  });
  // @rule R2/R3: local metadata cannot promote fixtures to real reads or execution capability.
  it("has no fabricated reads and rejects execution-enabled catalog entries", () => {
    for (const descriptor of [...SOLANA_LOCAL_CATALOG, SOLANA_HOLDING_DESCRIPTOR]) {
      const entry = solanaCatalogEntrySchema.parse(descriptor);
      expect(entry.execution).toEqual(execution);
      expect(entry.program).toEqual(absent);
      expect(entry.position).toEqual(absent);
      const liveRead = { status: "available", value: WSOL_MINT, source: fixture };
      expect(solanaCatalogEntrySchema.safeParse({ ...entry, program: liveRead }).success).toBe(
        false,
      );
      expect(
        solanaCatalogEntrySchema.safeParse({ ...entry, program: { ...liveRead, source: observed } })
          .success,
      ).toBe(false);
      expect(
        solanaCatalogEntrySchema.safeParse({ ...entry, execution: { status: "available" } })
          .success,
      ).toBe(false);
    }
  });
  // @rule R4: Supply USDC does not authorize Kamino Borrow or Multiply.
  it("narrows Kamino to Supply USDC with absent market, reserve and account risk", () => {
    const entry = solanaCatalogEntrySchema.parse(SOLANA_LOCAL_CATALOG[0]);
    expect(entry).toMatchObject({
      protocol: "kamino",
      family: "kamino-supply",
      asset: { mint: USDC_MINT, decimals: 6 },
      market: absent,
      reserve: absent,
      accountRisk: absent,
      principal: absent,
      interest: absent,
      rewards: absent,
    });
    expect(solanaCatalogEntrySchema.safeParse({ ...entry, family: "kamino-borrow" }).success).toBe(
      false,
    );
    expect(
      solanaCatalogEntrySchema.safeParse({ ...entry, family: "kamino-multiply" }).success,
    ).toBe(false);
    expect(
      solanaCatalogEntrySchema.safeParse({
        ...entry,
        asset: {
          kind: "native",
          symbol: "SOL",
          decimals: 9,
          unit: "lamports",
          network: "solana",
          cluster: "mainnet-beta",
        },
      }).success,
    ).toBe(false);
  });
  // @rule R5: pool orientation and grid verification belong to each CLMM protocol.
  it("keeps Orca and Raydium families separate with unverified pool grids", () => {
    const raydium = solanaCatalogEntrySchema.parse(SOLANA_LOCAL_CATALOG[2]);
    const orca = solanaCatalogEntrySchema.parse(SOLANA_LOCAL_CATALOG[3]);
    expect(raydium).toMatchObject({
      protocol: "raydium",
      family: "raydium-clmm",
      pool: absent,
      tickGrid: absent,
      feeModel: absent,
      fees: absent,
      rewards: absent,
      canonicalMints: absent,
    });
    expect(orca).toMatchObject({
      protocol: "orca",
      family: "orca-whirlpools",
      pool: absent,
      tickGrid: absent,
      feeModel: absent,
      fees: absent,
      rewards: absent,
      canonicalMints: absent,
    });
    expect(
      solanaCatalogEntrySchema.safeParse({ ...raydium, family: "orca-whirlpools" }).success,
    ).toBe(false);
    expect(solanaCatalogEntrySchema.safeParse({ ...raydium, family: "raydium-cpmm" }).success).toBe(
      false,
    );
    expect(
      solanaCatalogEntrySchema.safeParse({
        ...orca,
        tickGrid: { status: "available", value: { min: -887272, max: 887272 }, source: fixture },
      }).success,
    ).toBe(false);
  });
  // @rule R6/R7: custody is distinct from conversion and has no LP range or interest claim.
  it("keeps Holding contract-only, without LP fields or execution", () => {
    const holding = solanaCatalogEntrySchema.parse(SOLANA_HOLDING_DESCRIPTOR);
    expect(holding).toMatchObject({
      protocol: "holding",
      family: "holding",
      custody: absent,
      asset: absent,
      quantity: absent,
      wrapPlan: absent,
      execution,
    });
    expect(solanaCatalogEntrySchema.safeParse({ ...holding, range: absent }).success).toBe(false);
    expect(solanaCatalogEntrySchema.safeParse({ ...holding, apy: "5" }).success).toBe(false);
    expect(solanaCatalogEntrySchema.safeParse({ ...holding, collectFees: true }).success).toBe(
      false,
    );
  });
  // @rule R7: quote expiry and blockhash validity never overwrite each other.
  it("distinguishes managed order/execute from composable build inspection", () => {
    const common = {
      inputMint: USDC_MINT,
      outputMint: WSOL_MINT,
      rawInput: "9007199254740993",
      quoteValidity: absent,
      transactionValidity: absent,
      execution,
    };
    const managed = { ...common, mode: "managed-order-execute", requestId: "request-a" };
    const build = { ...common, mode: "composable-build", instructionPrograms: [WSOL_MINT] };
    expect(jupiterInspectionSchema.parse(managed)).toEqual(managed);
    expect(jupiterInspectionSchema.parse(build)).toEqual(build);
    expect(
      jupiterInspectionSchema.safeParse({ ...managed, instructionPrograms: [WSOL_MINT] }).success,
    ).toBe(false);
    expect(jupiterInspectionSchema.safeParse({ ...build, requestId: "request-a" }).success).toBe(
      false,
    );
    expect(jupiterInspectionSchema.safeParse({ ...managed, outputMint: USDC_MINT }).success).toBe(
      false,
    );
    expect(
      jupiterInspectionSchema.safeParse({
        ...managed,
        quoteValidity: {
          status: "available",
          value: { expiresAt: "2026-10-07T20:10:00Z" },
          source: fixture,
        },
        transactionValidity: {
          status: "available",
          value: { blockhash: WSOL_MINT, lastValidBlockHeight: "9007199254740993" },
          source: fixture,
        },
      }).success,
    ).toBe(true);
    expect(
      jupiterInspectionSchema.safeParse({
        ...managed,
        transactionValidity: {
          status: "available",
          value: { expiresAt: "2026-10-07T20:10:00Z" },
          source: fixture,
        },
      }).success,
    ).toBe(false);
  });
  // @rule R8: same pool/resource metadata never collapses two local configuration instances.
  it("preserves independent IDs when adding two blocks of the same protocol", () => {
    let state = previewReducer(createPreviewState(), { type: "add", protocol: "orca" });
    state = previewReducer(state, { type: "add", protocol: "orca" });
    expect(state.blocks.map((block) => block.id)).toEqual(["preview-1", "preview-2"]);
    const first = {
      localId: "preview-1",
      catalogId: "solana:mainnet-beta:orca-whirlpools",
      position: absent,
    };
    const second = { ...first, localId: "preview-2" };
    expect(solanaLocalInstanceSchema.parse(first)).toEqual(first);
    expect(solanaLocalInstanceSchema.parse(second)).toEqual(second);
    expect(solanaLocalInstanceSchema.safeParse({ ...first, localId: "" }).success).toBe(false);
  });
});
