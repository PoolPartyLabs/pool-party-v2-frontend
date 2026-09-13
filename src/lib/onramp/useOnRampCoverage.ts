/**
 * @id PP-CORE-HOK-036 (POO-1805)
 * @name useOnRampCoverage
 * @implements-rules-version v2 (POO-1805 rules v2)
 * @analytics-events none, the hook returns an answer and renders nothing; the funnel belongs to the
 *   surface that acts on it. Its ONE observability duty is the Sentry report below, which is the
 *   error rail (`reportClientError`) and not GA4.
 *
 * The client binding for {@link probeOnRampCoverage}: it supplies the things the pure module refuses
 * to reach for itself, and nothing else.
 *
 *   * `fetch`, the browser's own, so the probe sees real status codes ([R1]) instead of the empty
 *     quote list Privy's client would hand back for every kind of failure.
 *   * `getAccessToken` from `usePrivy()`, which is the buyer's own token and is public API.
 *   * the app and client ids, read the same way `src/app/providers.tsx` reads them, so a deploy
 *     cannot end up asking with one id and authenticating with another.
 *
 * No new dependency and no CSP change: `https://*.privy.io` is already allowlisted in
 * `src/lib/security/csp.ts`.
 *
 * ## Mock mode is a branch, not a call
 *
 * `Providers` returns its children with NO `PrivyProvider` when `isMockMode` (`src/app/providers.tsx`),
 * so an unconditional `usePrivy()` reads the SDK's default context. Measured against the installed
 * `@privy-io/react-auth@3.29.2` (rendered outside a provider): the hook itself returns fine and
 * `getAccessToken` is a function, but calling it REJECTS with
 * `Error("You need to wrap your application with the <PrivyProvider> initialized with your app id.")`.
 * So the unbranched hook does not crash, it does something quieter and worse: every mock-mode host
 * enters the probe, fails on the token, and posts an `onramp.coverage_unknown` to Sentry for a
 * non-failure, which is exactly the permanent noise floor `reportClientError`'s own header warns
 * about. The branch is the shape `useAuth` uses (`src/lib/auth/useAuth.ts:184-195`) and rests on the
 * same fact: `isMockMode` is a build-time constant, so the branch is stable across renders and the
 * hook order inside each half never changes. Mock mode answers `unknown` with reason `mock-mode`
 * rather than a fabricated `covered`: there is no rail to ask, and a made-up "yes" would send a
 * mock-mode tester into a purchase that cannot exist ([R1]'s discipline, applied to ourselves).
 *
 * [R3] It resolves NO currency. The caller passes the fiat code the server chain produced, and that
 * chain (CloudFront, then profile, then USD) stays server-side where it can read the header.
 */
"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useCallback, useRef } from "react";
import { reportClientError } from "@/lib/observability/reportClientError";
import { isMockMode } from "@/lib/services/index";
import { type CoverageProbeInput, type CoverageResult, probeOnRampCoverage } from "./coverageProbe";

/** Read exactly as `src/app/providers.tsx` reads them, as literals so Next inlines each. */
const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "";
const PRIVY_CLIENT_ID = process.env.NEXT_PUBLIC_PRIVY_CLIENT_ID ?? "";

/** The mock-mode answer, frozen so a caller cannot mutate the shared object. */
const MOCK_MODE_ANSWER: CoverageResult = Object.freeze({
  status: "unknown",
  reason: "mock-mode",
} as const);

/**
 * The Sentry report an `unknown` owes, and the exact fields it may carry.
 *
 * REASON AND HTTP STATUS ONLY. Never the access token, never the buyer's address, never a response
 * body: an `unknown` is a diagnosis of the rail, and none of those three help diagnose it. Mock mode
 * is not reported at all, because it is not a failure (the same expected-non-outage discipline
 * `reportClientError` applies to mock-mode reads).
 */
function reportCoverageUnknown(result: Extract<CoverageResult, { status: "unknown" }>): void {
  if (result.reason === "mock-mode") return;
  reportClientError("onramp.coverage_unknown", new Error(`coverage unknown: ${result.reason}`), {
    reason: result.reason,
    httpStatus: result.httpStatus ?? null,
  });
}

/**
 * The identity of a question. Two callers asking the SAME question while the first is still in
 * flight get the SAME promise: an amount field re-rendering, or two surfaces mounted at once, must
 * not each charge the rail for an answer that is already coming.
 *
 * The address and environment are part of the key and not just the money: a wallet switch or a
 * sandbox/production flip is a different question with the same amount.
 *
 * DEBOUNCING IS NOT THIS. A buyer typing "1", "10", "100" asks three DIFFERENT questions, and this
 * dedupe deliberately lets all three through; holding the keystroke is the host's job, on the input
 * it owns (carried to POO-1807 / POO-1808, where Privy's own picker debounces at 750ms).
 */
function coverageKey(input: CoverageProbeInput): string {
  return JSON.stringify([
    input.fiat,
    input.amount,
    input.destination.chain,
    input.destination.asset,
    input.destination.address,
    input.environment,
  ]);
}

/** Mock mode: no Privy, no network, no fabricated "yes". */
function useMockOnRampCoverage(): (input: CoverageProbeInput) => Promise<CoverageResult> {
  return useCallback(async () => MOCK_MODE_ANSWER, []);
}

/** Real mode: the buyer's own token, the browser's own `fetch`, one question at a time. */
function usePrivyOnRampCoverage(): (input: CoverageProbeInput) => Promise<CoverageResult> {
  // biome-ignore lint/correctness/useHookAtTopLevel: called unconditionally within this branch
  const { getAccessToken } = usePrivy();
  // biome-ignore lint/correctness/useHookAtTopLevel: called unconditionally within this branch
  const inFlight = useRef(new Map<string, Promise<CoverageResult>>());

  // biome-ignore lint/correctness/useHookAtTopLevel: called unconditionally within this branch
  return useCallback(
    (input: CoverageProbeInput) => {
      const key = coverageKey(input);
      const pending = inFlight.current.get(key);
      if (pending) return pending;

      const answer = probeOnRampCoverage(
        {
          fetch: (...args) => globalThis.fetch(...args),
          getAccessToken,
          appId: PRIVY_APP_ID,
          clientId: PRIVY_CLIENT_ID || undefined,
        },
        input,
      )
        .then((result) => {
          if (result.status === "unknown") reportCoverageUnknown(result);
          return result;
        })
        // The entry is dropped as soon as the question is ANSWERED, never cached: coverage changes
        // without a release, which is the reason this module exists rather than a table.
        .finally(() => {
          inFlight.current.delete(key);
        });

      inFlight.current.set(key, answer);
      return answer;
    },
    [getAccessToken],
  );
}

/** Ask whether anyone will sell, from a client component. */
export function useOnRampCoverage(): (input: CoverageProbeInput) => Promise<CoverageResult> {
  if (isMockMode) {
    // biome-ignore lint/correctness/useHookAtTopLevel: isMockMode is a build-time constant, branch is stable across renders
    return useMockOnRampCoverage();
  }
  // biome-ignore lint/correctness/useHookAtTopLevel: isMockMode is a build-time constant, branch is stable across renders
  return usePrivyOnRampCoverage();
}
