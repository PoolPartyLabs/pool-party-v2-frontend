# Follow-ups (local backlog)

Tasks captured here because Linear is temporarily blocked. Each entry is a Linear issue in waiting:
migrate it to Linear (project + labels + rules versioning per `07_LINEAR_WORKFLOW.md`) once Linear is
available again, then replace the entry with its `POO-` reference.

| ID | Title | Area | Status | Refs |
|----|-------|------|--------|------|
| FU-001 | Wire the generic wallet-signing modal into the real transactional flows | PP-CORE / strategies | Done | PR #171, #182, #194-#199, POO-295, POO-269 |
| FU-002 | Quacks pill observability (real-mode indexer error silently shows 0) | PP-CORE / rewards | Backlog | PR #185 |
| FU-003 | Permit2 allowance reuse: skip the permit-sign step when a valid on-chain allowance covers it | PP-CORE / strategies (cross-repo: pool-party-api) | Backlog | FU-001, POO-269 |
| FU-004 | holds-both no-price create-pool falls back to a dual seed (SeedLiquidityCard/seedAmounts); explicit starting-price input deferred to POO-354 | PP-MGR / manager | Backlog | POO-393, POO-354 |
| FU-005 | Portfolio avgApy + per-risk allocation grand aggregates on `/portfolio/:wallet/all` (already in Linear as POO-696) | PP-PORT / api | Done (POO-696 served; POO-829 reads them as the primary KPI source, client compute kept as fallback) | POO-668, **POO-696**, POO-829 |

---

## FU-001: Wire the generic wallet-signing modal into the real transactional flows

**Area**: `PP-CORE-MOD-009` (WalletSignModal) + `PP-CORE-MOD-006` (WalletSteps) + `PP-CORE-HOK-015`
(useWalletSignFlow), strategies feature.
**Status**: Done (all phases shipped). Phase 0 infra (PR #194) → collect (PR #195) → invest (PR #196)
→ withdraw (PR #197) → create-pool (PR #198) → move-range + remove/close (PR #199). Compound stays the
one cosmetic-timer flow (no real executor yet; integration point documented in `CompoundModal.tsx`).
**Depends on / relates to**: PR #171 (POO-295, shipped the modal standalone), PR #182 (made the stepper
host-controllable + added the `/dev/wallet-steps` sandbox), PR #194 (Phase 0: `useWalletSignFlow`
runner + per-step status/build kind), POO-269 (the FE-BE integration zone).

### Context (where we are today)

- PR #171 shipped `WalletSignModal` + `buildWalletSignSteps` (`PP-CORE-MOD-009`); PR #187 mounted it in
  the create-pool launch (`ReviewStep.tsx`) but **uncontrolled / mock-driven** (a representative
  approve+permit+confirm sequence on the timer, not real wallet events).
- PR #182 added an optional `activeStep` to `WalletSteps`/`WalletSignModal` (host-controllable) and a
  dev-only sandbox at `/dev/wallet-steps` (which `notFound()`s when `NODE_ENV === "production"`).
- **PR #194 (Phase 0)** landed the shared infra: `useWalletSignFlow` runner (`PP-CORE-HOK-015`), a
  `build` step kind, per-step `statuses`/`txHashes` on `WalletSteps`, and a shared `toTxError`. Nothing
  wired to it yet.
- The live transactional modals (`InvestModal`, `WithdrawModal`, `CollectModal`, `CompoundModal`) and
  the manager flows (`MoveRangeModal`, `RemoveLiquidityModal`) still render `WalletSteps` **uncontrolled**
  (mock timer) or a plain confirm-spinner, not on real wallet events.
- **Decisions:** gas = surface backend `estimatedGasInUsd` only (no client sim); scope = all real-mode
  ops; manager modals (move-range, remove/close) adopt the multistep modal; permit-reuse deferred to
  FU-003. Step sequences are network-agnostic (only internal build params differ by network).

### Goal

Make the wallet-signing flow real end-to-end: the stepper advances on actual wallet/transaction events
and each step calls the proper API/server action, so a real user (`isMockMode === false`) sees true
progress and a complete flow.

### Deliverables

- [x] Drive `activeStep` from the real signing lifecycle (token approval(s) -> Permit2 permit ->
      confirm/build tx), advancing on real wallet/tx events instead of the mock `stepMs` timer.
      (`useWalletSignFlow` runner; every executor exposes `buildSteps`.)
