# Solana launch UI handoff: Manager Console

**Owner:** Murilo, frontend pages and visual components. **Build day:** Thursday,
October 8, 2026. **Demo target:** Friday, October 9, 2026. **Audit:** October 7,
2026. **Tag:** `sol-ui-handoff`. This is a documentation-only handoff, not funding,
deployment, merge, or production-readiness approval.

## 1. Read this first: build the UI, do not bypass the release gates

The frontend has an unstyled dual-wallet integration and durable chain-aware
steps. The API has unsigned action builders, keeper jobs and manual CCTP receive
builders. **There is no verified, executable new-Fund Hub + Robinhood + Solana
launch end-to-end in these branch snapshots.** Ship visual states and deterministic
stories first. Do not enable real launch because a catalog entry or builder exists.

| Topic | Required UI behavior | Verified implementation / gap |
| --- | --- | --- |
| Flag | Hidden unless `useFeatureFlags().isEnabled("solanaSpoke")` | Default `false`; `NEXT_PUBLIC_FEATURE_SOLANA_SPOKE=on` opts in. Stage `next`. Never read this variable directly in a component. |
| Authentication | Keep the existing EVM/SIWE identity connected; add external Phantom through Privy | No change to canonical EVM identity; Solana is an additional signer. |
| SOL gate | Display actual requirement, balance and `costBreakdown` | **Not a hardcoded 0.3 SOL threshold.** The rulings PR computes selected Manager transaction costs with RPC rent/message-fee queries and explicit priority margin. Complete production transaction manifests remain required. |
| Three LP choices | Show TSLAx/USDC, NVDAx/USDC, SOL/USDC; no automatic selection | #48 includes NVDAx admission/custody and multiplier validation. Stock oracle remains unavailable, so **both stock options show “Unavailable”**. Admission is not deployment or executable API readiness. |
| Impact input | Empty initially, **no default and no placeholder**; explicitly enter a bounded or no-maximum value for LP submission | DEC-203/204: integer 0–65,535; explicit 0 or >=10,000 means no Manager maximum. Empty is not silently normalized. Missing reference still blocks. |
| Bootstrap | Disable real three-chain creation until supported | #47 resolves the identity cycle with an identity-free `policyHash` and derived Fund/ATA identities. Authenticated creation, staging and reconciliation API seams remain pending. |
| Swap / LP opening | Show disabled/release-blocked execution, with a reason | #48 wires signed swaps against sealed policy and nonce state. The committed API snapshot still returns 503 for `/signed-quote`; a route is not an executable API-signed quote. Stock execution remains gated. |
| Manual receive | “Complete transfer” after attestation; preserve pending until independently credited | Both manager-paid unsigned receive builder and admin keeper relay trigger exist. No admin key in browser. |
| Exit controls | Hide full liquidation, Hub-ordered close/unwind/collect and stock swaps | Local close/withdraw/burn evidence is not complete liquidation or Hub command delivery. |

### Source precedence and frozen revisions

The original audit used fetched refs; the #47/#48 refresh reads local Git objects
read-only and confirms the contract remote head with `git ls-remote`.
Use these revisions to reproduce this handoff; do not infer present readiness from
older descriptive “what code does today” paragraphs in the decisions.

| Repository / ref | Audited commit |
| --- | --- |
| Frontend `PoolPartyLabs/pool-party-v2-frontend`, `feat/fe-poo-2252-solana-spoke` | `59a1a34f4671ff2cf3e9b453a745bf290034423c` |
| API `uBits-Capital/pool-party-api`, local `feat/be-poo-2261-solana-sync` | `53dd816fa3b6b0a2000a12f7939b66fb06ce743a`; continuation worktree exists, uncommitted work is not a delivered API contract |
| Contracts `PoolPartyLabs/smartcontract-v2`, `origin/feat/pp-sc-feat-solana-spoke` | `4239d10883d95e867b0bfd6108cf801da6dafcdd`, includes merged #47 and #48 |
| Spec PR #14, `0xmvercosa/PoolParty_SCs_v2`, `docs/solana-spoke-definitions` | `21a6df12ada267add4b060f5dc7ee815a0e444b3` |

**Precedence:** DECs 188–206 specify policy; source specifies what exists. Newer
DEC-203/204 supersede provisional impact guidance in
`src/features/manager/fund/launch/SOLANA_INTEGRATION.md` and `src/lib/solana/swap.ts`.
The UI must expose the gap, not implement a workaround disguised as policy.
API response examples below describe the committed API snapshot, not missing
contract functionality at the refreshed #47/#48 revision. In particular, old
DEC-198/200/202 blocker messages are historical API diagnostics, not current
contract admission, identity-cycle or sealed-policy findings.
Follow-up remote check: `feat/be-poo-2261-solana-sync` is not published; its local
commit remains `53dd816fa3b6b0a2000a12f7939b66fb06ce743a`. API continuation stays
pending, not delivered. The contract remote head remains the audited #48 SHA.

### #47/#48 bootstrap contract and owner adapter requirements

Retain legacy `ManagerSolanaBinding` and its existing signing/verifying helpers
for existing callers and frozen legacy drafts. It is **not** the new bootstrap
authorization, and its native Config hash must not be relabeled `policyHash`.
New native creation uses this separate exact EIP-712 primary type:

```text
SolanaBootstrap(uint256 hubChain,address core,bytes32 mandateHash,bytes32 policyHash,uint16 spokeIndex,bytes32 program,bytes32 fundPda,bytes32 solanaKey,bytes32 usdcAta,bytes32 tslaxAta,bytes32 nvdaxAta,bytes32 wsolAta,bytes32 nativeMandateHash,bytes32 fundId,uint256 nonce,uint256 expiry)
```

The domain is `PoolParty Solana Fund`, version `6`, Hub chain ID and authoritative
factory verifying contract. The same Manager EVM authorization binds Hub creation
and native bootstrap. `policyHash` is identity-free: derive the Fund PDA from
`[fund, hubChain little-endian u64, core address bytes, spokeIndex little-endian
u16, policyHash]` under the pinned program, then derive its vault and canonical
USDC/TSLAx/NVDAx/WSOL ATAs with the correct token programs. Final Mandate/native
hashes and every derived identity must match the authenticated creation result.
Do not derive identities from the legacy Mandate hash or guess factory/nonce.

Freeze the complete bootstrap authorization and canonical serialized Config
payload manifest with the request **before** estimating, journaling or signing.
Resume must reject changed hashes, identities, Manager key, chunk bytes/order,
total length or selected configuration. TODO(interface): the backend must supply
and validate this manifest, its unsigned messages, lifetime and account metadata;
the frontend must not invent production payload bytes or API routes.
The frontend extension retains `ManagerSolanaBinding` with
`bootstrapAuthorization`/`bootstrapSignature`, exposes `solanaBootstrapTypedData`
and `solanaBootstrapDigest`, and freezes `solanaBootstrap: { policyHash, payload }`.
`SolanaLaunchIntegrationOptions.bootstrap` is required, not an optional fallback;
the hook validates it and stores it as frozen `solanaBootstrap`.
Its `stage-solana-config` and `seal-solana-config` step kinds both build
`stage_swap_policy`; `seal-solana-config` means the final nonempty sealing chunk,
not a new on-chain instruction. `SolanaLaunchBackend.bootstrapState` is the
read-only reconciliation seam, not a claim an HTTP endpoint is delivered.
Golden bootstrap digest:
`0x05405ee3cbacda4303d6ed3404afc02f852fd0ffa09cb9c7e44ac3bb66249092`,
using the Rust binding fixture tuple and independently encoded Solidity ABI words
in `src/lib/solana/binding.test.ts`. The legacy binding digest is separate evidence.

Manager-signed native provisioning is ordered, not one atomic browser step:

1. Stage contiguous chunks using `stage_swap_policy` at the canonical
   `[swap_policy_stage, fundPda, managerSolana]` PDA. Each `StageRequest` binds
   `policy_hash`, `total_len`, `offset`, nonempty `chunk` and `seal`.
2. The **final nonempty chunk** seals using the **same instruction** with
   `seal=true`; earlier chunks use `seal=false`. There is no separate seal
   instruction or empty seal transaction. Each chunk is at most 600 bytes,
   serialized stage payload at most 650 bytes, total payload at most 4,096 bytes;
   unsigned transaction packet limits must also pass independently.
3. Manager signs `initialize_fund` with staged-mode payload `[2]` and the sealed
   stage account. Init validates complete payload/commitment, consumes the stage
   and refunds its rent to the payer. Each stage/final-seal/init transaction
   requires the bound Manager Solana signer; an off-chain acceptance signature
   does not authorize a keeper to provision instead.

TODO(interface): authenticated read-only backend reconciliation must verify the
exact on-chain staged prefix against frozen bytes, matching Fund/Manager/hash/
length, sealed status, and initialized Fund/config identity. Stage absence alone
does not prove failure: successful init consumes it. Only verified matching
evidence may advance checkpoints. Unknown submitted transactions must retain
their signature/lifetime and reconcile; **never rebuild or request a new wallet
signature merely because polling times out**. Read-only hydration must not sign.
When `initialized=true`, the driver verifies Fund/Manager/policy identities and
the exact `bootstrapDigest`; it does not require the consumed stage's payload,
length or sealed flag to remain available. Before init, prefix/length/seal checks
are required against the frozen manifest. The response shape still carries those
fields, but initialized evidence must not be rejected for absent historical bytes.
Cost manifests must include every Manager stage/final-seal/init message and stage
rent, without counting an imaginary extra seal transaction or rent refunds as NAV.

#48 adds NVDAx native custody/admission and signed swap policy integration; it is
not an outstanding blocker to cite. `SwapPolicy.validate()` still requires
`reference_mode=0` and `stock_enabled=false`: stock oracle selection/enablement is
unavailable. Both stock choices stay disabled, including NVDAx. Feature stays OFF,
no deployment is authorized, and local evidence is not live financial readiness.

Primary evidence map (paths are relative to the named repository):

- **Frontend:** `src/features/manager/fund/launch/SOLANA_INTEGRATION.md`,
  `SolanaLaunchIntegration.tsx`, `useSolanaLaunchIntegration.ts`, `solanaPlan.ts`,
  `solanaDriver.ts`, `plan.ts`, `journal.ts`, `lock.ts`, `FundLaunchJourney.tsx`,
  `useV2LaunchBinding.ts`, `useLaunchReportWait.ts`; all non-test files in
  `src/lib/solana/`; `src/lib/features/registry.ts`; `src/lib/api/v2/client.ts`;
  `src/i18n/config.ts`, `src/i18n/messages/en/manager.json`.
- **API:** `src/v2-alpha/solana/{API.md,controller.ts,builders.ts,transactions.ts,state.ts,cctp.ts,jupiter.ts,quote.ts,reports.ts}`;
  `src/v2-alpha/{v2-cctp.controller.ts,v2-cctp.service.ts,v2-cctp.store.ts,v2-solana.client.ts,v2-alpha.controller.ts,v2-alpha.reports.ts,v2-alpha.module.ts}`;
  `src/v2-alpha/dto/fund-provisioning.dto.ts`, `v2-fund-transits.service.ts`;
  `src/main.ts`, auth guards, throttle guard, global transform/error filter,
  `src/v2-alpha/v2-alpha.interceptor.ts`.
