# Build canvas polish, 2026-10-05

Scope: Build only. Public repository: PoolPartyLabs/pool-party-v2-frontend.
Parent: POO-2116. Rules v1: POO-2235, POO-2236, POO-2237.

## Sources and decisions

- Owner screenshots and request on 2026-10-05.
- [Figma DEV NOTES 8025:1819](https://www.figma.com/design/jjOf5DL9uVEB7WBR9nGb4A/?node-id=8025-1819).
- [Interaction reference 8035:1688](https://www.figma.com/design/jjOf5DL9uVEB7WBR9nGb4A/?node-id=8035-1688).
- Figma specifies 1.5px resting edges, 2px primary hover, shared edge/label hover, 24px links, 48px shared stubs, 32px siblings, and controls inset 12px.
- The owner enables selection of manual Swap and spoke percentages, plus locks on all five fixed spine cards.
- Preserve Collect fees → Swap · auto → Income. Income → Withdraw is neutral.
- The current mandate stores an explicit token list. Manual Swap uses that list on its own network. No unrestricted-token flag exists in the current draft contract; no new allowance or token discovery API is invented.
- Manual Swap execution remains unavailable in Review/launch. Configuration is a stored draft instruction, not a quote or an executable route.

## Delivery stages and dependencies

1. **POO-2236, available canvas space.** AppShell temporarily collapses the sidebar per Build visit, while allowing its toggle. BuildStepLayout measures space above the navigation. CanvasViewport/useCanvasViewport/viewportMath fit and center on entry and measured resize. BuildScreen opts in; Manage keeps its current behavior. Tests: short viewport, two-axis fit, sidebar expansion/reentry and resize.
2. **POO-2235, graph geometry and interaction.** layoutGraph supplies continuous centerlines and semantic block-to-block paths. GraphEdges hit targets and overlays highlight only the connection's portion of a shared bus. BuildGraph links percentages to their incoming paths. All fixed spine cards show locks. Tests: real layout joins, sibling isolation, return paths, neutral Income output, keyboard/click targets.
3. **POO-2237, configuration.** Extend flow storage with optional manual Swap token keys and slippage. Reuse usePanelDraft and guarded selection for Swap and spoke targets. AuxiliaryBlockPanel uses existing selectors, status row, slippage and allocation controls. Tokens stay network-scoped, distinct and in the mandate. Spoke share stays within network/root caps and above its children without rescaling them. Tests: persistence, validation, Apply/Discard, guarded navigation, selection/removal and unchanged launch refusal.
4. **Review and delivery.** One local Vitest process, focused suites only, scoped TypeScript capped at 2 GiB, Biome and locale parity. Independent review before small commits/PRs. No full suite, build, browser walkthrough, signing or deployment.

## Integration and instrumentation

No new API or wallet seam. Configurations persist through the existing mandate draft store and its Save/exit path. Token metadata and logos come from the mandate references. Position panels keep their existing service reads.

Reuse builder_block_applied, builder_block_discarded, builder_block_leave_blocked and builder_build_blocked. Add the bounded spoke kind and token input/output fields to the existing schema; never emit token addresses or amounts. Hover and fitting are decorative, without new events.

## Verification and delivery evidence

Implementation completed against public main b95213ac. Focused validation covered 1,003 cases across 24 changed/affected test files with one worker and no parallel files. 23 files passed together; the remaining copy oracle was updated for the explicit unavailable message and rerun separately. Scoped TypeScript (2 GiB limit), changed-file Biome and locale parity passed. Biome reports only two existing warnings (AppShell image and a launch-test non-null assertion). No full suite, production build, browser walkthrough or on-chain operation was performed.

Independent review (GPT-6.1-sol) found and resolved: a 1px viewport on exceptionally short screens; a manual-Swap execution bypass in pool chains; a removal action on populated spokes; and fractional allocation/accessible minimum consistency. Coordinator inspection also increased control clearance to the measured 116px stack plus 12px bottom inset.

The explicit manual-swap gate now protects both Review and the launch compiler. [POO-2238](https://linear.app/yeildbay/issue/POO-2238) tracks execution wiring and the missing amount/route/recovery rules. No backend quote delivery is claimed missing: POO-2148 is already Done.

Delivery PR links are recorded below as each slice merges.
