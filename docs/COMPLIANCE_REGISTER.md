# Compliance register

What must be verified before a surface reaches a real user, written down where the code is.

This file arrived in this repository with the fund-contracts strategy builder (epic POO-2119). The
full register is kept in the private repository; only the entries raised by code that lives HERE are
carried over, with their original ids so the two stay comparable. An entry is opened for a claim
printed on screen, money taken or routed, an asset with a legal character, personal data, or anything
that depends on a jurisdiction or on custody. The bar is low on purpose.

Status: `OPEN` (asked, not answered), `BLOCKING` (must be answered before the launch it names),
`ANSWERED` (the answer is in the last column). If a launch checklist disagrees with this file, this
file wins.

## Manager (fund-contracts builder)

| ID | Question | Why it matters | Raised | Owner | Status | Answer |
|---|---|---|---|---|---|---|
| `CR-MGR-013` | On Robinhood Chain the mandate builder's Tokens step shows the locked deposit-token row as "USDG" / "Global Dollar" (`depositTokenRefFor`, `src/features/manager/fund/mandateDraft.ts`), reading the chain config's real stable (`src/lib/chains/config.ts`, POO-1779 [R1]). The handoff this builder was speced from says the opposite: R18 states "the frontend shows USDC everywhere until this is settled with Rafael" (handoff open point 3), i.e. print the WRONG symbol on purpose until a named person signs off. A later coordinator session overturned that default in code (comment: "Mislabelling an address is a compliance defect, so the row reads the chain's own stable symbol and name... Murilo can overturn this; it is the one place to change") without Rafael's or Murilo's recorded sign-off either way. Which should ship: the handoff's literal instruction (USDC everywhere, pending Rafael), or the coordinator's override (the chain's real stable, USDG)? | Two different people's instructions now disagree on a money-identity label, and the register is where that disagreement needs to be visible rather than resolved by whichever commit lands last. The override's own reasoning holds up (an address is USDG; printing "USDC" beside it is a mislabel, which is squarely the "a claim we make on screen" trigger, worse than the drift it replaced), but it was made by an agent, not by Rafael or Murilo, and the handoff explicitly named Rafael as the one to settle it with. Until one of them confirms it, read this as: the CODE currently prints the believed-correct label (USDG / Global Dollar), the DOCUMENTED default said to print the believed-incorrect one (USDC) pending sign-off, and nobody with the authority to decide has been asked yet, which the register's own rule calls "itself worth seeing." `OPEN`, not `ANSWERED`: an agent's override is not Murilo's or Rafael's answer. The work that answers this is tracked by POO-2134. | 2026-10-03, POO-2121, epic POO-2119 (amends handoff R18) | Murilo | `OPEN` | |
