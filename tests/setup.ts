import { configure } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

// PP-NOTE: the global next-intl mock is added in SETUP-005 (next-intl), once the
// package and routing exist. Until then, components using `useTranslations` should
// be tested with a local mock or via renderWithProviders once the provider lands.

// Hackathon fork (public repository, 2026-09): `fiatOnRamp` and `privyOnRamp` DEFAULT ON in the
// registry so a fresh clone runs the Privy rail. The on-ramp suites ported from the private
// repository (265 files) were written against the private baseline, where both ship off and every
// on-state test stubs its flag explicitly. Rather than rewrite those suites, which would diverge them
// from their source, the TEST environment pins that baseline here. Assigned directly (not
// `vi.stubEnv`) so a suite's `vi.unstubAllEnvs()` restores to this value rather than to the registry
// default. The shipped defaults themselves are asserted in `src/lib/features/registry.test.ts`.
process.env.NEXT_PUBLIC_FEATURE_FIAT_ON_RAMP ??= "off";
process.env.NEXT_PUBLIC_FEATURE_PRIVY_ON_RAMP ??= "off";

/**
 * POO-1467 [R1], ported with the fund builder (POO-2119): how long `waitFor` / `findBy*` may keep
 * polling before they give up.
 *
 * Testing-library's default is 1000 ms, a wall-clock budget: it does not ask "will this ever
 * appear", it asks "did it appear within one second ON THIS MACHINE RIGHT NOW". Under a coverage run
 * on a loaded CI runner a wait that idles at 300 ms locally can take several times longer. The fund
 * builder suites were written against a 5 s budget in the repository they were developed in, so the
 * same budget comes with them. It only moves the point where a wait that will never succeed gives
 * up: a passing wait still resolves the moment its element appears, so a green suite does not get
 * slower, and nothing here retries a failed test.
 */
configure({ asyncUtilTimeout: 5_000 });

/**
 * POO-2119: jsdom defines no `Element.prototype.scrollIntoView`, and the fund builder's Mandate
 * steps call it to bring a refused row into view (handoff R6). Without this stub every test that
 * hands a step a block with a non-null `rowId` throws a TypeError unrelated to what it asserts.
 * A no-op: scrolling is not observable in jsdom, and nothing here asserts on it.
 */
if (typeof Element !== "undefined" && typeof Element.prototype.scrollIntoView !== "function") {
  Element.prototype.scrollIntoView = () => {};
}
