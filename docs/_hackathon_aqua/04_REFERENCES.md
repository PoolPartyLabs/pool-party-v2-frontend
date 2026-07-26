# References, dependencies and attribution

<!--
@id PP-AQUA-DOC-006
@name Aqua hackathon package, references and attribution
@implements-rules-version v1
@hackathon POO-1057 (Active Reserve, 1inch Aqua and SwapVM)
-->

**Everything this half of the submission builds on.** Read [`README.md`](README.md) first for the
facts and the repository split.

Two conventions apply throughout. Links point at repository or documentation roots rather than
deep links that could rot or that we cannot verify from here, and anything we could not verify
directly is labelled as such instead of being asserted. Addresses link to Arbiscan, where the
source is verified and anyone can read it.

---

## 1. 1inch: Aqua and SwapVM

This is the protocol the submission is built on. We are a **pure caller**: we form calldata
against published ABIs and read state through RPC. No 1inch contract is modified, forked or
redeployed, and no upstream source is vendored into this repository.

### Protocol repositories

| Reference | Link | Why it matters here |
|---|---|---|
| Aqua protocol | [github.com/1inch/aqua](https://github.com/1inch/aqua) | The registry that holds virtual balances, and the `ship` / `dock` / `Pushed` / `Pulled` semantics the compiler targets. The repository also publishes the Aqua whitepaper. |
| SwapVM | [github.com/1inch/swap-vm](https://github.com/1inch/swap-vm) | The on-chain virtual machine that executes the program: the instruction set, the opcode table, and `IMakerHooks.sol`, which is where the `preTransferOut` signature comes from. The repository also publishes the SwapVM whitepaper. |
| SDK monorepo | [github.com/1inch/sdks](https://github.com/1inch/sdks) | Home of both TypeScript SDKs we depend on, under `typescript/aqua` and `typescript/swap-vm`. Confirmed as the `repository` field of both installed packages. |

We did not fetch the two whitepapers from this environment, so they are cited as published in
those repositories rather than by file name or URL.

### The version trap

**The deployed AquaSwapVMRouter runs the v1.0.1-era opcode table, so `main` in the upstream
repositories is the wrong thing to read.** This is not a footnote, it is the single most expensive
fact in the build:

- The maker hook the live router actually calls is the **9-argument** `preTransferOut`, derived
  from `swap-vm` v1.0.1 `IMakerHooks.sol` and independently confirmed by capturing the raw
  calldata the live router sends to a maker contract. It is **not** in the published SwapVM ABI.
  Selector `0x5a394f80`, asserted against the signature in `src/lib/aqua/serverOnly.test.ts`
  rather than trusted.
- The canonical program order was corrected against four live gen-2 ships and confirmed on an
  Arbitrum fork. See [`01_AQUA_INTEGRATION.md`](01_AQUA_INTEGRATION.md).
- A second, dead gen-1 Aqua deployment exists on Arbitrum, and it is what the upstream READMEs
  document. `assertNotDeadGeneration` in `src/lib/aqua/config/addresses.ts` refuses it by address.

The published SDK READMEs point at the protocol documentation as
`github.com/1inch/aqua#table-of-contents` and `github.com/1inch/swap-vm#-table-of-contents`. Treat
both as the entry point for the protocol, and the measured facts in `docs/VERIFIED.md` (on-chain
repository) as the entry point for what the deployed contracts do.

### npm packages, pinned exact

Pinned without a caret on purpose: a patch bump in an SDK that encodes opcode bytes is a change to
what we put on chain. Versions below are read from `package.json` and from the installed
packages.

| Package | Version | License field | Role |
|---|---|---|---|
| `@1inch/swap-vm-sdk` | `0.3.0` | `LicenseRef-Degensoft-SwapVM-1.1` | `AquaProgramBuilder`, `Order`, `MakerTraits`, `Address`, `HexString`. Every opcode byte goes through the builder; none is written by hand. |
| `@1inch/aqua-sdk` | `0.2.0` | `LicenseRef-Degensoft-Aqua-Source-1.1` | `AquaProtocolContract`, used to encode the `ship` call sent to the registry. |
| `@1inch/sdk-core` | `0.1.2` | not declared in `package.json` | `Interaction`, needed to carry the maker hook. Pinned to the exact version `@1inch/swap-vm-sdk@0.3.0` depends on, so the class identity the SDK checks against is the one we construct. |
| `@1inch/byte-utils` | `3.1.7` | not inspected | Transitive dependency of the two SDKs. Installed, not imported by our code. |

One environment note, recorded because it costs an hour to rediscover: these SDKs ship an ESM
bundle with extensionless internal imports, which Node's ESM resolver rejects. `vitest.config.ts`
inlines `/@1inch\//` for that reason. Next and `tsx` tolerate the omission already.

---

## 2. Aave v3

The carry leg. USDC sits in Aave earning lending yield, and the maker hook withdraws from it
inside the settlement transaction.

| Reference | Link |
|---|---|
| Aave documentation | [aave.com/docs](https://aave.com/docs) |
| Aave v3 protocol source | [github.com/aave/aave-v3-core](https://github.com/aave/aave-v3-core) |
| Pool, Arbitrum One | [`0x794a61358D6845594F94dc1DB02A252b5b4814aD`](https://arbiscan.io/address/0x794a61358D6845594F94dc1DB02A252b5b4814aD) |
| aUSDC, Arbitrum One | [`0x724dc807b04555b71ed48a6896b6F41593b8C637`](https://arbiscan.io/address/0x724dc807b04555b71ed48a6896b6F41593b8C637) |

Aave is reached only through our own `AaveV3Adapter`, whose entire write surface is `park` and
`unpark` (supply and withdraw). The committed artifact
`src/lib/aqua/abis/AaveV3Adapter.json` shows exactly two non-view functions and nothing that
borrows, so this product has no liquidation surface. The Aave interest is the externally-sourced
yield in Active Reserve, which matters because demo-window fills are self-directed and say so on
the page.

---

## 3. Chainlink

The price oracle. Band placement and every USD number on the investor page are anchored to it.

| Reference | Link |
|---|---|
| Data Feeds documentation | [docs.chain.link/data-feeds](https://docs.chain.link/data-feeds) |
| ETH/USD, Arbitrum One, 8 decimals | [`0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612`](https://arbiscan.io/address/0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612) |

The feed is read through `latestRoundData`, and its `updatedAt` is used, not ignored: past 90
minutes of staleness the page says the price is not current instead of presenting it as fresh
(`MAX_STALENESS_SECONDS` in `src/lib/aqua/api/vaultState.ts`). The comment on
`CHAINLINK_ETH_USD` in `src/lib/aqua/config/addresses.ts` records the 24-hour measurement that
set that threshold: 360 updates, median gap 121 seconds, maximum gap 29.5 minutes.

---

## 4. Standards

| Standard | Link | Where it shows up |
|---|---|---|
| ERC-20 | [eips.ethereum.org/EIPS/eip-20](https://eips.ethereum.org/EIPS/eip-20) | USDC and WETH balances, read with viem's built-in `erc20Abi`. |
| ERC-4626 | [eips.ethereum.org/EIPS/eip-4626](https://eips.ethereum.org/EIPS/eip-4626) | PartyVault uses ERC-4626 share math (OpenZeppelin conversion formulas with a decimals offset) but exposes no ERC-20 share token: `totalAssets()` is what the NAV card reports, and `totalShares()` is read and deliberately not rendered (see `02_INVESTOR_SURFACE.md`). |
| OpenZeppelin Contracts | [github.com/OpenZeppelin/openzeppelin-contracts](https://github.com/OpenZeppelin/openzeppelin-contracts) | The ERC-4626 and ERC-20 implementations the vault builds on. They live in the on-chain repository, not here. |
| EIP-712 | [eips.ethereum.org/EIPS/eip-712](https://eips.ethereum.org/EIPS/eip-712) | Context only. Aqua orders in Aqua mode are authenticated by the ship, not by a maker signature, so this half signs no typed data. Listed to make that absence explicit rather than leave a reader assuming the usual limit-order flow. |

---

## 5. The stack this half plugs into

None of these were added for the hackathon. They are the repository's existing stack, and the
Aqua module was built to sit inside it rather than beside it. Versions from `package.json`.

| Dependency | Version | Link | Role in this half |
|---|---|---|---|
| Next.js (App Router) | `15.5.18` | [nextjs.org/docs/app](https://nextjs.org/docs/app) | `/[locale]/active-reserve` is a Server Component, `force-dynamic`, rendered per request. |
| React | `19.1.0` | [react.dev](https://react.dev) | The page and its five cards. No client component in this feature. |
| next-intl | `^4.13.0` | [next-intl.dev](https://next-intl.dev) | `setRequestLocale` on both routes. Active Reserve copy itself is English-only for the window, see [`README.md` §6](README.md#6-scope-stated-plainly). |
| viem | `^2.52.2` | [viem.sh](https://viem.sh) | The Arbitrum public client, `keccak256` for the `strategyHash`, `erc20Abi`, and the taker signer. |
| `server-only` | `^0.0.1` | [npmjs.com/package/server-only](https://www.npmjs.com/package/server-only) | Load-bearing. Every module in `src/lib/aqua/` imports it, so an accidental client import is a build error instead of a leaked database URL. |
| Vitest | `^4.1.7` | [vitest.dev](https://vitest.dev) | Every suite listed in [`README.md` §5](README.md#5-how-to-run-what-is-here). |
| tsx | `^4.22.3` | [tsx.is](https://tsx.is) | Runs the CLI scripts. They need `--conditions=react-server`, otherwise `server-only` resolves to the throwing build and the script dies on import. |
| dotenv | `^17.4.2` | [github.com/motdotla/dotenv](https://github.com/motdotla/dotenv) | Loads `.env.local` for the CLI only. |
| Biome | `2.4.16` | [biomejs.dev](https://biomejs.dev) | Lint and format, repository-wide. |
| TypeScript | `^5` | [typescriptlang.org](https://www.typescriptlang.org) | Targets ES2017, which is why bigints are built with `BigInt(...)` and never `0n` literals. |
| Tailwind CSS | `^4` | [tailwindcss.com](https://tailwindcss.com) | The page's styling, through the repository's existing design tokens. |

**Zod (`^3.25.76`) is a repository dependency but is not used by the Aqua module.** Validation of
untrusted input belongs to the thin server-action layer above the module, which this read-only
cut does not have yet. Listing it as used would be a false claim about the code.

---

## 6. Our own artifacts

| Artifact | Where | What it is |
|---|---|---|
| On-chain repository | [github.com/0xmvercosa/pool-party-aqua](https://github.com/0xmvercosa/pool-party-aqua) | PartyVault, AaveV3Adapter, deploy and ops scripts, the taker, the status report. |
| Judge package | `docs/hackathon/` in that repository | The submission package for the on-chain half. |
| `docs/VERIFIED.md` | That repository | Canonical Arbitrum addresses and the on-chain facts measured against the live deployment. `src/lib/aqua/config/addresses.ts` mirrors it and must be re-synced if it changes. |
| `docs/FILLS.md` | That repository | The mainnet fills, with hashes and figures. |
| `docs/01_BUSINESS_RULES.md` | That repository | The canonical rules the `PRG-R*`, `VLT-R*`, `SRV-R*`, `IDX-R*`, `BOT-R*` and `FE-R*` identifiers in this code refer to. |
| PartyVault | [`0xec870a6A9E8EE41B349FD0766b8f295D6EDC6610`](https://arbiscan.io/address/0xec870a6A9E8EE41B349FD0766b8f295D6EDC6610) | Source-verified on Arbiscan. |
| AaveV3Adapter | [`0x6d409fF8578D017AddDB2e9Ad0848D8F0A65aBAe`](https://arbiscan.io/address/0x6d409fF8578D017AddDB2e9Ad0848D8F0A65aBAe) | Source-verified on Arbiscan. |
| Flagship fill | [`0xbc64ec2db39c6a8f718487268e4195c63e472f0ad0ae1f46e09919a1a9c5bb83`](https://arbiscan.io/tx/0xbc64ec2db39c6a8f718487268e4195c63e472f0ad0ae1f46e09919a1a9c5bb83) | 0.0003 WETH for 0.556382 USDC, with the aUSDC burn, the Aqua pull and the WETH push in one transaction. |
| Aqua integration pointer | [`../_integration/06_aqua_strategies/README.md`](../_integration/06_aqua_strategies/README.md) | Says where the canonical documentation lives and why. |
| Module manual | [`../../src/lib/aqua/README.md`](../../src/lib/aqua/README.md) | Layout, the `server-only` rule, the money-is-a-string rule, and the database commands. |

### Commits on this branch

Branch `feat/aqua-poo-1067-investor-page`, in this repository. Verify with
`git log --oneline` against these four:

| Commit | Subject |
|---|---|
| `1d0311aa` | `feat(aqua): server module scaffold + program compiler [POO-1071, POO-1061]` (PR #664) |
| `fdf29729` | `feat(aqua): Active Reserve read-only investor page [POO-1067]` |
| `6be96fec` | `docs(aqua): update the PP-INTEGRATION-POINT census for the investor page` |
| `3c5d630a` | `fix(aqua): compiler was omitting the preTransferOut hook, killing the JIT path [POO-1061]` |

Linear epic POO-1057, project "Aqua Strategies (1inch Hackathon)". The tracker is private, so
[`00_IMPLEMENTATION_PLAN.md`](00_IMPLEMENTATION_PLAN.md) mirrors the issues an evaluator would
otherwise be unable to read.

---

## 7. Attribution and licensing

Aqua and SwapVM are **source-available, not open source**. Both ship a Degensoft licence with the
installed package, and both are worth reading before anyone reuses this code commercially:

| Package | Licence | File |
|---|---|---|
| `@1inch/aqua-sdk@0.2.0` | Degensoft Aqua Source License (Aqua-Source-1.1), `LicenseRef-Degensoft-Aqua-Source-1.1` | `node_modules/@1inch/aqua-sdk/LICENSE` |
| `@1inch/swap-vm-sdk@0.3.0` | Degensoft SwapVM License (SwapVM-1.1), `LicenseRef-Degensoft-SwapVM-1.1` | `node_modules/@1inch/swap-vm-sdk/LICENSE` |

Both are copyright Degensoft Ltd, 2025. In summary, and non-bindingly: you may read, use, deploy
and call the licensed work; if you modify and distribute or deploy the modified version you must
release your changes under the same licence; and no commercial licence is required until you cross
a commercial trigger. Read the licence files rather than this paragraph for anything that matters.

**Our position under those terms is Pure Caller Use.** We form calldata, submit transactions and
read state through published ABIs and RPC. We modify nothing, we distribute no modified work, and
we vendor no upstream source into this repository: the SDKs are ordinary npm dependencies, and the
Aqua registry and AquaSwapVMRouter we target are the official 1inch deployments at the addresses
in [`README.md` §2](README.md#2-the-facts), used unmodified.

### Required attribution

The Aqua licence (§2.4) requires attribution identifying the source, in this exact form:

> Aqua — © Degensoft Ltd 2025

**That string is quoted verbatim from the licence and is the one place in this documentation set
where an em dash is correct.** The repository's own style rule forbids em dashes in prose, and it
still does. Do not "fix" this one, and do not copy its punctuation into anything else.

Where the same licence asks for prominent attribution, the form is:

> Powered by Aqua — © Degensoft Ltd 2025

The Active Reserve investor page carries an on-chain verification block that lists the 1inch Aqua
registry and AquaSwapVMRouter by address, alongside our own contracts, each linking to Arbiscan
(`src/features/aqua/components/VerifyBlock.tsx`). The claim being made there is that this runs on
the real, unmodified 1inch contracts, and the cheapest way to support it is to let anyone click
through and check.

### Everything else

The rest of the stack in [§5](#5-the-stack-this-half-plugs-into) is under its own licence, mostly
MIT or Apache-2.0, unchanged by this work and installed from npm. Aave v3 and Chainlink are called
on chain only: no source from either is present in this repository. The contracts we wrote live in
the on-chain repository under its own licence, which is stated there.
