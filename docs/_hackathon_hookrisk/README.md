# Hook risk for v4 strategies: the hackathon delivery

**Package index for the ETHGlobal submission (September 2026).** The premise, the two deliverables,
where the evidence lives and how to demo it. The tool's own documentation stays with the tool under
[`hookrisk/`](../../hookrisk/); this file is the map.

## Premise

Pool Party lets managers build on-chain strategies that investors allocate to under chain-enforced
mandates. When those strategies reach Uniswap v4, every pool carries a **hook**: arbitrary code on the
swap and liquidity path. A hook can skim beyond its declared fee, trap liquidity, or expose a callback
anyone can call, and none of that is visible from a pool page. The manager's mandate protects
investors from the manager; nothing protected either of them from the hook. This submission closes
that gap: **measure a hook's risk before a position is opened, inside the platform, with a report the
manager can read and the investor can audit.**

## Deliverables

| | What | Where |
|---|---|---|
| 1 | **hookrisk**, the Uniswap Foundation Hooks Security Framework made executable: Slither detectors, a twin-pool differential harness on real `v4-core`, a scoring layer that never scores a dimension zero without a detector having run, BlockSec HookScan as an attributed second engine, a manifest bound to `(chainId, address, codehash)`, a Markdown report, SARIF and a meaningful exit code | [`hookrisk/README.md`](../../hookrisk/README.md), narrative [`hookrisk/docs/hackathon/HACKATHON.md`](../../hookrisk/docs/hackathon/HACKATHON.md), decisions [`RESUME.md`](../../hookrisk/docs/hackathon/RESUME.md) |
| 2 | **The Tools page** (`/tools`) in the investor app: chain + hook address in, verified source fetched and built server-side, hookrisk run, the report rendered in place, cached 24 h per hook. The seam the strategy builder will call once v4 strategies land, so a manager never leaves the platform to check a hook | [`04_TOOLS_PAGE.md`](04_TOOLS_PAGE.md) (written with the page), route `src/app/[locale]/(auth)/(app)/tools/`, server lib `src/lib/tools/hookrisk/` |

## Evidence

- **14 real hooks scanned before and after the fixes**, from the official template to Uniswap's own
  production hooks, OpenZeppelin's library and the archived Cork exploit hook:
  [`hookrisk/docs/hackathon/evidence/scans/`](../../hookrisk/docs/hackathon/evidence/scans/) and the
  comparison table in its `README.md`.
- **The Cork finding**: HS-01 reports the unguarded `beforeSwap` the attacker called directly:
  [`evidence/cork-hook.md`](../../hookrisk/docs/hackathon/evidence/cork-hook.md).
- **Two engines agreeing**: [`evidence/blocksec-corroboration.md`](../../hookrisk/docs/hackathon/evidence/blocksec-corroboration.md).
- **The harness catches what static analysis cannot**: `test_I2_detectsUndeclaredSkim` and
  `test_I3_detectsTrappedLiquidity` in
  [`hookrisk/harness/test/HarnessValidation.t.sol`](../../hookrisk/harness/test/HarnessValidation.t.sol).

## Demo

- Tool: [`hookrisk/docs/hackathon/DEMO_RUNBOOK.md`](../../hookrisk/docs/hackathon/DEMO_RUNBOOK.md)
  (nine verified steps, `demo.sh` runs them in about 90 s).
- App: sign in, open **Tools**, paste a hook address, read the report. The container needs the
  hookrisk toolchain (`WITH_HOOKRISK=1` build arg); see `04_TOOLS_PAGE.md`.
- Funding the demo account without leaving the app is the supporting on-ramp work documented in
  [`../_hackathon_privy/`](../_hackathon_privy/).

## New vs reused, and AI use

Stated once, in the repository [`README.md`](../../README.md#what-is-new-and-what-is-reused-continuity-track),
and enforced by the commit history: one theme per commit, never squashed. AI tools (Claude Code) were
directed through the written rules and notes listed in the same README section.
