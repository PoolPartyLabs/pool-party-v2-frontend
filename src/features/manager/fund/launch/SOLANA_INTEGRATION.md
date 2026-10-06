# POO-2262: Solana wallet integration

Solana remains OFF by default (`NEXT_PUBLIC_FEATURE_SOLANA_SPOKE=on` enables
the infrastructure). No deployment or mainnet transaction is authorized by this work.
EVM SIWE identity, embedded Ethereum wallets and existing launch journeys remain unchanged.
Rules: DEC-188, DEC-190, DEC-191, DEC-192, DEC-193, DEC-195, DEC-196.

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
- Binding disclosure/signatures BEFORE launch: call `signManagerSolanaBinding` with
  EVM manager `signTypedData`, Solana `signMessage`, draft/Fund context and T2a codec.
  Present both addresses and the per-Fund immutable authorization. Reusing a key for
  another Fund requires that Fund's signatures. Persist the binding in the draft owner.
- Funded-wallet gate: call `integration.check()` and display exact
  `requiredLamports`, `balanceLamports` and errors. Threshold is the sum of supplied
  per-manager-step `rentLamports + feeLamports`, not an invented flat SOL amount.
- Launch controls: `launch()`, `resume()`, `pause()`, `busy`, `error`, `journal`.
  `launch()` independently reruns preflight before journaling/transactions; UI checks
  alone are insufficient. No launch starts on mount. Poll/resume pending journal steps.
- Chain-aware rows: render `journal.steps` and `journal.checkpoints`,
  `chainKind ?? 'evm'`, chain IDs 42161/4663 or `solana:mainnet`, native transaction
  signatures, and a Solana explorer link (never an EVM hash link for SVM).
- Arrival state: pending keeper/credit status and `retryReceive()` manual fallback.
  Attestation/mint is not principal credit. Retry never marks the journal complete.
- Translate new labels/errors in all 11 locales. This integration adds no locale keys.

## Required implementation inputs

`options` supplies manager, draft ID, binding, `BindingCodec`, costs, `evmCode`,
existing EVM steps/driver, Solana selection, frozen request/plan and authenticated
`SolanaLaunchBackend`. The frozen object retains the existing EVM request fields and
adds `solanaBinding`; saved version-1 storage keys are unchanged. A plain EVM driver
refuses Solana steps rather than accidentally using an EVM wallet.

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

- TODO(interface): exact T2a EIP-712 domain/types, Fund context and Solana acceptance
  bytes. `BindingCodec` is mandatory; no made-up production signing schema is shipped.
- TODO(interface): creation payload containing committed Solana binding/Mandate and
  multi-spoke indexing, init/Kamino/Raydium instruction builders, cost estimation,
  report evidence and authenticated attestation/receive endpoints. They are injectable
  seams, not claims that today's API already supports them. Existing strict EVM
  `createRequestSchema` is deliberately not loosened without the API owner.
- TODO(decision): swap venue/route and DEC-136 swap/LP overlap remain unresolved.
  No Jupiter/Raydium route is selected. Backend must fail closed until decided.
- TODO(decision): threshold contingency margin/retry allowance is not specified.
  Only measured rent and fee estimates are summed; authoritative budgets must include
  all expected manager steps and any approved safety margin.
- Validate Phantom/Solflare/Backpack + injected EVM concurrency in a real browser.
  Unit tests mock SDK wallets and are NOT live device/concurrency verification.
- Mainnet public RPC can rate-limit; select/review production RPC proxy configuration
  with matching explicit CSP hosts before enabling. Credentials never belong in client URLs.
- T2a/backend must enforce CCTP Fast both directions, `amount - maxFee` in-flight,
  atomic receive/credit and destinationCaller; Wormhole consistency 32 and shared
  report age; TSLAx Token-2022 eligibility/market-hours/pool checks (SOL/USDC fallback).
- Keep management fee cap 500 bps for this MVP (DEC-196); no fee-cap changes here.
