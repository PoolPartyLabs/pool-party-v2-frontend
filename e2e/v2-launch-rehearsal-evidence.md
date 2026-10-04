# PP-E2E-V2-002 — partial rehearsal, October 4, 2026

Part of POO-2182. **No fund was launched. No real-mainnet financial signatures or transactions were submitted.** This is a draft PR, not a successful full-launch report. No merge or deployment.

## Environment and boundaries

- Fresh `origin/main`: `8fbfe41c`, deployed build reported as `hackathon-8fbfe41c`.
- Own worktree: `.claude/worktrees/fe-poo-2182-v2-launch-rehearsal`; branch `test/fe-poo-2182-v2-launch-rehearsal`.
- Chromium, serial, one worker; URL `https://v2.dev.pool-party.xyz`.
- Only the authorized burner entry was loaded into `E2E_PRIVATE_KEY` in a command-scoped shell. Derived address verified as `0x3A3ea619C0f37a7D2fF07FF442d863f316A99A7a`; no credential persisted. RPCs sourced from the handoff helper in the same shell; endpoints never logged.
- The rehearsal wallet permits only explicit RPC reads/control requests and validated authentication messages. Financial signing/broadcast is blocked regardless of `E2E_V2_WRITE`. The spec stops before the Launch click.
- Exact hub/spoke pool IDs and Aave reserve are pinned from `mainnet-records/fund2/draft.json`. The primary spec attempts UI Mandate, menu-based Build, save, fallback Review and reload persistence. Menus exist, so drag-and-drop is unnecessary. Selectors beyond the first Mandate transition are not live-validated.

## Live evidence

| Check | Outcome | Seconds | Evidence / next action |
|---|---|---:|---|
| Burner address and chain balances | PASS, read-only | not timed | Values below |
| Initial authentication | Harness failure corrected | ~79 | Guard originally allowed EIP-4361 only; deployed Pool Party uses its legacy authentication message. Added strict support and three unit tests; no app auth code edited. |
| Authentication after correction | PASS | included below | Browser reaches manager/new with burner identity and session cookie |
| Networks → Protocols | BLOCKED | 42.4 first failure; 26.1 / 26.5 after explicit waits | Select Robinhood, click `Next: Protocols`; Protocols never renders. Initial snapshot remains on Networks; later traces include navigation toward `/en`. Catalog read actions returned `ok:true`. Even waiting for the session cookie, Open wallet and catalog loading completion did not resolve it. Root cause is **not established**. Candidate owner: Murilo / builder shell, `src/features/manager/fund/FundStrategyBuilderScreen.tsx:586` (`handleNext`), validation `src/features/manager/fund/mandateDraft.ts:531`; auth/navigation may also be involved. No owned-builder file changed. |
| Build / saved draft / fallback Review | NOT REACHED | — | Cannot work around via fallback without a real browser-saved draft. No direct localStorage fixture fabricated. |
| Fund #1 fund-wide history | FAIL on deployed old frontend | 25.5 | Standalone read-only run: expected `Fund history` region absent. Existing `FundDetail.tsx` uses only `loadFundPositionAction` and position history. New history UI/client added on branch, not deployed. |
| Launch / checkpoint Resume / reports / transit fill and credit | NOT RUN | — | Human-operated signing session required |
| New fund list / manager console / both-chain positions | NOT RUN | — | No new fund exists |

| Launch kind | Chain | Explorer URL | Receipt status | Gas | Seconds |
|---|---|---|---|---|---|
| All launch steps | Arbitrum / Robinhood | None | Not submitted | 0 spent by this run | Not measured |

Core Vault / Spoke Vault: **not created**. Total launch time and active/wait split: **not measurable**. No transit was initiated and no funds were stranded. No API launch error occurred, so no launch error body/status/code is claimed.

## Changes and open integration

