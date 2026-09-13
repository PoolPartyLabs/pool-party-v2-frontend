/**
 * @id PP-CORE-LIB-105 (POO-1800) - tests
 * @name on-ramp rail + environment resolver - tests
 * @implements-rules-version v1 (POO-1800 rules v1)
 * @analytics-events none, the module decides which rail serves fiat and against which vendor
 *   environment. It renders nothing and no user gesture reaches it, so there is no event to emit.
 *
 * The decision table is the whole module, so it is asserted as a table: every combination of the two
 * flags, and every combination of the two environment inputs. Env reads are call-time
 * (`resolve.test.ts` states the same), so `vi.stubEnv` is enough and no module reset is needed.
 *
 * Both flags are stubbed EXPLICITLY in every rail case, never left to the registry baseline. A bare
 * default would pass today and pass again the day somebody flips `fiatOnRamp` on, which is exactly
 * the flip this table exists to describe.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  decideOnRampRail,
  resolveOnRampEnvironment,
  resolveOnRampProvider,
} from "./onRampProvider";

afterEach(() => {
  vi.unstubAllEnvs();
});

/** Put both flags in a known state. `undefined` means "leave the var unset", not "off". */
function stubFlags(fiat: boolean, privy: boolean): void {
  vi.stubEnv("NEXT_PUBLIC_FEATURE_FIAT_ON_RAMP", fiat ? "on" : "off");
  vi.stubEnv("NEXT_PUBLIC_FEATURE_PRIVY_ON_RAMP", privy ? "on" : "off");
  // The non-prod "reveal all" switch would turn both on regardless and make every case below agree
  // by accident, so it is pinned off for the table.
  vi.stubEnv("NEXT_PUBLIC_FEATURE_ALL", "off");
}

describe("decideOnRampRail", () => {
  // @rule R1
  it("[R1] answers none when fiat is off, whatever privyOnRamp says", () => {
    // The rule in one line: the new flag never turns fiat ON by itself. `fiatOnRamp` keeps its
    // meaning as the ONE authority on whether fiat is offered at all; `privyOnRamp` only ever
    // answers WHICH rail serves it.
    expect(decideOnRampRail(false, false)).toBe("none");
    expect(decideOnRampRail(false, true)).toBe("none");
  });

  it("[R1] routes to paybis when fiat is on and privy is off", () => {
    expect(decideOnRampRail(true, false)).toBe("paybis");
  });

  it("[R1] routes to privy when both are on", () => {
    expect(decideOnRampRail(true, true)).toBe("privy");
  });
});

describe("resolveOnRampProvider", () => {
  // @rule R1
  it("[R1] fiat off answers none even with privyOnRamp on", () => {
    stubFlags(false, true);
    expect(resolveOnRampProvider()).toBe("none");
  });

  // @rule R1
  it("[R1] fiat off and privy off answers none", () => {
    stubFlags(false, false);
    expect(resolveOnRampProvider()).toBe("none");
  });

  it("fiat on and privy off answers paybis", () => {
    stubFlags(true, false);
    expect(resolveOnRampProvider()).toBe("paybis");
  });

  it("fiat on and privy on answers privy", () => {
    stubFlags(true, true);
    expect(resolveOnRampProvider()).toBe("privy");
  });

  // @rule R2
  it("[R2] reads both flags through the registry, so retiring one is a compile error", () => {
    // The death condition is a promise about DELETION, and what makes it keepable is that nothing
    // reads the env var behind the module's back: `privyOnRamp` is resolved through
    // `isFeatureEnabled`, so removing the key from `FeatureKey` fails the build here rather than
    // silently resolving to `undefined` and answering `paybis` forever.
    stubFlags(true, true);
    expect(resolveOnRampProvider()).toBe("privy");
    // A registry-resolved flag responds to the env var; a hardcoded one would not.
    vi.stubEnv("NEXT_PUBLIC_FEATURE_PRIVY_ON_RAMP", "off");
    expect(resolveOnRampProvider()).toBe("paybis");
  });
});

describe("resolveOnRampEnvironment", () => {
  // @rule R3
  it("[R3] is production only when the app env is production AND mock mode is off", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_MOCK_MODE", "false");
    expect(resolveOnRampEnvironment()).toBe("production");
  });

  // @rule R3
  it("[R3] accepts the prod spelling, trimmed and case-insensitive", () => {
    // Mirrors `isDevPanelEnabled()` (`features/devOverrides.ts`) and `isNonProdEnv()`
    // (`features/resolve.ts`), which are the two existing readers of this same variable. A third
    // normalization would be a third answer to "are we in production".
    for (const appEnv of ["prod", "PRODUCTION", " production ", "Prod"]) {
      vi.stubEnv("NEXT_PUBLIC_APP_ENV", appEnv);
      vi.stubEnv("NEXT_PUBLIC_MOCK_MODE", "false");
      expect(resolveOnRampEnvironment()).toBe("production");
    }
  });

  // @rule R3
  it("[R3] a production app env still answers sandbox while mock mode is on", () => {
    // Fails safe: mock data must never reach a real vendor environment, and mock mode is this
    // repo's DEFAULT, so the unset case has to land on sandbox too.
    vi.stubEnv("NEXT_PUBLIC_APP_ENV", "production");
    for (const mockMode of ["true", "", "1", "yes"]) {
      vi.stubEnv("NEXT_PUBLIC_MOCK_MODE", mockMode);
      expect(resolveOnRampEnvironment()).toBe("sandbox");
    }
  });

  // @rule R3
  it("[R3] mock mode unset is sandbox, not production", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_MOCK_MODE", undefined);
    expect(resolveOnRampEnvironment()).toBe("sandbox");
  });

  // @rule R3
  it("[R3] every non-production app env is sandbox even with mock mode off", () => {
    vi.stubEnv("NEXT_PUBLIC_MOCK_MODE", "false");
    for (const appEnv of ["development", "staging", "preview", "test", "productionish", ""]) {
      vi.stubEnv("NEXT_PUBLIC_APP_ENV", appEnv);
      expect(resolveOnRampEnvironment()).toBe("sandbox");
    }
  });

  // @rule R3
  it("[R3] both unset is sandbox", () => {
    // The fail-safe corner, and the one a real deploy hits first: nothing configured means nothing
    // real. `environment` is DERIVED, so there is no env var anybody can set to reach production
    // by mistake.
    vi.stubEnv("NEXT_PUBLIC_APP_ENV", undefined);
    vi.stubEnv("NEXT_PUBLIC_MOCK_MODE", undefined);
    expect(resolveOnRampEnvironment()).toBe("sandbox");
  });
});
