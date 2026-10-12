/**
 * @id PP-MGR-LIB-075
 * @name solanaOneBuilder tests
 * @implements-rules-version v1 (POO-2342 rules v1: Solana, Arbitrum and Robinhood in one builder)
 * @analytics-events none, the names are read from source here and never emitted
 *
 * Pure-logic proof of the POO-2342 rules that need no render: the catalog (R4), the draft and plan
 * types (R5), local storage (R6), API safety (R7), the Pools step (R8), the launch refusal (R9),
 * the removed events (R10) and the removed locale keys (R11). The rendered rules (R1 to R3) live in
 * `BuilderRouteSwitch.oneBuilder.test.tsx` and `FundStrategyBuilderScreen.test.tsx`.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BuildPlan } from "./build/plan/buildPlan";
import { planHasSolana } from "./build/plan/planReadiness";
import { normalizePlan } from "./build/plan/planStorage";
import { hubPoolPlan } from "./build/plan/planTestKit";
import { type CanvasPlan, deriveLaunchSteps } from "./launch/plan";
import { buildMandateCatalog } from "./mandateCatalog";
import {
  createEmptyDraft,
  type MandateDraft,
  stepIndex,
  validateStep,
  visibleSteps,
  withNetworks,
  withoutSolana,
  withoutUnavailableProtocols,
  withProtocols,
} from "./mandateDraft";
import { getDraft, MANDATE_DRAFTS_KEY, upsertDraft } from "./mandateDraftStore";
import { findMandatePoolByAddress, searchMandatePools } from "./mandatePoolSource";
import { planBuildReason, SOLANA_LAUNCH_REASON } from "./review/reviewForm";
import {
  buildSolanaBuilderCatalog,
  SOLANA_LOCAL_CONFIGS,
  withSolanaCatalog,
} from "./solana-preview/solanaBuilderRuntime";

const ROOT = process.cwd();
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const catalog = () => buildSolanaBuilderCatalog();

/** A mandate that holds Solana: the hub (Arbitrum) plus the Solana network. */
function solanaDraft(id = "solana-one"): MandateDraft {
  const base = withNetworks(
    createEmptyDraft("2026-10-12T00:00:00.000Z", id),
    ["solana"],
    catalog(),
  );
  return withProtocols(base, [...base.protocols, "kamino", "jupiter", "raydium", "orca"]);
}

/** A plan with one Solana spoke that holds an Orca pool position. */
function solanaPlan(): BuildPlan {
  return {
    version: 1,
    hub: { chains: [] },
    spokes: [
      {
        network: "solana",
        sharePct: 100,
        chains: [
          {
            id: "sol-chain",
            sharePct: 100,
            steps: [
              {
                id: "sol-orca",
                family: "position",
                kind: "solanaOrcaPool",
                config: SOLANA_LOCAL_CONFIGS.solanaOrcaPool ?? null,
              },
            ],
          },
        ],
      },
    ],
  };
}

beforeEach(() => {
  window.localStorage.removeItem(MANDATE_DRAFTS_KEY);
});

describe("R4: the V2 catalog is the API catalog plus the Solana entries", () => {
  // @rule R4
  it("[R4] adds Solana, four protocols and no change to the API load or error state", () => {
    const loading = { ...buildMandateCatalog(), loading: true as const };
    const failed = { ...buildMandateCatalog(), error: true as const };
    expect(withSolanaCatalog(loading).loading).toBe(true);
    expect(withSolanaCatalog(failed).error).toBe(true);
    const wrapped = withSolanaCatalog(buildMandateCatalog());
    expect(wrapped.networks.map((n) => n.id)).toEqual(
      expect.arrayContaining(["arbitrum", "robinhood", "solana"]),
    );
    for (const id of ["kamino", "jupiter", "raydium", "orca"] as const)
      expect(wrapped.protocols.find((p) => p.id === id)?.availableOn).toEqual(["solana"]);
  });

  // @rule R4
  it("[R4] offers the WSOL token and the USDC deposit token on Solana only", () => {
    const wrapped = catalog();
    expect(wrapped.depositTokenFor("solana")?.symbol).toBe("USDC");
    expect(wrapped.tokensFor(["solana"], []).map((t) => t.symbol)).toContain("WSOL");
    expect(wrapped.tokensFor(["arbitrum"], []).map((t) => t.symbol)).not.toContain("WSOL");
  });

  // @rule R4
  it("[R4] accepts a Solana protocol only when the draft holds the Solana network", () => {
    const plain = createEmptyDraft("2026-10-12T00:00:00.000Z", "no-solana");
    expect(withProtocols(plain, [...plain.protocols, "kamino", "orca"]).protocols).not.toContain(
      "kamino",
    );
    expect(solanaDraft().protocols).toEqual(
      expect.arrayContaining(["kamino", "jupiter", "raydium", "orca"]),
    );
    const back = withNetworks(solanaDraft(), ["robinhood"], catalog());
    expect(back.networks).not.toContain("solana");
    expect(
      back.protocols.filter((id) => ["kamino", "jupiter", "raydium", "orca"].includes(id)),
    ).toEqual([]);
  });
});

