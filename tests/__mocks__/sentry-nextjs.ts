/**
 * Test double for `@sentry/nextjs`.
 *
 * POO-1171 wired `trace_id` into `useAnalytics` (POO-1212 [1]), which reaches the Sentry SDK through
 * `browserTraceId()`. `useAnalytics` has ~93 call sites, so without this alias every component test
 * that renders anything calling `track()` would need the real SDK resolvable just to import.
 *
 * That is a test-graph concern only, NOT an argument for decoupling analytics from Sentry: the SDK
 * already ships in the client bundle of every route via `src/instrumentation-client.ts`
 * (`PP-CORE-LIB-080`), so the import adds no bundle weight and no new runtime dependency.
 *
 * The surface here is deliberately the minimum the analytics path touches. `getTraceData` returns an
 * empty object, so `browserTraceId()` resolves to `undefined` and `trace_id` is simply absent, which
 * is exactly its documented behaviour when Sentry is not enabled (local dev, tests, Storybook). A
 * test that wants a trace id mocks `browserTraceId` directly rather than widening this file.
 */
export function getTraceData(): Record<string, string | undefined> {
  return {};
}

export function getClient(): undefined {
  return undefined;
}

export function captureException(): void {}

export function captureMessage(): void {}

export function init(): void {}

export function setUser(): void {}

export function setTag(): void {}

export const defaultStackParser = undefined;
