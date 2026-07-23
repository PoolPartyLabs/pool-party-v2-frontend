/**
 * @id PP-STR-LIB-008 (POO-771)
 * @name manager-identity fan-out guard
 * @implements-rules-version v1
 *
 * POO-771 R9: the manager identity is now embedded on the catalog/detail/portfolio payloads (POO-758)
 * and mapped through by the strategy mappers, so the render path must issue ZERO per-manager
 * `GET /api/v1/managers/:address` requests. This guard locks the failure class: it fails if anything
 * reintroduces the superseded PR #512 registry fan-out (`enrichStrategiesWithManagerIdentity` /
 * `enrichPositionsWithManagerIdentity`) or a per-manager registry read in the catalog/portfolio render
 * modules. `fetchManagerProfile` remains legitimate ONLY for the public profile page + manager console,
 * so the guard scopes to the render-path modules rather than banning the profile fetch globally.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const srcRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** Recursively collect every .ts/.tsx source file under `dir`, skipping tests. */
function collectSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectSourceFiles(full));
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

describe("manager-identity fan-out guard (POO-771 R9)", () => {
  // @rule R9
  it("has no enrichManagerIdentity module (PR #512 superseded, never merged)", () => {
    expect(existsSync(join(srcRoot, "lib/strategies/enrichManagerIdentity.ts"))).toBe(false);
  });

  // @rule R9
  it("no source module imports the superseded per-manager enrich fan-out", () => {
    const offenders = collectSourceFiles(srcRoot).filter((file) => {
      const text = readFileSync(file, "utf8");
      return (
        text.includes("enrichStrategiesWithManagerIdentity") ||
        text.includes("enrichPositionsWithManagerIdentity")
      );
    });
    expect(offenders).toEqual([]);
  });

  // @rule R9: the catalog/portfolio render-path modules must not read the per-manager registry endpoint.
  it("the catalog/portfolio render path issues no per-manager GET /api/v1/managers/:address", () => {
    const renderPathModules = [
      "lib/strategies/fetchStrategiesPage.ts",
      "lib/strategies/strategyCatalog.ts",
      "lib/strategies/resolveDetailStrategy.ts",
      "features/portfolio/actions.ts",
      "features/portfolio/portfolioPagedActions.ts",
    ];
    for (const rel of renderPathModules) {
      const full = join(srcRoot, rel);
      if (!existsSync(full)) continue; // module may not exist on every branch — nothing to fan out then
      const text = readFileSync(full, "utf8");
      expect(text).not.toContain("/api/v1/managers/");
      expect(text).not.toMatch(/fetchManagerProfile\s*\(/);
    }
  });
});