describe("R5: no runtime flag on the draft, the catalog or the plan", () => {
  // @rule R5
  it("[R5] has no runtime field on a draft or a catalog", () => {
    expect("runtime" in createEmptyDraft("2026-10-12T00:00:00.000Z", "x")).toBe(false);
    expect("runtime" in catalog()).toBe(false);
    expect("runtime" in solanaDraft()).toBe(false);
  });

  // @rule R5
  it("[R5] tells a Solana plan from the network of its spoke", () => {
    expect(planHasSolana(solanaPlan())).toBe(true);
    expect(planHasSolana(hubPoolPlan())).toBe(false);
  });
});

describe("R6: a Solana draft saves to local storage and reads back the same", () => {
  // @rule R6
  it("[R6] round-trips networks, protocols and a Solana plan", () => {
    const draft = { ...solanaDraft(), plan: solanaPlan() };
    const stored = upsertDraft(draft);
    expect(stored).not.toBeNull();
    const back = getDraft(draft.id);
    expect(back?.networks).toEqual(draft.networks);
    expect(back?.protocols).toEqual(draft.protocols);
    expect(back?.plan).toEqual(solanaPlan());
  });

  // @rule R6
  it("[R6] normalizePlan accepts the Solana block kinds and their config", () => {
    const raw = JSON.parse(JSON.stringify(solanaPlan()));
    expect(normalizePlan(raw)).toEqual(solanaPlan());
  });

  // @rule R6
  it("[R6] keeps the Solana protocols when unavailable protocols are removed", () => {
    const kept = withoutUnavailableProtocols(solanaDraft());
    expect(kept.protocols).toEqual(
      expect.arrayContaining(["kamino", "jupiter", "raydium", "orca"]),
    );
  });
});