- **Contracts:** `solana/docs/ARCHITECTURE.md`, `solana/docs/REHEARSAL.md`,
  `docs/DEPLOYMENT-SOLANA.md`.
- **Rulings:** spec `docs/definicao-v2/01-RESPOSTAS-E-DECISOES.md` (DECs 188–206)
  and `docs/definicao-v2/34-SPOKE-SOLANA-2026-10-06.md` (including round 7);
  `docs/engenharia/2026-10-06-spoke-solana/sol-cctp.md` for researched
  seconds-to-attestation estimates (not settlement evidence for a Pool Party Fund).

## 2. Screen structure and existing EVM rendering

Keep the existing review → journey → Fund navigation. Entry routes live at
`src/app/[locale]/(auth)/(app)/manager/fund-launch/review/[draftId]/page.tsx` and
`.../fund-launch/[journeyId]/page.tsx`. The current
`FundLaunchJourney.tsx` uses `useV2Launch`, a controlled `Dialog`, an active
step, state/receipt label maps, explorer links, discovered-contract details,
`role="alert"` errors, `role="status"` completion, and footer actions “Sign next
step”, “Resume journey”, “Retry failed step”, “Pause journey”. It displays the
existing Fund address even when later steps fail. Do not show rollback or
“creation failed” once creation is confirmed.

This renderer is **EVM-only today**: its kind map has approve/create/discover/
spoke/profile/allocate/report/bridge/arrival/swap/open. Do not pass SVM steps into
it without extending its view-model and links. Render native signatures as
Solana transactions, not hex EVM hashes. Chain labels:

- `42161`: Arbitrum Hub, canonical Manager EVM wallet.
- `4663`: Robinhood spoke, same Manager EVM wallet on that chain.
- `"solana:mainnet"`: Solana spoke, immutable per-Fund bound Phantom key.
- `chainKind ?? "evm"` preserves old EVM journals. A Solana-group step may be
  **EVM** (`solana:bind`, `solana:report`, `solana:send`); do not derive signer
  solely from `group === "solana"`.

Suggested visual pieces: preflight/binding card; allocation + Kamino toggle;
three-row LP selector; empty impact input; chain-aware timeline; transaction
receipt/details; bridge/attestation/credit progress; report wait; explicit
blocked-capability and recovery cards. Mount the real integration only beneath
the authenticated Privy + query providers. Never initiate launch on mount.

Reuse the wallet-free presentation seam `FundLaunchJourneyView({ launch })` for
visual patterns. Its current `FundLaunchJourneyState` is a `Pick` of
`ReturnType<typeof useV2Launch>` fields `steps`, `addresses`, `loadingError`,
`ready`, `busy`, `error`, `outcome`, `sign`, `resume`, `retry`, `cancel`, plus
`journey: { draft: { review: { name: string; imageUrl?: string } } } | null` and
`journal: object | null`. It is **not** a direct alias of the Solana integration
return. Its active-row precedence is signing → submitted → building → failed →
waiting; adapt explicitly rather than casting a mixed-chain journal into EVM
step props. Closing that existing view calls `launch.cancel()`; wire a Solana
view to its own `pause()` rather than assuming this adapter already exists.

## 3. Pre-launch wallet check and immutable binding

Run before any creation transaction or creation of a launch journal:

1. Confirm the canonical EVM Manager address and EOA; EVM contract wallets are
   rejected by preflight if `evmCode(manager)` returns nonempty code. A successful
   code lookup is required operationally; do not fabricate `undefined` on RPC failure.
2. Connect Phantom using `wallet.connect()` (Privy `solana-only`). Keep EVM connected.
   Show loading until `wallet.ready`; show both full addresses in the disclosure.
3. Before binding, `useManagerSolanaWallet()` selects a wallet only when exactly
   one exists. With multiple connected wallets it returns no selected address.
   Explicitly choose/link the intended key; never use `wallets[0]` as a fallback.
4. Obtain the exact authorized Fund/spoke/Mandate tuple from provisioning.
   `fundContext` is the draft ID, **not** the signed EIP-712 Fund identity.
   Show that the key is fixed for this Fund's lifetime. Reusing it for a different
   Fund requires fresh per-Fund authorization; Privy linking alone is insufficient.
5. Call `signManagerSolanaBinding`: EVM typed-data signature first, then Phantom
   `signMessage` of the explicit `BindingCodec.acceptanceMessage(...)`. Persist
   the result in the draft owner. **Acceptance byte encoding remains an owner
   TODO; the API/program does not provide a production codec.** No invented
   JSON-prefix/text signing scheme. Native initialize requires the actual bound
   signer; an off-chain acceptance signature is not its substitute.
6. Call `integration.check()` with a complete `costEstimator`; it computes costs
   from selected steps and reads finalized balance. Display loading, requirement,
   balance, shortfall/error and `costBreakdown` account/fee details.
   `launch()` and `resume()` repeat preflight independently.

### Actual threshold — not 0.3 SOL

`estimateSolanaPlanCosts` derives Manager transactions from the chosen plan;
`requiredManagerLamports(costs)` sums computed `rentLamports + feeLamports`.
Costs must be nonempty, have unique nonempty `stepId`s, nonnegative rent and
strictly positive fee. Balance **equal to** the sum passes. `1 SOL = 1_000_000_000`
lamports; 0.3 SOL is 300,000,000 lamports, but **neither the code nor DEC-190/195
fixes that as the threshold**. Spec round 7 R7.4 explicitly leaves decomposition
of the mentioned 0.3 SOL and RPC policy unresolved. Program deployment rent is
the separate deployer's budget, not this Manager gate.

Use “Estimated SOL required: …” from real costs, not “You must have 0.3 SOL”.
Missing estimates disable real launch (`SOLANA_COST_ESTIMATE_REQUIRED`). The
hook requires messages for every selected Manager step, queries missing accounts
with `getMinimumBalanceForRentExemption`, deduplicates creations and queries each
message with `getFeeForMessage`. `costEstimator.transactions(step)` must cover all
init/adapter/ATA/CPI creations, position NFT/mint/ATA, tick arrays and extra signers.
Use program/IDL-derived `SOLANA_ACCOUNT_SPACES`; external sizes require a source,
including actual Token-2022 extensions, never a made-up SPL size. Maximum sampled
priority micro-lamports/CU at the actual CU limit are rounded up with a deliberately
supplied positive `priorityFeeMarginBps`. TODO(decision): production margin magnitude
and retry budget are not ruled; no default is invented. Exclude keeper-funded receive
and Wormhole report jobs. Manager/keeper pay their own SOL outside the Fund;
rent refunds go to the original payer and never NAV (DEC-195).

`costBreakdown` exposes each step's account address/label/bytes/rent, transaction
count, message fee, priority reserve, margin and total fee. It remains available
after insufficient-balance rejection; `preflight` is null until a successful fresh
check. Optional `costEstimator.rpc` allows a reviewed RPC proxy/local harness.
The builder manifest is still a release dependency: this frontend cannot infer
missing CPI accounts from a made-up budget. No estimation signs/submits transactions.

With a bound address, the hook finds **only that address**. Switching Phantom
accounts must show “Reconnect the Solana wallet bound to this Fund”; never
silently rebind, change the frozen plan, or continue with a new key.

## 4. Allocation, LP selector, Kamino and price-impact semantics

`useSolanaLpChoices(references)` returns `{ enabled, choices }`; flag off means
`choices: []`. Choices now include `availability` from supplied on-chain reference
metadata; the static catalog alone still proves no admission/oracle validation.

| ID / display | `poolId` | Fee | Token metadata | Live UI at audited snapshot |
| --- | --- | --- | --- | --- |
| `tslax-usdc` / TSLAx/USDC | `8aDaBQkTrS6HVMjyc6EZebgdiaXhLYGriDWKWWp1NpFF` | 10 bps (0.10%) | TSLAx: 8 decimals, Token-2022 | **Unavailable — stock price reference not configured**; builder-only is not stock swap readiness. |
| `nvdax-usdc` / NVDAx/USDC | `49iMatQtoyabsYAQc8GafVq6aeBFVDxSRH44oiatyyw6` | 10 bps (0.10%) | NVDAx: 8 decimals, Token-2022 | **Unavailable: stock oracle not configured**; #48 admission does not enable stock execution. |
| `sol-usdc` / SOL/USDC | `3ucNos4NbumPLZNWztqGHNFFgkHeRMBQAVemeeomsUxv` | 4 bps (0.04%) | WSOL: 9 decimals, original SPL Token | Present as the third ordinary LP choice, not merely a fallback. Execute only after live admission/reference + signed-swap/bootstrap gates pass. |

Mints: TSLAx `XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB`;
NVDAx `Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh`;
WSOL `So11111111111111111111111111111111111111112`;
USDC `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` (6 decimals).
Use `SOLANA_LP_CHOICES` as the metadata source rather than duplicating it in
production. All three use Raydium CLMM
`CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK`.
SPL Token is `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`;
Token-2022 is `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb`.
SOL in a position is WSOL tokens, **not Fund-owned spendable lamports**.

Submit the configured `choice.poolId` as `selection.raydiumPool`, not display
ID, arbitrary pool text, quote, route or account metas. No preselected pool.
Stock choices additionally require stock eligibility, fresh multiplier/witness,
market-hours and live oracle checks; freeze/pause/hook/nonunit witness failures
must fail closed. Do not invent a market timezone, holiday calendar, price,
multiplier, APR or countdown to reopening. Stale or closed-market reference means
unavailable until the authoritative backend says otherwise (DEC-204).

**Kamino:** separate `selection.kamino` toggle for native USDC lending supply,
not a Raydium LP or leveraged loop. Supply creates a `solana:supply` step only
after credited arrival. Backend chooses the pinned admitted reserve/collateral
accounts and actual principal. Do not show live yield from rehearsal fixtures.
Both Kamino and an LP can be structurally selected, but selection contains **no
leaf split amounts**; do not imply both consume 100% of the same Solana balance.
Backend/canvas must supply exact allocation/amounts and validate the Mandate.

`sharePct` is integer 1–100; select Kamino and/or an LP. Hub + Robinhood + Solana
top-level allocation must not exceed 100%; unallocated residual is not a new
leaf allocation. The helper sums EVM `allocate`/`bridge` shares; leaf allocation
and principal validation remain backend responsibilities.

### Impact: definitive policy vs current callable contracts

- Label **Maximum price impact**, with bps/% unit guidance (`100 bps = 1%`) in
  separate helper text. Initial input is empty; no numeric placeholder/default.
- DEC-203: the maximum is **optional**. `0` or `>= 10_000 bps` means no maximum,
  **not** permission to proceed without a reference. If Manager wants a bounded
  limit, Manager must explicitly enter it. Do not present required entry as a
  founder ruling; the request for Manager-entered bounds does not revoke DEC-203.
- Reference is an authenticated **on-chain oracle on Solana**, not Jupiter's
  quote, a Hub display price, a browser feed, or a Manager-supplied price.
- Execution uses `max(API-signed minimum output, oracle-implied minimum output
  with the applicable Manager bound)`. Use integer raw token units; exact oracle
  encoding/rounding is owned upstream, not calculated from a UI spot price.
