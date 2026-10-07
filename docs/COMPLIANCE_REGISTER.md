# Compliance register

What must be verified before a surface reaches a real user, written down where the code is.

This file arrived in this repository with the fund-contracts strategy builder (epic POO-2119). The
full register is kept in the private repository; only the entries raised by code that lives HERE are
carried over, with their original ids so the two stay comparable. `CR-MGR-014` to `CR-MGR-020` were raised by the
Build canvas (epic POO-2144, slice POO-2158) and continue the numbering; `CR-MGR-021` and `CR-MGR-022` by its
configuration panel (POO-2187). An entry is opened for a claim
printed on screen, money taken or routed, an asset with a legal character, personal data, or anything
that depends on a jurisdiction or on custody. The bar is low on purpose.

Status: `OPEN` (asked, not answered), `BLOCKING` (must be answered before the launch it names),
`ANSWERED` (the answer is in the last column). If a launch checklist disagrees with this file, this
file wins.

## CR-MGR-POO2281, 2026-10-07, local Solana editor scope revision

Answer for the current visual scope: Murilo replaced the unmounted API/cohort proposal with a
frontend-only editor, POO-2281 rules v2. No account list, access administration, credential read,
wallet request or persistence is introduced. All accounts using the existing gated builder route
can reveal the same mode. The gesture is discoverable and is not an access-control promise.
POO-2282 is canceled for this delivery. The original entry described the superseded v1 foundation.

The screen explicitly describes local configuration, discarded on exit/reload; market data and
execution remain Not available. Allocation and SOL/USDC labels are drawing choices. Native cash
identifies native SOL; pool SOL represents WSOL, not native operating cash. Kamino Supply describes
this drawing only, without a claim about a real user's debt, liquidation safety or APY. Principal
and LP-fee routes/automatic bridges explain intended architecture, with no provider, cost, timing,
transaction or settlement guarantee. No fee, real asset routing, custody or tokenized equity is enabled.

Official Solana/Kamino/Jupiter/Raydium/Orca marks identify protocol blocks. Their rights remain with
the owners and attribution implies neither endorsement nor a trademark grant. Source inventory:
[THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) and the
[feature README](../src/features/manager/fund/solana-preview/README.md).

