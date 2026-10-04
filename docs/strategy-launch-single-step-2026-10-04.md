# Strategy creation: single-step signing and Wormhole wait

Issue: [POO-2233](https://linear.app/yeildbay/issue/POO-2233), rules v1, under POO-2116. Base: public frontend main `374a80ec`. This follows POO-2212 and POO-2203. The owner's 2026-10-04 screenshot and provisioning's `ExecutionCarousel` (PP-CORE-CMP-071, Figma `6550:615`) define the presentation reference.

## Current behavior and constraints

`FundLaunchJourney` already owns the launch dialog, but renders a current-step summary and the entire step list at the same time. `useV2Launch` maps the frozen journal to display rows. The runner polls every 10 seconds and confirms a report only when the manager-authenticated fund read contains `lastReport`. During an explicitly started run, it continues to eligible downstream operations as soon as that report arrives. Closing/Pause stops continuation; reopening requires explicit Resume.

The 19-minute countdown is a display estimate. Its expiry must never confirm a report, fail the launch, retry an operation or request a signature. No executor, transaction payload, amount, backend endpoint or readiness predicate changes.

## Staged implementation plan

| Stage | Files / responsibility | Dependency and verification |
|---|---|---|
| 1. Wait timing | New `launch/useLaunchReportWait.ts` and focused tests, plus `launch/useV2Launch.ts` projection | Start on first observed report building/waiting. Persist metadata separately from the journal by manager/draft/step. Test persistence, isolation, legacy waits and storage failures. Derive remaining time from an absolute deadline; clamp and catch up after background throttling. |
| 2. Single current step | `launch/FundLaunchJourney.tsx` and its tests | Prefer active signing/submitted/building over a waiting report, then failed/waiting/idle. Show one card with Step N of total, status/progress and current-step evidence. Preserve explicit controls, partial-error recovery, completion and focus. Test a long plan and report acceptance before the deadline. |
| 3. Countdown presentation | Same modal; `FundLaunchJourney.stories.tsx`; all current locale `manager.json` files | Use isolated clock updates in the visible report body, mm:ss from 19:00 to 00:00, and a truthful delayed message. No per-second live announcements. Stories cover early wait, delayed report, signing, retry and completed states. |
| 4. Integration and delivery | Existing binding/driver tests; DESIGN_INTAKE, IDS_REGISTRY, INTEGRATION_POINTS, COMPLIANCE_REGISTER and Manager README | Verify actual report readiness still advances the existing runner and receipt/retry/pause safeguards remain. Run one focused test process, scoped TypeScript/Biome and i18n. Independent code review, focused commits, PR and merge. |

A GPT-6.1-sol worker owns timing and its projection. The coordinator owns the modal, copy, documentation and integration review. No browser walkthrough, full local suite, coverage or build, as requested by the owner.

## Rules and edge cases

- One step is visible, with current transaction/explorer, receipt, indexing and error details. Earlier waiting reports cannot hide a wallet prompt for an independent active operation. Completed flow retains the last step and existing-fund link; an empty/not-ready plan does not invent a step.
- Report timing starts when the report is actually being checked, including when another active step is shown. Future idle reports do not start a timer. Each manager/draft/report identity has separate timing.
- Polling and transient building, error/retry, close/reopen and remount do not reset the estimate. Old waiting journals lack a historical start, so timing starts on first observation. If browser storage is unavailable, use an in-memory fallback without failing the launch.
- A one-second visible clock computes from elapsed wall time. It does not decrement an authoritative counter. At zero it stays at zero and explains that the estimate elapsed. Report receipt can advance earlier regardless of remaining time.
- Preserve close/Pause cancellation and explicit Resume. Never start a signing operation on mount, reload or countdown expiry. No changes to the receipt journal or broadcast recovery.
- Use existing dialog, logo, status tokens and provisioning pattern, with a scrolling details body and reachable footer. Current-step announcements stay accessible; decorative progress and ticking estimates do not claim settlement.
- Existing launch signature/completed/failed instrumentation stays with the runner; no events on display ticks or duplicate terminal events. Completion still means all execution checkpoints settled.

## Validation and delivery

Implemented in `FundLaunchJourney.tsx`, `useV2Launch.ts` and new `useLaunchReportWait.ts` (PP-MGR-HOK-022). Stories cover long plans, signing, initial/elapsed report waits, independent signing during a report wait, retry and completion. Both new strings are translated in all 11 locales configured by this public repository.

Validation completed on 2026-10-04:

- 19 modal/timing tests passed. Initial timing failures and five modal failures were reproduced before implementation.
- 21 existing binding tests passed: serial continuation, explicit next, Pause, receipt recovery, duplicate Sign, rejection/Retry and terminal analytics.
- 19 public launch-hook tests passed, including two new regressions for stale waiting checkpoints during same-manager/different-manager journey switches. Both failed before the hydration-identity guard and pass afterward.
- The selected accepted-report driver test passed, retaining null-report wait and acceptance without an admin trigger. Two existing documentation census assertions passed: 669 registry rows and 501 integration markers across 289 files.
- Scoped TypeScript passed for changed source, stories and tests plus their imports, using a 2 GiB memory limit. Scoped Biome passed for seven TypeScript files and 11 locale files. `pnpm i18n:check` passed (11 locales, 2,847 source keys).
- `analytics:check` and `tokens:check` are absent from this public repository's package scripts. No analytics event or design token was introduced; existing binding analytics tests passed. These commands are not reported as successful checks.

Independent GPT-6.1-sol review found a P2 identity race between journey selection and passive journal hydration. Timing observation now requires a journal with the same normalized manager and draft ID as the selected journey. The reviewer rechecked this fix, its regressions, stories and documentation and found no remaining blockers.

Total focused runtime/documentation validation: **62 passing tests**. No browser walkthrough, full local test suite, coverage or build was run. No deployment, wallet signing or real transaction was performed. This validates code behavior with controlled API/wallet fixtures; live timing still depends on the report service and chain finality.