- No stock source has been selected by DEC-203. Do not assume Chainlink/Pyth or
  replace a missing reference with a placeholder. Missing reference → unavailable.
- **Rulings PR FE contract:** `resolveMaxPriceImpactBps` accepts explicit integer
  0–65,535, rejects empty/negative/fractional/overflow and has no default. LP plans
  require explicit input; Kamino-only plans leave it absent. Explicit “No maximum”
  may submit 0 after Manager action, never auto-convert an empty field. Current API
  `/signed-quote` remains a production gate; frontend semantics do not prove backend
  executable support. The stricter output minimum is enforced upstream, not UI math.
- #48's callable oracle minimum supports explicit `0` or `>=10,000` no-maximum
  semantics with `require_manager_bound=false`; bounded values are 1–9,999.
  This is implemented contract behavior, not an outstanding optional-limit
  implementation blocker. API delivery, stock oracle and deployment remain gated.
- `useSolanaLpChoices(references)` adds `choice.availability` with available or
  unavailable/reason. With no reference, all choices remain visibly unavailable.
  `backend.referencePrice(poolId)` provides authenticated on-chain reference metadata
  (`status`, `expiresAt`, `marketOpen` or unavailable `reason`). Preflight checks it
  before creation and the driver refreshes before swap/LP build; stale/closed stock
  market/missing references block, including when Manager chooses no maximum.
- API `slippageBps` is a separate route-builder parameter (0–9,999), **not** this
  field. Do not wire one to the other. Browser never calls Jupiter or holds its key.

## 5. Full three-chain journey, signer, waits and recovery

The rows below describe the **required journey**, with actual journal IDs and
explicit gaps. Deploying program/factories is an operator prerequisite, not a
Manager UI step. A report's publication, delivery and acceptance are distinct.

| Order / ID | Chain / signer | What the Manager sees and success condition | Pending / failure / resume |
| --- | --- | --- | --- |
| 0. Review/preflight | Hub EVM EOA + Phantom via Privy | Three allocations, exact binding tuple, SOL cost/balance, unavailable choices and entered/optional impact. Both signatures authorize this Fund. | Missing wallet/cost/reference or unsupported capability blocks before creation. User rejection leaves draft, no new Fund. |
| 1. `solana:bind` (`bind-solana`) | Journal EVM 42161; verifies prior EVM + Phantom consent, no new tx | “Verify Solana wallet binding.” Binding is persisted in frozen draft. | Driver verifies current key. No transaction hash; confirmed is off-chain verification, not native deployment. |
| 2. `approve` (if needed) | Hub 42161 / EVM wallet | “Approve USDC” with spender/amount and wallet confirmation. Confirm receipt. | Approval may be omitted if allowance is sufficient. Unknown receipt: reconcile same tx; rejection/revert: retry after checking state. |
| 3. `create` | Hub 42161 / EVM wallet | “Create and seed fund”; immutable reviewed Mandate, seed, binding commitment. Successful receipt creates Fund. | **Real native-cohort creation/provisioning not ready.** Once successful, never restart creation to repair downstream steps. |
| 4. `discover-hub` | Hub / read-only API | Show discovered Core, factory-related per-Fund connector/adapter/receiver/native registry identities. | Indexer may return discovery-pending; persist and retry with backoff. Never substitute synthetic addresses. |
| 5. `spoke` | Robinhood 4663 / same EVM wallet | Switch EVM network, “Create Robinhood spoke” using Hub Mandate. | Revert/rejection stays here; successful receipt is durable. Wrong EVM account/network gates signing. |
| 6. `discover-spoke` | Robinhood / read-only API | “Discover deployed addresses.” | Indexing pending does not mean failed deploy. |
| 7. `profile` | Journal Hub / EVM signed profile write | Sign/persist Fund profile using existing flow. | Off-chain confirmation possible; keep existing API ownership/auth. |
| 8. `allocate` + Hub leaf steps | Hub / EVM wallet | Allocate Hub principal; open Aave supply or execute `{blockId}:swap` then `{blockId}:open` for configured Uniswap V4 leaves. | Use existing raw amounts, ranges, guards and receipts. Confirm actual state before rebuilding uncertain execution. |
| 9. `report` (existing Robinhood path) | Journal Hub; keeper publication/delivery | “Wait for accepted report.” Existing UI says typically **14–19 minutes, sometimes longer**. | Existing 19-minute countdown is estimate, not expiry/credit. Continue pending when zero. |
| 10. `bridge` | Hub / EVM wallet | “Bridge to Robinhood” via existing Across path. | **Not CCTP.** Keep existing Across transfer/expiry/refund semantics; do not apply CCTP claim rules to it. |
| 11. `arrival` + Robinhood leaf swap/open | Robinhood / keeper credit then Manager EVM execution | Wait for credited arrival, refresh actual balances, then swap/open its configured Uniswap V4 position. | No spend based on a source bridge hash or fill alone. Preserve existing EVM recovery. |
| 12. Native provisioning | Solana / bound Phantom (Manager pays rent/gas) | Ordered stage chunks, final sealing chunk, then `initialize_fund`, each Manager signed against frozen bootstrap/config. | #47 resolves commitment derivation; API builders/reconciliation remain TODO(interface). Never synthesize payload/account configuration. |
| 13. `solana:report` (`report`) | Journal Hub 42161; keeper signs Solana post and Hub delivery | “Wait for accepted Solana report / registration verification.” Solana finalized report, Wormhole VAA consistency 32, shared age rule; actual Hub acceptance/registration, not just publish hash. | Minutes, no measured production SLA. Existing 14–19-minute copy is EVM baseline, not verified Solana promise. No Manager wallet prompt for keeper report. |
| 14. `solana:send` (`cctp-fast`) | Hub 42161 / EVM wallet | “Send USDC to Solana — CCTP Fast.” Show raw amount/fee cap and source hash. Fast hard ceiling **5 bps**, rounded up; refuse above cap, no silent Standard fallback. | Expected Fast attestation is **seconds**, then separate receive/credit. Not a measured end-to-end mainnet duration. Source burn success means pending claim, not arrival. |
| 15. `solana:arrival` (`solana-arrival`) | Solana / keeper receive-and-credit; Phantom only for manual fallback | Show “Awaiting attestation” → “Ready to receive” → “Receive submitted” → “Credited”. `credited()` must independently prove atomic authorized receive-and-credit and provide raw credited amount. | Retain claim indefinitely while pending. Manual “Complete transfer” builds/signs receive after attestation. Neither button click, attestation nor mint marks complete. |
| 16a. `solana:supply` (if Kamino) | Solana / Phantom | “Supply USDC to Kamino”; actual available principal, Manager fee/rent, confirmed receipt/state. | Builder exists for already provisioned/admitted Funds. New-Fund prerequisites remain blocked. No uncredited spending. |
| 16b. `solana:ratio` (if LP) | Solana / Phantom | “Prepare LP ratio”; fresh authenticated API-signed quote checked before build, stronger output minimum enforced. | **Production V2 swap blocked.** Missing/stale reference, stock market closed, quote expired, invalid signer or rate limit stops before tx signing. |
| 17. `solana:open` (if LP) | Solana / Phantom plus fresh NFT signer | “Open Raydium position” with actual post-swap balances, admitted pool, aligned ticks and minima. | #48 includes NVDAx admission; API continuation and stock oracle remain gated. Extra NFT signature orchestration is not implemented by the hook alone. |
| 18. Completion / ongoing reporting | All chains / keeper | “Launch completed” only when every planned checkpoint is confirmed. Show Fund link and truthful balances/NAV after accepted reports. | Current plan has **no explicit post-Solana-position report step**. Ongoing keeper reports are separate; never claim displayed NAV already reflects a position solely because open confirmed. |

### Actual execution ordering is a dependency graph, not a strict wizard

`withSolanaLaunchSteps()` returns `[solana:bind, ...evmSteps, ...staging, solana:init,
solana:report, solana:send, solana:arrival, optional supply, optional ratio,
optional open]`. EVM `create` adds a dependency on binding. Solana dependencies:

```text
first stage   <- discover-hub, solana:bind
next stage    <- previous stage, solana:bind
solana:seal   <- previous stage (or discover-hub for one chunk), solana:bind
solana:init    <- solana:seal
solana:report  <- profile, solana:init
solana:send    <- solana:report
solana:arrival <- solana:send
solana:supply  <- solana:arrival
solana:ratio   <- solana:arrival
solana:open    <- solana:ratio
```

EVM plan order is optional approval → create → Hub discovery → Robinhood create /
discovery → profile → Hub allocation/leaf operations → report → Across bridge →
arrival/Robinhood leaves. `runLaunch()` scans once per invocation, skips unmet
dependencies, and can pass a waiting branch to process another eligible branch.
Solana init depends on the final sealing chunk, transitively Hub discovery,
**not Robinhood completion**. Nonfinal IDs are `solana:stage:<offset>`; the final
chunk ID is `solana:seal` even for a one-chunk payload. Solana send
does not inherit the runner's special hold of EVM `bridge` behind Hub swap/open.
Render returned order, but do not claim it enforces the exact serial order above
or that closing a modal changes dependencies. Any stricter scheduling belongs to
the launch owner, not a UI-added transaction shortcut.

### Receipt, pause and resume model

- Checkpoint statuses: `idle → building → signing → submitted → waiting /
  confirmed`; `failed` is explicit error/revert, not “slow bridge”. `receiptStatus`
  is `success | reverted | unknown`. Missing optional checkpoints render idle.
- Solana uses fresh blockhash, sign-only, verifies unchanged message/fee payer
  and all required signatures, **persists native signature before broadcast**,
  then checks historical finalized status. Unknown stays waiting. Never rebroadcast
  a rebuilt transaction because a timeout or blockhash expiry looks unsuccessful.
- Confirmed steps are skipped. Unknown/submission-attempted steps reconcile
  before replacement; `SUBMISSION_RECONCILIATION_REQUIRED` forbids new sends.
- A signing rejection is not automatically safe to retry in this implementation:
  the journal sets `submissionAttempted` before invoking `send`. Unless the owner
  driver proves no submission, its next pass can require reconciliation even
  after a rejected prompt or pre-broadcast quote/build failure. Solana transaction
  reconciliation currently returns false. Render the saved checkpoint truthfully;
  do not clear the attempted flag from the UI to “unstick” it.
- `launch()` and `resume()` are the **same execute function**, not “sign one step”
  and not read-only polling. One pass can prompt for multiple eligible transactions.
  Do not label `launch()` “Sign next step” without a one-step owner adapter.
- The new hook does not hydrate on mount or run its own background polling loop;
  `journal` initially is `null`. It loads on execute. Existing EVM
  `useV2LaunchBinding` has separate read-only polling (default 10 seconds), but
  this Solana hook does **not** automatically inherit it. No timer should call
  `resume()` unattended, since it can sign/send. Read-only reconciliation/hydration
  is an integration-owner gap; stories may render saved checkpoint fixtures.
- `pause()` aborts the current execution, not already submitted transactions or
  keeper jobs. Closing the modal is not itself a Solana abort unless wired to
  `pause()`. It retains the journal and Fund. Awaited work may finish before abort
  is observed; never promise chain cancellation.
