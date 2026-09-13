# Cash+ delivery, acceptance and demonstration

> Current delivery (13 September 2026): the user selected an interactive UI-only demo, with simulated balances and no contract deployment. See [Cash+ UI demo delivery](cash-plus-ui-demo.md). The protocol requirements below are preserved as the earlier design and optional separate fork workflow; they are not claims about the mock demo.

Version 1.1 · Companion to the [technical specification](cash-plus-technical-spec.md) and [contract specification](cash-plus-contracts-accounting.md)

Scope: a polished dedicated Cash+ page with real Aqua/SwapVM fork execution, local automation, no portfolio/catalog integration and no new API/database.

## 1. Implementation work packages

The sequence is organized by interfaces and proof, not an MVP feasibility ranking. Commit each coherent change; the track requires proper commit history.

| Package | Ownership | Deliverable | Depends on |
|---|---|---|---|
| CP-01 | Frontend design | Route, sidebar, Cash+ feature flag, responsive static states and local fixtures using current theme | Spec |
| CP-02 | Contract engineering | Vault/share ledger, two-token valuation, adapters and exits | Manifest fixture |
| CP-03 | Aqua engineering | Canonical encoder/factory, pricing extension, hook state machine, official-router fork tests | CP-02 |
| CP-04 | Frontend integration | Typed reads, account/history hooks, direct transaction building, signing and receipt refresh | CP-02 ABI; CP-01 |
| CP-05 | Automation | Serial keeper, demo counterparty, manifest verifier and reproducible fork scripts | CP-03 |
| CP-06 | Presentation | Actual return/activity components, separate economic calculator, presenter runbook and visual QA | CP-04/05 |
| CP-07 | Verification | Contract invariants, meaningful frontend tests, end-to-end rehearsal and evidence bundle | All |

Frontend design can proceed against deterministic fixtures while contract interfaces stabilize. Preview fixtures must never leak into fork/live mode. Contract ABI changes require regenerating artifacts, updating typed clients and replaying the relevant integration cases.

## 2. Minimal product-change contract

Allowed shared changes: AppShell navigation, feature registry/resolver, localization namespace/nav label, chain config only if needed for the fork, package scripts, env examples and documentation/IDs registry.

Cash+ logic lives in its own feature/library folders. Do not change generic Strategy or Position models, catalog pagination, Portfolio/Home totals, strategy cards, backend DTOs or API services. Do not alter Active Reserve's addresses or mandates. No HTTP endpoints or database migrations are part of this delivery.

The existing feature-flag and business-rules conventions apply. Register testable `CP-*` requirements and unique `PP-CP-*` component/integration IDs without inventing issue numbers. Canonical engineering docs/code remain English; investor copy is localized.

## 3. Acceptance matrix

### 3.1 Product and visual acceptance

| ID | Scenario | Expected result / evidence |
|---|---|---|
| CP-UI01 | Cash+ enabled | One sidebar item named Cash+; correct active/collapsed/keyboard behavior |
| CP-UI02 | Cash+ disabled before funding | Nav hidden and route follows registry gating |
| CP-UI03 | Cash+ page opened | Current shell, Poppins, gold accent, card tokens and layout; no separate blue theme |
| CP-UI04 | Existing product viewed | No new catalog card, portfolio position or Home aggregation; existing screens unchanged |
| CP-UI05 | 360/390px view | Actions before chart, readable cards, mobile Cash+ navigation, no overflow/covered controls |
| CP-UI06 | 1024/1440px view | Main content plus sticky action rail; no duplicated shell padding |
| CP-UI07 | New investor | Clear explanation and Invest; no fake prior balance/history |
| CP-UI08 | Funded investor | Current account claim, result, liquidity estimate and activity all on Cash+ |
| CP-UI09 | Incomplete/stale reads | Explicit state and timestamp; no zero substitution or fixture fallback |
| CP-UI10 | Short history | Honest insufficient-history state; no invented historical APY |
| CP-UI11 | Simulation expanded | Persistent illustrative label; changed assumptions affect only simulation components |
| CP-UI12 | Keyboard/reduced motion/privacy | Focus trap/restoration, visible focus, accessible labels, no forced animation, masked personal values |
| CP-UI13 | English and pt-BR | Polished copy, decimal handling and dates; all configured locale namespaces complete |

### 3.2 Wallet and transaction acceptance

| ID | Scenario | Expected result / evidence |
|---|---|---|
| CP-TX01 | Deposit with insufficient allowance | Exact approval to vault, then fresh simulation and deposit |
| CP-TX02 | Allowance sufficient | Approval skipped; no unnecessary wallet request |
| CP-TX03 | Wallet balance read fails | Max disabled; no fallback to TVL/capacity |
| CP-TX04 | Amount uses exponent/excess decimals/uint256 overflow | Rejected before signing |
| CP-TX05 | Wallet/network changes at review | Unsigned intent invalidated; fresh review required |
| CP-TX06 | Target/spender/value/selector/minimum altered | Semantic validator refuses signature request |
| CP-TX07 | User rejects wallet action | Return to a recoverable state without reporting onchain failure/success |
| CP-TX08 | Tx submitted but polling times out | Pending hash retained; no automatic duplicate send |
| CP-TX09 | Replacement/cancellation | Resolve by nonce/hash and show actual outcome |
| CP-TX10 | Successful receipt | Decode owner/assets/shares and refresh from receipt block or later |
| CP-TX11 | Aave underlying liquidity unavailable | Cash redemption simulation fails clearly; shares remain unchanged |
| CP-TX12 | Proportional exit selected | Exact component tokens/minimums reviewed; no implicit cash conversion |
| CP-TX13 | Wrong account's pending journal | Never displayed as current account balance/operation |

