# Frontend licensing and scope

<!--
@id: PP-CORE-DOC-010
@implements-rules-version: v2
@analytics-events: none (source distribution policy only)
-->

The public frontend uses **[Pool Party Source-Available License 1.0](LICENSE)**
as its current distribution policy for **all Pool Party-authored material**:
existing features, the V2 builder and investor/manager surfaces, shared
components, authored tools including Hookrisk's independent components, Aqua
caller code, tests, scripts, configuration, documentation and original assets.
The same default covers future additions and modifications while this license
is in effect. It applies during development; a final release is not required.

The custom SPDX identifier is
`LicenseRef-PoolParty-Source-Available-1.0`. This is **source-available, not
OSI-approved open source**. Public access is available for transparency, review
and the purposes in the license.

## What is permitted

| Purpose | Current first-party license |
| --- | --- |
| Read, study, modify and test locally or with test assets | Permitted. |
| Conduct independent security research or a paid/unpaid audit | Permitted; live-system access still requires authorization. |
| Make study/contribution forks and submit patches | Permitted, with license/attribution preservation and unofficial identification. |
| Invest or manage through the official Pool Party platform, including manager fees | Permitted within its documented features, service terms and contract permissions. |
| Develop independent adapters/tools interoperating with the official platform | Permitted, including necessary interface/example reuse; restricted implementation copies are excluded. |
| Operate a separate production deployment, including a free fork | Requires prior express written authorization for restricted material. |
| Sell, host a SaaS/white label or distribute a separate operational product containing restricted material | Requires prior express written authorization. |

An agreement must be signed by an authorized Pool Party representative and
identify the contracting legal entity, covered material and granted rights.
A licensing request or an unanswered issue is not permission. Use the verified
[PoolPartyLabs organization](https://github.com/PoolPartyLabs) or a non-sensitive
repository issue to reach the maintainers.

## Prior MIT and other grants survive

The frontend introduced its root MIT notice in
[commit `36d4d4c`, July 26, 2026 at 06:29 UTC](https://github.com/PoolPartyLabs/pool-party-v2-frontend/commit/36d4d4c67a30f01f7d3ac656417795427c5fb4b8).
The public main examined immediately before this policy PR is
[`410188eaf749dec8dcb1fcf3f5fb7e541aaccb51`](https://github.com/PoolPartyLabs/pool-party-v2-frontend/commit/410188eaf749dec8dcb1fcf3f5fb7e541aaccb51).
This is a reference baseline, not the beginning of prior license rights.

The exact former root notice is preserved at
[LICENSES/MIT-legacy-frontend.txt](LICENSES/MIT-legacy-frontend.txt).
Hookrisk's prior [MIT text](LICENSES/MIT-legacy-hookrisk.txt) and
[NOTICE](LICENSES/NOTICE-legacy-hookrisk.txt) are also preserved byte for byte.
The [machine-readable baseline](LICENSES/legacy-baseline.json) records their
hashes and publication references.

**Replacing a notice cannot revoke valid MIT, AGPL or other permissions
already granted.** Recipients may continue to use, modify, redistribute and
commercialize material under the applicable previous grant. Those permissions
also continue for unchanged licensed portions present in later versions.
The current policy does not make that legacy material exclusively restricted.
Its effective exclusivity covers original changes and material for which no
independent permissive grant exists, and only where Pool Party has sufficient
rights. Reusing legacy portions still requires their original notices.

A public repository's hosting terms also permit viewing and forking. This
license is a legal permissions policy; it does not prevent downloading source
or make a public repository private.

## Scope exceptions

| Material | Governing boundary |
| --- | --- |
| `hookrisk/detectors/**` | AGPL-3.0-only, due to its Slither-linked plugin. [Its license](hookrisk/detectors/LICENSE) and package declaration remain intact, including future modifications that must follow AGPL. |
| `hookrisk/` independently authored CLI, harness, corpus, action and other tooling | Current first-party policy, with previous MIT grants and contributor ownership preserved. [Current notice](hookrisk/NOTICE). |
| `src/app/fonts/poppins/**` | SIL Open Font License 1.1; [font notice](src/app/fonts/poppins/OFL.txt) retained. |
| `.claude/skills/swap-integration/**` and upstream context in `hookrisk/contrib/uniswap-ai/` | Uniswap Labs MIT content with [upstream license](.claude/skills/swap-integration/LICENSE.upstream); only independently authored additions can follow the current default. |
| Upstream prose in `hookrisk/schema/framework-rubric.json` | Retain Uniswap Foundation attribution. Its upstream permission must be verified before asserting exclusive ownership or redistributing new adaptations; [third-party record](THIRD_PARTY_NOTICES.md). |
| Dependencies, copied upstream snippets and generated protocol ABI/interface facts | Their own applicable grants and notices. Package licenses are not changed by the frontend's license metadata. |
| Third-party network/protocol/token logos and starter/template artwork | Rights remain with their rightsholders; no Pool Party commercial grant is asserted over them. |
| Earlier separately licensed material | Its existing grants remain effective. A filename or last modification date does not determine copyright ownership. |

Our independent Aqua integration is included in first-party scope. It calls
official protocol contracts and SDKs; it does not acquire ownership of the
protocol or remove Degensoft's licensing/attribution conditions. Read
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for those dependencies.

## Current notices and future additions

The root and standalone Hookrisk licenses use the same custom text.
`package.json` and the Hookrisk CLI package use `SEE LICENSE IN LICENSE`;
each standalone package contains that referenced file. Existing first-party
Solidity fixtures use the custom SPDX identifier and retain an explicit
prior-grant notice. Other first-party files inherit this root policy; a mass
rewrite of frontend component bodies is unnecessary.

New files inherit this policy when first-party and rights-cleared. For Solidity,
use the custom SPDX identifier; do not introduce MIT by habit. A copied or
adapted upstream portion keeps its original notice. Add an exception and
provenance record before treating it as first-party. The applicable outbound
terms and inbound contributor permissions must both be satisfied; see
[CONTRIBUTING.md](CONTRIBUTING.md).

## Transition approval and remaining rights verification

On October 7, 2026, Murilo expressly authorized merging the completed frontend
policy. That delivery approval does not establish ownership of third-party
material or resolve the following legal/provenance questions. The license
applies only to rights Pool Party owns or is authorized to license:

1. Confirm the legal entity represented by "Pool Party Labs" and the signatory
   authorized to grant commercial permissions.
2. Confirm employee, founder and contractor copyright assignments or sufficient
   license grants for the frontend and Hookrisk contributors. The change cannot
   remove a contributor's rights or an upstream obligation.
3. Approve the separate contribution permission in CONTRIBUTING.md and any
   required signed contributor agreement before accepting restricted contributions.
4. Verify current hackathon, grant and audit-subsidy commitments and third-party
   redistribution obligations against the actual signed terms.
5. Resolve the upstream framework-prose permission and preserve all external
   assets, dependency notices and separately licensed boundaries.

Tracked in [POO-2268](https://linear.app/yeildbay/issue/POO-2268), rules v2, and
[the compliance record](docs/COMPLIANCE_REGISTER.md#repository-license-transition-2026-10-07-poo-2268-v2).
Do not treat the owner-approved distribution policy as a completed rights audit.
Exclusive restrictions and separate commercial sublicenses remain limited to
rights actually controlled by Pool Party. Documented official-platform use and
valid previous grants retain their existing permissions.

The backend implementation is not distributed or licensed by this repository.
No private implementation or source repository is incorporated by these notices.