- Default storage: `localStorage`, key
  `pp:v2:launch:1:${manager.toLowerCase()}:${draftId}`. Desktop, same-browser resume
  is scope; cross-device migration is not implemented. Browser locks fail closed
  for unsupported browsers / another active tab.
- Frozen binding and normalized selection must match byte-for-byte JSON on
  resume; changed key/pool/impact fails closed. Do not delete storage or create a
  second Fund to fix it. Older provisional Solana journals without full
  authorization/selection need reviewed migration; old EVM-only loading is retained.
- All-complete is `steps.every(step => checkpoints[step.id]?.status === "confirmed")`,
  not `!busy`, no error, successful attestation or one receipt.

## 6. TypeScript integration contracts

Use the real exports, not local copies. The following types describe existing
contracts; optional/unknown members are deliberate gaps, not license to fabricate
production payloads. JSON raw quantities are decimal strings; runtime lamports
and block heights may be `bigint` and must be stringified for fixtures/storage.

### Wallet, binding, costs and selection

```ts
import type { Address, Hex } from "viem";
import type { ReactNode } from "react";

interface SolanaBindingAuthorization {
  hubChainId: number;       // validated as 42161
  factory: Address;
  fund: Address;
  spokeAddress: string;    // base58
  spokeChainId: string;    // uint256 decimal, not "solana:mainnet"
  nativeMandateHash: Hex;  // bytes32
  nonce: string;           // uint256 decimal
  expiry: string;          // Unix seconds, uint256 decimal
}
interface ManagerSolanaBinding {
  manager: Address;
  solanaAddress: string;
  fundContext: string;     // draft ID
  authorization: SolanaBindingAuthorization;
  evmSignature: Hex;
  acceptance: number[];    // 64-byte Ed25519 signature
}
interface BindingCodec {
  acceptanceMessage(binding: Omit<ManagerSolanaBinding, "acceptance">): Uint8Array;
}
interface SolanaStepCost {
  stepId: string;
  rentLamports: bigint;
  feeLamports: bigint;
}
interface SolanaLaunchSelection {
  sharePct: number;
  kamino: boolean;
  raydiumPool?: string;
  maxPriceImpactBps?: number; // explicit u16 for LP; no default, 0/>=10000 = no maximum
}

type ManagerSolanaWallet = ReturnType<
  typeof import("@/lib/solana/useManagerSolanaWallet").useManagerSolanaWallet
>;
// enabled/ready: boolean; address: string|null;
// balanceLamports: bigint|null; balanceError: boolean;
// connect(): void; refreshBalance: TanStack query.refetch;
// signMessage(Uint8Array): Promise<Uint8Array>;
// signTransaction(Uint8Array): Promise<Uint8Array>.
```

Legacy binding EIP-712 (retained, not new bootstrap): domain `{ name: "PoolParty Solana Fund", version: "6",
chainId: 42161, verifyingContract: factory }`, primary type
`ManagerSolanaBinding`; message fields `solanaKey: bytes32`, `fund: address`,
`spoke: bytes32`, `spokeChainId: uint256`, `nativeMandateHash: bytes32`,
`nonce: uint256`, `expiry: uint256`. Use `managerSolanaBindingTypedData`,
`managerSolanaBindingDigest`, `signManagerSolanaBinding` and
`verifyManagerSolanaBinding` from `src/lib/solana/binding.ts`. No EVM personal-sign
replacement. API provisioned identities/codec are prerequisites.

`checkSolanaPrelaunch({ manager, fundContext, connectedAddress, binding, codec,
costs, balance: (address) => Promise<bigint>, evmCode: (manager) =>
Promise<string | undefined> })` returns
`Promise<{ requiredLamports: bigint; balanceLamports: bigint }>` or throws.

LP type source is `src/lib/solana/lpChoices.ts`:

```ts
interface SolanaLpToken {
  symbol: "TSLAx" | "NVDAx" | "SOL" | "USDC";
  mint: import("@solana/kit").Address;
  tokenProgram: import("@solana/kit").Address;
  decimals: number;
}
interface SolanaLpChoice {
  id: "tslax-usdc" | "nvdax-usdc" | "sol-usdc";
  label: "TSLAx/USDC" | "NVDAx/USDC" | "SOL/USDC";
  poolId: import("@solana/kit").Address;
  programId: import("@solana/kit").Address;
  feeTierBps: number;
  tokens: readonly [SolanaLpToken, SolanaLpToken];
  stockMarketHoursRequired: boolean;
}
type SolanaOracleReference =
  | { status: "unavailable"; reason: string }
  | { status: "available"; expiresAt: number; marketOpen: boolean };
// useSolanaLpChoices(references): choices include
// availability: { status: "available" } | { status: "unavailable"; reason: string }
```

### Render prop and owner-supplied backend

```ts
import type { BindingCodec, ManagerSolanaBinding } from "@/lib/solana/binding";
import type { SolanaBootstrapManifest } from "@/lib/solana/bootstrap";
import type { SolanaPlanCostEstimator } from "@/lib/solana/costs";
import type { SolanaOracleReference } from "@/lib/solana/oracle";
import type { SolanaLifetime } from "@/lib/solana/transaction";
import type { SolanaApiSignedQuote, SolanaSwapQuoteRequest } from "@/lib/solana/swap";
import type { LaunchStep, SolanaLaunchStep } from "@/features/manager/fund/launch/plan";
import type {
  Checkpoint, JournalStorage, LaunchDriver, LaunchJournal,
} from "@/features/manager/fund/launch/journal";
import type { SolanaLaunchSelection } from "@/features/manager/fund/launch/solanaPlan";
import { useSolanaLaunchIntegration } from "@/features/manager/fund/launch/useSolanaLaunchIntegration";

// Types are exported from @/lib/solana/costs; these mirror the rulings PR.
interface SolanaPlanCostEstimator {
  transactions(step: SolanaLaunchStep): Promise<readonly SolanaCostTransaction[]>;
  priorityFeeMarginBps: number; // explicitly configured, positive; no default
  rpc?: SolanaCostRpc;
}
interface SolanaCostTransaction {
  message: string; // actual unsigned base64 transaction message
  computeUnitLimit: number;
  createdAccounts: readonly SolanaCreatedAccount[];
}
interface SolanaCreatedAccount {
  address: string;
  label: string;
  layout: { kind: "spoke"; name: keyof typeof SOLANA_ACCOUNT_SPACES }
    | { kind: "external"; bytes: number; source: string };
}
// Original-audit allocation sizes, including discriminator; revalidate against #47/#48 IDL:
// FundState 5105; TokenLedger 105; CctpRoute 109; CctpLedger 80;
// KaminoPosition 161; RaydiumPolicy 113; RaydiumLedger 104;
// RaydiumPosition 210; Transit 250. Reconcile before production wiring.
// External CPI/Token-2022 account sizes require the actual builder/extension decoder.

interface SolanaLaunchBackend {
  bootstrapState?(journal: LaunchJournal): Promise<{
    policyHash: string;
    fundPda: string;
    managerSolana: string;
    totalLength: number;
    payload: string;
    sealed: boolean;
    initialized: boolean;
    bootstrapDigest?: string;
  } | null>;
  referencePrice?(poolId: string): Promise<SolanaOracleReference>;
  build(step: SolanaLaunchStep, journal: LaunchJournal,
    lifetime?: SolanaLifetime, quote?: SolanaApiSignedQuote): Promise<Uint8Array | unknown>;
  quoteSwap?(request: SolanaSwapQuoteRequest, journal: LaunchJournal): Promise<unknown>;
  verifySwapQuote?(quote: SolanaApiSignedQuote,
    request: SolanaSwapQuoteRequest): Promise<boolean>;
  credited(journal: LaunchJournal): Promise<{ credited: boolean; amount?: string }>;
  reportReady(journal: LaunchJournal): Promise<boolean>;
  attestation(journal: LaunchJournal): Promise<{ message: string; attestation: string }>;
  receiveAndCredit(journal: LaunchJournal,
    evidence: { message: string; attestation: string }): Promise<void>;
  complete(step: SolanaLaunchStep, checkpoint: Checkpoint, journal: LaunchJournal): Promise<void>;
}
interface SolanaLaunchIntegrationOptions {
  draftId: string;
  manager: Address;
  binding: ManagerSolanaBinding;
  bootstrap: SolanaBootstrapManifest;
  codec: BindingCodec;
  costEstimator: SolanaPlanCostEstimator;
  evmCode: (manager: Address) => Promise<string | undefined>;
  evmSteps: LaunchStep[];
  selection: SolanaLaunchSelection;
  frozen: Record<string, unknown>; // retain existing EVM request/plan
  evmDriver: LaunchDriver<LaunchStep>;
  backend: SolanaLaunchBackend;
  storage?: JournalStorage;
}
interface SolanaLaunchIntegrationProps {
  options: SolanaLaunchIntegrationOptions;
  children: (integration: ReturnType<typeof useSolanaLaunchIntegration>) => ReactNode;
}
// Integration return:
// enabled, wallet, preflight: {requiredLamports: bigint; balanceLamports: bigint}|null,
// costBreakdown: readonly SolanaComputedStepCost[]|null,
// journal: LaunchJournal|null, busy: boolean, error: string|null,
// check(): Promise<{requiredLamports: bigint; balanceLamports: bigint}>,
// launch(): Promise<void>, resume(): Promise<void>, pause(): void,
// retryReceive(): Promise<void>.
```

`SolanaLaunchIntegration` returns `null` with flag off **or mock mode on**.
`launch/resume` catch failures into `error`; `check/retryReceive` can reject, so
UI must catch and render them. Non-uppercase failures collapse to
`SOLANA_LAUNCH_FAILED`; retain useful API detail/correlation in an owner adapter.
`retryReceive` has no built-in busy guard/state update: give its button separate
in-flight/error handling, prevent duplicate clicks, and refresh credit evidence.

Backend adapter mapping / explicit missing joins:

| Method / step | Existing API evidence | Missing integration requirement |
| --- | --- | --- |
| Native stage/final-seal/init builds | None in committed API snapshot | Frozen bootstrap/config manifest, exact unsigned messages and verified prefix/sealed/init reconciliation; TODO(interface). |
| `build(cctp-fast)` | Native v6 creation/transport contract path, not `/solana/build/send-home` | Hub outbound CCTP builder/amount/fee/transit mapping not delivered by this Solana API; `send-home` is reverse direction. |
| `build(kamino-supply)` | `POST /api/v2/funds/:core/solana/build/kamino-supply` | Exact amount, authoritative account admission and lifecycle readiness. |
| `build(swap-to-ratio)` / `quoteSwap` | `/route` is diagnostics; `/signed-quote` always 503 | Final signed envelope, pinned signer/domain/nonce/oracle, production ratio builder. |
| `build(raydium-open)` | `/build/raydium-open` | Range/liquidity/maxima from planner, extra NFT signer, confirmed ratio. |
| `attestation` | CCTP GET in section 7 | Map source core/transit from journal; reject null bytes until ready. |
| `receiveAndCredit` | `/solana/transits/:id/build-receive` | Server-saved validated evidence → decode unsigned tx → correct wallet signing/broadcast; never POST arbitrary evidence. |
| `credited` | Keeper internally verifies credit; CCTP GET exposes `status` only | Fund/transit-qualified independent credit and exact amount. CCTP GET alone cannot fulfill `amount`. |
| `reportReady` | Admin report trigger / job read and actual Hub state | Accepted finalized report, shared age/emitter/registration validation, not job existence. |
| `complete` | Action-specific receipt/account reads | Actual committed addresses/amounts and state updates; no optimistic completion. |

