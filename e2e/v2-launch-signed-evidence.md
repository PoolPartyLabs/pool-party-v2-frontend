# Opt-in launch spec validation (PP-E2E-V2-003)

Part of POO-2182. Validated October 4, 2026 against `https://v2.dev.pool-party.xyz`
with Arbitrum and a 65-second catalog cooldown. No Launch click, financial signature or
broadcast was performed. The private key stayed in the Node process environment; the browser
only received the public wallet and narrowly allowlisted SIWE authentication signatures.

Final deployed run: **3 passed in 3.4 minutes**. The original non-spending Mandate/Build/Review
test and fund #1 history test both pass; signed-spec dry mode passes separately in the same run.
Review showed **Launch · 11 signatures** and these 15 steps:

| # | Displayed step | Chain ID |
|---|---|---|
| 1 | Approve USDC | 42161 |
| 2 | Create and seed fund | 42161 |
| 3 | Discover deployed addresses | 42161 |
| 4 | Create Robinhood spoke | 4663 |
| 5 | Discover deployed addresses | 4663 |
| 6 | Sign fund profile | 42161 |
| 7 | Allocate to hub | 42161 |
| 8 | Swap from actual balances | 42161 |
| 9 | Open position | 42161 |
| 10 | Open position | 42161 |
| 11 | Wait for accepted report | 42161 |
| 12 | Bridge to Robinhood | 42161 |
| 13 | Wait for credited arrival | 4663 |
| 14 | Swap from actual balances | 4663 |
| 15 | Open position | 4663 |

Inputs: name `Rehearsal <HHMM>`, Instant 2%, performance 20%, management 0%, minimum/seed
2 USDC. Defaults were left intact. Displayed seed preview: one whole share, 1 USDC principal,
0.005 USDC flow fee, 0.995 USDC wallet remainder. The guard conservatively checked entered
seed plus displayed fee: **2.005 USDC**, below the 2.1 ceiling. It does not claim that the
two-USDC input is entirely invested; the displayed whole-share rounding remains authoritative.

Checks pass: application typecheck, explicit `e2e/tsconfig.json` typecheck, Biome check and lint
for `e2e/` (zero errors; five pre-existing unused-suppression warnings), and two SIWE-allowlist
unit tests. Chromium was already cached; dependencies needed a frozen install because the
primary checkout has no `node_modules` to symlink. No lockfile changes.

Validation exposed three harness-only issues: Privy's deployed SIWE statement differs from
the older allowlist; a diagnostic response-body promise could stall Review indefinitely;
and fund history now displays two links for the same deposit transaction. The narrowly scoped
SIWE variant has positive/negative regressions, diagnostics wait at most five seconds, and the
history assertion selects the first matching link (as the existing payout assertion does).
The real flow, inputs, persistence checks and no-spending boundary remain unchanged.

The signed branch, reload/Resume, new Core/Spoke address capture and post-launch assertions
are implemented but **not live-validated**, intentionally. They must be exercised only by the
authorized human operator. Do not infer transaction success from this dry rehearsal.

No app-source changes, merge, deployment, local server or backend stack. Other worktrees
were left untouched. The dedicated worktree and dry evidence/screenshots are retained for
the operator; see `e2e/README.md` for the signed command and failure-resumption warning.

## October 4, 2026: PR #61 safe launch mode follow-up

This section records static validation only. The earlier operator/browser observations remain
unchanged. No browser, burner secret loading, financial signing, broadcast or deployment occurred
during this follow-up. Existing `test-results/`, reports and screenshots were not read or modified.
The retained authorized worktree was not removed, reset or replaced. No launch app/panel files changed.

Rules for this follow-up:
- R1: `E2E_V2_SIGNED_DRY=1` retains Review-only behavior; signed mode retains explicit opt-in and arming.
- R2: `E2E_V2_SIGNED_DRY=launch` keeps the financial guard disarmed and blocks every financial method, even if armed accidentally.
- R3: Launch-only clicks Launch, requires the 15 expected ordered step/chain pairs, enables Sign next step, and stops without Sign or Resume.
- R4: Allow authentication only for the authorized wallet and exact deployed or localhost:3000 SIWE domain/URI pairs. Reject financial statements, other ports/origins and appended resources.
- R5: Launch-only evidence uses isolated Playwright test output, not the retained signed/review JSON. Orchestration must select fresh output/report directories.

The guard/mode regressions were observed failing before implementation. The localhost SIWE
regression also failed before the narrow allowlist update. After implementation:
- Vitest: **18 tests passed across three files** (`v2LaunchSigning`, `v2RehearsalSignIn`, `v2FundJournal`).
- `pnpm exec tsc -p e2e/tsconfig.json --noEmit`: passed.
- Biome check and lint for E2E plus changed tests: no errors; five pre-existing unused-suppression warnings in E2E.
- Companion `scripts/e2e-secrets-check.ts`: changed-path scan passed with no credential literals. This public checkout has no `e2e:secrets-check` package script.
- The full tracked-root companion scan failed on two pre-existing findings in `e2e/helpers/embeddedLogin.ts:18` (test-account literal and OTP assignment). That unrelated file was not changed; no credential values are repeated here.

Dependencies were already usable in this retained worktree; no install, symlink replacement or
lockfile edit was required. The suggested companion dependency directory and protected hackathon
dependency directory also exist; neither was modified. Git hooks remain enabled.

The launch-only browser flow is **not validated here**. Main orchestration owns that run against
`http://localhost:3000`, including any API tunnel. The separate journey-ID storage fix belongs to
its owner's worktree, not this E2E change. Use the isolated-output command in `e2e/README.md`.