### 3.3 Contract and protocol acceptance

| ID | Scenario | Expected result / evidence |
|---|---|---|
| CP-SC01 | Seed/deposit/redeem fuzz cases | Share ownership and NAV reconcile; rounding bounded; sponsor seed cannot redeem |
| CP-SC02 | Donation/inflation attempt | No zero-share donation of an investor deposit; minimum shares enforce reviewed protection |
| CP-SC03 | Mixed token decimals and USD prices | Correct USDC valuation; aToken/underlying counted once |
| CP-SC04 | Same account multiple deposits/partial exits | Current value and lifetime cashflows reconcile |
| CP-SC05 | Stale/future/zero/divergent oracle; sequencer down/grace | Priced operations blocked according to policy; readable status preserved |
| CP-SC06 | Standard stablecoin fill | Official SwapVM/Aqua transfers; positive defined spread; correct event/balance deltas |
| CP-SC07 | Fill exceeds hot buffer | JIT Aave withdrawal in the same successful transaction as the conversion |
| CP-SC08 | Aave withdrawal reverts | Entire fill reverts, including input and budget changes |
| CP-SC09 | Output-first taker traits | Reverts before accepted output settlement |
| CP-SC10 | Cross-order and cross-function reentrancy | Global state rejects nested settlement/deposit/redeem/governance paths |
| CP-SC11 | Many individually small fills | Aggregate secondary inventory/day budget enforced across all orders |
| CP-SC12 | Rotate orders or change cap | Does not reset consumed daily budget |
| CP-SC13 | Malicious program bytes/extension/traits | Factory/vault rejects noncanonical order |
| CP-SC14 | Quote and swap at identical state | Amounts match; exact-output unsupported error is deterministic |
| CP-SC15 | Token behavior/incorrect allowance | Reject fee-on-transfer mismatch; handle configured approval semantics |
| CP-SC16 | Guardian/keeper misuse | No asset theft path or unauthorized policy relaxation |
| CP-SC17 | Proportional exit under Aave illiquidity | Receipt-token transfer path works if protocol permits; ownership fractions preserved |
| CP-SC18 | Oracle-free emergency exit | Quantities distributed proportionally; valuation marked incomplete |
| CP-SC19 | Healthy cash withdrawal increases remaining concentration | Exit succeeds where solvent; exposure-increasing trades paused until policy restored |
| CP-SC20 | SDK/factory/official router mismatch | Verification fails; no silent switch of Active Reserve configuration |

### 3.4 Data, automation and demo acceptance

| ID | Scenario | Expected result / evidence |
|---|---|---|
| CP-D01 | Reload page | Position reconstructed from contracts; actual bounded event history restored |
| CP-D02 | Event query duplicated/reordered | Stable chronological output, no duplicate fill/revenue |
| CP-D03 | Recent reorg/fork reset | Orphaned cache invalidated; run ID prevents prior rehearsal leakage |
| CP-D04 | RPC 429 or rate limit | Multicall/bounded concurrency/backoff; no request storm |
| CP-D05 | History exceeds budget | Partial-history label and bounded load-earlier action |
| CP-D06 | No HTTP backend available | Investor page still works through selected RPC and wallet |
| CP-D07 | Keeper restarts after pending tx | Reconciles nonce/receipt/active orders before any new write |
| CP-D08 | Keeper moves idle capital | Adapter holdings update and UI shows actual state |
| CP-D09 | Actual exposure/capacity restriction | New investment/trade disabled based on contract status, not a cosmetic button |
| CP-D10 | Annual calculator defaults | $44,800, 4.48%, +0.48 pp, +12% return dollars under stated inputs |
| CP-D11 | Volume zero/$10m/$20m | 3.40%/3.70%/4.00% respectively; no guaranteed outperformance |
| CP-D12 | Local time advanced | Labeled as fork time advancement; observed event/indices distinguish it from normal elapsed demo time |
| CP-D13 | Public/live mode | Impersonation, balance writes, time travel and fixture sends impossible |
| CP-D14 | Artifact/client build inspected | No private keys, private RPC credentials or CLI signer imports in browser output |

## 4. Test strategy

Use meaningful unit tests for exact amounts, share/fee-free account formulas, pricing, compiler bytes, calldata validation, simulation calculator, event deduplication and journal identity. Test hooks/forms with their actual edge cases. Shared/complex sheets and major visual states receive Storybook stories following repository conventions.

