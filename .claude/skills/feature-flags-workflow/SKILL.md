---
name: feature-flags-workflow
description: How to gate a feature behind a flag in the Pool Party frontend. Register the flag, gate nav/route/entry links, test both states, and run the launch checklist. Every not-yet-launched area is born dark-launched (CLAUDE.md premise 10). Companion to docs/FEATURE_FLAGS.md.
---

# Feature Flags Workflow

Every new area merges to `main` dark-launched behind a flag (premise 10). This skill is the implementation recipe; the spec and v1 launch matrix live in `docs/FEATURE_FLAGS.md`, and the registry (`src/lib/features/registry.ts`) is the single source of truth. Never read `process.env.NEXT_PUBLIC_FEATURE_*` directly in a component.

## 1. Register the flag

1. Add the entry to `FEATURES` in `src/lib/features/registry.ts`. A `FeatureDefinition` is `{ key, area, defaultEnabled, stage, envVar: NEXT_PUBLIC_FEATURE_<KEY>, description }`; a new dark-launched area uses `defaultEnabled: false`, `stage: "next"`. (Core, always-on areas are not guarded by `requireFeature`.)
2. Add its static `case` to `envOverride()` in `src/lib/features/resolve.ts` (a literal `process.env.NEXT_PUBLIC_FEATURE_<KEY>` line; Next.js inlines it client-side).
3. Document the env var in `.env.example` and add the row to the matrix in `docs/FEATURE_FLAGS.md`.

## 2. Gate every surface

- **Route** (server): call `requireFeature("<key>")` in the area `layout.tsx` (preferred, covers the whole subtree) or `page.tsx`. Off means 404, including deep links and SSR.
- **Nav**: set `flag: "<key>"` on the `NavItem` in `AppShell.tsx`; filtered items never render.
- **Entry links / widgets** (client): `const { isEnabled } = useFeatureFlags();` and render conditionally. Hunt ALL entry points: home cards, profile rows, pills, cross-links from other areas.
- **Server (non-route)**: `isFeatureEnabled("<key>")` from `src/lib/features` for a flag check inside a server component or action that is not the route guard.

Remember the three axes are independent: feature flag (area launched?) vs `isManager` role (this user?) vs `isMockMode` (data source). Manager surfaces need flag AND role.

## 3. Test both states

- Unit/component: force the flag through the dev-override store (`setOverride("<key>", true)` from `src/lib/features/devOverrides` + `__resetDevOverridesForTests()` in `finally`), not by stubbing env (the client snapshot caches).
- Route guard: test that the page 404s with the flag off (e.g. `expect(requireFeature).toThrow` route test or e2e when available).
- Both states must have a test: visible-when-on AND absent-when-off (nav, entry links, route).
- Manual QA: the Dev menu Feature Flags panel flips client visibility live; direct route access needs `NEXT_PUBLIC_FEATURE_<KEY>=on` in `.env.local` (server guard stays env-pure).

## 4. Launch checklist (flip on)

- [ ] Area complete behind the flag on `main`; gate tests green for both states.
- [ ] `NEXT_PUBLIC_FEATURE_<KEY>=on` promoted dev to staging to prod (each is a redeploy).
- [ ] Analytics events for the area verified in staging before prod.
- [ ] Update the matrix in `docs/FEATURE_FLAGS.md` (stage: next to live).
- [ ] After the area is stable and permanent: RETIRE the flag (delete gates, registry entry, env var, matrix row). No long-lived release flags.

## Anti-patterns

- Reading `process.env.NEXT_PUBLIC_FEATURE_*` in a component (breaks the precedence chain and the dev panel).
- Gating only the nav and forgetting the route (deep links leak the area) or vice versa (404 with a visible nav item).
- Using a flag for a user-role decision (that is `isManager`) or for mock/real switching (that is `isMockMode`).
- Shipping an area without the flag "because it is almost launch-ready". Born dark, always.
