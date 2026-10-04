# Mandate Protocols correction, POO-2167 rules v4

Artifact: PP-MGR-CMP-036. Related: POO-2123, POO-2143; implementation epic POO-2119,
within delivery epic POO-2116. Figma: [Mandate Protocols option B](https://www.figma.com/design/jjOf5DL9uVEB7WBR9nGb4A/Pool-Party-V2?node-id=8006-1299).

## Business rules revision history

- v3, 2026-10-03: Uniswap v3 positions remain visible and unavailable; the v3 swap remains required.
- v4, 2026-10-04, Murilo: correct the reported real-mode Figma drift, restore GMX and add Pendle as
  disabled future rows, and replace protocol monograms with committed brand assets. These rules are
  user-authorized follow-up work. Linear synchronization is pending connector authentication.

## Rules

- [R1] Both data modes render the designed Required and Protocols to operate groups. Neither renders
  the extra real-mode protocol helper, reserve/APY paragraphs or duplicate network fieldsets.
- [R2] GMX and Pendle render after Uniswap v4 with the same Coming soon disabled-row behavior as
  Uniswap v3 positions. Their clicks emit the existing coming_soon blocked-intent event and change no
  selection. They have no supported fund-contract networks and therefore show no On column.
- [R3] Uniswap v3 positions, GMX and Pendle are excluded from Select all and withProtocols in both
  modes. Stored drafts lose these protocol ids, their pools and caps, and invalid per-chain position
  entries. The real mandate serializer refuses unsanitized future protocols. No operation is enabled.
- [R4] Every known protocol row uses a committed canonical logo, including Across, Aave, GMX and
  Pendle. Logos are decorative; row names remain the accessible labels. Both existing sizes work.
- [R5] Real-mode rows and Select all select position protocols on every supported selected network,
  with Aave on Arbitrum only. Deselection removes matching per-chain entries, pools and reserve
  selections, expires the pool-universe count, and preserves other valid protocol choices.
- [R6] Keep required Uniswap v3 swaps, conditional real-mode Across, real reserve-based Aave
  availability, catalog loading/error/stale notices with retry, selected-network dots, and the
  existing analytics emitter. New display strings land in all 11 public-repository locales.

## Sources and verification

Protocol availability comes from mandateCatalog and, for real Aave, the catalog reserve seam.
The existing catalog failure and stale-draft behavior remain the source of error handling.
Brand assets are committed locally and used without alterations to the mark:

- Uniswap: existing public/protocols/uniswap.svg; Aave: existing public/tokens/aave.png.
- Across: [across-protocol/frontend-v1](https://github.com/across-protocol/frontend-v1), src/assets/Across-logo-bullet.svg,
  Git blob 4813d7e422d4a413c8735d3085aecca1f4a44bc7.
- GMX: [gmx-io/gmx-interface](https://github.com/gmx-io/gmx-interface), src/img/logo-icon.svg,
  Git blob dbd7ffaedc53008fdaba995c79ac1ecc243babf4.
- Pendle: [pendle-finance/documentation](https://github.com/pendle-finance/documentation), static/img/favicon.ico,
  Git blob 854f03b014ee56422bef9119f434a6dd9c8eb300. The official 256 px icon is converted to PNG.

The new SVGs were parsed and checked for embedded scripts, images and links. The Pendle PNG was
visually checked against the official mark.
Murilo owns the complete browser journey. This document does not establish browser acceptance,
deployment, authenticated API smoke or transaction execution.

## Regression mapping

| Rule | Observable regression evidence |
| --- | --- |
| R1 | ProtocolsStep.test: helper, APY and duplicate controls absent; MandateSteps.v2.test: real-mode APY absent. |
| R2 | ProtocolsStep.test: both future rows disabled, unselected and blocked in both modes; mandateCatalog.test: future rows and network scope. |
| R3 | ProtocolsStep.test: Select all and mistaken catalog availability exclusions; mandateDraft.test: direct reducer refusal; mandateDraftStore.test: stale ids, caps and chain entries removed; v2Mandate.test: executable serialization refusal. |
| R4 | ProtocolMark.test: exact local source, decoration and 24/28 px size for all seven ids. |
| R5 | ProtocolsStep.test: supported-network row selection, Select all repairs partial chain selection, and deselection clears pools while preserving Aave. |
| R6 | Existing required and availability regressions plus ProtocolsStep.test loading/error/retry and MandateSteps.v2.test real Aave reserves. |

The initial unfixed-code run failed 17 tests and passed 192 across seven files. Failures covered
extra real-mode content, missing future rows/catalog, absent logos, stale future draft choices and
real-network synchronization. A further malformed stored-chain regression failed before its defensive
sanitization fix, proving one corrupt optional chain entry otherwise made every draft unreadable.
The final focused command passed **212 tests in seven files**:

```sh
pnpm test src/features/manager/fund/steps/ProtocolsStep.test.tsx src/features/manager/fund/components/ProtocolMark.test.tsx src/features/manager/fund/mandateCatalog.test.ts src/features/manager/fund/mandateDraft.test.ts src/features/manager/fund/mandateDraftStore.test.ts src/features/manager/fund/v2Mandate.test.ts src/features/manager/fund/steps/MandateSteps.v2.test.tsx --maxWorkers=2
```

`NODE_OPTIONS=--max-old-space-size=4096 pnpm typecheck`, scoped Biome across all changed source and
locale files, `pnpm i18n:check` (11 locales, 2,726 keys) and `pnpm config:check` passed.
The initial broader Fund run was stopped after it evaluated an intermediate sanitizer before the
malformed-chain fix. The final full Fund run passed **2,681 tests in 126 files**. Full TypeScript and
repository Biome checks passed; Biome reported only existing warnings outside this change. An
independent correctness/regression review approved the final code. The artifact registry retains
658 rows; this correction adds no artifact or integration seam.
