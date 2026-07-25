/**
 * @id PP-CORE-CMP-046 (POO-1023)
 * @name provisioning seam guard
 * @implements-rules-version v1
 * @hackathon POO-1022 (Universal Funding)
 *
 * A source-level drift guard, not a behavioral test.
 *
 * The defect this locks out was invisible at runtime: both provisioning surfaces called
 * `mockComputePlan` DIRECTLY, so the real planner could be fully wired and never called, and flipping
 * `NEXT_PUBLIC_MOCK_MODE=false` would change nothing. No rendering test catches that, because in mock
 * mode both paths produce the identical plan. Only the import does.
 *
 * Rules under test (POO-1023 rules v1):
 *   [R1] `computePlan` is the ONLY plan source; no surface may reach past the seam
 *   [R5] both PP-FIXMEs are deleted, and `mockComputePlan` has no caller outside the provisioning
 *        module and its own tests
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..", "..");

/** The two surfaces that used to bypass the seam. */
const SURFACES = [
  "src/features/strategies/components/ProvisioningPanel.tsx",
  "src/features/strategies/components/ProvisioningWizardModal.tsx",
] as const;

function read(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), "utf8");
}

/**
 * Strip comments before asserting. The prose in these files legitimately NAMES `mockComputePlan`
 * while explaining why it must not be called; the multiline `import ... from` regex would match that
 * prose across an unrelated `import` line, so it runs against the stripped source.
 *
 * The CALL-SITE check does NOT use this: stripping is heuristic (a `//` inside a string literal
 * truncates the rest of that line) and could hide a genuine `mockComputePlan(` next to it. The prose
 * only ever writes the bare name, never the paren form, so `mockComputePlan(` is safe to assert
 * against the RAW source and is the stricter check.
 */
function code(relativePath: string): string {
  return read(relativePath)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("provisioning seam (POO-1023)", () => {
  // [R1] Neither surface may import or call the mock planner.
  it.each(SURFACES)("%s does not import or call mockComputePlan", (path) => {
    expect(code(path)).not.toMatch(/import[\s\S]*?mockComputePlan[\s\S]*?from/);
    expect(read(path)).not.toContain("mockComputePlan(");
  });

  // [R1] Both must resolve through the seam, via the shared hook.
  it.each(SURFACES)("%s resolves its plan through useProvisioningPlan", (path) => {
    expect(read(path)).toContain("useProvisioningPlan");
  });

  // [R5] The PP-FIXMEs are deleted, not reworded. Their issue numbers must not linger as FIXMEs.
  it.each(SURFACES)("%s carries no provisioning-seam PP-FIXME", (path) => {
    const source = read(path);
    expect(source).not.toContain("PP-FIXME(POO-432)");
    expect(source).not.toContain("PP-FIXME(POO-418)");
  });

  // [R1] The hook itself must go through the seam, or it would just move the bypass one file over.
  it("useProvisioningPlan calls computePlan and not the mock planner", () => {
    const path = "src/features/strategies/hooks/useProvisioningPlan.ts";
    expect(code(path)).toMatch(/import\s*\{\s*computePlan\s*\}\s*from\s*"@\/lib\/provisioning"/);
    expect(code(path)).toMatch(/\bcomputePlan\(/);
    expect(read(path)).not.toContain("mockComputePlan(");
  });
});
