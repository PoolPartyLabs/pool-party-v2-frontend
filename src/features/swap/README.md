# Swap & bridge (`/swap`)

`PP-CORE-SCR-010` · Linear **POO-1046** (UF-24) · hackathon epic **POO-1022** (Universal Funding).

The first place in the product where a user can move their own money between networks on purpose,
rather than as a side effect of investing. Dark-launched behind the `swapScreen` flag.

## Why it exists

The wallet modal has shown USDC split across Base, Arbitrum and Polygon since POO-238, with **no
action on any row**: Swap is a disabled "coming soon" (POO-240) and Send is an in-modal placeholder
(POO-241). Meanwhile the Universal Funding epic built a complete funding rail, reachable only from
inside an operation modal. This screen is the missing entry point, not a new capability.

## Pieces

- **`SwapScreen`** (`components/SwapScreen.tsx`) - destination + amount, then the shipped
  `ProvisioningPanel`. Client component; the only screen-owned state is the destination, the amount
  and the wallet read.
- **`swapRequest`** (`lib/swapRequest.ts`) - the pure half: parse the amount, work out what is
  already at the destination, drop the destination's own USDC from the funding sources, and assemble
  the `ProvisioningNeedInput` the shipped planner takes.

## What it reuses, and what that means

Everything after "Continue" is `ProvisioningPanel` (`PP-CORE-CMP-046`), which owns the
funding-source picker, the cost breakdown, the plan card and the execution rail
(`buildPlanSteps` -> `useWalletSignFlow`). There is **no second planner call, no second rail and no
second execution path** here (POO-1046 [R3]). Anything that lands in the panel later reaches this
screen for free.

Nothing on the screen asks the user to classify their own transfer ([R2]): a same-chain swap, a
cross-chain bridge, and a swap decomposed into both are all `buildPlan`'s answer to one question.

## Two honest limits

| Limit | Why |
|---|---|
| The destination asset is **USDC** | `buildPlan` terminates every route on the target chain's USDC. An arbitrary "to token" is a planner capability (a third leg class, plus sizing in that token's units), not a screen one. USDC is also the unit every Pool Party operation is denominated in. |
| The amount is a **target balance**, not a transfer size | `computePlanAction` sizes a route against what the destination is still missing. Re-deriving a plan from current holdings is what makes it safe to re-run (`02_BRIDGE_ARCHITECTURE.md` §3.1), so the screen says "how much do you want available on X" and moves only the difference. |

## Design

There is **no Figma for this screen**. It is composed from primitives already in the tree (the
segmented control of `GasAmountSelector`, the amount field of the invest flow) rather than inventing
a visual language design would have to un-invent. **It needs a design pass before launch**, which is
one of the things the flag is holding.

## Flag

`swapScreen` / `NEXT_PUBLIC_FEATURE_SWAP_SCREEN`, default **off**. It gates the route (404 while
off) and the wallet modal's Swap action, which stays the inert "coming soon" until it is on.
Independent of `provisioning`, which gates the pre-flight gate embedded in the six operation modals:
they share the rail and are still two separate launch decisions.
