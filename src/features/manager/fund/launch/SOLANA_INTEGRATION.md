# POO-2262: Solana wallet integration

Solana remains OFF by default (`NEXT_PUBLIC_FEATURE_SOLANA_SPOKE=on` enables
the infrastructure). No deployment or mainnet transaction is authorized by this work.
EVM SIWE identity, embedded Ethereum wallets and existing launch journeys remain unchanged.
Rules: DEC-188, DEC-190, DEC-191, DEC-192, DEC-193, DEC-195, DEC-196, DEC-197, DEC-198,
DEC-199, DEC-202, DEC-203, DEC-204.

## UI owner contract (Murilo)

Mount `SolanaLaunchIntegration` only in the authenticated wallet provider tree.
It returns `null` when the flag is off or mock mode is on. Its `options` prop is
`SolanaLaunchIntegrationOptions`; `children(integration)` is a render prop, with no
styling, markup or pages prescribed here. Existing EVM launch pages are not migrated.

Build these UI pieces:

- Solana connect/key-selection control: `useManagerSolanaWallet(boundAddress?)`
  exposes `enabled`, `ready`, `address`, `balanceLamports`, `balanceError`, `connect`,
  `refreshBalance`, `signMessage`, `signTransaction`. No arbitrary first-wallet selection
  when multiple keys are connected. EVM stays connected and remains canonical.
- Legacy binding disclosure/signatures: retain `signManagerSolanaBinding` with
  EVM manager `signTypedData`, Solana `signMessage`, draft context, exact
  `SolanaBindingAuthorization`, and the acceptance-only `BindingCodec`.
  Present both addresses and the per-Fund immutable authorization. Reusing a key for
  another Fund requires that Fund's signatures. Persist the binding in the draft owner.
- New native bootstrap: use the separate `SolanaBootstrap` authorization described
  below, not a renamed legacy binding. Freeze its authorization and Config payload
  manifest before launch. Display Manager signatures for every stage chunk, final
  sealing chunk and init; none is a keeper-funded provisioning action.
- Funded-wallet gate: call `integration.check()` and display exact
  `requiredLamports`, `balanceLamports`, errors and `costBreakdown`. The hook derives
  Manager transaction steps from the selected plan, queries rent for missing
  accounts, deduplicates shared creations and queries each unsigned message's fees.
  It adds sampled priority fees and an explicit positive margin, never a flat 0.3
  SOL. Breakdown survives insufficient-balance rejection; another check clears
  the previously successful preflight.
- Launch controls: `launch()`, `resume()`, `pause()`, `busy`, `error`, `journal`.
  `launch()` independently reruns preflight before journaling/transactions; UI checks
  alone are insufficient. No launch starts on mount. Poll/resume pending journal steps.
- Chain-aware rows: render `journal.steps` and `journal.checkpoints`,
  `chainKind ?? 'evm'`, chain IDs 42161/4663 or `solana:mainnet`, native transaction
  signatures, and a Solana explorer link (never an EVM hash link for SVM).
- Arrival state: pending keeper/credit status and `retryReceive()` manual fallback.
  Attestation/mint is not principal credit. Retry never marks the journal complete.
- Translate new labels/errors in all 11 locales. This integration adds no locale keys.
- LP selector: `useSolanaLpChoices(references)` exposes `{ enabled, choices }`. Render
  `choice.label` and configured `feeTierBps`; submit `choice.poolId` as
  `selection.raydiumPool`. Options are TSLAx/USDC, NVDAx/USDC and SOL/USDC, not
  arbitrary pool entry. `tokens` contains mints, decimals and each token program;
  SOL denotes the WSOL mint, never Fund lamports. No pool is automatically chosen.
  Stock choices require eligibility, market-hours and live multiplier/oracle checks
  by the backend; the catalog is not proof these gates passed. Each choice exposes
  `availability: { status: 'available' } | { status: 'unavailable', reason }`.
  Missing evidence defaults to unavailable; stale/closed-market references remain
  unavailable. Supply authenticated on-chain reference metadata, never UI prices.
  Kamino remains separate.
