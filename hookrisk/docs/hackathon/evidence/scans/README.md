# 15 real hooks, before and after

Same clones, `hookrisk.toml` regenerated with the final `init` template (Orbital and LiquidityPenaltyHookMock add `[harness] constructorArgs`, copies are in their directories), scanned with `main@db08091` (before) and the final `feat/hackathon-p0` (after). Each directory holds `hook-risk.json`, `HOOK_RISK.md` and the verbose `scan.stderr`; `after/summary.jsonl` is the machine-readable summary. Regenerate the scans with `../rescan.sh <hookrisk-root> <clones-root> <out-dir>` and this table with `../make-table.py`. Finding counts exclude the informational `hook-profile` every recognised hook carries. Probes are the harness's execution probes (EOA guard per callback, selector/return check per callback, pool-key exclusivity). Dimensions are counted measured/declared/unmeasured.

| Hook | Findings before | Findings after | Harness | Invariants | Probes | Complexity | Dimensions | Gate | Tier band |
|---|---|---|---|---|---|---|---|---|---|
| cork-hook | 4 high, 1 info | 3 high, 5 medium, 2 info | skipped | I1 skipped, I2 skipped, I3 skipped | — | 5/5 | 5m/2d/2u | failed | medium 17–23 |
| nft-owners-only | none | 1 info | skipped | I1 skipped, I2 skipped, I3 skipped | — | — | 0m/2d/7u | failed | low 3–28 |
| orbital-hook | 1 high, 1 info | 2 low, 3 info | ok (hooked-failed) | I1 inconclusive, I2 inconclusive, I3 not-applicable | guard {guarded: 3} · selectors {reverted: 3} · exclusivity not-applicable | 4/5 | 5m/2d/2u | passed | medium 14–20 |
| oz-antisandwich-mock | 1 info | 2 info | ok (both) | I1 passed, I2 passed, I3 passed | guard {guarded: 2} · selectors {ok: 2} · exclusivity accepted | 4/5 | 5m/2d/2u | passed | medium 13–19 |
| oz-limitorder-mock | none | 1 info | ok (both) | I1 passed, I2 passed, I3 passed | guard {guarded: 2} · selectors {ok: 2} · exclusivity accepted | 3/5 | 4m/2d/3u | passed | low 6–17 |
| oz-liquiditypenalty-mock | — (new) | 2 info | ok (both) | I1 passed, I2 passed, I3 passed | guard {guarded: 2} · selectors {ok: 2} · exclusivity accepted | 3/5 | 5m/2d/2u | passed | medium 9–15 |
| ref-fee-hook | none | none | skipped | I1 skipped, I2 skipped, I3 skipped | — | — | 0m/2d/7u | failed | low 3–28 |
| take-profits-hook | none | 1 info | skipped | I1 skipped, I2 skipped, I3 skipped | — | — | 0m/2d/7u | failed | low 3–28 |
| trading-days | none | 1 info | skipped | I1 skipped, I2 skipped, I3 skipped | — | — | 0m/2d/7u | failed | low 3–28 |
| v2-on-v4 | 2 high, 1 info | 4 high, 2 info | failed | I1 inconclusive, I2 inconclusive, I3 inconclusive | — | 4/5 | 4m/2d/3u | failed | medium 15–24 |
| v4-constant-sum | 1 high, 1 info | 2 info | ok (hooked-failed) | I1 inconclusive, I2 inconclusive, I3 not-applicable | guard {guarded: 2} · selectors {reverted: 2} · exclusivity not-applicable | 4/5 | 5m/2d/2u | passed | medium 13–19 |
| v4-hooks-public-stablepair | 1 high | 1 high, 1 medium, 1 info | failed | I1 inconclusive, I2 inconclusive, I3 inconclusive | — | 2/5 | 4m/2d/3u | failed | low 6–17 |
| v4-hooks-public-weth | 1 high, 1 info | 1 medium, 2 info | skipped | I1 skipped, I2 skipped, I3 skipped | — | 4/5 | 5m/2d/2u | passed | medium 15–21 |
| v4-stoploss | none | 1 info | failed | I1 inconclusive, I2 inconclusive, I3 inconclusive | — | — | 0m/2d/7u | failed | low 3–28 |
| v4-template-counter | none | 1 info | ok (both) | I1 passed, I2 passed, I3 passed | guard {guarded: 4} · selectors {ok: 4} · exclusivity accepted | 2/5 | 4m/2d/3u | passed | low 5–16 |

The gate fails on the three hooks with HIGH findings (Cork, StablePairHook, v2-on-v4) and on the five that could not be analysed (four 2023-ABI hooks and the repo that does not compile), and passes on the seven that were measured. v2-on-v4's three HS-03 HIGHs are its Uniswap-v2-style `mint`/`burn`/`sync`, permissionless by that design; the detector cannot tell them from an open admin surface because the caller pays by transferring beforehand rather than in the call (documented limit).