**Blockhash mismatch:** FE `sendSolanaTransaction` supplies a lifetime and insists
the built message matches it. API builders independently fetch a finalized
blockhash and accept no lifetime in their strict request schema. Merely base64
decoding an API builder response can fail `UNSAFE_SOLANA_TRANSACTION`. Owner must
reconcile builder-lifetime design; UI must not patch signed messages or strip checks.
Additional NFT/event signers must all sign; Privy signing the Manager alone is
not enough. Current hook does not generate or orchestrate those keys.

### Journal, step and RPC contracts

```ts
type ChainId = 42161 | 4663 | "solana:mainnet";
type CheckpointStatus = "idle" | "building" | "signing" | "submitted" |
  "waiting" | "confirmed" | "failed";
interface Checkpoint {
  stepId: string;
  chain: ChainId;
  chainKind?: "evm" | "svm";
  status: CheckpointStatus;
  txHash?: string; // native base58 signature for SVM
  submissionAttempted?: boolean;
  receiptStatus?: "success" | "reverted" | "unknown";
  error?: string;
  data?: Record<string, unknown>;
  waitReason?: "discovery";
  retryAt?: number; // milliseconds
  retryCount?: number;
  retryAfterSeconds?: number;
}
interface LaunchJournal {
  version: 1;
  draftId: string;
  manager: string; // lowercased EVM address
  frozen: unknown; // existing EVM fields + solanaBinding + solanaSelection
  steps: import("@/features/manager/fund/launch/plan").ChainLaunchStep[];
  checkpoints: Record<string, Checkpoint>;
  addresses: Record<string, string>;
  principal?: string;
  arrival?: string;
  analyticsCompleted?: boolean;
}
interface JournalStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
interface SolanaLifetime { blockhash: string; lastValidBlockHeight: bigint }
interface SolanaTransactionRpc {
  genesisHash(): Promise<string>;
  latestBlockhash(): Promise<SolanaLifetime>;
  send(bytes: Uint8Array): Promise<string>;
  status(signature: string): Promise<"success" | "reverted" | "unknown">;
}
interface LaunchDriver<Step extends import("@/features/manager/fund/launch/plan").ChainLaunchStep =
  import("@/features/manager/fund/launch/plan").ChainLaunchStep> {
  build(step: Step, journal: LaunchJournal): Promise<{
    data?: Record<string, unknown>; transaction?: unknown; complete?: boolean;
  }>;
  send(step: Step, transaction: unknown, onSubmitted?: (hash: string) => void): Promise<string>;
  receipt(chain: Step["chain"], hash: string): Promise<{
    status: "success" | "reverted" | "unknown"; data?: Record<string, unknown>;
  }>;
  reconcile(step: Step, checkpoint: Checkpoint, journal: LaunchJournal): Promise<boolean>;
  complete(step: Step, checkpoint: Checkpoint, journal: LaunchJournal): Promise<void>;
}
```

Canonical step types and `LaunchDriver` are exported from `plan.ts` / `journal.ts`:
`SolanaLaunchStep` extends the EVM shared step fields (ID/dependencies/share/group/
block/protocol/config), replaces kind/chain, requires `group: "solana"` and
`chainKind`, and adds `config.maxPriceImpactBps`. Kinds are `bind-solana`,
`stage-solana-config`, `seal-solana-config`, `init-solana`, `cctp-fast`, `solana-arrival`, `kamino-supply`, `swap-to-ratio`,
`raydium-open`, `report`. `ChainLaunchStep = LaunchStep | SolanaLaunchStep`.
Use `isEvmLaunchStep`, not numerical-chain assumptions. `createChainLaunchDriver`
routes EVM unchanged; a plain EVM driver rejects SVM steps. `createManagerSolanaRpc`
uses public mainnet finalized RPC; production paid/provider policy is not decided.

Shared EVM `LaunchStep` fields: `id: string`, `chain: 42161 | 4663`,
`chainKind?: "evm" | "svm"`, `dependencies: string[]`, optional
`sharePct: number`, `shareDenominator: number`, `group: string`, `blockId: string`,
`protocol: "aave-v3" | "uniswap-v4"`; kinds are the existing EVM kinds listed in
section 2. Optional `config` contains `poolId`, `assetKey`, `priceLower`,
`priceUpper` (strings), `leafSharePct`, `maxLossBps`, `tickLower`, `tickUpper`
(numbers), `fullRange` (boolean). Solana shares these fields and adds
`maxPriceImpactBps`; exact leaf execution details are not present in
`SolanaLaunchSelection` itself.

### Current frontend signed-quote DTO — provisional, not API wire compatibility

```ts
interface SolanaSwapQuoteRequest {
  poolId: string;
  fund: string;           // EVM Fund address
  solanaAddress: string;  // bound base58 signer
  maxPriceImpactBps: number;
}
interface SolanaApiSignedQuote {
  version: 1;
  poolId: string;
  fund: string;
  solanaAddress: string;
  maxPriceImpactBps: number;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;       // positive raw integer
  minAmountOut: string;   // positive raw integer
  referenceAmountOut: string;
  priceImpactBps: number; // integer 0–10,000
  expiresAt: number;      // safe positive integer, Unix seconds
  signedPayload: `0x${string}`;
  signature: `0x${string}`;
}
```

`solanaApiSignedQuoteSchema` is strict; `validateSolanaApiQuote` checks pool/Fund/
key/limit match, admitted token pair, impact <= bound, future expiry. Separate
`verifySwapQuote` must verify the pinned API signature over the complete envelope
and payload. Merely returning `true` is forbidden in production. Quote is not
persisted; request fresh quotes on execution/resume. Reference amount is signed
evidence, not the browser's independent oracle verification.

The API's **internal** `SolanaQuote` is different: bytes32 `fund`, `tokenIn`,
`tokenOut`, `legsHash`; u64 `quotedAmountIn`, `minAmountOut`, `deadline`, `nonce`.
`SolanaQuoteDomain` is `{ chainId: bigint; verifyingContract: EVM Address;
program: PublicKey }`; domain name `Pool Party Swap Adapter`, version `2`, salt
is program bytes32; primary type `SolanaSwapRoute`. Encoding is four bytes32s,
four little-endian u64s and a 65-byte EVM signature (225 bytes). Golden vectors
exist, **but no delivered endpoint maps this into the FE envelope or authorizes
production swaps**. Do not confuse `version: 1` envelope with Jupiter API V1.

## 7. HTTP API inventory, examples, auth, errors and throttling

### Transport rules applying to every route

- Actual app installs global prefix `api` and URI versioning. Solana controller
  version 2 resolves to `/api/v2/funds/:core/solana/...`.
- **CCTP controller is version 1 with path `v2/funds/...`: its effective path is
  `/api/v1/v2/funds/:core/transits/:transitId/cctp`.** Do not silently shorten it
  to `/api/v2/.../cctp`; no alias/reverse-proxy rewrite was verified. API bootstrap
  code, not prose in older notes, determines this surprising route.
- All new endpoints require `x-api-key`; report/relay triggers and report-job
  reads additionally require `x-admin-key`. **No bearer JWT or Manager-message
  signing guard is declared on these new Solana/CCTP controller methods.**
  “Authenticated backend” here is API-key guarded, not proof of Manager consent.
  Builder validates bound Manager key; wallet signature authorizes execution.
- Use server-side owner adapters with `PP_API_URL` / `PP_API_KEY`; keep admin and
  Jupiter credentials server-only. The existing `v2Fetch` is a read-only helper
  allowing `/catalog` and `/funds`; it is **not** a delivered POST adapter, and
  cannot address this CCTP version-1 path or admin job path unchanged.
- Success is wrapped as `{ "data": ... }`; controller interceptor recursively
  adds `protocolVersion: "v2"` to **every object**, including nested transaction,
  route, account/meta/map objects. It sets `x-pool-party-protocol: v2` for handler
  responses. Parse/strip version tags before passing upstream instruction DTOs;
  do not assume a top-level tag alone meets the existing FE parser.
- Default Nest POST status is **201**, GET **200**; no override is declared here.
  Examples below use JSON `data` payloads; symbolic angle-bracket values are
  deliberately not valid signed txs/addresses. They are documentation templates,
  never instructions to submit mock financial transactions.
- Shared throttle guard defaults **20 requests / 60,000 ms per API key**, with
  per-key server overrides. These new Solana and CCTP GETs have **no**
  `@V2ReadThrottle`; do not assume the separate 600/minute read budget. The guard
  is installed globally and on controllers; only decorated v2 reads have an
  explicit duplicate-count guard. Budget conservatively and avoid burst polling.
  Actual configured key limits were not verified; no secrets were read.
- Existing decorated Fund GETs (`/funds`, detail/profile/transits/balances/limits/
  positions/history) have default **600/minute**, configurable 1–6,000/minute,
  separate shared read bucket. The new report-job read is not decorated either.
- Global timeout is 15 seconds. Transport timeout does not prove no chain send.
  Preserve correlation IDs and reconcile submitted transactions.

### Endpoint catalog (all new Solana/CCTP endpoints)

Let `CORE` be a valid EVM Fund address and `TRANSIT` a nonzero bytes32 identity.
Amounts are **raw**, never human decimal strings like `"1.5"`.