- [x] Implement the failure/cancel/rejection path the #171/#182 headers describe but do not yet build:
      a rejected or failed step routes to an error state, and "Try again" returns to the failed step.
      (`flow.retry()` resumes from the failed step; `flow.reset()` cancels in-flight on close.)
- [x] Use the proper server actions / API for each step (the create-pool / invest / withdraw / collect
      builders + Permit2 signing) so the flow completes in real mode. Calls marked
      `// PP-INTEGRATION-POINT` / `// PP-ANALYTICS`.
- [x] Each operation drives the multistep stepper from real settlement: `InvestModal`, `WithdrawModal`,
      `CollectModal` (strategies) + `ReviewStep`, `MoveRangeModal`, `RemoveLiquidityModal` (manager).
      `CompoundModal` consciously stays mock (no executor yet) — documented in the file.
- [x] Tests for the real-driven progression and the failure/cancel/retry paths (per-modal + the runner
      unit tests).
- [x] Coordinate with POO-269 (the FE-BE transactional integration zone) before touching the live modals.

### Acceptance

- [x] In real mode, the stepper reflects the true signing/tx state (no mock timer), failures surface a
  retryable error at the failed step, and each step hits the correct API/server action.
- [x] Existing mock-mode behavior is preserved where mock mode is still used (each modal keeps a mock
  step flow; create-pool keeps its `SIGNING_MIN_MS` mock path).

---

## FU-002: Quacks pill observability (low)

**Area**: `PP-CORE-HOK-014` (useQuacksBalance), rewards. **Status**: Backlog. **Refs**: PR #185.

In real mode the header Quacks pill (`useQuacksBalance`) swallows an analytics-indexer error to `0` with
no log/trace (correct for chrome, but a persistent indexer outage shows a silent `0`). Add a lightweight
observability hook (a `PP-NOTE`/structured log or a one-off analytics breadcrumb) so a sustained outage is
visible, without making the pill crash the shell.

## FU-003: Permit2 allowance reuse (medium, cross-repo)

**Area**: strategies + **pool-party-api** (build endpoints). **Status**: Backlog. **Refs**: FU-001, POO-269.

Today invest/create-pool sign a fresh Permit2 permit every time. v2 uses Permit2 **AllowanceTransfer**
(amount + expiration + nonce), so a still-valid on-chain allowance technically needs no new signature, but
the backend `build-add-liquidity-tx` / `build-create-pool-tx` **require** `permit` + `signature`
(`@IsNotEmpty`), so the frontend can't skip it alone. Coordinated change: make `permit`/`signature`
optional in those DTOs + derive the permit from the on-chain Permit2 `allowance(owner, token, spender)`
when present; then the frontend reads the allowance (amount + future expiration, with a safety buffer) and
marks the permit step `skipped` (the runner already supports skip) when it covers the amount. The ERC-20
approve-to-Permit2 step already auto-skips today.

## FU-005: Portfolio avgApy + per-risk allocation grand aggregates (medium, cross-repo — TRACKED IN LINEAR)

**Area**: `PP-PORT` (Portfolio KPIs) + **pool-party-api** (`GET /portfolio/:wallet/all`). **Status**:
Backlog, already tracked in Linear as **POO-696** (this is a durable pointer from the integration point,
not a Linear-blocked entry). **Refs**: POO-668, POO-696.

POO-668 (rules v2) computes the Portfolio KPI header's **avgApy** (value-weighted `Σ estReturn×currentValue
/ Σ currentValue`) and **allocation-by-risk** (per-band current-value split) CLIENT-SIDE over the wallet's
drained **active** holdings (`computeApyAndAllocation`), because the backend serves neither as a grand
aggregate on `/portfolio/:wallet/all`. This is correct for a funded wallet (kills the `0% APY` + flat-bar
regression) but is an interim: the active-only basis excludes closed-with-funds from these two figures
(arguably more correct for a "current" APY/allocation), and it is computed over the active drain rather
than served. **POO-696** landed both as backend grand aggregates (over all holdings, exact), and
**POO-829** (the POO-668 cutover) reads them as the PRIMARY KPI source via `mapAggregatesToKpis`
(nullish check — a real 0/[] wins). The client-side `computeApyAndAllocation` call in
`PortfolioPagedLoader` is deliberately KEPT as the fallback over the LOADED active rows
(deploy-order-independent + tolerant-schema degrade), so this follow-up is **Done**. See the
integration point in `docs/INTEGRATION_POINTS.md` (Positions row).