- Fail-closed `DUPLICATE_AAVE_RESERVE` in `launch/plan.ts` spans all root chains on the same network and compares case-insensitively. Same-root repeats and separate-root repeats block. Independent reserves remain permitted. The clear translated reason reaches Review readiness, fallback preview/UI and launch binding. Unit regressions and disabled-Launch UI test included.
- #51 was **OPEN**, not merged, at start and subsequent check. Its atomic `applyBlockConfig` / new `planReadiness` shapes are not on this baseline. Conditional integration with that PR is deferred, not asserted as tested. Existing fallback precedence tests pass; no semantic adaptation made.
- Fund-wide history contract checked read-only against API GitHub commit `c8e8ce6`, because the local API checkout `e88f02f` predates POO-2186. Sources: `src/v2-alpha/v2-fund-history.service.ts`, `v2-fund-position.store.ts` (`historyPage/historyProgress`), DTO cursor constraints, event mapper and recursive `tagV2Response`. API repo untouched. The client has a zod schema, server-action same-fund validation, explicit refresh/pagination, stale-result cancellation and chain-aware explorer rows; all 11 locales updated. Deposit `0x95785603…` and payout `0x408c9825…` are required by the spec, but not verified in the new live UI.
- No local dev server against the dev API was started: the skill notes the dev API is reachable only from EC2. No credentials or upstream access were invented to bypass that boundary.

## Validation

- `pnpm install --frozen-lockfile`: PASS, lockfile unchanged.
- Full Vitest: **778 files passed; 10,412 passed, 1 expected fail**. No unexpected failures.
- Focused launch/funds/API/docs/i18n tests: 351 passed before two additional blocker tests; final full suite includes them.
- `pnpm typecheck`, `pnpm i18n:check`: PASS (11 locales, 2,549 source keys).
- `pnpm lint`: zero errors, 84 pre-existing warnings and one info.
- `pnpm build`: PASS; existing dependency/build warnings. `pnpm secrets:check`: PASS for 681 client files, no configured build secrets (prefix check only).
- Skill-requested `pnpm e2e:secrets-check` script is not present on this main baseline. Do not claim it ran.
- Failed Playwright trace/screenshot/video are retained locally under `test-results/`; report under `playwright-report/`. Traces contain authentication material and are **not pushed or pasted into the PR**.

## Human recording recommendation

Recording is October 4, 2026 at **16:00 BST / 15:00 UTC**. There are no measured successful launch timings to support a live-launch schedule.

1. Pre-authenticate and verify Networks → Protocols on the actual recording browser before recording. This run spent 26–42 seconds before failing that transition; do not assume Mandate is camera-ready.
2. Once fixed, show Mandate selections and Build menus, then fallback Review name/fees/2-USDC minimum and seed. Keep default shares/execution visible. Verify the authoritative seed preview before any financial signature: this code treats the input as a budget with whole-share rounding, not proof of two USDC principal plus fees.
3. A human signs Launch steps. Show the first wallet confirmation and every real hash/explorer link. Record click-to-confirmation timestamps and independently `cast receipt` on the chain; do not use earlier fund #1 receipts as rehearsal-launch evidence.
4. Cut bridge/report waiting only after measuring real fill and credit; show actual waiting UI and reload/Resume without replaying confirmed transactions. Stop signing if transit stalls or gas runs short; never add funding.
5. End on the newly created fund in strategies and Manager Console, with both-chain positions and explorers. Currently unverified; do not present a pre-existing fund as the new rehearsal fund.

## Balances and teardown

Initial read-only snapshot: Arbitrum **4.250615 USDC**, **0.00194554396143 ETH**; Robinhood **0.001998558552158842 ETH**. This run submits no transactions; end snapshot is recorded in the PR/final output, not assumed.

No Next server, Docker stack or deployment was started. Port 3000 had no listener at teardown checks. Playwright-owned browsers exited. Failed artifacts retained. All other expected worktrees, including `hackathon-privy-institutional-onramp`, the finish-work baseline and sibling `worktree_*` folders, are untouched.