| Method / effective path | Auth | Request | Response / readiness | Specific errors |
| --- | --- | --- | --- | --- |
| POST `/api/v2/funds/CORE/solana/build/send-home` | API key | Manager + positive `amount`, `maxFee`, nonzero `transitId`, fresh `eventAccount`; optional lookup tables | Unsigned v0 Solana CCTP burn **Solana → Hub**, Manager fee payer and additional event signer | 400 invalid amount, bound key or transit; 503 Fast fee ceiling/route/native config/packet overflow. Not Hub-to-Solana send. |
| POST `/api/v2/funds/CORE/solana/build/kamino-supply` | API key | Manager + positive raw-USDC `amount`; optional lookup tables | Unsigned v0 supply in pinned reserve | 400 invalid amount/Manager/admission; 503 native/account/RPC unavailable. |
| POST `/api/v2/funds/CORE/solana/build/kamino-withdraw` | API key | Manager + positive cToken `amount` + raw `minimumUsdc` | Unsigned v0 withdraw; amount `18446744073709551615` means all recorded collateral | 400 missing amount/minimum or unadmitted state; not full liquidation. |
| POST `/api/v2/funds/CORE/solana/build/raydium-open` | API key | Manager, admitted `pool`, fresh `nftMint`, ticks, positive u128 liquidity/minimum, u64 amount maxima | Unsigned v0 open; all required signers returned | 400 unadmitted pool, invalid aligned ticks/NFT/liquidity; historical API NVDAx 503 is not a current #48 contract blocker; pool layout/packet issues remain. |
| POST `/api/v2/funds/CORE/solana/build/raydium-collect` | API key | Manager, admitted pool, program-owned `position` | Unsigned v0 fee collect; custody and rewards quarantine resolved from state | 400 invalid/closed/wrong-Fund position; no farm reward revenue. |
| POST `/api/v2/funds/CORE/solana/build/raydium-close` | API key | Manager, admitted pool, position, `amount0`, `amount1` minima | Unsigned v0 position close; original rent payer from state | Same position/admission checks; not Hub close-order/full liquidation. |
| POST `/api/v2/funds/CORE/solana/transits/TRANSIT/build-receive` | API key | Strict `{ "payer": "<bound Manager base58>" }` | Reads saved validated message/attestation; source domain 3 gives unsigned SVM receive-and-credit, source domain 5 unsigned Hub connector calldata | 400 bad transit/body, attestation not ready, wrong Solana payer/burn route; 503 native/RPC/packet unavailable. |
| POST `/api/v2/funds/CORE/solana/reports` | API + admin keys | No body | `{data:{jobId,protocolVersion:"v2"}}`; persisted keeper-funded Solana report trigger | 401 admin key missing; 503 keeper/report storage/capacity/config unavailable. |
| POST `/api/v2/funds/CORE/solana/route` | API key | Strict route DTO below | Route diagnostics with `executionReady:false`, echoed max impact and blocker | 400 invalid DTO/mints; 429 Jupiter queue/rate limit; 503 absent key, unsupported route, custody/pool mismatch/upstream timeout. |
| POST `/api/v2/funds/CORE/solana/signed-quote` | API key | Same strict route DTO | **503 always for valid requests**, no usable signed-quote response | 400 malformed DTO; 503 `v2 signed quote blocked: sealed on-chain swap policy and nonce unavailable`. |
| GET `/api/v2/funds/CORE/solana/capabilities` | API key | None | Engineering readiness object below, **not live Fund/pool admission** | 400 invalid Core; valid-address response does not itself load/validate Fund. |
| GET `/api/v1/v2/funds/CORE/transits/TRANSIT/cctp` | API key | None | Saved attestation/status/correlation DTO below | 400 identity; 404 Fund/transit missing; 503 disabled chain/storage unavailable. |
| POST `/api/v1/v2/funds/CORE/transits/TRANSIT/cctp/relay` | API + admin keys | No body | Attempts keeper relay under Fund lease, returns same status DTO; may remain pending | 409 `v2 fund keeper busy; retry`; 404 missing transit; 503 Solana keeper disabled; 401 admin missing. |

`build/:action` is a single implemented route; all six valid action values are
enumerated above. `initialize-fund`, `swap-to-ratio`, arbitrary action and
`publish-report` are **not** builders; report builds explicitly return 400
requesting the keeper endpoint. Unknown action returns 400 unsupported action.

### Builder request/response DTOs and examples

```ts
interface ManagerBuildRequest {
  manager: string;
  lookupTables?: string[]; // <= 8 unique existing active tables
  amount?: string;
  minimumUsdc?: string;
  transitId?: `0x${string}`;
  maxFee?: string;
  eventAccount?: string;
  messageAccount?: string; // accepted field; not an arbitrary message payload
  pool?: string;
  nftMint?: string;
  position?: string;
  tickLower?: number;
  tickUpper?: number;
  liquidity?: string;
  minimumLiquidity?: string;
  amount0?: string;
  amount1?: string;
}
interface UnsignedSolanaBuild {
  protocolVersion: "v2";
  transaction: string; // base64 serialized unsigned VersionedTransaction
  transactionVersion: 0;
  transactionBytes: number; // <= 1232
  blockhash: string;
  lastValidBlockHeight: number;
  requiredSigners: string[];
}
interface UnsignedHubReceive {
  protocolVersion: "v2";
  transaction: {
    protocolVersion: "v2";
    to: `0x${string}`; data: `0x${string}`; value: "0"; chainId: 42161;
  };
}
```

All amounts are canonical unsigned decimal integers, u64 except liquidity u128;
overflow/sign/whitespace/decimal fractions reject. Tick validator range is
−443,636…443,636 plus live pool spacing, lower < upper. Builders do not submit,
create lookup tables or put spendable SOL into Fund custody. The request is a
strict allowlist: arbitrary quotes/feeds/instruction bytes/keys/metas reject.

Request examples for **each** builder (template keys must be real and admitted
before any use):

```json
{
  "send-home": {
    "manager": "<bound-base58>", "amount": "1000000", "maxFee": "500",
    "transitId": "0x1111111111111111111111111111111111111111111111111111111111111111",
    "eventAccount": "<fresh-event-signer-base58>"
  },
  "kamino-supply": { "manager": "<bound-base58>", "amount": "10000000" },
  "kamino-withdraw": {
    "manager": "<bound-base58>", "amount": "18446744073709551615", "minimumUsdc": "9900000"
  },
  "raydium-open": {
    "manager": "<bound-base58>", "pool": "3ucNos4NbumPLZNWztqGHNFFgkHeRMBQAVemeeomsUxv",
    "nftMint": "<fresh-nft-signer-base58>", "tickLower": -120, "tickUpper": 120,
    "liquidity": "1000", "minimumLiquidity": "900", "amount0": "1000000", "amount1": "1000000"
  },
  "raydium-collect": {
    "manager": "<bound-base58>", "pool": "3ucNos4NbumPLZNWztqGHNFFgkHeRMBQAVemeeomsUxv",
    "position": "<program-owned-position-base58>"
  },
  "raydium-close": {
    "manager": "<bound-base58>", "pool": "3ucNos4NbumPLZNWztqGHNFFgkHeRMBQAVemeeomsUxv",
    "position": "<program-owned-position-base58>", "amount0": "0", "amount1": "0"
  }
}
```

These are six independent request bodies, not a batch API. Example ticks/minima
are format demonstrations, not live range/financial recommendations. Every one
returns the same `UnsignedSolanaBuild` shape, e.g.:

```json
{
  "data": {
    "protocolVersion": "v2", "transaction": "<base64-unsigned-v0-bytes>",
    "transactionVersion": 0, "transactionBytes": 296,
    "blockhash": "<finalized-blockhash>", "lastValidBlockHeight": 123456,
    "requiredSigners": ["<bound-base58>"]
  }
}
```

`296` is a display fixture, not API prediction; actual serialized size varies.
Open/send-home may require Manager + NFT/event signers. Do not send until all
signatures are present. Receive body is exactly `{"payer":"<bound-base58>"}`;
no message/attestation override. Solana destination response uses the same
unsigned shape; Hub destination example:

```json
{
  "data": {
    "protocolVersion": "v2",
    "transaction": {
      "protocolVersion": "v2", "chainId": 42161,
      "to": "<per-Fund-EVM-connector>", "data": "<receiveCctpAndCredit-calldata>", "value": "0"
    }
  }
}
```

### Route / quote DTO, rate limits and diagnostic response

```ts
interface SolanaRouteRequest {
  inputMint: string;
  outputMint: string;
  amount: string;
  slippageBps: number;       // integer 0–9999
  maxPriceImpactBps: number; // integer 0–65535, policy not execution-ready
}
interface JupiterBuild {
  inputMint: string; outputMint: string;
  inAmount: string; outAmount: string; otherAmountThreshold: string;
  slippageBps: number; swapMode: "ExactIn";
  routePlan: [{ swapInfo: { label: "Raydium CLMM"; ammKey: string } }];
  swapInstruction: {
    programId: string; data: string; // base64, verified V2 decoder
    accounts: { pubkey: string; isSigner: boolean; isWritable: boolean }[];
  };
  addressesByLookupTableAddress: Record<string, string[]>;
  setupInstructions: unknown[];
  cleanupInstruction?: null; tipInstruction?: null; otherInstructions?: [];
}
// HTTP nesting additionally inserts protocolVersion: "v2" on every object.
interface RouteDiagnostic {
  protocolVersion: "v2";
  executionReady: false;
  route: JupiterBuild;
  maxPriceImpactBps: number;
  blocker: string;
}
```

Example `/route` or `/signed-quote` request:

```json
{
  "inputMint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "outputMint": "So11111111111111111111111111111111111111112",
  "amount": "1000000", "slippageBps": 50, "maxPriceImpactBps": 100
}
```

The route response template is
`{"data":{"protocolVersion":"v2","executionReady":false,"route":<JupiterBuild>,
"maxPriceImpactBps":100,"blocker":"DEC-202: production program lacks sealed signer/oracle policy and nonce persistence"}}`.
No signature envelope, independent live reference, ratio plan or execution
permission is implied by it. Valid `/signed-quote` instead returns 503 (error
template below), never `SolanaApiSignedQuote`.

Server calls Jupiter **V2 `/swap/v2/build`**, direct admitted Raydium CLMM route,
maxAccounts 32, no SOL wrap/unwrap, no shared accounts, v0. It checks Fund custody,
mint/amount/min-output/decoder and admitted pool, not Manager-supplied data.
Free-tier engineering: shared serialized one-token bucket spaced **1,100 ms**,
queue maximum **60**, cache maximum **128** entries for **2,500 ms** (in-flight
dedup included). Upstream 429 honors retry/reset delays with exponential floor
2,100/4,200/8,400 ms; at most three attempts, returns 429 on third or delay above
10 seconds. UI should show “Jupiter rate limited. Retry after …”, use available
`response.retryAfterSeconds` / `Retry-After`, disable duplicate retry and never
poll quotes on every keystroke. Queue-full may have no retry seconds. Do not
assert the API sets a `Retry-After` header for every Jupiter error; payload has
the verified structured delay. No direct/fabricated route fallback.

Historical committed API capabilities response (no body; not Fund existence or
admission validation). Its upstream blocker strings predate merged #47/#48 and
must not be displayed as current contract findings. TODO(interface): refresh the
API capabilities contract before using it to enable execution:

```json
{
  "data": {
    "protocolVersion": "v2", "signedSwap": false, "bootstrap": false,
    "raydiumPools": {
      "protocolVersion": "v2", "tslax": "builder-only", "sol": "builder-only", "nvdax": "blocked"
    },
    "blockers": [
      "DEC-200 circular bootstrap commitment upstream",
      "DEC-202 sealed swap policy upstream",
      "DEC-198 NVDAx pool upstream"
    ]
  }
}
```

### CCTP fallback DTO and exact UI transition

```ts
interface CctpStatus {
  protocolVersion: "v2";
  transitId: `0x${string}`;
  message: `0x${string}` | null;
  attestation: `0x${string}` | null;
  status: "pending" | "attested" | "submitted" | "credited";
  correlationId: string;
}
```

GET status and POST admin relay return the same shape:

```json
{
  "data": {
    "protocolVersion": "v2",
    "transitId": "0x1111111111111111111111111111111111111111111111111111111111111111",
    "message": null, "attestation": null, "status": "pending",
    "correlationId": "fixture-cctp-pending"
  }
}
```

For an attested story set non-null fixture hex bytes and status `attested`;
never submit those fake bytes. Manager “Complete transfer” flow:

1. Read CCTP status; null attestation → stay pending, disable receive signing.
2. After failed/delayed keeper retries and available attestation, offer manager
   unsigned receive builder or server-mediated admin relay. The API does not
   expose attempt count/retry time; UI cannot enforce a numeric retry threshold
   by inventing one. Keeper backoff starts from its attempt counter and caps at
   **60 seconds**, retaining the claim rather than writing it off.
