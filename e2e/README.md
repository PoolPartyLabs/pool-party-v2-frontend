# V2 deployed mainnet checks (PP-E2E-V2-001)

## Opt-in launch rehearsal (PP-E2E-V2-003)

From the retained `test-fe-poo-2182-v2-launch-signed` worktree, export the authorized
`E2E_PRIVATE_KEY` in the shell only. Never put the key in browser storage, arguments or tracked files.
For the human-operated signed run:

```bash
E2E_V2_SIGNED=1 E2E_V2_SIGNED_DRY=0 E2E_BASE_URL=https://v2.dev.pool-party.xyz E2E_CHAIN=arbitrum E2E_CATALOG_COOLDOWN_MS=65000 pnpm exec playwright test e2e/specs/v2-launch-signed.spec.ts --workers=1
```

Set `E2E_V2_SIGNED_DRY=1` instead to run through Review and assert the Launch button and
step list without clicking Launch. Dry mode blocks every financial signature/broadcast in Node;
only narrowly allowlisted SIWE authentication messages are permitted. Without `E2E_V2_SIGNED=1`
the spec skips. Review must use the authorized manager address and seed plus displayed flow fee
must not exceed 2.1 USDC. Panel-written settings/shares remain authoritative.

The signed journey polls every ten seconds, reloads once after the first confirmed spoke step,
then clicks Resume. Resume may advance multiple steps; the Node bridge records the UI before
each signature. No automatic failed-step retry occurs. JSON evidence accumulates step observations
at `test-results/v2-launch-signed-evidence.json`, with per-step screenshots in the test output folder.
Timestamps denote UI observations, not block timestamps; off-chain steps have null hashes and
may have null click timestamps. Retain this evidence and checkpoints after a failed signed run;
do not rerun blindly, because a new browser creates a new draft rather than resuming old funds.
The original non-spending rehearsal still stops before Launch and asserts existing fund history.

Static E2E checks: `pnpm exec tsc -p e2e/tsconfig.json --noEmit`,
`pnpm exec biome check e2e`, and `pnpm exec biome lint e2e`.

Run read-only checks with `E2E_BASE_URL=https://v2.dev.pool-party.xyz E2E_CHAIN=arbitrum pnpm exec playwright test --grep '@v2-read' --workers=1`.
Read specs reuse the EIP-6963 wallet and SIWE helper. Fund #2 discovery depends on deployed POO-2181.

Writes require the funded dev burner in `E2E_PRIVATE_KEY` **in the shell only** and explicit
`E2E_V2_WRITE=1`. Source the handoff `tools/rpc-env.sh`, then export
`E2E_ARBITRUM_RPC_URL="$ARBITRUM_RPC_URL"` in that same shell. Never print either credential.
Wait for PR #45 to merge and for explorer links to appear on deployed fund history before writes.
These are real mainnet transactions: one deposit, at most 2.2 USDC, cumulative ceiling 3 USDC,
one Instant payout, no native-value transfer. The optional Standard payout is skipped.
Payout sizing reads ShareToken `decimals()` and computes whole units from the raw balance.
The authorized follow-up redeems exactly the burner's one whole share. Request sizing includes
one-percent price headroom; the authoritative preview must burn exactly the one-share balance.
The journal prevents a second payout broadcast. Fractional requests return `PayoutBelowOneShare`;
the fund form now explains "Payouts are in whole shares; minimum 1 share."
`E2E_V2_FUND=2` explicitly selects fund #2 for a deposit. `E2E_V2_HISTORY=1` runs the
five-minute read-only history diagnostic after a deposit (`--grep 'history diagnostic'`).
The authorized dev burner source is the separate `pool-party-v2-frontend/.env.dev` checkout;
filter only `POOL_PARTY_DEV_BURNER_WALLET` into shell `E2E_PRIVATE_KEY`, never source all secrets.

Serial, one worker, no retries. `e2e/.auth/v2-run.json` is an ignored public-transaction journal:
it prevents duplicate deposits across reruns and preserves broadcast hashes even if UI assertions fail.
Do not delete it after a broadcast or retry a transaction on a receipt timeout. Review the wallet first.
An unresolved `pendingBroadcast` is persisted before the wallet request and blocks every later write,
including when the RPC loses the response after accepting a transaction. Reconcile the nonce and receipt
manually before clearing that marker; never clear it merely to rerun a spec.
Receipt verification uses both viem and `cast`; RPC error details are suppressed. Keys stay Node-side.
Screenshot/receipt attachments live under `test-results/`; retain failure artifacts, remove passing
reports after copying non-secret evidence. No local server is needed in deployed-dev mode.
