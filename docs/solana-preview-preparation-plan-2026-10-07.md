<!--
@id PP-MGR-DOC-002
@name RestrictedSolanaPreviewDeliveryPlan
@implements-rules-version v1 (POO-2281)
@analytics-events none, preparation plan with no mounted product surface.
-->

# Restricted Solana preview: delivery plan

Date: October 7, 2026. Owner: Murilo's Codex coordinator. Rules: POO-2281 v1.
Epic: [POO-2252](https://linear.app/yeildbay/issue/POO-2252), related to Manager
[POO-2116](https://linear.app/yeildbay/issue/POO-2116). This is a durable implementation reference.

Murilo authorized preparing a V2 Solana mode that can be revealed by approved testers and later
opened to more accounts. The cohort is managed by the API, with no personal wallet hard-coded in
the frontend. Preparation does not activate a public Solana product or authorize a mainnet operation.

## 1. Verified starting point

| Source inspected | State and consequence |
|---|---|
| Public frontend main, `627237c84f4fd2b2ce7d1e99ef1eb8fa899512cf` | V1/V2 family; EVM-only provider configuration and fund schemas. No Solana preview host. |
| Frontend integration `feat/fe-poo-2252-solana-spoke`, `59a1a34f4671ff2cf3e9b453a745bf290034423c` | Separate dual-wallet, per-fund binding, chain-aware launch/journal and quote scaffolding. [PR #115](https://github.com/PoolPartyLabs/pool-party-v2-frontend/pull/115) merged into that integration branch, not main. Reuse under POO-2262. |
| API authentication inspection, October 7 | `SessionTokenGuard` verifies signature and expiry. Existing user profile has no experiment grants; permissive legacy `AccessTokenGuard` must not protect this preview. Solana route and public discovery entitlement still need POO-2282. |
| Contract integration inspection, October 7 | Kamino/Jupiter/Raydium code exists on the separate Solana branch; no Orca implementation was found. This is source evidence, not a deployment or execution claim. |
| Solana Build handoff, October 5 | [Build draft](https://www.figma.com/design/jjOf5DL9uVEB7WBR9nGb4A?node-id=8359-2725), [graph](https://www.figma.com/design/jjOf5DL9uVEB7WBR9nGb4A?node-id=8370-2816), [Configure](https://www.figma.com/design/jjOf5DL9uVEB7WBR9nGb4A?node-id=8359-3089). Visual reference with incomplete data/execution rules. |

The integration branch's `src/features/manager/fund/launch/SOLANA_INTEGRATION.md` lists remaining
bootstrap, acceptance codec, oracle, bounds/cost and real-execution gates. Preserve those gates.
Public source and on-chain evidence remain public even when app entry points are restricted.

## 2. Phase A: access foundation, implemented in this PR

[POO-2281](https://linear.app/yeildbay/issue/POO-2281), branch
`feat/core-poo-2281-solana-preview-access`.

| Files | Implemented responsibility | Validation |
|---|---|---|
| `src/lib/experiments/access.ts` and tests, `PP-CORE-LIB-122` | Strict proposed version-1 DTO; minimal denial; expiry; explicit preview/catalog/execute capabilities. | Allowed/denied, field/schema drift, unknown/duplicate capabilities, exact expiry and invalid clock. |
| `src/lib/experiments/fetchExperimentAccess.ts` and tests, `PP-CORE-LIB-123` | Server-only read seam; both feature gates; current Bearer; no Data Cache; failure returns denial. | Anonymous/mock/off, independent session tokens, API errors, rejected payloads, expiry during read and changed local token source. |
| `src/lib/experiments/solanaPreviewMode.ts` and tests, `PP-CORE-LIB-124` | In-memory reveal preference. Three V2 presses within 1,000 ms, grant and clean draft required. | Window boundary, dirty draft, account/family reset, denied/expired grant, pure inputs. |
| `src/lib/features/{registry,resolve}.ts` and tests | Add default-off `solanaSpoke`, reusing Rafael's key. | Default, explicit on/off and existing registry invariants. |
| Package README, feature/integration/ID registers, ADR 0008 and this plan | Document implemented/planned boundaries and ownership. | Registry/census check and source review. |

No Server Action, provider, toggle handler, catalog, draft migration or transaction is mounted.
Existing `ContractFamily`, its storage key, EVM drafts, investor lists and launch drivers are unchanged.
Infrastructure declares analytics `none` because it introduces no product interaction.

## 3. Phase B: API authority and discovery, pending Rafael

Reuse [POO-2282](https://linear.app/yeildbay/issue/POO-2282), currently Needs Rules. Owner: Rafael/API.
The [package contract proposal](../src/lib/experiments/README.md#api-proposal-pending-poo-2282)
defines `GET /api/v1/experiments/solana-preview/access` through the existing transport.

Before Ready, confirm:

1. Cryptographic session guard, DTO/capability names and server-owned multi-account cohort.
2. Grant/revoke administration and expiry bounded by session lifetime. A maximum 60-second grant
   is a reviewer recommendation, not a confirmed rule or frontend limit.
3. Private no-store responses and live membership checks for every protected read/build/resume.
4. Public list exclusion and direct-link protection for experimental funds. Frontend filtering
   alone cannot protect discovery or detail endpoints.
5. Canonical EVM manager identity plus the existing per-fund Solana signer binding under POO-2262.

API tests: two approved accounts; third unlisted account; revocation; malformed/forged/expired
session; anonymous and direct-read bypass; private cache isolation; unknown capability/schema.
Missing support keeps the frontend denied. Do not invent endpoint availability from source inspection.

## 4. Phase C: guarded host, hidden gesture and draft isolation

Frontend owner: Murilo's coordinator. Dependency: confirmed Phase B, reusable Solana integration
and a usable restricted catalog. Deliver as a separate small PR with versioned issue rules.

Files to extend: `src/components/layout/ContractFamilyToggle.tsx`, a new client host in
`src/lib/experiments/`, its separate server action over `loadSolanaPreviewAccess`, and isolated Solana
draft storage alongside `src/features/manager/fund/mandateDraftStore.ts`. Preserve
`src/lib/hooks/useContractFamily.ts` and existing EVM storage semantics.

- Capture session/account generation at grant-read start. Immediately clear grant/mode on logout
  or account change; reject late responses with an older generation. Next request cookies are
  snapshots, so the current loader's second read is not protection against cross-request logout.
- Revalidate on focus/session change and expire the active mode when the grant elapses. Determine
  refresh cadence after API lifetime confirmation; no stale grant may authorize a real operation.
- Apply the tested triple-press only to already selected V2. Add an accessible authorized exit.
  Use an explicit dirty-work guard before switching drafts; silent EVM draft replacement is forbidden.
- Keep Solana drafts account- and environment-scoped. Do not rewrite or reinterpret launched EVM
  funds. Revocation closes the preview while preserving recoverable local draft data.
- Ship view, activation/exit, abandonment, blocked-intent and error analytics in this mounted PR.
  Never emit raw wallets, grants, credentials or token mints.

Tests: delayed account-A response after switching to B/logout; expiry while active; denied/allowed
gesture; focus revalidation; dirty-work preservation; storage isolation; unchanged V1/V2 behavior.
The foundation's changed-getter test does not prove this future host behavior.

## 5. Phase D: Solana Mandate, spoke and protocol catalog

Dependencies: [POO-2239](https://linear.app/yeildbay/issue/POO-2239) token discovery,
[POO-2240](https://linear.app/yeildbay/issue/POO-2240) markets, confirmed Figma intake/rules,
Phase C. Frontend: existing `mandateCatalog.ts`, `mandatePoolSource.ts`, V2 catalog boundary,
Build graph/palette and Configure panels. Keep the EVM schemas strict; add an explicit Solana
representation for base58 mint/program identities instead of passing them through EVM address types.

- Show a Solana spoke and protocol choices for Kamino lend, Jupiter, Raydium and Orca according to
  the served capability matrix. Available entries come first; unsupported execution is Not available.
- Search name/symbol/mint through the confirmed API; results are not limited to the first loaded page.
  Validate network, mint, decimals, pools, permitted mandate assets and quote freshness.
- Use canonical catalog logo metadata with existing local protocol-logo fallbacks. No invented
  mint, pool identifier, balance or price. Missing logos use the existing neutral fallback.
- Operating cash is native SOL. SOL/USDC pool asset means WSOL when served as such; keep that
  distinction in holdings, balances and builders. TSLAx/NVDAx and other tokenized assets require
  eligibility, price support and appropriate disclosures before enablement.
- Treat the integration's three LP choices as its current constraint, not support for every new
  catalog asset. Market discovery does not establish permission to execute.

Tests: search pagination/mint results; chain isolation; malformed metadata; permitted asset/range
validation; logo fallbacks; unsupported-protocol states; native-versus-wrapped precision. Figma
fixtures stay in mocks/stories; no values from screenshots become real holdings.

## 6. Phase E: reuse wallet, provisioning, launch and recovery

Owner: coordinate with Rafael under [POO-2262](https://linear.app/yeildbay/issue/POO-2262)
and [POO-2261](https://linear.app/yeildbay/issue/POO-2261). Dependencies: actual builders,
binding/acceptance and oracle support, measured costs, funded account and explicit execution grant.
Do not recreate or concurrently edit Rafael's Providers, wallet binding or launch drivers.

Integrate the reviewed `SOLANA_INTEGRATION.md` boundary into the existing provisioning/modal
presentation and chain-aware journal. Recheck live membership and per-fund identity before every
build, launch and resume. A client `execute` capability never substitutes for server authorization.
Preserve one-step signing, receipt-driven continuation and uncertain-broadcast recovery; never
resend automatically after timeout. Capital in transit, accepted reports and final settlement remain
separate states. No completion event on click or broadcast.

Tests: wallet/chain mismatch, revoked execution, failed funding, rejected signature, stale report,
partial receipt, resume/account isolation and settlement-driven completion. Mainnet validation is
a separate authorized activity; this preparation submits no transaction.

## 7. Phase F: restricted rollout, then cohort expansion

Release condition: Phases B-E accepted; public lists and direct reads restricted; compliance
conditions recorded; existing V1/V2 regression checks pass. Start with several approved accounts
under the same API cohort. Observe denied-account, revocation and recovery behavior before adding
more accounts. Grant/revoke is an API administration operation, not a frontend deployment.

The global `solanaSpoke` flag remains a release switch; membership remains a per-account permission.
Turning the flag off denies new protected access. A public Solana launch requires a separate release
decision. It is not implied by expanding the tester cohort or by the hidden gesture.

## 8. Validation and current limitations

For this foundation, run only focused single-worker experiment/flag/toggle/hook tests, the existing
registry/census assertions, scoped Biome, TypeScript and locale parity. No full suite, coverage,
Next build or complete browser journey, per Murilo's instruction. A future mounted server/client
integration must complete its appropriate release checks on suitable infrastructure.

The first PR delivers Phase A only. API permissions/discovery, mounted switch, Solana draft UI,
protocol catalog and executable Solana flow remain the later phases above. POO-2282 and the existing
integration issues track those dependencies; preparation is not a claim that testers can already
create a Solana fund on the public website.

Foundation checks on October 7: 145 tests passed in eight focused files, scoped Biome passed and
locale parity passed. The repository-wide TypeScript command exhausted its default Node heap;
a scoped TypeScript project including every changed experiment/flag module, its tests and real
transitive imports passed. This is scoped validation, not a whole-repository typecheck pass.