3. For manager fallback, build the saved-evidence receive, show current fee/rent,
   sign with bound Phantom for Solana destination (or appropriate EVM wallet for
   Hub destination), persist/reconcile tx. Admin relay does not require Manager
   signature and remains server-only.
4. Read independent credit evidence. Show received amount from authoritative
   credit; only then complete arrival. `retrySolanaReceive` validates nonempty
   hex evidence and calls backend; it never completes a checkpoint itself.

Status DTO omits destination signature, amount and attempts. Do not render a fake
hash or infer raw amount from `status`. `CctpRelay` internally additionally has
`core`, `sourceDomain: 3|5`, source `transactionHash`, optional `nonce`, attempts,
`retryAt`, optional `destinationTxHash`, `reattestRequested`; those are **not**
all fields of the public GET. Domain 3 is Arbitrum source; domain 5 Solana source.
Expired attestation before submit is cleared and reattested. Pending transfer is
a claim at `amount - maxFee`; unused fee cap is credited as principal on arrival.
Actual fee is Fund transport cost, not yield. CCTP timeout never expires/writes
off claim, refunds by assumption or allows Fund close (DEC-191/199/205).

### Report trigger and shared existing reads

New POST `/funds/CORE/solana/reports` request: no body, API + admin keys. Response:
`{"data":{"protocolVersion":"v2","jobId":"<uuid>"}}`.
Existing GET `/api/v2/report-jobs/JOB_ID`, API + admin keys, reads it:

```ts
interface ReportJob {
  protocolVersion?: "v2"; // HTTP response tags as v2
  source?: "robinhood" | "solana";
  solanaPublishTxHash?: string;
  jobId: string; core: string;
  status: "pending" | "delivered" | "expired" | "failed";
  sequence?: string; publishTxHash?: `0x${string}`; deliveryTxHash?: `0x${string}`;
  createdAt: number; completedAt?: number; // milliseconds
  payload?: `0x${string}`; expiresAt?: number;
}
```

Example GET response:
`{"data":{"protocolVersion":"v2","jobId":"fixture-sol-report","core":"0x1111111111111111111111111111111111111111","source":"solana","status":"pending","createdAt":1791374400000}}`.
404 missing job; 503 disabled chain/storage/report service; default shared
20/minute throttle (not decorated read budget). A delivered job is evidence to
reconcile actual accepted Hub report; expired/failed job is not a lost CCTP claim.

Existing endpoints reused by EVM launch remain unchanged: POST
`/api/v2/funds/build-create`, `/build-spoke`, `/discover`; GET
`/api/v2/funds/CORE`, `/profile`; signed profile writes; POST
`/api/v2/funds/CORE/build`; admin POST `/api/v2/funds/CORE/report` starts
**Robinhood**, not Solana report. Keep their existing FE transport DTOs from
`src/lib/api/v2/{launchSchemas.ts,launchActions.ts,launchReconciliationActions.ts}`;
do not replace them with Solana builder types.

Important shared-read trap: existing GET `/api/v2/funds/CORE/transits` (query
`limit=20`, maximum 50, opaque `cursor`) and `/transits/TRANSIT` are the **Across
EVM** service. It hardcodes Hub/4663 reverse discovery and Across stages/
expiry/refund. GET `/spokes/:chainId/balances` is likewise not proof of native
SVM balance/credit delivery. No new public Solana amount/credited-balance DTO
was verified in this branch. **Do not map its Across expired/refunded state into
Solana CCTP or use it blindly to implement `backend.credited`.**

### Error wire format and UI handling

Global filter sends (no success `data` wrapper):

```json
{
  "statusCode": 503,
  "timestamp": "2026-10-07T12:00:00.000Z",
  "path": "/api/v2/funds/0x1111111111111111111111111111111111111111/solana/signed-quote",
  "code": "SERVICE_UNAVAILABLE",
  "message": "v2 signed quote blocked: sealed on-chain swap policy and nonce unavailable",
  "response": {
    "statusCode": 503, "message": "v2 signed quote blocked: sealed on-chain swap policy and nonce unavailable",
    "error": "Service Unavailable"
  },
  "error": {
    "code": "SERVICE_UNAVAILABLE",
    "message": "v2 signed quote blocked: sealed on-chain swap policy and nonce unavailable",
    "correlationId": "fixture-blocked", "timestamp": "2026-10-07T12:00:00.000Z"
  }
}
```

Machine codes are owned by the common filter/parser; status/class mappings here
include `BAD_REQUEST`, `UNAUTHORIZED`, `NOT_FOUND`, `CONFLICT`,
`SERVICE_UNAVAILABLE`, and `SYSTEM_RATE_LIMITED` for 429. Do not invent a new
Solana code enum based on English strings. Jupiter's structured 429 `response` includes
`protocolVersion:"v2"`, `message:"Jupiter rate limited; retry manually"`,
`retryAfterSeconds`; queue-full can return a standard message without that field.
Guard 401/429 occur before controller execution and may lack the protocol header.
Use the HTTP status + established parser/correlation ID, not that header alone.
Unexpected chain exceptions become 503 `v2 chain service unavailable`.

## 8. Error and edge-state acceptance matrix

| Condition / code | What to render / safe action | Never do |
| --- | --- | --- |
| Flag off / `SOLANA_DISABLED` / global mock mode | Hide real integration. Render stories through separate pure view fixture. | Request signatures with mock data or toggle feature as readiness proof. |
| Privy not ready / missing wallet / `SOLANA_WALLET_REQUIRED` | Loading/connect; show canonical EVM identity and expected bound key. | Auto-select first connected key. |
| Wrong Phantom key / `SOLANA_BINDING_MISMATCH` | Reconnect exact saved bound wallet; show address mismatch. | Rebind per-Fund key or clear journal. |
| `SOLANA_MANAGER_EOA_REQUIRED`, `SOLANA_BINDING_INVALID`, `SOLANA_BINDING_EXPIRED` | Block prelaunch; owner-reviewed valid consent/renewal needed. | Re-sign a changed tuple silently on resume. |
| Balance RPC failure / `balanceError` | “Unable to check SOL balance”, retry explicit refresh/check. | Treat unknown balance as zero or success. |
| `SOLANA_INSUFFICIENT_SOL` | Show estimated requirement/balance/shortfall; fund **Manager** wallet then recheck. | Fund vault SOL, invented flat threshold, optimistic pass. |
| `SOLANA_COST_ESTIMATE_REQUIRED` | Missing/invalid estimates; block and show setup issue. | Substitute 0.3 SOL or local rehearsal cost as production budget. |
| `INVALID_SOLANA_PLAN`, `INVALID_ALLOCATION`, `SOLANA_LP_POOL_NOT_ADMITTED` | Return to reviewed build; explain allocation/allowed pool. | Accept arbitrary pool or duplicate capital consumption. |
| Empty impact / no maximum | Empty no-placeholder input; explicit “No maximum” action submits 0. LP requires an explicit choice; Kamino does not. | Silent default or “reference not needed”. |
| `SOLANA_PRICE_IMPACT_INVALID` | Require integer 0–65,535 and explain 0/>=10,000 no-maximum semantics. | Clamp values or confuse with slippage. |
| Missing/stale stock oracle; closed market; invalid multiplier/freeze/hook | Stock choice + swap **Unavailable**, disabled, authoritative reason. | Mock price, arbitrary Pyth/Chainlink fallback, stale reference reuse. |
| `/route` 429 or generic API throttling | Retry delay/correlation; disable retry while queued; no auto quote storm. | Jupiter browser call, server key exposure, optimistic signed quote. |
| 503 API signed-quote/bootstrap unavailable; stock oracle unavailable | Disabled capability with specific engineering reason; distinguish stale API diagnostics from merged #47/#48 contract support. | Retry-loop as though release code can recover or submit diagnostic route. |
| `SOLANA_API_QUOTE_REQUIRED`, `..._INVALID`, `..._SIGNATURE_INVALID` | Stop before build/sign; request fresh authenticated quote after gate resolves. | Persist expired quote, accept Manager quote or stub signature verifier. |
| CCTP `pending` / `attested` / `submitted` | Preserve pending claim; complete-transfer action only with ready attestation; independently poll/reconcile credit. | Claim lost funds, write off, mark arrived from mint or button, allow close. |
| Manual receive 400 “attestation not ready” | Remain pending; refresh evidence, retry later. | Override message/attestation body or call Circle mint directly. |
| Relay 409 busy / duplicate browser launch | Show operation already active; retry after lease/lock. | Concurrent relay/send or second Fund creation. |
| Unknown signature / `SUBMISSION_RECONCILIATION_REQUIRED` | Link signature, “Verifying transaction”; safe read-only reconciliation. | Rebuild after timeout/expired blockhash with uncertain prior send. |
| Reverted receipt / `TRANSACTION_REVERTED` | Explicit failed step and detail; preserve prior successes; owner-driver rebuild only after definitive revert. | Restart entire journey. |
| `SOLANA_CLUSTER_MISMATCH`, `UNSAFE_SOLANA_TRANSACTION`, `SOLANA_SIGNATURE_MISMATCH` | Stop; configured cluster/build/lifetime/signatures unsafe. | Strip validation, switch to devnet to “make it work”, mutate signed message. |
| Oversize v0 / additional signatures missing | Explain transaction preparation not ready; owner needs valid tables/all signers. | Drop evidence/metas or create browser-generated production signer workaround. |
| `INVALID_JOURNAL`, `SOLANA_SELECTION_MISMATCH` | Saved plan needs reviewed recovery/migration. | Delete/checkpoint-edit to release blocked sends. |
| `LAUNCH_ALREADY_RUNNING`, `LAUNCH_LOCK_UNAVAILABLE` | Other tab owns journey / supported desktop browser required. | Disable locks to sign in parallel. |
| `LAUNCH_CANCELLED`, pause, modal closed | Paused with saved progress; submitted transactions/keeper can still settle. | Say transactions were canceled on-chain. |
| Report countdown reaches zero / job expired | “Taking longer than estimated”; reconcile/requeue accepted report appropriately. | Mark launch complete/claim expired or spend uncredited money. |
| Generic `SOLANA_LAUNCH_FAILED` | Show retry-safe context and API correlation if owner adapter retained it. | Pretend every failure is retriable or reset binding. |

## 9. Deterministic fixtures and stories before deploy

**Visual fixture mode is not an executable mainnet integration.** Real
`SolanaLaunchIntegration` returns null in global mock mode; build pure visual
components and inject their view-model from stories/tests. Do not change mock
mode to “real” just to make a render prop execute. No source secrets, live wallets
or deployment requests are needed.

Useful committed evidence fixtures/tests:

- FE `FundLaunchJourney.stories.tsx` / `.test.tsx` for EVM modal conventions;
  `solanaPlan.test.ts`, `solanaDriver.test.ts`, `solanaJournal.test.ts`,
  `useSolanaLaunchIntegration.test.tsx`; `src/lib/solana/{preflight.test.ts,binding.test.ts,swap.test.ts,transaction.test.ts,useSolanaLpChoices.test.tsx}`.
