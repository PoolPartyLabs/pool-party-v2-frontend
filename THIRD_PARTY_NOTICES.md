# Third-party notices

<!--
@implements-rules-version: v2
@analytics-events: none (license and provenance inventory only)
-->

The [Pool Party license](LICENSE) covers only material Pool Party owns or has
authority to license. It does not replace the licenses of dependencies, copied
content, fonts or third-party marks. The exact upstream license and copyright
notice take precedence for their material.

## Prior first-party publications

The former root MIT notice is preserved at
[LICENSES/MIT-legacy-frontend.txt](LICENSES/MIT-legacy-frontend.txt).
Hookrisk's prior [MIT license](LICENSES/MIT-legacy-hookrisk.txt) and
[NOTICE](LICENSES/NOTICE-legacy-hookrisk.txt) are retained verbatim.
[LICENSES/legacy-baseline.json](LICENSES/legacy-baseline.json) records the
public baseline and notice hashes. Those grants remain effective, including
for unchanged licensed material in future distributions.

## Separately licensed repository material

| Material | License/provenance |
| --- | --- |
| `hookrisk/detectors/**` | **AGPL-3.0-only**. The plugin imports and subclasses Slither. [Complete license](hookrisk/detectors/LICENSE) and `pyproject.toml` remain unchanged. |
| `src/app/fonts/poppins/**` | **SIL Open Font License 1.1**, copyright The Poppins Project Authors. [Complete notice](src/app/fonts/poppins/OFL.txt) remains unchanged. |
| `.claude/skills/swap-integration/**` | **MIT**, copyright 2026 Uniswap Labs. [Complete license](.claude/skills/swap-integration/LICENSE.upstream) and the skill's upstream provenance are preserved. |
| Upstream context in `hookrisk/contrib/uniswap-ai/fix-before-swap-returns-delta-bit.patch` | Uniswap skill text retains its original rights; our additions do not relicense the unchanged context. |
| `hookrisk/schema/framework-rubric.json` upstream prose | Port of the [Uniswap Hooks Security Framework](https://github.com/uniswapfoundation/security-framework), revision `e7e8da52fd5717b6eb4517ea779b766f63148c41`. Attribution is preserved; an upstream grant covering reproduced prose was not established in this review. Do not represent that text as exclusively owned by Pool Party. |
| Protocol, network and token artwork; `public/next.svg`, `public/vercel.svg`, and starter icons | Rights remain with their respective owners. Public availability and a repository license do not grant trademark permission or establish exclusive Pool Party ownership. |

The Uniswap Foundation does not review, audit, endorse or certify Hookrisk,
the framework port or any score. Upstream attribution is not endorsement.

## Solana preview protocol marks

The five static SVGs in `public/protocols/solana-preview/` identify protocols/networks in the local
editor added by POO-2281. They are third-party marks and are excluded from any first-party ownership
claim. Their copyright/trademark rights remain with their owners. The source-available root policy
does not relicense these assets or imply endorsement or permission to use the trademarks commercially.

| Asset | Official source, retrieved through design intake on October 5 or directly on October 7, 2026 | Adaptation |
|---|---|---|
| `solana.svg` | [Solana mark in Raydium UI](https://raw.githubusercontent.com/raydium-io/raydium-ui/master/src/assets/icons/solana-text-logo.svg) | Wordmark cropped by design intake; three original paths/gradients retained |
| `raydium.svg` | [Raydium UI](https://raw.githubusercontent.com/raydium-io/raydium-ui/master/src/assets/icons/logo.svg) | Original mark |
| `orca.svg` | [Orca official site](https://www.orca.so) | SVG mark extracted by design intake |
| `kamino.svg` | [Kamino documentation](https://mintcdn.com/kamino-3d73a151/EHpt5rRzyV5R3dXt/images/logo/dark.svg) | K mark retained by design intake |
| `jupiter.svg` | [Jupiter official site](https://jup.ag/svg/jupiter-logo.svg) | Original SVG |

Display sizing and the provenance record are in the
[preview feature README](src/features/manager/fund/solana-preview/README.md). These files are static;
no script, event handler, external resource reference or foreignObject is introduced.


## Adapted Solana tick math

The Orca and Raydium tick-to-Q64 functions in
`src/features/manager/fund/solana-preview/solanaRangeModel.ts` are adapted from
these exact Apache-2.0 sources. They are separate algorithms with their own
rounding and domain boundaries. Pool Party modified the Rust functions into
TypeScript BigInt and added presentation validation; the upstream portions
retain their original license and copyright.

| Upstream material | Pinned source and preserved license |
| --- | --- |
| Orca Whirlpools tick math, copyright 2022 Orca Foundation | [Revision e528dd23](https://github.com/orca-so/whirlpools/blob/e528dd23bb41571f92cfdb49a2f15d4fa0b01bec/programs/whirlpool/src/math/tick_math.rs), February 26, 2025. [Original Apache notice](LICENSES/Orca-Apache-notice-e528dd23.txt) and [complete Apache-2.0 license](LICENSES/Apache-2.0.txt). |
| Raydium CLMM tick math | [Revision ed1eb415](https://github.com/raydium-io/raydium-clmm/blob/ed1eb41519d5355755f7df52b43fa9610938b60b/programs/amm/src/libraries/tick_math.rs). [Original complete Apache license](LICENSES/Raydium-Apache-ed1eb415.txt). |

The later Orca License is not the grant used for this adaptation. The Orca
positive/negative sqrt functions in the Apache revision are identical to the
reference functions checked during implementation. Neither pinned repository
provided an additional NOTICE file. Preserve these notices and the complete
Apache-2.0 text in source and built distributions containing the adapted code.
No SDK, program binary, deployment authority or market feed is bundled here.

## Application dependencies

`@xyflow/react@12.12.0` and its `@xyflow/system@0.0.83` dependency retain **MIT**,
copyright 2019-2025 webkid GmbH. The complete upstream notice is preserved at
[LICENSES/xyflow-MIT-12.12.0.txt](LICENSES/xyflow-MIT-12.12.0.txt). Pool Party's custom
financial graph adapter does not relicense the engine. No React Flow UI registry components
are copied into this repository.

The dependency manifest is [package.json](package.json); resolutions and
integrity data are in [pnpm-lock.yaml](pnpm-lock.yaml). Every installed package
retains its actual license at that pinned version. This inventory highlights
material boundaries; it does not replace the complete package notices.

The installed Uniswap JavaScript packages `@uniswap/sdk-core@7.17.0`,
`@uniswap/v3-sdk@3.30.4` and `@uniswap/permit2-sdk@1.4.0` declare MIT.
Their license declarations concern those JavaScript packages, not every
Uniswap contract or test fixture.

| Dependency | Separate license at the documented installed version |
| --- | --- |
| `@1inch/aqua-sdk@0.2.0` | Degensoft Aqua Source License, `LicenseRef-Degensoft-Aqua-Source-1.1`. |
| `@1inch/swap-vm-sdk@0.3.0` | Degensoft SwapVM License, `LicenseRef-Degensoft-SwapVM-1.1`. |

Aqua and SwapVM are **source-available**, with their own commercial and
redistribution conditions. Our integration is documented as Pure Caller Use
of official contracts and SDKs; no upstream implementation is claimed as ours.
The established Aqua attribution is retained here:

> Aqua - © Degensoft Ltd 2025

Read the package licenses and the
[existing integration attribution record](docs/_hackathon_aqua/04_REFERENCES.md#7-attribution-and-licensing)
before redistributing or operating that integration. A Pool Party authorization
does not waive Degensoft's terms.

Other application/runtime/build dependencies, including React, Next.js,
Privy, wagmi/viem, OpenZeppelin-related tools and developer packages, retain
their package licenses and notices. Their vendors' APIs and service terms
are separate from their SDK licenses.

## Hookrisk upstream boundary

[hookrisk/NOTICE](hookrisk/NOTICE) records the tool's current scope and
third-party components. BlockSec HookScan and Slither are AGPL components;
the detector links Slither. BlockSec is invoked as an isolated process, and
its source is not redistributed here.

The Solidity harness uses upstream dependency pins in
[hookrisk/harness/deps.lock](hookrisk/harness/deps.lock), including Foundry,
Uniswap V4, OpenZeppelin and Solmate. Those dependencies have **per-file
licenses**; the pinned V4 Pool library is BUSL-1.1 and upstream test routers/
deployers declare UNLICENSED. At the pinned Solmate revision
`eaa7041378f9a6c12f943de08a6c41b31a9870fc`, the imported MockERC20 and ERC20
files declare MIT, even though other Solmate files have different licenses.
Some probes link V4 Pool, so the previous broad claim that all Uniswap source
was MIT and nothing was linked must not be used as the current license map.
The Slither detector's AGPL boundary remains separate.

A first-party source notice does not grant permission to redistribute upstream
or compiled combined work under incompatible terms. Confirm the applicable
grants before distributing generated/linked harness artifacts; this transition
changes neither dependencies nor artifacts and does not assert that missing
upstream permission was resolved.

## Distributions and future dependencies

Preserve license/copyright files with any source or built package distribution.
New copied/adapted upstream material needs its original notice and an identified
source/version. Generated code can contain upstream material; generation alone
does not transfer ownership.

Licenses may apply differently to source declarations, local test-only combined
work, and distributed artifacts. Review copyleft and source-available compatibility
at the exact source boundary; do not impose Pool Party restrictions on material
whose upstream license prohibits them.