describe("R7: no API read names Solana", () => {
  // @rule R7
  it("[R7] leaves Solana out of the draft that the API reads see", () => {
    const api = withoutSolana({ ...solanaDraft(), plan: undefined });
    expect(api.networks).not.toContain("solana");
    expect(api.tokens.some((t) => t.network === "solana")).toBe(false);
    expect(
      api.protocols.filter((id) => ["kamino", "jupiter", "raydium", "orca"].includes(id)),
    ).toEqual([]);
  });

  // @rule R7
  it("[R7] searches no pool on Solana and does not call the network", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await expect(
      searchMandatePools({
        network: "solana",
        tokenAddress: "So11111111111111111111111111111111111111112",
        protocols: [],
      }),
    ).resolves.toEqual([]);
    await expect(
      findMandatePoolByAddress("solana", "So11111111111111111111111111111111111111112", []),
    ).resolves.toEqual({ pool: null, foundOn: null });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe("R8: Raydium or Orca gives the Pools step", () => {
  // @rule R8
  it("[R8] shows Pools for Orca or Raydium, and not for Kamino or Jupiter", () => {
    const base = withNetworks(
      createEmptyDraft("2026-10-12T00:00:00.000Z", "p"),
      ["solana"],
      catalog(),
    );
    for (const id of ["orca", "raydium"] as const)
      expect(visibleSteps(withProtocols(base, [...base.protocols, id]))).toContain("pools");
    expect(
      visibleSteps(withProtocols(base, [...base.protocols, "kamino", "jupiter"])),
    ).not.toContain("pools");
    const orca = withProtocols(base, [...base.protocols, "orca"]);
    expect(stepIndex(orca, "pools").count).toBe(5);
  });

  // @rule R8
  it("[R8] does not ask for a Solana pool before Next on the Pools step", () => {
    const base = withNetworks(
      createEmptyDraft("2026-10-12T00:00:00.000Z", "p2"),
      ["solana"],
      catalog(),
    );
    const orca = withProtocols(base, [...base.protocols, "orca"]);
    expect(validateStep(orca, "pools", catalog())).toBeNull();
  });
});

describe("R9: a plan with Solana cannot launch", () => {
  // @rule R9
  it("[R9] names Solana as the reason in Review", () => {
    expect(planBuildReason(solanaPlan(), [])).toEqual(SOLANA_LAUNCH_REASON);
    expect(planBuildReason(hubPoolPlan(), [])?.code).not.toBe(SOLANA_LAUNCH_REASON.code);
  });

  // @rule R9
  it("[R9] has the reason text, naming Solana, in all 11 locales", () => {
    const dir = join(ROOT, "src/i18n/messages");
    const locales = readdirSync(dir).filter((name) => existsSync(join(dir, name, "manager.json")));
    expect(locales).toHaveLength(11);
    for (const locale of locales) {
      const json = JSON.parse(read(`src/i18n/messages/${locale}/manager.json`));
      const text = json.fundBuilder.review.validation.solanaLaunchUnavailable as string;
      expect(text, locale).toContain("Solana");
      expect(text, locale).not.toContain("—");
    }
  });

  // @rule R9
  it("[R9] keeps UNSUPPORTED_POSITION for the Solana kinds and refuses a Solana spoke", () => {
    const hubSolana: CanvasPlan = {
      version: 1,
      hub: {
        chains: [
          {
            id: "h",
            sharePct: 100,
            steps: [{ id: "h-orca", family: "position", kind: "solanaOrcaPool", config: {} }],
          },
        ],
      },
      spokes: [],
    };
    expect(() => deriveLaunchSteps(hubSolana, {}, false, false)).toThrow("UNSUPPORTED_POSITION");
    expect(() => deriveLaunchSteps(solanaPlan() as CanvasPlan, {}, false, true)).toThrow(
      "INVALID_BUILD",
    );
  });
});

describe("R2, R10, R11: removed files, events and locale keys", () => {
  // @rule R2
  it("[R2] deletes the gesture files and the Solana label code", () => {
    for (const path of [
      "src/lib/experiments/solanaPreviewMode.ts",
      "src/lib/experiments/solanaPreviewMode.test.ts",
      "src/lib/experiments/solanaPreviewStore.ts",
      "src/lib/experiments/solanaPreviewStore.test.tsx",
    ])
      expect(existsSync(join(ROOT, path)), path).toBe(false);
    const toggle = read("src/components/layout/ContractFamilyToggle.tsx");
    expect(toggle).not.toMatch(/v2Solana|solanaTooltip|solanaPreview/);
  });

  // @rule R10
  it("[R10] has no solana_preview event in code or in the event doc", () => {
    expect(read("src/lib/analytics/events.ts")).not.toContain("solana_preview_");
    expect(read("src/features/manager/fund/build/BuildScreen.tsx")).not.toContain(
      "solana_preview_",
    );
    expect(read("docs/ANALYTICS_EVENTS.md")).not.toContain("solana_preview_");
  });

  // @rule R11
  it("[R11] removes the unused locale keys in all 11 locales", () => {
    const dir = join(ROOT, "src/i18n/messages");
    for (const locale of readdirSync(dir).filter((n) => existsSync(join(dir, n, "shell.json")))) {
      const shell = JSON.parse(read(`src/i18n/messages/${locale}/shell.json`));
      expect(shell.contractFamily.v2Solana, locale).toBeUndefined();
      expect(shell.contractFamily.solanaTooltip, locale).toBeUndefined();
      const manager = JSON.parse(read(`src/i18n/messages/${locale}/manager.json`));
      expect(manager.solanaPreview.exit, locale).toBeUndefined();
      expect(manager.solanaPreview.visualOnly, locale).toBeUndefined();
    }
  });
});
