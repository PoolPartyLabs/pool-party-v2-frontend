# Local Solana strategy preview

`PP-MGR-SCR-009`, POO-2281 rules v2. The parent route owns the hidden entry and guarded exit. This feature owns an independent React reducer and drawing. Nothing here imports the EVM builder, mandate draft, network IDs, wallet clients or services.

The preview is temporary local state. Applying changes updates only the drawing's configuration. Leaving the preview discards it. The global unsaved-changes guard protects a changed drawing, while the local confirmation protects unapplied edits before another selection or addition. Every removable protocol has a separate X control and a confirmation.

The fixed structure is Arbitrum Deposit, Idle input, Idle output, Income and Withdraw, plus one Solana spoke. Each direction has one bridge. Solana Idle holds a USDC label. Operating cash is native SOL, with no balance, in a 144 × 96 card centered to the right of Idle. Fixed spine cards retain the reused 236 × 62 geometry. Pool SOL labels represent wrapped SOL, distinct from native operating cash.

Principal routes are gray. Raydium CLMM and Orca Whirlpools add input Swap, Collect fees and Swap auto; their fees use a separate green bus through the return Bridge to Income on the hub. Outgoing Income is gray. Kamino Supply USDC receives USDC directly and returns principal and interest to Idle on the gray route. Jupiter Swap is a manual local conversion drawing and has no LP collector. Automatic swaps and bridges are fixed explanatory steps. Hover highlights one complete path between nodes, including all bends.

Allocation is a whole percentage from 0 to 100, represented as integer basis points internally. The sum across all blocks cannot exceed 100%. Pair and conversion choices are drawing labels only. No live pool, reserve, mint, price, balance, yield, fee model, range, grid, liquidity, route or transaction identity is invented. Unavailable fields say "Not available". Supply-only wording describes the drawing, not an actual wallet debt position.

No launch, signing, transaction broadcasting, approval, API discovery, data simulation or browser persistence exists here. A blocked execution affordance explains that execution is unavailable and reports bounded blocked intent. Analytics reports view, first start, local Apply, abandonment, blocked intent and genuine render failures. There is no completion event. The render boundary preserves the parent reducer and allows retry after a real rendering exception without recording exception text.

Focused tests cover allocation validation and aggregate bounds, edit/application isolation, discard, removal, LP collector scope, global dirty registration, guarded transitions, bounded events and actual render failure recovery. Confirmation close restores the editable field on cancel and the current panel heading on a confirmed switch. Removing the selected block focuses the remaining screen controls. Storybook covers an empty drawing, mobile viewport and all protocol paths. Geometry and keyboard focus are reviewed through code and focused component tests. Browser visual verification was not performed and remains with Murilo.

## Design and brand sources

Design follows the 2026-10-05 Solana/Raydium and Orca/Kamino handoffs, superseded where specified by `protocol-research-solana-configure-manage-2026-10-07.md` in the PoolPartyV2Design project. Historical market fixtures in those handoffs are intentionally omitted from this local drawing.

Official marks are shipped under `public/protocols/solana-preview/`. Solana, Raydium, Orca and Kamino assets were copied from the PoolPartyV2Design `brand/external-logos/2026-10-05/` intake and its source manifest. Jupiter was retrieved from its official site on 2026-10-07. The marks are displayed beside protocol names to identify drawing blocks. Attribution does not imply endorsement or a trademark license.

| Mark | Official source | Adaptation |
| --- | --- | --- |
| Solana | [Solana mark in the Raydium UI source](https://raw.githubusercontent.com/raydium-io/raydium-ui/master/src/assets/icons/solana-text-logo.svg) | The design intake cropped the wordmark while retaining the three mark paths and gradients. |
| Raydium | [Raydium UI logo](https://raw.githubusercontent.com/raydium-io/raydium-ui/master/src/assets/icons/logo.svg) | Original mark. |
| Orca | [Orca official site](https://www.orca.so) | SVG mark extracted during design intake. |
| Kamino | [Kamino documentation logo](https://mintcdn.com/kamino-3d73a151/EHpt5rRzyV5R3dXt/images/logo/dark.svg) | The design intake retained the K mark. |
| Jupiter | [Jupiter official logo](https://jup.ag/svg/jupiter-logo.svg) | Original SVG, displayed at the component's size. |
