# PP-E2E-V2-001 evidence, 2026-10-04

Part of POO-2182. Browser target: `https://v2.dev.pool-party.xyz`, Chromium, Arbitrum,
serial, one worker, no retries. PR #45 merged at commit `0f05c188`; deployed address
links observed during the 02:20 UTC poll. Final browser pass completed at approximately
02:25 UTC. No funded transaction was submitted.

| Flow | Status | Transaction / explorer | Amount | Gas |
| --- | --- | --- | --- | --- |
| Fund #2 discovery | PASS | Not applicable | 0 | 0 |
| Fund #1 read | FAIL, real frontend explorer regression | Robinhood USDG incorrectly links to `https://arbiscan.io/address/0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` | 0 | 0 |
| Approval + deposit | BLOCKED, missing authorized key file | None submitted | 0 USDC | 0 |
| Instant payout | BLOCKED, no funded deposit | None submitted | 0 USDC | 0 |
| Standard payout | SKIPPED, optional | None submitted | 0 USDC | 0 |

## Confirmed browser regression

Route: `/en/funds/0x89625f9e4B3941e503A2f0982c81046d82143e1f`.
Connect via SIWE, select V2, inspect Report. Its Robinhood USDG token address links
to Arbiscan rather than `https://robinhoodchain.blockscout.com/address/0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`.
Cause: `src/features/funds/FundDetail.tsx:164` passes hub context to a spoke report;
`src/features/funds/ExplorerFields.tsx:83` recognizes `chainId` only, while the real
report carries `sourceChainId: 4663`. Suggested fix: normalize the report's source
chain context before rendering nested token/adapter addresses; retain explicit hub
context for report-delivery hashes. No fund-page source changed.

Profile fallback PP-1, Share Price, positions, limits and both chain states render.
Both funds are discoverable. Selected position history returns incomplete history
with no events, so real history transaction-link coverage remains unproven, not a
fabricated passing check. The final spec records that limitation separately.

## Blockers and unverified risks

- Exact authorized source `pp-v2-public/.env.dev` does not exist. Shell burner key
  is also absent. No alternate secret file was opened; no burner key entered a browser.
- Fund #1 shows minimum 2 USDC. At the observed share price ~1.003 USDC, this mints
  one indivisible whole share. Half of it cannot be redeemed; payout skips rather than
  silently redeeming old holdings or the full new share.
- Static-only lifecycle risk, not funded reproduction: `FundDetail.tsx:334` reloads
  data after success, its loading return unmounts `FundActionsPanel`, whose transaction
  state is local (`FundActionsPanel.tsx:90`). Successful transaction evidence and toast
  can disappear on refresh. Suggested fix: retain the mounted action panel or hoist
  transaction records above the loading boundary. Funded confirmation remains required.

## Balances, validation and artifacts

Independent `cast` reads before and after: burner has **4.2782 USDC** and
**0.000480113353512 ETH**, unchanged; fund #1 share-token balance is zero.
No mainnet spend, no gas spent, no receipt/hash invented.

Final Playwright: 1 passed, 1 failed, 3 skipped. Failure evidence stays in the worktree
under `test-results/v2-01-read--v2-v2-read-fun-7717c-ions-and-explorer-addresses-chromium/`:
`fund-detail.png`, `test-failed-1.png`, `trace.zip`, `video.webm`, `error-context.md`.
Artifacts are ignored and not committed. Keys stay in the Node bridge by design.

Merged-main validation: typecheck passes; lint passes with 84 existing warnings;
i18n passes (11 locales, 2476 keys); unit suite 763 files / 10,207 passing tests
and one expected failure; production build passes. Standalone E2E compilation reveals
two pre-existing generic RPC typing errors in `e2e/wallet/mockWallet.ts:132`;
the new specs have no standalone compiler errors. The skill's `pnpm e2e:secrets-check`
command is absent on this public checkout; a targeted credential scan substitutes.

No local app/backend server started. Own temporary browser poll processes stopped;
port 3000 has no listener. Other agents' worktrees and the dev host remain untouched.
Main includes #44, #45 and #41; branch integrates main by merge, not rebase/force-push.
