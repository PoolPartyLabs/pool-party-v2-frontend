/**
 * @id PP-CORE-LIB-011
 * @name feature resolution — tests
 * Behavior: env strings parse to a tri-state, and resolution follows the documented precedence
 * (explicit per-flag env > non-prod _ALL > registry default). Env reads are call-time, so stubbing
 * with `vi.stubEnv` is enough — no module reset needed.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseFlagValue, resolveFeature } from "./resolve";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("parseFlagValue", () => {
  it("parses truthy values (case/space-insensitive)", () => {
    for (const value of ["on", "true", "1", "yes", "enabled", "ON", " True "]) {
      expect(parseFlagValue(value)).toBe(true);
    }
  });

  it("parses falsy values", () => {
    for (const value of ["off", "false", "0", "no", "disabled", "OFF"]) {
      expect(parseFlagValue(value)).toBe(false);
    }
  });

  it("returns undefined for unset or unrecognized values", () => {
    expect(parseFlagValue(undefined)).toBeUndefined();
    expect(parseFlagValue("")).toBeUndefined();
    expect(parseFlagValue("maybe")).toBeUndefined();
  });
});

describe("resolveFeature precedence", () => {
  it("falls back to the registry default when nothing overrides it", () => {
    expect(resolveFeature("rewards")).toBe(true); // default on
    expect(resolveFeature("cards")).toBe(false); // default off
  });

  it("an explicit per-flag env var overrides the default", () => {
    vi.stubEnv("NEXT_PUBLIC_FEATURE_CARDS", "on");
    vi.stubEnv("NEXT_PUBLIC_FEATURE_REWARDS", "off");
    expect(resolveFeature("cards")).toBe(true);
    expect(resolveFeature("rewards")).toBe(false);
  });

  it("NEXT_PUBLIC_FEATURE_ALL reveals off areas in non-prod", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_FEATURE_ALL", "on");
    expect(resolveFeature("cards")).toBe(true);
    expect(resolveFeature("perps")).toBe(true);
  });

  it("ignores NEXT_PUBLIC_FEATURE_ALL in production", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_FEATURE_ALL", "on");
    expect(resolveFeature("cards")).toBe(false);
  });

  it("an explicit per-flag value beats the _ALL switch", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_FEATURE_ALL", "on");
    vi.stubEnv("NEXT_PUBLIC_FEATURE_CARDS", "off");
    expect(resolveFeature("cards")).toBe(false);
  });
});
