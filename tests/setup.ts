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
