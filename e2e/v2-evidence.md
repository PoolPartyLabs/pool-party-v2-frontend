# PP-E2E-V2-001 evidence, 2026-10-04

Part of POO-2182. Chromium against `https://v2.dev.pool-party.xyz`, funded dev burner,
Arbitrum mainnet, serial, one worker, no retries or direct signing outside the UI.
PR #45 is deployed. This PR is not merged or deployed. Corrected authorized key source:
the separate `pool-party-v2-frontend/.env.dev` checkout. Only the burner entry was loaded
into the shell; `cast wallet address` confirmed `0x3A3ea619C0f37a7D2fF07FF442d863f316A99A7a`.

| Flow | Status | Transaction / explorer | Amount | Gas used / ETH |
| --- | --- | --- | --- | --- |
| USDC approval | PASS, displayed hash + explorer + confirmed receipt | [0x395256811ba907c16a64bbbff4b1720c1dd1a41fa34342327490613d87530e0c](https://arbiscan.io/tx/0x395256811ba907c16a64bbbff4b1720c1dd1a41fa34342327490613d87530e0c) | allowance 2 USDC | 38,596 / 0.00000077230596 |
| Fund #1 deposit | PASS on-chain, preview and hash display; initial holder-refresh assertion throttled, subsequent holder read PASS | [0x95785603afd04aa3a5de05e97014b871a7b97fc12d7069f0a2b34100869b45b3](https://arbiscan.io/tx/0x95785603afd04aa3a5de05e97014b871a7b97fc12d7069f0a2b34100869b45b3) | budget 2; charged 1.007786; flow fee 0.005; unused budget 0.992214 USDC; minted 1 share / raw 1e18 | 865,923 / 0.00001731846 |
| Instant half-raw-share payout | BLOCKED by authoritative preflight `PayoutBelowOneShare`; no payout broadcast | None | requested 0.501393 USDC for raw 5e17 shares; received 0 | 0 / 0 |
| Standard payout | SKIPPED, optional; half-share cannot be served | None | 0 | 0 |
| Holder after deposit | PASS after cooldown | Fund #1 holder reads raw 1e18 / 1 displayed share | 1 share | 0 |
| Five-minute post-deposit history | Diagnostic PASS; history remains incomplete and empty | Endpoint below, no new deposit transaction in position history | No write | 0 |

Both transaction receipts were verified with viem and independently rechecked with
`cast receipt --json`: status `0x1`, from the funded burner. Screenshots capture each
full hash linking to Arbiscan, its confirmed block, and deposit preview. Actual USDC
charge and raw shares equal the authoritative preview exactly. Fee is 25 bps of the
full 2-USDC budget, not merely the eventual principal charged.

The first preparation returned `V2_UNAVAILABLE` while Report was stale. An explicit
keeper wait/reload (at most 12 minutes, one retry) subsequently obtained fresh valuation
and allowed approval and deposit. No duplicate deposit or failed on-chain write occurred.
The deposit spec's final reload polling hit API 429 `SYSTEM_RATE_LIMITED`; cooldown and
a separate funded-browser read confirmed holder shares. Polling is now paced at 30 seconds
and awaits the rendered heading instead of checking the immediate post-reload DOM.

## Explorer bug fixed, not yet deployed

Commit `d96d0080`: `fix(PP-E2E-V2-001): honor report source chain [rules-v1]`.
Route `/en/funds/0x89625f9e4B3941e503A2f0982c81046d82143e1f`, Report previously linked
Robinhood USDG `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` to Arbiscan.
`FundDetail.tsx` now selects report `sourceChainId`; `ExplorerFields.tsx` propagates
source-only report context to nested token/adapter addresses and publication hashes,
while retaining explicit hub delivery context and transit source/destination rules.
Fund #1-shaped unit regressions failed before the patch and pass after it (10 touched
tests initially). Strategies list and Manager Console were not edited.