- API `src/v2-alpha/fixtures/solana-keeper/{iris-not-indexed.json,iris-complete.json,wormholescan-finalized.json}`;
  `src/v2-alpha/solana/fixtures/{api-quote-vector.json,api-quote.hex,report-v6.hex}`
  and `controller.spec.ts`, `builders.spec.ts`, `jupiter.spec.ts`, CCTP service tests.
  Golden quote bytes are crypto/wire-test evidence, not production signing policy.
- Contracts `solana/tests/rehearsal/fixtures/report-v6.hex` and
  `solana/docs/REHEARSAL.md` provide real **local** report shape/CU/size evidence.
  Ignore `.localnet` keys/balances for mainnet UX; this handoff does not run rehearsal.

Rehearsal recorded 13 loopback transactions: initialize consent/config → atomic
CCTP receive/credit → Kamino admission → supply → recorded V1 ratio → Raydium
admission → TSLAx open → refresh/publish report → collect → close → withdraw all
recorded collateral → USDC principal burn home → local guardian ACK. This is a
**different local test order**, not proof of the production Manager journey.
Example measured unsigned-payload context: signed init 1,206 bytes / 180,087 CU,
receive 952 / 266,142, supply 296 / 134,626, TSLAx open 461 / 197,254, report
410 / 286,866; largest observed CU 325,189 for close. No per-step wall-clock
settlement timings are published there. Use these only to explain packet/rent
engineering, never as production fee estimates, progress timers or live yield.

Suggested visual-only TypeScript fixture (not a `LaunchJournal` ready for execution):

```ts
import { SOLANA_LP_CHOICES } from "@/lib/solana/lpChoices";

export const solanaUiFixture = {
  fixtureOnly: true as const,
  manager: "0x1111111111111111111111111111111111111111",
  // Reuse valid-shaped catalog keys for display only, not ownership proof.
  solanaAddress: "So11111111111111111111111111111111111111112",
  chain: "solana:mainnet" as const,
  balanceLamports: 50_000_000n,
  requiredLamports: 12_020_000n,
  costs: [
    { stepId: "solana:init", rentLamports: 10_000_000n, feeLamports: 5_000n },
    { stepId: "solana:open", rentLamports: 2_000_000n, feeLamports: 15_000n },
  ], // invented visual numbers, never transaction cost estimates
  impactInput: "", // no placeholder; optional under DEC-203
  choices: SOLANA_LP_CHOICES.map(choice => ({
    choice,
    available: false,
    reason: choice.stockMarketHoursRequired
      ? "stock-reference-unavailable"
      : "signed-swap-and-bootstrap-blocked",
  })),
  selection: { sharePct: 30, kamino: true, raydiumPool: undefined },
  bridge: { status: "pending" as const, message: null, attestation: null },
  report: { status: "pending" as const, startedAt: 1_791_374_400_000 },
};
```

The displayed Solana address above is the WSOL mint, deliberately **not** an
authorized Manager account. Never pass it to preflight/signers; live code must
get the connected bound account. Do not create fake binding signatures. For
hook tests use the existing test helpers' generated/test signatures and mocks,
not a fabricated production codec. Decimal fixture strings/BigInts should round-trip
without `Number` precision loss. Format SOL amounts safely at nine decimals.

Minimum story set:

| Story | Fixture changes / acceptance |
| --- | --- |
| Flag off and global mock | Real integration absent; pure previews still available to Storybook. |
| Wallet connect / multiple keys / wrong bound key | No automatic first-key selection; disclose expected and actual key. |
| SOL unknown / insufficient / exact threshold / funded | `null` loading; 12,019,999 fails; 12,020,000 passes; 50,000,000 passes the visual estimate. No 0.3 gate. |
| Three pools, no stock source | Both stocks Unavailable; third SOL row visible but execution separately blocked. No selected LP. |
| Empty / explicit 100 bps / explicit no maximum | No placeholder/default; 100 displays 1%; explicit 0/10,000 mean no max, but never bypass missing oracle/reference gates. |
| CCTP pending / attested / submitted / credited | Null bytes pending; fixture hex attested; signature link only when fixture tx exists; credited amount must be supplied separately. |
| Complete transfer rejected / retry / relay busy | Button-specific busy/error, no optimistic checkpoint completion. |
| Jupiter 429 / no retry header / queue full | Structured delay when present, manual retry, no browser Jupiter request. |
| Report 14-minute / 19-minute / delayed / accepted | Countdown is estimate; zero stays pending. Finalized report label separate from tx receipt. |
| Phantom rejected / reverted / unknown send | Prior successes stay visible; unknown never offers new creation/send shortcut. |
| Paused and saved mixed-chain journal | Use real step/checkpoint types with fixture-only driver and **no signing callbacks**; confirm order/dependency badges. |
| Pending bootstrap API / signed quote / stock oracle / full exit | Disabled reasons mirror capability/release map; merged NVDAx admission is not stock readiness. |

## 10. What is not ready and what to hide/disable

1. **New native-Fund bootstrap API:** #47 resolves the circular commitment with
   identity-free policy derivation. Provisioning DTO/discovery, frozen bootstrap
   authorization/config manifest, stage/init builders and verified read-only
   reconciliation remain TODO(interface). Existing `FundDraftDto` allows at most two EVM chain entries,
   exposes no native binding fields; sending FE frozen extras into old
   `/build-create` does not create a three-chain v6 Fund.
2. **Signed-swap API and deployment:** #48 wires signed swaps with sealed policy
   and replay nonce; the committed API still returns signed-quote 503. Integration
   and live execution are unverified. Historical V1 rehearsal is not production
   V2 acceptance. Hide “Swap stocks” and disable LP execution until authenticated
   signed ratio delivery, state validation and deployment are verified.
3. **Stock source/session:** #48 includes NVDAx initializer/custody/admission and
   multiplier checks, not an available stock oracle. Production policy requires
   `reference_mode=0`, `stock_enabled=false`; stock oracle selection/enablement and
   session evidence remain unavailable. Both stock choices stay disabled. Never
   fake reference prices or describe admission as a missing #48 implementation.
4. **Full liquidation, income settlement, Fund closure and Hub-ordered commands:**
   Hub unwind/close/collect execution/result dispatch fail closed. Local Raydium
   close, Kamino withdraw and USDC principal burn leave residual TSLAx/possible
   income; no full liquidation proof. Hide those end-to-end controls; standalone
   action builder availability is not a lifecycle promise.
5. **Outstanding CCTP transit closure:** DEC-205 requires all transits credited
   before close. No timeout/write-off/receipt sweep. Direction-qualified transit
   identities, retention/GC/closed-Fund receipts remain upstream gates.
6. **Mainnet approval/readiness:** local cloned rehearsal and factory dry runs are
   not deployed new-Fund three-chain evidence, measured Fast/Wormhole settlement,
   live fees/rent/max registry stress or funding approval. Do not turn on mainnet
   launch on the basis of this handoff. Program identity/ELF/authority must be
   independently frozen and verified.
7. **Fee cap mismatch:** DEC-196's global management maximum is 1,000 bps; current
   API/contracts keep 500 bps for this MVP. Keep current executable constraints
   while surfacing production correction gate; do not attribute 500 to nonexistent
   DEC-186/187 (reserved numbers). Do not change economic contracts in UI work.
8. **Farm rewards:** quarantine, not revenue (DEC-206). Principal/fees exit must
   not depend on rewards processing; do not show farm APY as Fund income.
9. **Owner adapters:** cost estimates, read-only hydration/polling, exact credited
   amount, accepted-report reads, builder-lifetime reconciliation and additional
   signer orchestration are not delivered just by these hooks. Pure visual UI can
   be finished without implementing undocumented financial glue.

## 11. i18n, accessibility and Thursday acceptance checklist

Existing namespace is **`manager`**, key prefix **`fundLaunch.*`**. Reuse existing
step/status/receipt labels, `reportWait`, `reportCountdown`, `reportDelayed`,
`discoveryWait`, `partialFailure`, `submissionReconciliation`, `walletOrJournal`
and journey controls where their semantics match. Solana integration adds **no
locale keys today**. Add explicitly named Solana-specific wallet/binding/impact/
unavailable/credit/recovery labels under this namespace; do not reuse “Bridge to
Robinhood” for CCTP or the old 14–19-minute copy as a Solana SLA.

Translate all **11** locales from `src/i18n/config.ts`: `en`, `pt-BR`, `es`, `fr`,
`de`, `nl`, `ja`, `ko`, `zh-CN`, `zh-TW`, `vi`. Current story/error examples are
English guidance, not literal production string keys. Keep error technical codes
and correlation IDs in details, with translated primary actions/descriptions.

- Wallet disclosure shows EVM + Solana addresses, fixed per-Fund binding and
  Manager-funded SOL/rent. Accessible copy/address buttons; correct chain explorers.
- All choices rendered from catalog; unavailable choices cannot submit; reasons
  use text, not color alone; no placeholder/reference-price/quote fabrication.
- No maximum prefill. Explicit 0/>=10,000 no-maximum choice, independent of blocked
  production API/program capabilities. No slippage/impact relabeling.
- Timeline distinguishes keeper-funded waiting from wallet signing; SVM signatures
  get Solana links. Use `role="alert"` for actionable errors, `role="status"` for
  state changes, countdown `role="timer"` with `aria-live="off"`.
- Check SOL with selected-step transaction manifests and RPC rent/fee queries;
  expose breakdown; exact threshold passes. No launch
  from mount, no timer invokes signing resume, no second active launch tab.
- Pending CCTP remains claim; manual receive never completes optimistically;
  unknown transactions never rebuild; existing Fund remains navigable on failure.
- Pure stories cover all section 9 states without real signing/deploy/secret access.
- Bootstrap API/signed-quote/stock-oracle/full-exit/Hub-command release blockers are visible
  engineering status, not hidden promises of an available financial operation.

## 12. Verification boundary / questions already answered by evidence

**Verified:** branch revisions, actual hook/prop/DTO names, exact catalog metadata,
selected-plan RPC SOL estimator and explicit DEC-203/204 impact/availability semantics,
dependency graph, journal/pause/resume limitations, controller methods/auth/effective
URI paths, response wrapping/tagging, throttle defaults/Jupiter backoff, manual
receive/relay paths, production blockers and local rehearsal scope.

**Not verified and must not be implied:** production acceptance codec and frozen
bootstrap/config API manifest, stage-prefix/sealed/init reconciliation, complete
native creation/discovery/init/Hub-CCTP adapter, production cost estimates or
0.3-SOL policy, chosen stock oracle/provider/calendar, deployed optional-limit
execution evidence (contract semantics are implemented), live admitted three pools, credit-amount/public SVM balance adapter,
extra-signer/lifetime orchestration, safe read-only Solana polling/hydration,
deployed program/factories/authority revocation, actual key-specific throttle
configuration or proxy alias for the CCTP URI, mainnet transaction/bridge/report
timings, complete liquidation/Hub commands. No `.env*` files were read. Source
timestamps and future dates are explicit; “tomorrow” here means October 8, 2026.

Those gaps are already classified above so Murilo's agents can build accurate
screens/stories without asking for invented protocol values or enabling unsafe
execution. Re-audit any changed source SHA before lifting its associated gate.