Status: ANSWERED for this local, non-executable visual scope. Existing BLOCKING entries remain
applicable. Real integration must independently verify native/WSOL semantics, market identity,
price provenance, measured costs, signer binding, venue disclosures, settlement and recovery before
activation under POO-2239/2240/2261/2262. This answer does not clear those future operations.
Owner: Murilo / Codex coordinator. Evidence: [POO-2281](https://linear.app/yeildbay/issue/POO-2281),
[delivery plan](solana-preview-preparation-plan-2026-10-07.md),
[ADR 0009](adr/0009-local-solana-visual-preview.md), focused guard/editor tests and code review.
Browser visual verification remains with Murilo; it was not performed in this implementation.

## Verification record: gas-only risk acknowledgement

2026-10-04, POO-2198, PP-CORE-CMP-046: reviewed the existing loss-percentage disclosure before
the gas-only funding route reaches a real user. The displayed quote must retain its explicit risk
acknowledgement, a worsened quote must require fresh consent, and acknowledgement alone must not
start execution. Component regressions verify these conditions, the existing blocked-intent event,
and consent reset when the auxiliary screen is left. This correction uses the existing quote,
10% threshold and disclosure copy; it introduces no fee, venue, asset or personal-data field.
The engineering defect is tracked in POO-2198. This verification does not answer the register's
existing product or legal disclosure questions.

## Manager (fund-contracts builder)

| ID | Question | Why it matters | Raised | Owner | Status | Answer |
|---|---|---|---|---|---|---|
| `CR-MGR-010` | The fund-contracts Mandate builder's Pools step prints, when every token and every pool are selected, the title "This strategy will carry a Broad mandate flag" and the body "Every token and every pool is selected, so the strategy can trade anything its networks offer. Investors see the flag before they deposit." (handoff R13/R37, shipped verbatim in `fundBuilder.pools.broadTitle`/`broadBody`, `src/i18n/messages/*/manager.json`). The second sentence is a promise about what an INVESTOR will see, made to the MANAGER, on a surface the investor side does not have yet. Is that promise true today, and may it ship to a manager before it is? | The investor-facing flag placement (strategy card and detail) is explicitly NOT built: the handoff lists it as a separate, not-started issue (open point 6, "Flag name and its investor placement"), and this builder's own README section names it as not done. So a manager who reads "Investors see the flag before they deposit" and launches a broad-mandate fund today is being told something that is not yet true anywhere in the product. This is the "claim we make on screen" trigger precisely: the words are correct about an intended end state and incorrect about the current one, and nothing on the screen marks the difference. Scoped by the `fundContracts` flag (default off, so no real investor or manager sees this outside dev/preview today), which is why this is `OPEN` rather than `BLOCKING`; it should be revisited before the flag flips on in any environment a real manager reaches. The work that answers this is tracked by POO-2136. | 2026-10-03, POO-2125 / POO-2127, epic POO-2119 | Murilo | `OPEN` | |
| `CR-MGR-011` | The same builder's Limits step (R39/R43) shows a manager a 5%-step slider "Max share of capital" for every selected protocol and every selected token, identical in presentation to the per-network cap that IS enforced on chain. Per the handoff's own R41 (contract fact): "On chain only the per spoke network cap exists (in USDC, checked on send). Per protocol and per token caps have no contract basis yet: the frontend stores and enforces them in Build (allocation slider limits) and shows them on Review; they must not be presented as on-chain guarantees." Does the shipped Limits step draw any visual or textual distinction between the one cap kind the contract enforces and the two kinds that are a frontend-only promise, and if not, must it? | A manager sets a 20% cap on a protocol or a token expecting the fund cannot exceed it, the same expectation the network cap earns honestly. If nothing on screen marks the difference, the manager (and anyone they tell) is trusting an enforcement that does not exist yet past the Build-step allocation slider, which this phase of the builder does not even implement. The handoff calls the gap out in its own rules text but the three cap groups render as one undifferentiated list (`LimitsStep.tsx`, `capRows`); the only mitigating text today is the shared footnote (`CR-MGR-012`, below), which does not single out WHICH caps it is disclaiming. `fundContracts` is off by default, so `OPEN` rather than `BLOCKING`; revisit before Build (which is where the frontend-only enforcement would actually need to exist) ships. The work that answers this is tracked by POO-2134. | 2026-10-03, POO-2126, epic POO-2119 | Murilo | `OPEN` | POO-2197 (2026-10-04, rules v2) treats 100% as No cap and requires USDC plus another positively allowed token. This remains a frontend eligibility rule, without a diversification or on-chain enforcement claim. Existing frozen launch recovery is preserved. |
| `CR-MGR-012` | The Limits step's shared footnote reads "Caps are checked when money moves. Growth from price changes is not forced back." (handoff R42, shipped verbatim in `fundBuilder.limits.footnote`), which is a claim about how the FUND CONTRACTS behave, printed to a manager before any fund exists. Its source is the Mandate v2 contract map attached to the design track POO-2118 ("Map · Mandate v2 and fund creation in the contracts", section 5, Limits and caps): the only on-chain cap is the per-spoke cap in hub USDC, checked on `sendToSpoke` only, never on withdrawals, and value that grows past it by appreciation is not forced back (DEC-031, DEC-037, DEC-095 as cited by that map; the handoff itself cites DEC-018, DEC-030 and DEC-053 only). Per-protocol and per-token caps have NO contract basis (`CR-MGR-011`), so the footnote is true of the spoke cap and merely aspirational for the other two groups. Is the footnote's wording acceptable for a screen that shows all three cap kinds side by side, and does Rafael confirm the spoke-cap semantics against the contracts at the commit the fund builder will ship against? | The footnote is the ONLY thing on screen that tells a manager caps are a point-in-time check rather than a standing ceiling (a cap is "checked when money moves", so a token that grows past its cap organically is not force-sold back under it). That is a specific, falsifiable claim about contract behaviour, and this entry exists because its cited source could not be confirmed with the materials available this session, which is itself the kind of gap the register is for rather than a defect to quietly wave through. Until it is sourced or corrected, treat the footnote as UNVERIFIED rather than confirmed. `fundContracts` is off by default, so `OPEN` rather than `BLOCKING`. The work that answers this is tracked by POO-2134. | 2026-10-03, POO-2126, epic POO-2119 | Murilo | `OPEN` | |
| `CR-MGR-013` | On Robinhood Chain the mandate builder's Tokens step shows the locked deposit-token row as "USDG" / "Global Dollar" (`depositTokenRefFor`, `src/features/manager/fund/mandateDraft.ts`), reading the chain config's real stable (`src/lib/chains/config.ts`, POO-1779 [R1]). The handoff this builder was speced from says the opposite: R18 states "the frontend shows USDC everywhere until this is settled with Rafael" (handoff open point 3), i.e. print the WRONG symbol on purpose until a named person signs off. A later coordinator session overturned that default in code (comment: "Mislabelling an address is a compliance defect, so the row reads the chain's own stable symbol and name... Murilo can overturn this; it is the one place to change") without Rafael's or Murilo's recorded sign-off either way. Which should ship: the handoff's literal instruction (USDC everywhere, pending Rafael), or the coordinator's override (the chain's real stable, USDG)? | Two different people's instructions now disagree on a money-identity label, and the register is where that disagreement needs to be visible rather than resolved by whichever commit lands last. The override's own reasoning holds up (an address is USDG; printing "USDC" beside it is a mislabel, which is squarely the "a claim we make on screen" trigger, worse than the drift it replaced), but it was made by an agent, not by Rafael or Murilo, and the handoff explicitly named Rafael as the one to settle it with. Until one of them confirms it, read this as: the CODE currently prints the believed-correct label (USDG / Global Dollar), the DOCUMENTED default said to print the believed-incorrect one (USDC) pending sign-off, and nobody with the authority to decide has been asked yet, which the register's own rule calls "itself worth seeing." `OPEN`, not `ANSWERED`: an agent's override is not Murilo's or Rafael's answer. The work that answers this is tracked by POO-2134. | 2026-10-03, POO-2121, epic POO-2119 (amends handoff R18) | Murilo | `OPEN` | |
| `CR-MGR-014` | The Build canvas prints a percentage of the strategy's capital on the line above every chain and above every spoke's Bridge: the share label ("60%", and "0%" on an empty block), its tooltip `fundBuilder.canvas.tooltip.share` ("{pct}% of the strategy's capital") and the card's accessible name `fundBuilder.canvas.card.accessibleName` ("{title}, {caption}, on {network}, {pct}% of the capital"), both in `src/i18n/messages/*/manager.json`. It also draws a return line from every chain back to "Idle output" and, with Collect fees, to "Income (fees)", and it lets a plan be drawn in which capital flows down through an Aave Supply into the blocks under it (reference canvas A draws Supply, Swap · auto, pool; through the menus a manager can only place a Borrow or a Swap under a Supply, but a stored plan can hold more). The contracts store no plan: a share is the manager's intent, held in the browser draft; nothing on chain allocates by it (the one on-chain cap, the spoke cap, is stored as intent and not enforced yet, POO-2169); a payout unwinds positions proportionally, with no per-block priority; and an Aave supply is a leaf. Is it acceptable to print these percentages, these return lines and these chains with no qualifier, or must the canvas say that a share is a plan intent, that a return line is a picture and not an exit order, and that nothing is funded through a Supply? | A manager who reads "60%" beside a chain, and a line returning principal and income to Idle output, can take it that the fund will keep that split and unwind in that order. Neither is true on chain. The capital the shares divide is the net first deposit, not the gross one (the handoff's example: a 100 USDC first deposit leaves 99 USDC to deploy), a spoke's chains split what actually arrives after the bridge, prices move the real split, and the handoff itself calls the return lines "a picture of how capital comes back, not a launch action". Under a Supply, handoff v1.3 (Rafael's decision 4) says the supplied USDC is held by Aave and funds nothing under it, several Supply blocks of one asset execute as one Aave position, and a chain that continues under a Supply "can be drawn and saved but cannot be executed as drawn"; the launch adapter of POO-2177 treats every Aave block as a parallel leaf. Nothing on the canvas says any of this: the tooltip repeats the number. This is the "claim we make on screen" trigger, about how capital is split and routed. Scope: the Build canvas is behind the `fundContracts` flag (default off) and the V2 toggle, so no real manager or investor reaches it outside dev or preview today. `OPEN` rather than `BLOCKING`; revisit before the flag flips on where a real manager reaches it. The work that answers this is tracked by POO-2171 (the configuration panel batch edits the shares and can carry the qualifier). | 2026-10-03, POO-2158 (Build canvas S8), epic POO-2144 | Murilo | `OPEN` |  |
| `CR-MGR-015` | The canvas tells a manager that the app moves money through third parties, with no figure: the Swap · auto tooltips `fundBuilder.canvas.tooltip.swapAuto` ("The app swaps {token} into the pool tokens") and `tooltip.swapAutoSupply` ("The app swaps {token} into {asset}"), the manager Swap tooltip `tooltip.swap` ("Swaps into another token of your mandate"), the Bridge · auto tooltip `tooltip.bridgeAuto` ("Moves {token} to {network}"), under the pills `flow.swapAuto` ("Swap · auto"), `flow.swap` ("Swap") and `flow.bridgeAuto` ("Bridge · auto"), and the Add network menu row `menu.networks.option` ("spoke · adds a bridge"). Per the block sheets POO-2162 and POO-2164, a swap becomes a signed Uniswap v3 route with a maximum loss of up to 5% (`maxLossBps` 1 to 500) and a bridge send carries a fee policy of 0.08% falling to 0.03%, plus 3 cents; the provider is never named on the canvas (Mandate R22). The Bridge exists only for a spoke, that is only when Robinhood Chain is in the mandate, which preselects Across and makes it mandatory; a hub-only Arbitrum fund has no Across, no spoke and no Bridge. The canvas prints no fee, no maximum loss, no quote and no timing. Is it acceptable to say that the app swaps and moves money across networks with none of these figures, and is naming no provider acceptable? | This is money we route through a third-party venue. A pill that reads "Swap · auto" or "Bridge · auto" can be taken as free, lossless and instant, while a swap can lose up to 5% of what it swaps, a bridge costs a fee and settles asynchronously (minutes, per the handoff), and neither venue is under Pool Party's control. The API now quotes both (POO-2148, deployed on dev on 2026-10-03: an API-key-only Across quote in either direction, and an unsigned swap quote with `quotedAmountOut` and `priceImpactBps`), but the canvas reads none of them, so no figure reaches the manager. Not naming the bridge provider is a Mandate rule (R22) that this entry asks to confirm, not to assume. Scope: the Build canvas is behind the `fundContracts` flag (default off) and the V2 toggle, so no real manager or investor reaches it outside dev or preview today. `OPEN` rather than `BLOCKING`. The work that answers this is tracked by POO-2148 (quotes) and the sheets POO-2162 and POO-2164. | 2026-10-03, POO-2158 (Build canvas S8), epic POO-2144 | Murilo | `OPEN` |  |
| `CR-MGR-016` | The canvas lets a manager place an Aave v3 Borrow block, on the strength of handoff v1.2 C22, which enables it: the palette row and the Add protocol row (`fundBuilder.canvas.blocks.aaveBorrow.protocol` "Aave v3" over `.type` "Borrow"), the port menu row `menu.port.borrowOption` ("Borrow against this supply"), the port tooltip `tooltip.portAfterSupply` ("Insert a block: Borrow, Swap"), the panel sentence `panel.portMenuOpenSupply` ("Choose what comes after {title}. A Borrow block uses that supply as its collateral."), the disabled row `menu.protocols.borrowDisabled` ("Borrow · add it under a Supply block") and the cards `card.borrowTitle` ("Borrow {symbol}") and `card.emptyBorrow` ("Aave v3 Borrow"). The fund contracts are supply only: the Aave adapter never borrows (DEC-018 and DEC-028, as quoted by the API v2 alpha specification), the API has no borrow action, and no read exists for borrow APY, loan to value, health factor or liquidation price. A plan with a Borrow can be drawn and saved and can never become operations (the launch adapter of POO-2177 refuses it). Should Borrow stay enabled (coordinator default D29), move to coming soon, or be hidden, until a borrow adapter exists? | Offering an action the product cannot perform is a claim on screen ("you can borrow here", and a supply that serves as collateral) that the contracts contradict, and a manager can design a leveraged strategy around it. Handoff C22 enables Borrow (Murilo, 2026-10-03); Rafael's side recommends hiding it and handoff v1.3 open point 12 asks Murilo to choose; until then the coordinator kept it enabled as default D29. Murilo decided on 2026-10-04 that Borrow becomes coming soon, like Pendle and GMX, and that the insert port under a Supply goes away; the code does not do this yet, a later slice (PA0) does, so today the strings above are still on screen. Scope: the Build canvas is behind the `fundContracts` flag (default off) and the V2 toggle, so no real manager or investor reaches it outside dev or preview today. `OPEN` rather than `BLOCKING` for the same reason; promote it to `BLOCKING` before the flag is on for a real manager if Borrow is still enabled then. The work that answers this is tracked by POO-2165 (the block sheet) and made by slice PA0. | 2026-10-03, POO-2158 (Build canvas S8), epic POO-2144 | Murilo | `OPEN` | 2026-10-04, Murilo: Borrow becomes coming soon and the insert port under a Supply goes away. Not in the code yet: set `ANSWERED` when slice PA0 lands. |
| `CR-MGR-017` | The canvas shows three protocols as future: the palette group `fundBuilder.canvas.palette.comingSoon` ("Coming soon") with the rows "Uniswap v3", "Pendle" and "GMX" (`blocks.uniswapV3Pool.protocol`, `blocks.pendle.protocol`, `blocks.gmxPerp.protocol`), each with the tag `palette.soon` ("Soon") and the tooltip `palette.soonTooltip` ("Coming soon"), and three disabled rows at the end of every Add protocol menu through `menu.comingSoonType` ("{type} · coming soon": "Liquidity position · coming soon", "Yield position · coming soon", "Perp position · coming soon"), shown on every network whatever the mandate (default D12). A "coming soon" label is a statement about future availability. Today Uniswap v3 is the swap adapter only (no v3 position adapter exists), there is no Pendle adapter, and GMX left the mandate protocols (POO-2143). Is Pool Party prepared to tell a manager that each of the three is coming, with no date, and who confirms each one is planned? | A "Soon" tag is read as a promise. If a protocol is not on the roadmap, the tag promises something that will not be kept; if it is, the label still describes products (a perp position, a yield position) the contracts do not support. The row "Uniswap v3" names a liquidity POSITION: the required Uniswap v3 swap adapter is a different thing and stays active, and the handoff asks that the swap never look unavailable. When slice PA0 lands (decided 2026-10-04, see `CR-MGR-016`), Aave v3 Borrow becomes a fourth coming-soon item and this entry covers it too. Scope: the Build canvas is behind the `fundContracts` flag (default off) and the V2 toggle, so no real manager or investor reaches it outside dev or preview today. `OPEN` rather than `BLOCKING`. The work that answers this is tracked by POO-2166. | 2026-10-03, POO-2158 (Build canvas S8), epic POO-2144 | Murilo | `OPEN` |  |
| `CR-MGR-018` | A configured pool card prints the pair and the fee tier of its pool: `fundBuilder.canvas.card.poolTitle` ("{token0} / {token1}") and `card.poolCaption` ("{protocol} · {fee}%"), for example "WETH / USDC" over "Uniswap v4 · 0.05%", and the accessible name repeats them. The fee comes from the pool stored in the mandate draft (`MandatePoolRef.feeBps`, written at Mandate time), not from a live read of the pool. Is a fee printed on a card a claim about the live pool, and must the canvas tell a stored value from a live one? | The canvas draws no TVL, APR or price today, and a Mandate cannot be edited after creation, so for a pool already in the Mandate the stored fee is the one the Mandate holds. The risk is a reader taking the card for a live view of the pool. The configuration panel batch (POO-2171) will print TVL and APR, which are live figures (the API's `feesApr` is always null, POO-2160), and each of those is a claim on screen that needs its own entry. The canvas never promises an interface, a fee or a limit: every number on it comes from the draft. Scope: the Build canvas is behind the `fundContracts` flag (default off) and the V2 toggle, so no real manager or investor reaches it outside dev or preview today. `OPEN` rather than `BLOCKING`. The work that answers this is tracked by POO-2160. | 2026-10-03, POO-2158 (Build canvas S8), epic POO-2144 | Murilo | `OPEN` |  |
| `CR-MGR-019` | On the Robinhood Chain spoke the canvas prints the chain's own stable: the Bridge · auto and Swap · auto tooltips read "Moves USDG to Robinhood Chain" and "The app swaps USDG into the pool tokens" (`tooltip.bridgeAuto` and `tooltip.swapAuto`, with `{token}` taken from `networkStableSymbol(network)`, default D7), while the hub's spine cards read "USDC · Arbitrum" (`spine.deposit.caption`, `spine.income.caption`, `spine.withdraw.caption`) and the lock tooltip "Fixed: USDC on Arbitrum" (`spine.lockTooltip`). Capital on Robinhood Chain is USDG, not USDC. Is USDG on the spoke and USDC on the hub the wording to ship? | This is the canvas surface of `CR-MGR-013`: the Mandate handoff's R18 said to show USDC everywhere until settled with Rafael, a coordinator default overturned it in code, and the deployed alpha bridge delivers USDG on Robinhood Chain (the handoff's open point 7, whose wording is still Murilo's). A tooltip that says "Moves USDG" to a manager who deposited USDC reads as a conversion the canvas never explains, and a wrong symbol beside an address is a mislabel. Answer it together with `CR-MGR-013`. Scope: the Build canvas is behind the `fundContracts` flag (default off) and the V2 toggle, so no real manager or investor reaches it outside dev or preview today. `OPEN` rather than `BLOCKING`. The work that answers this is tracked by POO-2134. | 2026-10-03, POO-2158 (Build canvas S8), epic POO-2144 | Murilo | `OPEN` |  |
| `CR-MGR-020` | The canvas draws a Collect fees pill whose tooltip `fundBuilder.canvas.tooltip.collectFees` reads "Claims the pool fees into Income (fees)" (the pill text is `flow.collectFees`, "Collect fees"), and, once a pool chain has one, an "Income (fees)" block (`spine.income.title`, caption `spine.income.caption` "USDC · Arbitrum") fed by a green income line from every Collect fees pill. In the contracts nothing collects at launch: collecting is a later `collect-income` operation per open position, and on a spoke income returns only through a COLLECT order relayed by a keeper whose hub-order relay was wrong when the block sheet was written (gap G-25 of the API specification, tracked by POO-2149). Is a present-tense "Claims the pool fees into Income (fees)" acceptable on a surface that adds no collection step and cannot yet collect reliably on Robinhood Chain? | A manager can read the pill as automatic collection of fees into USDC on the hub, and a Robinhood Chain pool as collectable like an Arbitrum one. The first is a later manual operation per position (the launch journey of POO-2177 adds no collect step), and the second is not demo-safe (block sheet POO-2163). This is the "claim we make on screen" trigger, about how money comes back; collecting on a spoke also moves money across networks (`CR-MGR-015`). Scope: the Build canvas is behind the `fundContracts` flag (default off) and the V2 toggle, so no real manager or investor reaches it outside dev or preview today. `OPEN` rather than `BLOCKING`. The work that answers this is tracked by POO-2163 (the block sheet) and, for the keeper relay, POO-2149. | 2026-10-04, POO-2158 (Build canvas S8, independent review of PR #39), epic POO-2144 | Murilo | `OPEN` |  |


| `CR-MGR-025` | Review cards print manager performance/management fees, instant withdrawal terms, Public access and a protocol flow rate. Verify these disclosures and the 72-hour alternative against the deployed fund contracts before enabling the builder for real users. | POO-2188 uses the existing hook's fee configuration and labels fallback flow rates as estimates. Minimum and instant fee are fixed at launch; identity can be edited and management/performance fees only reduced. The first-deposit preview is integer-based and marked as an estimate, with the receipt as confirmation. The feature remains behind fundContracts and V2. No risk, return or gas figure is invented. | 2026-10-04, POO-2188 (RB1) | Murilo | `OPEN` | Pending deployed-contract disclosure confirmation. POO-2195 adds current-form investor and launch previews; signature counts are estimates, allocations are intent, the existing journey confirms settlement. Murilo performs the browser test. |
| `CR-MGR-021` | The configuration panel prints the mandate's caps as rules: at the Allocation's ceiling `fundBuilder.canvas.panel.allocation.capProtocol` ("Maximum reached. Your mandate caps {protocol} at {pct}%.") and `allocation.capNetwork` ("Maximum reached. Your mandate caps {network} at {pct}%."), and in the (i) of the field `allocation.helpCap` ("Your mandate caps {protocol} at {pct}%."), in `src/i18n/messages/*/manager.json`. Per handoff R41 and `CR-MGR-011`, per protocol and per token caps have no contract basis (they are frontend aids enforced only by this slider), and the one on-chain cap, the spoke cap, is stored as intent and not enforced in the alpha (POO-2169). May a sentence that reads like an enforced rule ship, or must it say these are the manager's own allocation targets (Rafael's suggested wording, handoff open point 17)? | A manager who reads "Your mandate caps Uniswap v4 at 70%" can take it as a guarantee the fund enforces, while nothing on chain does, and the slider is the only place that holds it. This is the "claim we make on screen" trigger. The copy is the approved handoff wording; the alternative is open point 17, Murilo's call. Scope: behind the `fundContracts` flag (default off) and the V2 toggle, so no real manager reaches it outside dev or preview. `OPEN` rather than `BLOCKING`. The work that answers this is tracked by POO-2171. | 2026-10-04, POO-2187 (panel shell, review L8 of PR #54), epic POO-2171 | Murilo | `OPEN` |  |
| `CR-MGR-022` | The Max slippage field's (i) reads `fundBuilder.canvas.panel.slippage.help` ("Cancels the transaction if the price moves more than this before it confirms."), and the field writes a `slippagePct` of 0.1 to 5 into a pool block (and into a Supply that needs a swap), with "5% is the maximum." when a typed value is brought down (decision D-D). Per the handoff's table "What the deployed alpha and the v2 API change", the 5% bound is the API's policy for signed swap routes (`maxLossBps` 1 to 500), and a Uniswap v4 open takes no slippage number at all, only a minimum per token derived from the amounts. Is a sentence that promises a cancellation accurate for both the Swap · auto and the position open the field covers? | The sentence describes one mechanism (a swap that reverts past a price move) while the field also covers a mint whose protection works differently, so a manager may read a guarantee the open does not give in the same form. This is the "claim we make on screen" trigger, about money we route. Scope: behind the `fundContracts` flag (default off) and the V2 toggle. `OPEN` rather than `BLOCKING`. The work that answers this is tracked by POO-2171 (the pool panel, PE, uses the field). | 2026-10-04, POO-2187 (panel shell, review L8 of PR #54), epic POO-2171 | Murilo | `OPEN` |  |

| `CR-MGR-023` | The Uniswap v4 panel prints an estimated token value split and states that an out-of-range position earns no fees until the price enters its range (`PriceRangeField`, `RangeSplitBar`, POO-2189). Confirm this copy describes the configured hookless v4 pool and make clear that the split is an estimate before routing real capital. | A position and fee claim about money routed to a third-party pool. Uses the pool's live price and standard concentrated-liquidity value formula, never TVL/APR placeholders. Behind `fundContracts` and the V2 toggle; launch disclosures and the slippage promise remain tracked in CR-MGR-022. | 2026-10-04, POO-2189, PE panel session | Murilo | `OPEN` | |
| `CR-MGR-024` | May Supply APY be shown without a timestamp or variable-rate explanation before public launch? | `SupplyBlockPanel` displays the catalog reserve APY snapshot. Aave rates vary and the catalog is loaded by the shell without periodic reserve refresh. This is not a promised return. The current feature remains gated; this entry concerns public exposure. | 2026-10-04, POO-2194 | Murilo | `OPEN` | Source: GET /api/v2/catalog/aave-v3/reserves via usePanelReserves; no invented APY or new polling policy. |

## Verification record: Mandate protocol availability

2026-10-04, POO-2167 v4, PP-MGR-CMP-036: the Mandate Protocols step now labels GMX and Pendle
Coming soon alongside Uniswap v3 positions. This extends the existing future-availability claim in
CR-MGR-017 to Mandate. Murilo explicitly requested these disabled rows; that UI authorization does
not answer the existing roadmap/disclosure question. Verify that the three planned protocol labels
are acceptable before exposing the builder to real users. Regressions verify disabled intent,
Select all exclusion, saved-draft sanitization and the real serializer's refusal. The removed APY
paragraph used the same Aave reserve snapshot as SupplyBlockPanel; CR-MGR-024 remains open there.

## Verification record: configuration actions visibility

2026-10-04, POO-2202, PP-MGR-CMP-045: the layout now reserves the full height of a long configuration panel above Back/Next. Existing allocation/range disclosures, Apply/Discard consent and blocked-leave rules are unchanged. The fix adds no fees, routes, assets, credentials or claims. Existing compliance questions remain open; this is an engineering visibility correction.

## Verification record: continuous launch prompts

2026-10-04, POO-2203, PP-MGR-HOK-019 and PP-MGR-CMP-081: explicit Sign now continues sequential wallet prompts after prerequisites settle. Verify each wallet still presents the actual transaction/message, Pause stops future prompts, and rejection or uncertain broadcasts never authorize replay. Existing driver validation, wallet/chain checks, journal reconciliation and settlement-only completion analytics are retained. Regression tests cover these transitions with mocks; no live transaction or browser signing test was performed. The change does not add venues, fees, custody or return claims and does not resolve the existing launch disclosure entries.

## Verification record: pools with deferred allocation

2026-10-04, POO-2204, PP-MGR-CMP-069: zero allocation preserves the pool's immutable permission without opening a position or routing funds to it at launch. Range estimates are hidden until the manager allocates capital; positive allocations still require current eligibility and range checks. Verify that later management offers the operation when capital is allocated. This fix makes no claim that a position already exists or earns yield at 0%. Existing venue/range disclosures and custody questions remain open. A wholly idle launch retains its previous restriction pending Murilo's decision.

### CR-MGR-POO2209, 2026-10-04, local Follow demonstration

Status: RESOLVED. V2 Follow/Following is local UI state scoped to one viewed manager during the mounted session. No personal data is transmitted or persisted, no follower count or backend relationship is claimed, and no wallet operation occurs. Reassess before real social-follow wiring ships.


## Verification record: automatic fee block and confirmed removal

2026-10-04, POO-2210, PP-MGR-LIB-021 / PP-MGR-SCR-002: applying a newly selected pool includes the existing Collect fees step. This changes the draft composition, not fee rates, collection permissions or transaction consent. Verify that managers can see and remove the step before launch. Every user-block and empty-spoke removal now asks in a modal and names the real allocation/cascade effect; cancel preserves the plan. Unrelated panel drafts survive removal. No new asset, venue, custody or return claim is introduced. Existing fee/routing disclosures remain applicable and unresolved entries are unchanged.

### CR-MGR-POO2212, 2026-10-04, launch modal presentation

Status: RESOLVED. This changes signing presentation only. Fund identity and progress reflect the existing journal; progress advances only for confirmed checkpoints, and completed remains settlement-driven. No fee, asset, custody, signing payload or backend behavior changes. Closing pauses future prompts, with no claim of cancelling an already submitted transaction.

### CR-MGR-POO2213, 2026-10-04, derived income conversion diagram

Status: RESOLVED for visual scope. The automatic fee-swap pill describes the intended income path to the network stable; it is not a submitted swap, quote or execution guarantee. No persisted plan step, transaction payload, fee or supported asset changes. Real income-conversion wiring requires its own backend/contract validation before claiming execution.

## Investor V2 verification, 2026-10-04

POO-2214/2217: current principal value, historical invested cost and income entitlement must remain distinct. Unknown balances and metrics display Not available; no zero or mock price/fee claim is introduced. The V2 Invest capability is unavailable until POO-2219 supplies an investor-safe review/guard/receipt contract. No V2 signing or provisioning starts from the unavailable host. Raw6 minimum comparisons use integer base units. The return context is account-bound and fills an amount only. These are engineering verification conditions for this slice, not a claim that existing disclosure/legal entries are resolved.

POO-2215/2216 verification: V2 current principal is displayed separately from absent cost basis and yield. Income entitlement does not claim immediate liquidity; pending payout means processing before payment. Missing discovery coverage does not produce wallet totals. Unknown allocation is not normalized to 100%, and missing mandate permissions are never treated as wildcard. The investor surface does not mount technical signing controls. These conditions are covered by targeted projection/component tests; API execution enablement and pending-income tuple semantics remain POO-2219.

## Investor mobile verification, 2026-10-04

POO-2220/2221: responsive presentation must preserve the exact underlying amount and manager identity, with no new balance, income, fee or settlement claim. Existing amount/Max tests protect precision; source review verifies wrapping and width constraints without changing calculation, routing or custody. Closed-only history stays accessible, and genuinely empty history is distinguished from unavailable/unloaded data. No new fee, asset, venue or personal-data use is introduced. Existing disclosure entries and POO-2219 execution restrictions remain applicable; this note does not resolve them.

## Investor composition and local Follow verification, 2026-10-04

POO-2223: the donut visualizes supplied NAV weights without renormalizing incomplete coverage. The remainder is labelled not detailed, never cash or idle assets. Missing, negative, duplicate-identity or over-100 coverage produces no chart. History has no fabricated price series. Verify position valuation meaning and data completeness before extending these semantics. Follow is an owner-approved local UI toggle with no persistence, transmission, count, notification or wallet action; no social relationship or backend completion is recorded. Existing financial disclosures and POO-2219 remain applicable.

POO-2224 verification: public balance visibility does not establish ownership of fund shares or authorize a transaction. Reads use the connected account; stale session/account and late response guards prevent showing a previous wallet. ETH/WETH valuation is not guessed and is never added to the USDC balance. Existing custody and transaction disclosures remain unchanged.

## Manager Manage V2 verification, 2026-10-04

POO-2226/2227/2228: verify the distinction between current principal holdings, free idle, withdrawal reserve, uncollected fees and actual hub Income. This slice displays served quantities and independent USD values, keeps missing data unavailable and does not infer on-chain enforcement from API/UI caps. Collect fees -> Swap auto -> Income is a descriptive graph, not an execution receipt or guaranteed conversion. Existing venue, fee, custody and jurisdiction disclosures remain applicable.

Execution gate: Move confirmation stays disabled until POO-2229 provides reviewed principal provenance, fees/impact and partial-execution continuation. Allocation and future-deposit save stay disabled under POO-2231. No new money routing, signing, wallet funding or persisted policy is performed. Enabling those actions requires their preview/disclosure and recovery verification; this record resolves no existing blocking legal/disclosure item. Cash/queue/Income sources remain POO-2230.

POO-2232 verification: In range / Out of range is a claim about the current open position in the served snapshot, not a yield, solvency or withdrawal guarantee. Verify canonical API status semantics before changing the read source. Tests cover true/false/unavailable/closed inputs and isolation from draft edits. The fixed center marker and full track do not encode allocation, token composition, price or percentage; they are decorative and expose no numeric accessibility value. This visual change adds no execution or new disclosure claim. Existing blocking items and venue disclosures remain in force.

## Launch report estimate, 2026-10-04 (POO-2233)

Verification: the visible 19-minute Wormhole countdown must read as an estimate, never a settlement promise or transaction deadline. Status: RESOLVED for this presentation scope. All 11 locales explicitly call it estimated time remaining; expiry shows that the report is taking longer and keeps waiting. Only the accepted report can advance execution. No fees, amounts or routing change, and no per-second analytics are emitted.

Local timing metadata contains the normalized manager address in its browser storage key plus draft/report identifiers and a timestamp. It stays on the device, separate from the existing execution journal; this feature does not send it to analytics or a new endpoint. Clearing browser data removes it. In-memory fallback cannot persist across a full reload when browser storage is unavailable.

## Build canvas and manual Swap configuration, 2026-10-05

POO-2235/2236/2237: fixed locks describe structural canvas roles, not capital safety or guaranteed withdrawals. Green traces fee flow into Income only; neutral outgoing paths do not assert settlement. Swap token selection and spoke percentages are local draft configuration, not quotes, approved routes, current holdings or transaction receipts. Existing venue/custody disclosures remain applicable.

Verification: RESOLVED for this editor-only scope. Independent review identified and corrected a pool-chain bypass that could ignore a manual token pair. Review and launch compilation now refuse manual swaps. POO-2238 must establish amount provenance, price/impact/fees, authorization and recovery before enabling execution. Analytics receives bounded field/kind names only, never token addresses, amounts or wallet data.

## Sidebar destination restoration, 2026-10-05 (POO-2241)

Verification: RESOLVED for navigation scope. Cash+ and Tools reuse their existing feature flags, guarded routes and labels. The links introduce no return/security claim, fee, wallet request or new data collection. Existing destination-specific disclosures and launch conditions remain applicable.

## Manager Manage delta, 2026-10-06 (POO-2246 v2)

Verification: RESOLVED for this read/editor scope. Operating cash displays native assets only; stable metadata requires chain/address identity. Missing quantity/metadata remains Not available and existing served holdings are preserved. Preparation timeout does not assert transaction failure or success, and no new fee, custody action or route is enabled. Authoritative cash, queue and hub Income disclosure remains POO-2230; Move/Future financial reviews remain POO-2229/2231 before execution can launch.

## Manager Overview V2, 2026-10-06 (POO-2245 v1)

Verification: RESOLVED for the supported read/navigation scope. Real-mode AUM, ready-strategy counts and history remain Not available until POO-2247 defines financial meaning and coverage. Open lifecycle and a completed browser journal do not certify investment readiness. The illustrative curve/values live in explicit mock/demo fixtures, with no real-mode fallback or return claim. Existing public manager profile editing reuses its signing and personal-data controls. Device-local drafts are labelled as such and are not assigned wallet ownership; corruption is reported without overwriting stored data. No new custody, fee or transaction capability is enabled.

## Investor V2 deposit continuation, 2026-10-06 (POO-2248 v1)

Verification: RESOLVED for these engineering disclosure boundaries. The UI separately shows shares, USDC charged, flow fee, refund and share price from the complete API simulation. Approval is capped to the selected budget. Confirmation protects at least the reviewed share quantity. Gas is disclosed as a separate ETH payment shown by the wallet; the frontend does not invent a gas estimate or call simulation output a settled receipt. Funding/approval completion does not mean capital was invested.

The existing fund/protocol/custody disclosures and any existing launch blockers continue to apply. The local recovery journal contains wallet/core addresses, requested budget and transaction evidence only on the device. It is not an analytics payload. Pending/unknown submissions remain locked until verified; loss of browser storage loses this device-local recovery evidence. Separate tabs do not have an atomic distributed submission lock. No public-audit or safety guarantee is added.

## Repository license transition, 2026-10-07 (POO-2268 v2)

Status: OPEN for legal/provenance verification. Murilo expressly authorized
merging the completed frontend distribution policy on October 7, 2026.
That owner approval is recorded as delivery authorization, not evidence that
the rights-verification questions below have been answered. Existing MIT grants
and documented use of the unchanged official platform remain effective.

The owner requested a current-and-future first-party source-available policy
covering all authored frontend/tool material. Before asserting exclusive rights
or granting separate commercial sublicenses, confirm the contracting
entity/signatory, contributor copyright assignments or
sufficient grants, the new explicit contribution permission, actual current
grant/hackathon/audit commitments, and upstream compatibility. Hookrisk detector
AGPL, font/upstream notices and copied protocol content keep their own rights.
Framework-prose permission and harness combined-work obligations require review.

Valid previous MIT/AGPL grants cannot be revoked. No product fee, custody,
transaction behavior, personal-data use or deployed artifact changes in this PR.
The complete scope, history and review questions are in [LICENSING.md](../LICENSING.md)
and [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md). Owner: Murilo / authorized
legal representative. Evidence: [POO-2268](https://linear.app/yeildbay/issue/POO-2268).

## CR-MGR-POO2270, 2026-10-07, canvas and inline-panel plan

Scope: documentation/planning only, [POO-2270](https://linear.app/yeildbay/issue/POO-2270)..[POO-2279](https://linear.app/yeildbay/issue/POO-2279). Existing CR-MGR-015/019/020 and venue/custody disclosures remain applicable; no existing blocking item is resolved. See [delivery plan](manager-canvas-panels-plan-2026-10-07.md).

Verification pending before runtime enablement:

- Principal and fee Bridges describe separate routes; auto does not assert execution, provider, ETA, token conversion, atomicity or hub settlement. USDG must not be relabelled USDC. Fixed locks describe structural roles rather than asset safety or withdrawal guarantees.
- Today/tomorrow/day-after deadlines, reservation coverage, eligibility and timezone must come from the authoritative queue. These labels cannot become an unsupported payout-time promise. POO-2230 must define their financial meaning, complete coverage and freshness before real values are shown; missing/partial data stays explicit.
- Collect token amounts are uncollected fees of the selected position, not principal or settled hub Income. Manual execution requires validated preview/costs/capability and origin recovery under POO-2277/2278. Origin collection and hub settlement are separate completion scopes. No financial completion event fires on click, broadcast or an unrelated receipt.
- Native physical balances, aggregate hub Income and financial chart metrics require provenance/units/freshness. Figma amounts stay in explicit story fixtures. Functional Charts/Activity waits for POO-2279 definitions, including incomplete history and financial event labels.

Status: OPEN for these future product disclosures and financial integration meanings. The planning-only PR enables no wallet operation and introduces no new financial claim on screen. Each implementation slice records its evidence and remaining launch conditions here before exposure.

### CR-MGR-POO2270 revision v2, October7, per-area Manager plan

Status: OPEN; no prior launch blocker is resolved. The latest plan replaces two visible outbound Bridges with one shared node and separately typed Principal/Income ports. Diagram convergence is not ledger convergence, conversion, atomicity or settlement. Native cash quantity and independent USD estimate require their own sources; USDG and native SOL identities must not be relabelled USDC/WSOL.

Lending Current/After requires account/obligation debt, collateral/oracle and scenario provenance. Confirmed no debt is not inferred from a Supply-only diagram. Charts Market reference attribution and data/renderer license must be verified before integrated charts expose a claim; annotations cannot change financial settings. Entry/Exit fees remain unavailable until their base/currency/timing/recipient/conditions and authoritative source are defined, separately from existing manager/protocol charges.

The owner-approved Solana local editor is a client preview, not server authorization or proof of deployed programs/custody/execution. Asset legal character, venue terms and transaction disclosure remain verified per real integration. Isolated optional Jev development tooling sends bounded model state remotely; metadata-only logs are not content redaction. It adds no product personal-data flow or financial capability, and current credentials/conversation material must not enter public docs/Slack. Evidence and delivery gates: [plan v2](manager-canvas-panels-plan-2026-10-07.md), POO-2288/2289/2290/2291 and existing POO-2229/2230/2231/2277/2278/2279.

## Manager range readability, 2026-10-07 (POO-2284 v1)

Verification: RESOLVED for this editor/display correction. Complete readable bound values and locale-safe decimals do not change the meaning of a reviewed range, create a price source or bypass canonical tick validation. The marker represents current price within the draft's displayed price interval; token percentages are estimated liquidity value shares, not live holdings, guaranteed execution amounts or returns. Authoritative current-position range status remains separate. Existing inclusive boundary and Full 50/50 display conventions are retained.

Full is recovered only from verified position ticks matching the actual pool's aligned usable extremes. Inline Move/Create capability gates, preview and recovery controls remain in force; this correction enables no transaction or public-audit claim. Existing financial/custody disclosures and launch blockers remain open under POO-2229/2230/2231 and CR-MGR-POO2270. Source evidence: [POO-2284](https://linear.app/yeildbay/issue/POO-2284), `PriceRangeField`, `RangeSplitBar`, `ManageBlockPanel` and focused tick/draft regressions. Browser acceptance remains with Murilo.
## Build native scrollbar correction, 2026-10-07 (POO-2287 v1)

Verification: RESOLVED for this visual scope. Native dark controls and scoped scrollbar
styling preserve scrolling, panel action access, zoom and existing screen emitters;
forced-colors mode yields to system rendering. No fee, routing, custody, asset,
financial claim, personal-data collection or signing behavior changes. Existing
financial launch conditions remain in force. Focused component contracts and interaction
tests pass; native scrollbar painting in the affected browsers remains Murilo's
acceptance check, without any inference about transaction availability or settlement.

## CR-MGR-POO2289, 2026-10-07, Review Entry/Exit transaction fee information

Status: ANSWERED for the read-only unavailable-information scope. POO-2289 rules v1 introduces two labels with Not available and the shared helper Fee details are unavailable. No amount, rate, beneficiary or charging trigger is claimed; existing manager fees, protocol flow fee and instant withdrawal fee remain separate. The rows cannot edit the draft or authorize a fee, and existing launch validation/provisioning is preserved. Focused tests verify order, keyboard help, plain text values and preserved manager-fee editing. Browser reflow acceptance remains with Murilo.

Status: BLOCKING before Entry/Exit values or charges are enabled. Confirm beneficiary, triggering operation, calculation base, gross/net treatment, caps/minima, currency, rounding, fee source/freshness, jurisdiction and required investor disclosure. These answers must come from the authoritative fee contract; an unavailable row is not zero or an approval of an existing charge. This entry clears no existing fee/custody/launch blocker. Owner: Murilo / product and legal owner. Evidence: [POO-2289](https://linear.app/yeildbay/issue/POO-2289), [Figma 8670:2855](https://www.figma.com/design/jjOf5DL9uVEB7WBR9nGb4A?node-id=8670-2855), PP-MGR-CMP-090 and PP-MGR-CMP-077.

## Manager semantic graph foundation, 2026-10-07 (POO-2288 v1)

Verification: RESOLVED for the internal contract slice. PP-MGR-LIB-062 adds typed
financial endpoints and deterministic route-integrity checks without creating a transfer,
changing existing canvas topology, exposing a new financial claim or enabling signing.
Focused tests cover class/origin separation, same-chain Bridge rejection, explicit
junction ownership, conversion continuity and stable edge/hover identities.

Status: OPEN for future product adoption under POO-2270/2271/2273. Before these routes
reach real users, verify that served principal, fee, repayment, Holding and native-cash
meanings match the displayed flow and actual origin/network. A valid declared graph is not
evidence of executable capability, a provider/ETA, atomic conversion or hub settlement.
The 48 Figma references are geometric evidence only. Existing CR-MGR-015/019/020,
CR-MGR-POO2270 and the POO-2229/2230/2231 launch conditions remain applicable; this
slice resolves none of those financial or custody questions.

## Solana local catalog, October 7, 2026 (POO-2291 S1)

Status: ANSWERED for this pure local-contract slice. The existing gesture/local-draft notice and unavailable market/execution state remain. USDC and WSOL are identity metadata; no rate, balance, venue outcome, custody or deployment is claimed. Declared source metadata is not verification or attestation. No new personal-data collection, credential flow or transaction occurs.

Existing real-launch gates remain: confirm canonical programs/accounts/owners, asset and venue disclosures, price/source freshness, quote validity, custody/authority, fees and transaction details before enabling discovery or execution. This slice clears none of those gates. Evidence: [POO-2291](https://linear.app/yeildbay/issue/POO-2291), PP-MGR-LIB-063/064 and the [current delivery plan](manager-canvas-panels-plan-2026-10-07.md).

## Manage inline header, October 7, 2026 (POO-2272 v2)

Status: ANSWERED for this presentation slice. The selected canonical protocol/network identity and existing Supply/Liquidity subtype are kept together. Trusted existing marks are reused, complete text wraps and no financial amount, venue support, rate, fee or custody permission is added. Optional pair context remains owned by the operation host. The existing financial, custody and execution gates remain unchanged. PP-MGR-CMP-091 adds no credential, personal-data or transaction flow. Header/panel tests and TypeScript pass; rendered narrow-width acceptance remains with Murilo.

## CR-MGR-POO2270-ROUTES, 2026-10-07

Scope: supported Manage graph/card presentation and route hover, POO-2270/2271 v2. Verify before financial enablement that actual Principal/Income origins and network transitions match displayed routes. A visual Collect/Swap/Bridge path does not prove conversion, atomicity or hub credit. Physical native quantity and independent USD valuation stay distinct; unavailable quantity must not carry an available USD label, and no reserve/Income value is guessed.

Answer in this slice: explicit typed ports, measured final rectangles, no invented capability/read, and native/USD guard are implemented and covered by focused regression tests. Current authoritative integration/disclosure entries remain OPEN; no blocking item is resolved by geometry or hover. No signing or deployment is added.

## Manage Hub identity and fixed marks, October 7, 2026 (POO-2272 v2)

Status: ANSWERED for presentation only. Hub identity comes from the existing authorized model chain, not a new network/provider claim. Locks communicate structural role and do not authorize an operation or prohibit inspection. Network watermarks use the chain name only; no external artwork, financial claim, tracking or credential flow is added. Current financial, custody and venue disclosure entries remain OPEN and no launch gate is cleared. Browser hit-testing/reflow acceptance remains with Murilo.

## Manage hidden editor retention, October 7, 2026 (POO-2274 v2)

Status: ANSWERED for navigation and read preparation only. Hiding an editor does not cancel an owned intent or transfer its authority. Retained display data cannot authorize a stale operation. Core/position changes and material read/snapshot changes invalidate review. Existing financial execution and recovery gates remain OPEN; this slice adds no signing, custody action or pending transaction journal.

## Collect position fees disclosure, October 7, 2026 (POO-2276 v1)

Status: ANSWERED for the read presenter only. Ordered uncollected position fees are distinct from principal balances, realized hub Income and available USD value. Missing metadata/freshness cannot authorize manual collection; stale copy requires actual stale evidence. A cross-chain route description does not claim current conversion/atomicity or hub credit. All Collect preview/execution/settlement disclosures remain OPEN under POO-2277/2278. No signing or money movement is added.


## Idle output read presenter, October 7, 2026 (POO-2275 v1)

Status: ANSWERED for the injected read-only presenter. Queue dates, deadline timezone, snapshot freshness, requested/reserved/still-needed cohorts and complete-empty confirmation are supplied rather than inferred from browser time or payoutReserve. Coverage is a same-cohort display ratio, not reserve allocation or eligibility. No USD total, cutoff, withdrawal guarantee, signing or payout action is introduced. Unknown/stale reads hide their quantities. Test fixtures remain outside real data paths.

Status: OPEN before production queue enablement under POO-2230. Confirm eligible-cohort inclusion, cancellation/partial-payment/in-flight treatment, authoritative deadlines and timezone, assigned reserves, completeness, snapshot freshness and required withdrawal disclosures. The presenter clears no financial/custody blocker; host focus/Back and native-browser rendering remain separate acceptance.

## Build financial route disclosure, October 7, 2026 (POO-2273 v2)

Status: ANSWERED for the pure layout/rendering slice. Principal and position fees use separate origin/class ports, required existing manual conversion remains visible, and sharing one Bridge card does not represent a token/cohort merge, atomic conversion, transit receipt or hub settlement. Figma-only debt/Pendle/reference networks enable no protocol permission or transaction. No new monetary amount, fee, credential flow or custody action is introduced. Full-route hover is diagram navigation only.

Status: OPEN for broader Build capability adoption. Operating cash requires its own native quantity/valuation source; token/cohort compatibility and explicit repayment/withdrawal sequence require a supported plan/executor contract. Current POO-2229/2230/2231 and CR-MGR financial/venue disclosures remain in force. Unit geometry and semantic validators are not mainnet settlement or48runtime acceptance evidence.

## Manage all-node inspectors, October 7, 2026 (POO-2274 v2)

Status: ANSWERED for read/navigation presentation. Actual block, network and canonical origin identity determine inspection. Available normalized hub Idle may be shown; absent cash/Income/global queue and unknown fee freshness remain explicit. No new personal-data identifier is emitted: selection analytics carries bounded node family and numeric chain only. Back/Retry/selection preserve draft ownership without signing or authorizing a money movement.

Existing financial/custody/source/freshness/disclosure gates remain OPEN under POO-2230/2277/2278/2229/2231. Neither read success nor a visual route proves fee conversion, reserve assignment, account risk or hub settlement. This slice clears no execution or pending-recovery gate. Native browser acceptance remains with Murilo.


## Full-account lending risk disclosures, October 7, 2026 (POO-2290 v1)

Status: ANSWERED for source-preserving read-only presentation. No protocol safety guarantee or financial advice is asserted. Missing full-account identity remains unavailable. No debt requires a complete fresh confirmed zero, not a Supply row. Health factor and estimated liquidation price retain declared scenario, units, assets, method, assumptions and oracle evidence; positive price is scenario-specific. Fixture evidence is visibly labeled and never fills a production source.

Status: OPEN before live account risk enablement. Confirm adapter-derived effective Aave eMode/isolation and Kamino elevation-group parameters, accrued debt, fresh oracle rules, Current/After hypothesis consistency, scenario validity/expiry and venue disclosures. Current financial/custody gates remain. The local Kamino host has no account read; it does not authorize Borrow or Multiply.

## Solana LP range presentation, October 8, 2026 (POO-2291 S3/S4)

Status: ANSWERED for local read/draft presentation. Current position and edited range remain separate; neither In range nor a protocol grid implies a yield or safety guarantee. Complete prices preserve precision, mint orientation and provenance. Unknown/stale/liquidity-zero states remain distinct, and a missing liquidity quote supplies no composition. The production host receives no sample pool, price or ticks. The pinned Orca/Raydium math ports preserve upstream Apache-2.0 notices and their independent licensing boundary.

Status: OPEN before live protocol or execution enablement under POO-2240/2261/2262. Verify deployed programs, pool/mint/token-program restrictions, transfer fees/extensions, position authority, actual adapter capabilities, fresh quotes and operation-specific min/max/fees disclosures. Tick math or a local Apply action clears no custody, venue or signing gate.
