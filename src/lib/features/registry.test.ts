/**
 * @id PP-CORE-LIB-011
 * @name feature registry — tests
 * Behavior: the catalog is internally consistent and encodes the v1 launch matrix.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FEATURE_KEYS, FEATURES } from "./registry";

describe("feature registry", () => {
  it("each map key matches its entry's key", () => {
    for (const key of FEATURE_KEYS) {
      expect(FEATURES[key].key).toBe(key);
    }
  });

  it("every flag declares a NEXT_PUBLIC_FEATURE_ env var", () => {
    for (const key of FEATURE_KEYS) {
      expect(FEATURES[key].envVar).toMatch(/^NEXT_PUBLIC_FEATURE_[A-Z0-9_]+$/);
    }
  });

  it("env vars are unique across flags", () => {
    const vars = FEATURE_KEYS.map((key) => FEATURES[key].envVar);
    expect(new Set(vars).size).toBe(vars.length);
  });

  it("encodes the v1 launch matrix — core areas + Rewards on, everything else off", () => {
    const enabled = FEATURE_KEYS.filter((key) => FEATURES[key].defaultEnabled).sort();
    expect(enabled).toEqual(
      ["deposit", "home", "portfolio", "profile", "rewards", "strategies"].sort(),
    );
  });

  it("core areas are stage 'core' and enabled (nav-level kill-switch only)", () => {
    for (const key of ["home", "portfolio", "strategies", "deposit", "profile"] as const) {
      expect(FEATURES[key].stage).toBe("core");
      expect(FEATURES[key].defaultEnabled).toBe(true);
    }
  });

  it("Cards is the next area to build (registered, off)", () => {
    expect(FEATURES.cards.stage).toBe("next");
    expect(FEATURES.cards.defaultEnabled).toBe(false);
  });

  it("registers the virtualize rendering-strategy flag, default off", () => {
    // POO-624: `virtualize` is a presentational rendering-strategy switch (windowed lists),
    // NOT a route/launch gate. Default off keeps the plain `.map()` baseline everywhere.
    expect(FEATURE_KEYS).toContain("virtualize");
    expect(FEATURES.virtualize.defaultEnabled).toBe(false);
    expect(FEATURES.virtualize.stage).toBe("next");
    expect(FEATURES.virtualize.envVar).toBe("NEXT_PUBLIC_FEATURE_VIRTUALIZE");
  });

  it("registers the strategyCategoryFilter control flag, default off", () => {
    // POO-830 PR2: a presentational control gate on the Explore surface (the investor asset-category
    // filter), NOT a route/launch gate. Default off = today's Explore behavior.
    expect(FEATURE_KEYS).toContain("strategyCategoryFilter");
    expect(FEATURES.strategyCategoryFilter.defaultEnabled).toBe(false);
    expect(FEATURES.strategyCategoryFilter.stage).toBe("next");
    expect(FEATURES.strategyCategoryFilter.envVar).toBe(
      "NEXT_PUBLIC_FEATURE_STRATEGY_CATEGORY_FILTER",
    );
  });

  it("the provisioning flag ships off, on a FLAT baseline (POO-1042 [R5])", () => {
    // The baseline used to be `process.env.NODE_ENV === "development"`, so what production did
    // depended on how it was built rather than on a decision anyone made. Now it is a literal, and
    // the go-live switch is the env var like every other flag.
    expect(FEATURES.provisioning.defaultEnabled).toBe(false);
    expect(FEATURES.provisioning.envVar).toBe("NEXT_PUBLIC_FEATURE_PROVISIONING");
  });

  it("no flag's baseline is computed from NODE_ENV (POO-1042 [R5])", () => {
    // A registry read at import time under a different NODE_ENV must produce the same matrix. This
    // is the drift guard: the source, not the value, is what the rule is about.
    const source = readFileSync(join(__dirname, "registry.ts"), "utf8");
    expect(source).not.toMatch(/defaultEnabled:\s*process\.env\.NODE_ENV/);
  });

  it("does NOT register a financialsV2 flag (PP-CORE-LIB-048 removed it)", () => {
    // POO-990: the `financialsV2` data-source flag was deleted — the FE reads the C1 /financials payload
    // UNCONDITIONALLY (legacy /metrics consumption fully excised). This locks the flag out for good: no
    // code path may re-introduce a legacy financials fallback behind a flag.
    expect(FEATURE_KEYS).not.toContain("financialsV2");
    expect(FEATURES).not.toHaveProperty("financialsV2");
  });
});