- Impact input: Manager sets **maximum price impact**, in integer bps, via
  `selection.maxPriceImpactBps`; 100 bps = 1%. Initial input is empty with **no
  placeholder or default**. `SOLANA_PRICE_IMPACT_CONFIG` bounds integer input to
  0–65,535 (the program's u16 field). Explicit 0 or >=10,000 means no Manager
  maximum; 1–9,999 is a bounded maximum. LP submission requires explicit input;
  Kamino-only selection needs no impact. Never silently convert empty input to 0.
  Do not label this Jupiter slippage or let the Manager supply quotes, min-out,
  route instructions or feed prices. On chain the stricter API-signed minimum and
  oracle-implied minimum wins (DEC-203); no maximum does NOT disable the reference
  requirement. Display API errors/manual retry for
  rate limits; never call Jupiter or handle its API key in the browser.

## Required implementation inputs

### #47/#48 bootstrap revision

Preflight requires both `bootstrapState` and an independent
`validateTransactionIntent` adapter before any Fund creation. Bootstrap messages
are additionally decoded locally for pinned program, exact append bytes/accounts,
staged init `[2]`, one native operation and limited compute-budget auxiliaries.
Lookup-table bootstrap messages fail closed until resolved validation is delivered.
The adapter verifies complete init account identities and all nonbootstrap SVM
operations. Persisted steps must match the frozen canonical graph exactly.
Unknown submitted bootstrap receipts reconcile through verified account state,
preserving signature/submission records; missing evidence never triggers signing.
Live Manager identity follows the existing Privy EVM launch-wallet source.

Contract source: `origin/feat/pp-sc-feat-solana-spoke` at
`4239d10883d95e867b0bfd6108cf801da6dafcdd`, including merged #47 and #48.
Legacy `ManagerSolanaBinding` stays supported for existing callers; its typed data
and native Config hash are not the new bootstrap wire format. New native creation
requires a frozen bootstrap authorization and canonical serialized Config payload
manifest, supplied and verified through the authenticated backend seam.
The frontend keeps `ManagerSolanaBinding.bootstrapAuthorization` and
`bootstrapSignature` alongside legacy fields; `solanaBootstrapTypedData` and
`solanaBootstrapDigest` implement the separate type. Freeze
`solanaBootstrap: { policyHash, payload }` with the request. Step kinds
`stage-solana-config`/`seal-solana-config` both map to `stage_swap_policy`, with the
latter representing the final nonempty chunk, followed by `init-solana`.
`SolanaLaunchBackend.bootstrapState` is the read-only verification seam, not a
delivered API endpoint.
`SolanaLaunchIntegrationOptions.bootstrap: SolanaBootstrapManifest` is required;
the hook validates it and persists it as frozen `solanaBootstrap`.
The first staging step depends on `discover-hub` and `solana:bind`; later chunks
depend on their preceding chunk and binding. Final chunk ID is `solana:seal`,
including a one-chunk payload, and `solana:init` depends on `solana:seal`.
Golden bootstrap digest
`0x05405ee3cbacda4303d6ed3404afc02f852fd0ffa09cb9c7e44ac3bb66249092`
matches the Rust binding fixture tuple and independent Solidity ABI encoding in
`src/lib/solana/binding.test.ts`, not the legacy binding fixture below.

```text
SolanaBootstrap(uint256 hubChain,address core,bytes32 mandateHash,bytes32 policyHash,uint16 spokeIndex,bytes32 program,bytes32 fundPda,bytes32 solanaKey,bytes32 usdcAta,bytes32 tslaxAta,bytes32 nvdaxAta,bytes32 wsolAta,bytes32 nativeMandateHash,bytes32 fundId,uint256 nonce,uint256 expiry)
```

Domain: `PoolParty Solana Fund`, version `6`, authoritative Hub chain and factory.
The same Manager EVM signature binds Hub creation/native bootstrap. `policyHash`
is identity-free. Fund seeds are `[fund, hubChain little-endian u64, core address
bytes, spokeIndex little-endian u16, policyHash]` under the pinned program; the
vault and four canonical ATAs follow, respecting SPL/Token-2022 ownership. Final
Mandate/native hashes, identities, nonce/expiry, program and bytes must come from
the verified creation result. Never reuse the legacy Mandate hash as a PDA seed.

Provision in order: each Manager-signed `stage_swap_policy` appends a contiguous
nonempty chunk with the frozen hash, total length and offset. Earlier chunks set
`seal=false`; the final nonempty chunk sets `seal=true` on that **same instruction**.
No standalone seal instruction or empty seal transaction exists. Contract maxima
are 600 chunk bytes, 650 serialized stage bytes and 4,096 total bytes; transaction
packet limits still apply. Manager-signed `initialize_fund` uses staged payload
`[2]`, validates the sealed stage, consumes it and refunds rent to the payer.

Freeze authorization plus payload bytes/chunk order/config before estimating or
journaling. Resume rejects any changed identity, policy, Manager or manifest.
TODO(interface): provide production builder/Config manifest and authenticated
read-only reconciliation of exact verified staged prefix, sealed state and
initialized Fund/config identity. Stage disappearance can mean successful init,
not failure. `bootstrapState` returns `policyHash`, `fundPda`, `managerSolana`,
`totalLength`, `payload`, `sealed`, `initialized` and optional `bootstrapDigest`,
or `null`. Before init, exact prefix/length/seal verification applies. When
`initialized=true`, matching Fund/Manager/policy and the exact bootstrap digest
are required; the consumed stage's payload/length/seal no longer prove init and
are not checked. `bootstrapDigest` is optional in the type but required for
initialized evidence. Unknown submitted transactions retain their signature/lifetime for
reconciliation; do not rebuild or prompt another signature on a polling timeout.
Estimate every Manager staging/final-seal/init message and stage rent, with no
fictional extra seal transaction or keeper budget substitution.

The local API branch `feat/be-poo-2261-solana-sync` exists at committed SHA
`53dd816fa3b6b0a2000a12f7939b66fb06ce743a`. Its committed `API.md` still describes
pre-#47/#48 blockers; concurrent uncommitted continuation is not API delivery.
Remote `feat/be-poo-2261-solana-sync` is absent at this follow-up check; do not
describe the local continuation as a published or delivered API contract.
TODO(interface): creation/bootstrap/staging/reconciliation and signed-quote
adapters remain pending verification. #48 adds NVDAx admission/custody and signed
swap policy integration, but stock oracle is still unavailable: the production
policy requires `reference_mode=0`, `stock_enabled=false`. Keep both stock choices
unavailable and the feature OFF. No deployment or financial readiness is implied.

### Existing adapter surface

`options` supplies manager, draft ID, binding, required `bootstrap`, `BindingCodec`, `costEstimator`, `evmCode`,
existing EVM steps/driver, Solana selection, frozen request/plan and authenticated
`SolanaLaunchBackend`. The frozen object retains the existing EVM request fields and
adds `solanaBinding` and normalized `solanaSelection`; saved version-1 storage keys
are unchanged. New bootstrap also requires frozen `solanaBootstrap` and the separate
authorization/signature above. Both ratio/open configs persist selected pool and maximum impact.
Resume rejects a changed binding, pool or impact instead of rebuilding a new plan.
Older provisional Solana journals without the tuple/selection fail closed and need
an explicit reviewed migration; old EVM-only journal loading is unchanged. A plain EVM driver
refuses Solana steps rather than accidentally using an EVM wallet.

`costEstimator.transactions(step)` must return EVERY unsigned Manager message and
EVERY account it/CPI creates: init adapter setup, ATAs, Kamino collateral custody,
Raydium NFT mint/ATA/positions and missing tick arrays/bitmap. The hook excludes
EVM steps and keeper-paid `solana-arrival`. Missing messages, fees, priority samples
or account layouts fail closed. Optional `costEstimator.rpc` supports a reviewed
RPC proxy/local harness; default RPC performs finalized read-only queries.

Spoke account bytes, including discriminator, come from Anchor `INIT_SPACE` and
`solana/target/idl/pp_spoke.json` at smartcontract snapshot `fb37976`: FundState 5105,
TokenLedger 105, CctpRoute 109, CctpLedger 80, KaminoPosition 161, RaydiumPolicy 113,
RaydiumLedger 104, RaydiumPosition 210, Transit 250. These are allocation sizes, not
rent amounts; reconcile before production wiring. External `layout: { kind:
'external', bytes, source }` comes from the actual instruction/mint-extension
decoder. Never assume all Token-2022 accounts use SPL's 165 bytes.

`getMinimumBalanceForRentExemption` prices each unique new account;
`getFeeForMessage` prices each message. Maximum sampled micro-lamports/CU at the
actual CU limit are rounded up, with an explicitly configured positive
`priorityFeeMarginBps` on message fee plus priority reserve. Messages already
carrying priority fees may therefore be conservatively double budgeted, not
under-budgeted. Each step exposes account rents, transaction count, message fee,
priority reserve, margin and total fee in lamports. No check signs or submits.

`backend.referencePrice(poolId)` supplies unavailable with a reason or available
with trustworthy `expiresAt` and `marketOpen`. Preflight checks it BEFORE Fund
creation; the driver refreshes it before swap/LP building. Backend/program still
authenticate the feed and enforce both minima; frontend metadata is not oracle proof.

`withSolanaLaunchSteps` composes Hub + Robinhood + Solana into one journal, with
binding before Fund creation, init after Hub discovery, report before Fast send,
credited arrival before Kamino supply / swap-to-ratio / Raydium open. It rejects total
top-level allocation above 100%. Backend must separately enforce leaf allocations,
Mandate accounts and exact program/pool identities; the frontend does not invent those.

`createChainLaunchDriver` routes EVM steps unchanged and SVM steps through fresh
blockhash/sign-only/persist-before-send. Unknown signatures are reconciled through
historical finalized RPC lookup and never blindly rebuilt. Expired missing signatures
remain pending (no automatic double-send). Keeper/manual receive uses authenticated
API-provided `{message, attestation}` and receive-and-credit, never direct unrestricted mint.

## Open interfaces and release gates

- Legacy binding EIP-712 fixture is pinned to smartcontract integration commit
  `16e6f68c9c52735d70e6cec21162d75c7b5dc878`:
  `src/factory/FundFactoryV6.sol`, `src/factory/SolanaDeploymentV6.sol`,
  `docs/SOLANA-REPORT-V6.md`, and `solana/programs/pp_spoke/src/instructions/core/binding.rs`.
  Domain: `("PoolParty Solana Fund", "6", 42161, factory)`.
  Type: `ManagerSolanaBinding(bytes32 solanaKey,address fund,bytes32 spoke,uint256 spokeChainId,bytes32 nativeMandateHash,uint256 nonce,uint256 expiry)`.
  `fund` is predicted Hub Core; `spoke` is the full-width emitter key, NOT the
  Fund-state/vault PDA. `nativeMandateHash` must come from the exact canonical
  native Config ABI encoding; never substitute draft ID or the legacy Mandate hash.
  Program, mints, venues, routes and accounts are bound through this Config hash;
  do not append unsigned tuple fields to the contract-defined typed data.
  Nonce/expiry/spoke chain are decimal strings in JSON, converted losslessly to
  uint256 only for signing. Read nonce/factory/predicted Core/native hash from the
  authoritative creation builder. Preflight refuses expired signatures.
  Golden digest `0x7f0d0fe3056003fb4654f099f5bf8831906d1f6837fd70f880e0980f6d924dc4`
  matches independent Solidity-style ABI encoding and the Rust fixture.
- TODO(interface): off-chain Solana acceptance bytes remain an explicit
  `BindingCodec.acceptanceMessage` dependency. The program currently accepts via
  the bound `authority: Signer` on `initialize_fund`, not an implemented off-chain
  Ed25519 acceptance envelope. Do not present the test-only digest countersign codec
  as production wire format. Backend must map countersign evidence to actual init.
- Revision clarification: #47/#48 use the identity-free policy derivation and
  separate bootstrap type above. The legacy EIP-712 codec remains available;
  its `16e6f68` fixture is legacy evidence, not a new creation authorization.
  TODO(interface): validate the production frozen authorization/Config manifest
  and provisioned identities before enabling transactions.
- TODO(interface): creation payload containing committed Solana binding/Mandate and
  multi-spoke indexing, init/Kamino/Raydium instruction builders, cost estimation,
  report evidence and authenticated attestation/receive endpoints. They are injectable
  seams, not claims that today's API already supports them. Existing strict EVM
  `createRequestSchema` is deliberately not loosened without the API owner.
- DEC-197 resolves route venue: Jupiter V2 through OUR authenticated, rate-limited
  API, server-side key only. No direct fallback or swap/LP pool-separation guard is
  invented. DEC-198 adds the three Manager-selected LP options; DEC-199 caps CCTP
  Fast fees at 5 bps with refusal above the cap, not silent Standard fallback.
- TODO(interface): `SolanaApiSignedQuote` is provisional. Backend supplies
  `quoteSwap(request, journal)` and `verifySwapQuote(quote, request)`; both are
  required for swaps. `build(step, journal, lifetime, quote)` receives the verified
  DTO immediately before wallet signing. Verification must pin the API signer and
  bind ALL DTO fields to the signed payload, including Fund, Manager Solana Key,
  pool, mint pair, amounts, reference output, impact, expiry and route. The frontend
  validates structure/scope/expiry/bound but does not pretend an opaque signature
  is cryptographically valid. Missing verifier, expired/over-impact/wrong-scope
  quotes and rate limits fail before transaction building. Quote is never stored
  as a Manager selection and is refreshed for fresh builds, not uncertain sends.
- DEC-202 (R6.3): price impact compares output to an authenticated on-chain Solana feed
  reference, not an unauthenticated Jupiter `priceImpactPct` or Manager reference.
  API/program must enforce feed freshness, stock multiplier/market-hours checks,
  signed min-out, exact input/output vaults, Jupiter V2 decoding and real deltas.
  `referenceAmountOut` is API-signed evidence, not independent feed verification
  by this frontend. DEC-203 fixes no-maximum and stricter-minimum semantics;
  TODO(decision): stock oracle selection and precise feed rounding remain with
  oracle/API owners; no unsupported frontend formula is invented.
- DEC-203/204 replace the temporary 1–500 bps/default policy; there is no default.
  #48 implements explicit 0/>=10,000 no-maximum semantics in the callable oracle
  minimum with `require_manager_bound=false`; 1–9,999 remains bounded. No-maximum
  implementation is not a remaining contract blocker, but API delivery, stock
  oracle and deployed execution remain unverified.
- TODO(decision): the priority-margin magnitude and retry allowance are unspecified.
  Require a deliberate positive estimator margin rather than inventing a protocol
  constant; the production owner must choose it and supply complete transaction manifests.
- Validate Phantom/Solflare/Backpack + injected EVM concurrency in a real browser.
  Unit tests mock SDK wallets and are NOT live device/concurrency verification.
- Mainnet public RPC can rate-limit; select/review production RPC proxy configuration
  with matching explicit CSP hosts before enabling. Credentials never belong in client URLs.
- T2a/backend must enforce CCTP Fast both directions, `amount - maxFee` in-flight,
  atomic receive/credit and destinationCaller; Wormhole consistency 32 and shared
  report age; TSLAx/NVDAx Token-2022 eligibility/market-hours/multiplier/pool checks.
- Release gate: #48 supports NVDAx native init/custody/admission, including its
  multiplier witness. The stock oracle remains unavailable and API continuation
  is not verified delivery. All three catalog entries may be visible, but neither
  stock may become executable from admission alone; deployment is not authorized.
- Keep management fee cap 500 bps for this MVP (DEC-196); no fee-cap changes here.