Foundry tests cover contract unit behavior, fuzz/invariants and forks against the exact official deployment. A mock router alone cannot certify hook order, Aqua.push/pull behavior or SDK opcode compatibility. Add an adversarial taker that tries callbacks, output-first and cross-order reentrancy.

Frontend integration/E2E cases should use the app's existing wallet testing infrastructure where compatible, plus one real local-fork wallet rehearsal. Stubbed wallet tests cannot replace proof of actual token transfer. Test a full deposit → keeper park → counterparty fill → JIT withdrawal → refresh → investor redemption sequence.

Appropriate commands after implementation: targeted Vitest and Foundry suites, typecheck, lint, i18n/config/secrets checks, build and dedicated Cash+ E2E. Run the existing Aqua compiler/wallet smoke tests when shared helpers or dependencies change. Address actual failures; do not claim a successful baseline that has not run.

Visual QA requires rendered captures at 360, 390, 1024 and 1440px, including connected/unconnected, loading/error, review/pending/success and liquidity-limited states. Compare against existing Strategies UI, not against an invented redesign.

## 5. Demo choreography

Target presentation length: approximately three minutes, with a reproducible longer rehearsal script.

| Scene | On screen | Actual action / evidence | Message |
|---|---|---|---|
| 1. Understand | Cash+ page, clean explanation and invest panel | Fresh manifest/chain/wallet reads | “Invest in interest and business conversion fees.” |
| 2. Invest | Amount → review → wallet → position | Real USDC approval/deposit, shares minted | “The investor only chooses an amount.” |
| 3. Earn interest | Lending status and placement | Keeper supplies surplus to Aave; optional clearly labeled time advancement | “Idle eligible capital earns interest.” |
| 4. Convert | New conversion in activity and position refresh | Counterparty script invokes official SwapVM/Aqua; fill exceeds hot output balance and triggers JIT withdrawal | “The same pool serves a conversion and captures its margin.” |
| 5. Enforce limits | Restriction explanation in presenter details | Second scenario simulates an over-limit fill and receives the real custom error | “Automation operates within a mandate.” |
| 6. Understand value | Separate comparison calculator | Edit annual volume assumption, not real balance | “Under these assumptions, $44,800 versus $40,000.” |
| 7. Withdraw | Withdraw review/result | Real cash redemption if available; proportional alternative remains explainable | “The whole investment journey stays here.” |

Use a funded test investor and a distinct test counterparty. Do not describe internal demo swaps as customer traction. Pre-stage local accounts and approvals where appropriate but disclose what the live steps execute. The presentation should spend its time on investor value; transaction hashes and traces are available in details for judges.

For a visible JIT scene with a 1% fill cap and 5% global hot USDC target, choose the **secondary token as output** with a deliberately smaller hot balance and sufficient secondary lending holdings. A generic 1% USDC fill would fit inside a 5% USDC buffer and would not prove JIT. Verify the selected secondary Aave reserve or adjust the fixture transparently. Do not claim JIT occurred just because the hook ran.

If the chosen secondary asset has no supported lending reserve, use a separately disclosed fixture with a USDC output buffer below the allowed fill size and bind that fixture policy in the manifest. Do not silently violate the policy displayed in the UI.

## 6. Evidence bundle

Save a local rehearsal report with:

- Repo commits and dependency lockfile hash.
- Fork chain ID, run ID, source block and manifest/code hashes.
- Official Aqua/SwapVM/Aave binding verification.
- Canonical encoded order and matching factory/compiler hash.
- Successful transaction hashes and decoded receipts for investment, park, conversion/JIT and withdrawal.
- Before/after token balances, shares, lending balances and NAV.
- Rejected over-limit simulation with the expected error.
- Screenshots/video showing the same values displayed in the page.
- Test outputs and any remaining known limitations.

Explorer links on a local fork may not resolve publicly. Provide a receipt viewer in the page or the evidence report rather than constructing a misleading public explorer URL for local-only transactions.

## 7. Release bindings and completion definition

Before the demonstration, bind and verify:

| Binding | Required evidence |
|---|---|
| Secondary stablecoin/representation | Exact token, decimals, issuer description and supported transfer behavior |
| Aave eligibility | Correct reserve/aToken; fork-tested supply, withdraw and receipt transfer |
| Oracles/sequencer | Correct feeds, heartbeat/tolerance and grace policy |
| Official router | Deployment evidence, code compatibility and golden-program fork test |
| Fixture parameters | Seed, cap, buffers, fill/day limits, spread and addresses recorded in manifest |
| Wallet and RPC | Browser can read/sign on the selected fork without exposed secrets |
| Roles | Distinct demo investor/counterparty/keeper; no hidden web signing endpoint |
| Visual readiness | All main demo states rendered and reviewed at target sizes |

Done means: one polished Cash+ page; small shell/config changes; actual contract reads and investor transactions; actual Aqua/SwapVM execution with JIT evidence; a running local automation script; honest comparison simulation; passing relevant tests and a replayable demo. Production partner onboarding, continuous hosted operations, commercial fee accounting and full production audit are separate later work, not concealed requirements of this delivery.