## Instant payout: decimals do not permit a fractional contract burn

Read ShareToken `decimals() = 18`, raw balance `1000000000000000000`, target raw half
`500000000000000000`, converted with on-chain price to request `501393` USDC base units.
Deployed server action returned `{ok:false,error:{status:400,code:"PayoutBelowOneShare"}}`;
UI incorrectly labels this as "Minimum deposit" (`src/features/funds/fundModel.ts:41`).
Contract root cause: `smartcontract-v2/src/libraries/ShareMath.sol:90` rounds burns to
whole shares; `smartcontract-v2/src/core/CoreVaultPayoutLogic.sol:127` rejects zero burn.
The decimals assertion is real, but fractionally denominated ERC20 units do not change
this contract rule. No larger payout, second deposit, or extra funding was attempted.
The 2% Instant fee/USDC-received path remains unproven because no valid half-share payout exists.

## History diagnosis (API read-only; no API repo edits)

The page does not call a generic `/funds/:core/history`. Its server action
`loadFundPositionAction` calls `GET /api/v2/funds/:core/positions/:chainId/:positionKey`
(`src/lib/api/v2/funds.ts:30`; API `src/v2-alpha/v2-alpha.controller.ts:164`).
Fund #1 Arbitrum Aave key:
`0x000000000000000000000000af88d065e77c8cc2239327c5edb3a432268e5831`.
The authenticated browser's real server-action response contained:

| UTC | `history.complete` | `history.events` | `nextBlock` | `finalizedBlock` |
| --- | --- | --- | --- | --- |
| 02:56:34 | false | [] | 511214830 | 511484241 |
| 03:01:45 | false | [] | 511215130 | 511485465 |

Likely cause of empty lifecycle history: API
`src/v2-alpha/v2-fund-position-history.service.ts:105` defaults to 10-block windows,
10 windows per scan, starting from factory history. The cursor advanced only 300 blocks
in five minutes and remained ~270k blocks behind finalized head. Increase catch-up
throughput or initialize at verified creation bounds; inspect cursor/config operationally.
No dev-host inspection or deployment performed.

Separately, this endpoint cannot include the Core Vault investor deposit transaction:
`v2-fund-position-history.service.ts:22` enumerates spoke `PositionOpened`,
`PositionIncreased`, `PositionDecreased`, `IncomeCollected`, `PositionClosed` only;
`:114` scans `vault.spokeVault`, not Core Vault `Deposited` events.
A fund-level investor transaction feed needs Core Vault event indexing, not a frontend
attempt to manufacture a deposit row in spoke-position history. Response bodies and
timestamps are retained in the ignored history diagnostic JSON.

## Final balances and safety

Arbitrum burner: **3.270414 USDC**, **0.000462022587552 ETH**, **1 fund #1 share**.
Total USDC charged 1.007786, total gas 0.00001809076596 ETH. Journal reserves 2 USDC
of the authorized 3-USDC ceiling, preventing replay across reruns. No optional claim,
extra funding, merge, deploy or API source edit.

Failure artifacts remain under the worktree's ignored `e2e/.auth/final-evidence/`:
`funded-deposit/` and `half-payout/` contain screenshots, videos, traces and contexts.
Hash-display screenshots also remain under `e2e/.auth/`. History screenshots and JSON
are retained there; no secret entered browser injection or a committed file.
No local app/backend server started; no other agents' worktrees were touched.

Final gates after merging current main (including slice E and #39): typecheck PASS;
biome no errors (84 existing warnings, one info); 70 fund tests PASS; full suite
767 files / 10,237 passing tests, one expected failure; i18n 11 locales / 2487 keys PASS;
production build PASS. Earlier branch comparison was 10,207 tests, this patch added
two source-chain regressions; the remaining increase comes from incoming main.
Standalone E2E compile still reports only two pre-existing RPC generic errors in
`e2e/wallet/mockWallet.ts:132`; no new standalone errors.
