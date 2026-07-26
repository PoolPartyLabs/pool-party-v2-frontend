# Active Reserve, the frontend and server half

<!--
@id PP-AQUA-DOC-000
@name Aqua hackathon package, index
@implements-rules-version v1
@hackathon POO-1057 (Active Reserve, 1inch Aqua and SwapVM)
-->

**The entry point for this half of the 1inch Aqua submission.** Linear epic POO-1057, project
"Aqua Strategies (1inch Hackathon)". Repository: `pool-party-v2-frontend`, branch
`feat/aqua-poo-1067-investor-page`.

> **For hackathon evaluators.** The submission has two halves in two repositories. This folder
> documents the half that lives here: the server-only Aqua module (`src/lib/aqua/`) and the
> Active Reserve investor page (`src/features/aqua/`). The on-chain half, the deploy and ops
> scripts, the taker, and the judge package live in
> [github.com/0xmvercosa/pool-party-aqua](https://github.com/0xmvercosa/pool-party-aqua).
> Every claim below is checkable against a file path in this tree, an address on Arbiscan, or a
> transaction hash.

---

## 1. What Active Reserve is

Active Reserve is a managed USDC reserve on Arbitrum that never sits idle and buys ETH only when
the market comes down to it. Roughly 95 percent of the vault's USDC is lent on Aave v3 behind a
5 percent hot buffer, so the capital earns lending yield every block. A sleeve worth about
10 percent of TVL is registered with 1inch Aqua as virtual balance, priced by a program whose buy
band sits entirely below spot. When the market dips into that band, the fill settles against the
vault, and the maker hook withdraws from Aave inside the same settlement transaction. The capital
is therefore earning interest right up to the instant it is spent, and there is no idle float
waiting for a dip that may never come.

The official product description, used verbatim on the page, in the page metadata and in the
submission (`src/features/aqua/copy.ts`, 277 characters, asserted by
`src/features/aqua/ActiveReserveScreen.test.tsx`):

> An always-earning reserve that buys the dip. Capital earns Aave lending yield every block and is
> deployed automatically the instant the market dips into the manager's buy band, purchasing ETH
> below market price. Objective: accumulate ETH at a discount while never sitting idle.

---

## 2. The facts

Everything in this table is on Arbitrum One (chain id 42161). The canonical copy, with the
evidence for each value, is `docs/VERIFIED.md` in the on-chain repository;
`src/lib/aqua/config/addresses.ts` mirrors it and is the only place this app learns an address.

### Ours

| What | Value |
|---|---|
| PartyVault (ERC-4626-style share math, the maker) | [`0xec870a6A9E8EE41B349FD0766b8f295D6EDC6610`](https://arbiscan.io/address/0xec870a6A9E8EE41B349FD0766b8f295D6EDC6610), source-verified |
| AaveV3Adapter (the carry leg) | [`0x6d409fF8578D017AddDB2e9Ad0848D8F0A65aBAe`](https://arbiscan.io/address/0x6d409fF8578D017AddDB2e9Ad0848D8F0A65aBAe), source-verified |
| Manager | [`0xc365B6795443380eb76516dA0Cedd5a00B349d66`](https://arbiscan.io/address/0xc365B6795443380eb76516dA0Cedd5a00B349d66) |
| Taker | [`0x67Fd51e5082205AF0bD97039a6124Ff3368aD0da`](https://arbiscan.io/address/0x67Fd51e5082205AF0bD97039a6124Ff3368aD0da) |

### 1inch, used unmodified

| What | Value |
|---|---|
| Aqua registry (gen 2) | [`0x1111113CCf1426A8E30e2bfF5E005d929bF6a90a`](https://arbiscan.io/address/0x1111113CCf1426A8E30e2bfF5E005d929bF6a90a) |
| AquaSwapVMRouter (gen 2) | [`0x1111113Db0e0ef9D0E3A50d5f094a3a57a26C0DE`](https://arbiscan.io/address/0x1111113Db0e0ef9D0E3A50d5f094a3a57a26C0DE) |
| SDKs, pinned exact | `@1inch/swap-vm-sdk@0.3.0`, `@1inch/aqua-sdk@0.2.0` |

A dead gen-1 deployment also exists on Arbitrum, and it is what the upstream READMEs document.
Nothing here touches it. `assertNotDeadGeneration` in `src/lib/aqua/config/addresses.ts` refuses
it by address, and `src/lib/aqua/serverOnly.test.ts` proves the refusal is case-insensitive.

### External protocols this half reads

| What | Value |
|---|---|
| Aave v3 Pool | [`0x794a61358D6845594F94dc1DB02A252b5b4814aD`](https://arbiscan.io/address/0x794a61358D6845594F94dc1DB02A252b5b4814aD) |
| aUSDC (Aave v3 Arbitrum) | [`0x724dc807b04555b71ed48a6896b6F41593b8C637`](https://arbiscan.io/address/0x724dc807b04555b71ed48a6896b6F41593b8C637) |
| Chainlink ETH/USD, 8 decimals | [`0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612`](https://arbiscan.io/address/0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612) |
| USDC (native, not USDC.e) | [`0xaf88d065e77c8cC2239327C5EDb3A432268e5831`](https://arbiscan.io/address/0xaf88d065e77c8cC2239327C5EDb3A432268e5831) |
| WETH | [`0x82aF49447D8a07e3bd95BD0d56f35241523fBab1`](https://arbiscan.io/address/0x82aF49447D8a07e3bd95BD0d56f35241523fBab1) |

### What ran on mainnet

| What | Value |
|---|---|
| Bands shipped | demo `0x77097fd33011a87bf7a5be80dde5043f28bfaa130758ab77363133f0120810cf`, production `0xafbd59da3040256990b3584b56930acd0befc0ee1ccbfa7bc87b0c7496818260` |
| Fills | Five. Three buy-side, all of which hit the just-in-time Aave withdrawal, plus two reverse fills at close-out |
| Flagship fill | [`0xbc64ec2db39c6a8f718487268e4195c63e472f0ad0ae1f46e09919a1a9c5bb83`](https://arbiscan.io/tx/0xbc64ec2db39c6a8f718487268e4195c63e472f0ad0ae1f46e09919a1a9c5bb83): 0.0003 WETH for 0.556382 USDC, with the aUSDC burn, the Aqua pull and the WETH push all inside one transaction |
| Program order | `[deadline][concentrateGrowLiquidity2D][flatFeeAmountInXD 80bps][xycSwapXD][salt]`, measured against the deployed router |
| Maker hook | `preTransferOut` with 9 arguments, selector `0x5a394f80`, carried on a zero-address `Interaction` with non-empty data |

Two details in that table are the whole engineering story, and both are covered in
[`01_AQUA_INTEGRATION.md`](01_AQUA_INTEGRATION.md).

`concentrateGrowLiquidity2D` shapes the reserves and `xycSwapXD` is the instruction that executes
on them, so the curve is terminal: a fee placed after it reverts at quote time. The on-chain
protocol-fee opcode is out of v1 because it charges `tokenIn`, and our WETH side ships at amount
0, which is asserted on the built bytes by `assertNoTokenInPullingOpcode` in
`src/lib/aqua/api/compiler/compile.ts`.

The maker hook is not optional and its absence is silent. Without it the ship succeeds, quotes
look correct, and small fills settle out of the hot buffer, so only a fill larger than the buffer
fails, because the router never calls the vault and the vault never unparks from Aave. That is
exactly the just-in-time path the product is built around. Commit `3c5d630a` on this branch fixed
a compiler that was omitting the hook, and the regression is locked by the test named "declares
the preTransferOut hook, without which the JIT path is silently dead".

---

## 3. Two repositories, and one folder that is a different hackathon

Read this section before citing anything, because there are three things here that are easy to
confuse.

| Thing | Where | What it holds |
|---|---|---|
| **This half** | `docs/_hackathon_aqua/` in `pool-party-v2-frontend` | The server-only Aqua module and the Active Reserve investor page. The documents listed in [§4](#4-navigation). |
| **The on-chain half** | [github.com/0xmvercosa/pool-party-aqua](https://github.com/0xmvercosa/pool-party-aqua) | PartyVault, AaveV3Adapter, deploy and ops scripts, the taker, the status report, and the judge package in `docs/hackathon/`. Also `docs/VERIFIED.md` and `docs/FILLS.md`, the canonical addresses and the measured fills. |
| **A different hackathon entry** | `docs/_hackathon/` in this same repository | **Universal Funding**, built on the Uniswap Trading API, Linear epic POO-1022. It is a separate submission, with its own scope, its own issues and its own evidence. |

`docs/_hackathon/` and `docs/_hackathon_aqua/` are siblings by filesystem accident only. They
share no code, no epic and no claims. Do not conflate them: a figure from one is not evidence for
the other. The two folders even use the same file numbering (`00_IMPLEMENTATION_PLAN.md`,
`03_PRE_EXISTING_VS_NEW.md`), so always cite the full path.

---

## 4. Navigation

| File | Read it for |
|---|---|
| `README.md` (this file) | The facts, the repository split, and how to run what is here |
| [`00_IMPLEMENTATION_PLAN.md`](00_IMPLEMENTATION_PLAN.md) | What was built on this branch, issue by issue, with the business rules each one implements |
| [`01_AQUA_INTEGRATION.md`](01_AQUA_INTEGRATION.md) | The server module: which SDK calls are made, how the program compiler works and what it refuses, the chain reads, and the database |
| [`02_INVESTOR_SURFACE.md`](02_INVESTOR_SURFACE.md) | The Active Reserve page: components, data flow from Arbitrum to pixels, and the copy rules that govern it |
| [`03_PRE_EXISTING_VS_NEW.md`](03_PRE_EXISTING_VS_NEW.md) | Continuity: what pre-dates the hackathon and what was built during it, at file level |
| [`04_REFERENCES.md`](04_REFERENCES.md) | Every reference, dependency and attribution, with links |

Worth opening alongside them:

| File | Read it for |
|---|---|
| [`../../src/lib/aqua/README.md`](../../src/lib/aqua/README.md) | The module's own manual, including the two things that will bite anyone editing it (`server-only` is load-bearing, money is a string) |
| [`../_integration/06_aqua_strategies/README.md`](../_integration/06_aqua_strategies/README.md) | Where the canonical Aqua documentation lives, and why it is in the other repository |
| [`../../src/lib/aqua/config/addresses.ts`](../../src/lib/aqua/config/addresses.ts) | The address mirror, with the provenance of the maker-hook signature in its comments |

---

## 5. How to run what is here

Every command below runs offline. The test suites need no RPC endpoint, no database and no
private key, because everything they assert is either pure computation or source text.

| Command | What it proves |
|---|---|
| `pnpm test src/lib/aqua/api/compiler` | The compiler emits `[deadline][concentrate][flatFee][xycSwap][salt]` and nothing else, encodes 80 bps as the literal bytes `007a1200` at the 1e9 scale, declares the `preTransferOut` hook, ships both tokens with the base side at 0, and refuses every out-of-policy input (band at or above spot, ship above the sleeve or above `maxPerShip`, coverage below 1.0, a re-used epoch, the dead gen-1 registry). It also proves byte-identical output against the independent launch-payload builder, for both shipped bands, and therefore the same `strategyHash`. |
| `pnpm test src/lib/aqua/serverOnly.test.ts` | Every module in `src/lib/aqua/` imports `server-only` (with the documented `db/schema.ts` exemption for drizzle-kit), `AQUA_DATABASE_URL` is read in exactly one file, the gen-2 pair is what the app uses, the dead gen-1 pair is refused case-insensitively, and the published maker-hook selector really is the keccak of the published 9-argument signature. |
| `pnpm test src/lib/aqua/abis` | The narrow ABI the page reads with matches the committed PartyVault artifact, declares view functions only, and carries the measured maker hook, so the vault we read is the vault Aqua calls. |
| `pnpm test src/features/aqua` | The page renders the official name and the description verbatim at its 277 characters, keeps maker/taker/opcode vocabulary off an investor surface, hides a section rather than showing zeros when its data is missing, warns on a stale price feed, links every fill and every contract to Arbiscan, discloses that window fills are self-directed, and formats money through bigint arithmetic that truncates rather than rounds. |
| `pnpm typecheck` | `tsc --noEmit` over the whole repository, including the module and the page. |
| `pnpm lint` | Biome over the whole repository. |
| `pnpm test` | The full suite, this half included. |

To see the page:

```bash
pnpm dev
# http://localhost:3000/en/dev/active-reserve   the live layout, rendered from a fixture
# http://localhost:3000/en/active-reserve       the real page, reading Arbitrum
```

`/en/active-reserve` is `force-dynamic` and reads chain on every request, so with no RPC
configured or before the vault holds anything it renders the honest "not deployed yet" state
rather than zeros. `/en/dev/active-reserve` exists so the populated layout can be reviewed
anyway: it renders the same component from clearly synthetic fixtures, prints a banner saying so,
and calls `notFound()` in production. Nothing there feeds the real page.

The manager CLI (`scripts/aqua/strategy.ts`, exposed as `pnpm aqua:ship`, `aqua:roll`,
`aqua:dock`, `aqua:launch-payloads`) and `pnpm aqua:db:check` do need server env, so they are not
part of the offline path. The CLI never signs: it compiles, checks policy, records the intent and
prints calldata for a wallet to sign, which is why the manager key never reaches the process.

---

## 6. Scope, stated plainly

What this half is, and what it deliberately is not:

- **The investor page is read-only.** There is no deposit and no redeem control on it. Shipping
  the read-only view first means the page can never show a control that does not work. Deposit
  and redeem are the second cut.
- **There is no manager UI.** The manager surface for this window is the CLI in `scripts/aqua/`.
  A console screen was cut (POO-1068).
- **There is no keeper.** Rolls and docks are run by hand through the CLI. Nothing on this branch
  runs on a schedule.
- **The page is English only.** The repository ships 11 locales and normally requires every
  user-facing string to go through `useTranslations`. Active Reserve copy is a plain module
  (`src/features/aqua/copy.ts`) for the hackathon window, and the locale port is post-event. This
  is a known, recorded deviation, not an oversight.
- **The database scope is two tables.** `aqua_ships` and `aqua_fills`. The designed
  `aqua_mandates`, `aqua_nav_snapshots` and `aqua_keeper_log` are deferred, because state is read
  live from chain rather than from a stored series.
- **Fills during the demo window are self-directed.** They are settlement proofs executed by our
  own taker wallet, not third-party demand, and the page says exactly that above the list before
  a reader can misread it. The externally-sourced yield in this product is the Aave interest.
- **This half is not yet wired into the main app.** The protocol discriminator and the
  `aquaStrategies` feature flag that would surface Active Reserve inside the investor catalog are
  post-hackathon work. The seam is marked `PP-INTEGRATION-POINT` in `src/lib/aqua/index.ts` and
  `src/features/aqua/ActiveReserveScreen.tsx`.
