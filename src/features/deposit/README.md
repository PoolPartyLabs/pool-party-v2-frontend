# Deposit (`/deposit`)

`PP-DEP-SCR-001` · the standalone add-funds surface. One responsive wizard (a client state machine),
not separate routes, so the entered amount and method never get lost between steps.

Two paths:

- **Fiat.** Two rails behind one path, chosen by `useOnRampProvider()` (`PP-CORE-HOK-034`). This is
  where money enters the product; see the section below.
- **Crypto (receive USDC).** address + QR for a chosen network. Terminal at receive on the standalone
  path (POO-604: no on-chain watcher in production); the manual "I've sent the funds" confirm shows
  only under a Deposit & invest context, as the resume trigger.

## Two fiat rails, one screen (POO-1807, rules v1)

`useOnRampProvider()` decides which runs, so a Dev-menu override moves this screen and
`ProvisioningPanel` together. BOTH `realRail` (is fiat offered at all) and `privyRail` come from
that one read, so an override cannot move one while the other still answers for the flag's env
value. Mock mode is checked FIRST on both and keeps its fixture path.

The vendor environment is DERIVED, at the probe and at the checkout alike:
`resolveOnRampEnvironment()` (`PP-CORE-LIB-105`), never a literal. Privy honours the field
(`stripe` vs `stripe-sandbox` in its shipped bundle), so a hardcoded `production` would have
charged real cards from a dev build.

| Rail | Steps | Where the charge is priced |
|---|---|---|
| **`paybis`** (today) | amount -> payment-method dialog (the provider's LIVE list) -> **review** -> `onramp` -> settling/success | Our review step. That is `review`'s whole reason to exist |
| **`privy`** (POO-1793) | amount -> `onramp` -> `onramp-settling` -> `success`, with `onramp-error`, `onramp-uncovered`, `onramp-currency-unsupported` and `onramp-unverified` as the other exits. **No payment-method surface on the amount step at all** (POO-1904 [R1]): not the inline panel, and the dialog is not mounted | Inside the provider's own modal, so **`review` does not run at all** |
| **`none`** | amount -> `onramp-disabled` (POO-1794) | nothing is launched |

The Paybis path is unchanged, byte for byte, and its five suites run against it untouched.

### Why the amount step does work before the buyer clicks

Both of these MUST be resolved before the click, and neither is a preference:

- **The baseline balance** (`[R6]`). One `balanceOf` on Base, read while the amount step is live and
  kept in state. Read after the click it would be a post-purchase figure, and the delta measured
  against it would be wrong. A failed read is said out loud and shuts the confirm; it is never a
  zero, because a zero baseline reports the buyer's whole balance as the delivery.
- **The coverage answer** (`[R7]`). Debounced on the amount at the RAIL's own 750 ms (its fiat
  screen wraps its quotes fetch in the same debounce), not awaited in the handler. The probe
  hook dedupes rather than debounces, deliberately: holding a keystroke belongs to whoever owns
  the input. `amount-too-low` is a distinct answer and is NOT `uncovered`: it is the rail's own
  display floor, below our `MIN_DEPOSIT`, so it is unreachable from here and never renders as
  "nobody will sell to you".

The reason for both is the same one line in POO-1803: `openCheckout` has to be reached inside the
click's own synchronous turn, or the browser blocks the provider's popup and the buyer sees nothing.
Anything awaited in that handler costs them the checkout. So the handler awaits nothing.

### The prefill amount is USD only, and the CURRENCY never defaults (`[R8]`)

`fiat.defaultAsset` is always the buyer's own currency, and it is never guessed. If `toPrivyFiat`
cannot answer, because the rail does not sell in that currency or because the server chain that
resolves one (`PP-CORE-LIB-096`) did not answer at all, the confirm REFUSES: it counts
`tx_amount_blocked{block_reason:"onramp_currency_unsupported"}` and shows the
`onramp-currency-unsupported` screen. The `?? "usd"` this replaced opened a dollar-denominated
checkout for a buyer whose money is not dollars, which is POO-1512 [R5]'s defect with a new rail
behind it.

`prefill` is a USD figure and stays labelled USD. The ADAPTER decides whether it travels: POO-1803
sends `defaultAmount` only when `prefill.currency` matches `fiat.defaultAsset`, so a EUR buyer opens
their checkout in EUR with no prefilled amount rather than a USD number wearing a euro sign, and the
`[R1]` sentence tells them to enter what they want to pay instead. Both copy variants state the
approximate USDC that will reach the wallet. There is no rate anywhere on this path to convert with,
which is why the amount is dropped rather than converted.

`[R1]` matters more than it looks: we pass a BUFFERED figure, so the buyer sees a larger number in
the checkout than the one they typed. One sentence of ours has to precede it or it reads as an error.
The buffer is the house `SEED_BUFFER_RATE` (5%, pinned until POO-1812), never the swap leg's
`STANDALONE_SLIPPAGE_PCT`: those are different quantities with different owners, and moving one to
size the other would move the swap.

### The words at the end (`[R9]`, ADR-0006)

A hard `no` from the classifier is the ONLY outcome that may read like a failure. `confirmed` and
`maybe` both enter the settling window, because after react-auth 3.40.0 a charged card and an
abandonment are indistinguishable at the exit. `settled` prints a receipt from the OBSERVED delta and
never from the typed amount (ADR-0004). `unverified` gets its own honest screen, and the word
"cancelled" appears on no path where money could have moved.

No Paybis figure reaches this rail: the quote's `pricingEnabled` is off on it, and the receipt's
Amount row and the method label are withheld, because a Paybis charge is an assertion about a
purchase the provider priced itself. `deposit_method` is withheld from the funnel for the same
reason. `Try again` on the error screen returns to `amount`, not to the `review` step this rail does
not have, and the Paybis rail is never mounted on any Privy step.

A delivery under `ON_RAMP_FLOOR_USD` still prints the receipt with the real figure, because the money
is in the wallet; it adds one line about the platform minimum and withholds the invest CTA rather
than sending the buyer into a refusal the operation boundary would raise anyway (POO-1806/1808).

Copy lives under `deposit.onramp.checkout.*` and never names the provider: "secure checkout".

### The funnel keeps five settlement terms (`[R10]`)

`deposit_completed` fires on the observed delta and carries it, never when the checkout promise
resolves: that promise is the provider's CLAIM, which reads like a success and is not one.

`onramp_uncovered`, `onramp_unverified` and `onramp_currency_unsupported` are new
`tx_amount_blocked` reasons and are **denominators, not settlement terms**. They do not conclude the
abandonment, because the passive observation window keeps watching for the rest of the SAME SESSION
and may still settle the purchase; concluding at the visible ceiling would let one `deposit_started`
produce two settlement terms. So the identity is unchanged:
`started = completed + failed + abandoned + transfer_unobserved + onramp_disabled`.

The window does NOT yet survive a reload: the cross-session resume is POO-1833's, and until it lands
a buyer who closes the tab is reconcilable only by hand, from the intent record (`PP-CORE-LIB-107`).

All three exits map to the `pending` abandonment exit rather than to "terminal", so a buyer who
leaves one of those screens is still counted: they fell through to `default: return null` before the
review, and that silently emitted no `tx_flow_abandoned` at all.

### The crypto wait states its own absence (POO-1624)

The confirm above led somewhere it should not have. It ran a 2500ms `setTimeout` commented "mock for
on-chain watching" and then printed `const CRYPTO_RECEIVED = 100` through `crypto.added` as
"{amount} USDC added", a RECEIVED amount, under a heading reading "Deposit received". **Neither the
timer nor the constant was gated on `isMockMode`**, and the confirm renders in real mode whenever an
invest context is present, so a production buyer got a receipt for a deposit nobody measured. The
copy said "We'll detect it automatically. No need to do anything" and the frame adds "You can leave
this page"; both are false, because nothing watches the address and navigating away or refreshing
loses the wait entirely. The timer fired on time, not on money.

The fix is three subtractions and no new mechanism:

- **the timer is mock-only**, so in real mode the wait never resolves itself and the receipt
  (`PP-DEP-SCR-006`) is unreachable. `deposit_crypto_completed` stops firing there too: premise 11
  puts a `completed` on SETTLEMENT, and its whole history before 2026-08-17 counts timers;
- **the figure moved to `src/mocks/data/cryptoDeposit.ts`** (`PP-CORE-MCK-008`), so the mock boundary
  is a directory rather than a comment three lines under the fiat minimum;
- **the copy promises only what the implementation delivers**, in 12 locales, and the spinner went
  with the promise, because a spinner asserts that something is being watched.

The invest return moved onto the wait, so losing the fabricated receipt does not also lose the way
back to the strategy (POO-604 / POO-605). Invest re-reads the real balance and sends the buyer back
if it is still short, which is the honest answer this screen cannot give by itself.

**What is deliberately NOT here:** the observation. Reusing the balance-delta reconcile the fiat rail
already runs on (`StandaloneOnRampRail`'s `onSettled`, POO-1129 [R4]) is the obvious candidate, and
which network, for how long and what a partial or late arrival means are product decisions, so they
belong to POO-1129 / POO-604. Until one exists, reaching the wait in real mode reports
`tx_amount_blocked{block_reason:"transfer_unobserved"}`, which is the count that would justify
building it. Registered as `CR-CORE-028`.

Every deposit is **received-fixed** (POO-729): the entered amount is the USDC you receive; the fee is
added on top of "You pay". Bounded to $10..$200,000 (POO-727).

## The payment method (POO-1513)

The picker is built from `useBuyRouteQuote`'s `methods`, i.e. the live Paybis list resolved for the
buyer's own currency (POO-1512), with each row's real `displayName` and its own minimum in its own
`minCurrencyCode` (`formatFiat`, never `formatUsd`). A per-method charge is rendered
**opportunistically**, only for the row the quote already priced, never by making a call per method
(POO-1576 Q1). **POO-1599 removed the reason there is only one figure:** Paybis prices EVERY method on
the pair when the quote carries no `paymentMethod`, which is what the listing quote now sends, so a
figure per row costs the same single POST, and the desktop list renders them per row.

What it replaced, and why it mattered:

- a hardcoded `pix | card | applePay | bank` union, country-blind, defaulting to **Pix for every buyer
  on earth** and missing Google Pay for Android buyers (POO-1455);
- a **discarded** selection: `StandaloneOnRampRail` took only `receiveUsd`, so the mint re-derived a
  card with `pickDefaultPaymentMethod` and every purchase opened on a card in USD;
- a **local USD fee model** (`SERVICE_RATE` / `SERVICE_MIN_USD` / `PROCESSING_RATES`, and
  `lib/depositQuote.ts` with it) that priced `bank: 0` against `card: 0.0278`. It printed one number
  and the buyer was billed another. The review now prints the quote's own charge, in the currency the
  quote says it bills, or says "shown at checkout" when there is no figure.

### The method's logo comes from OUR origin (POO-1643)

Each row draws the vendor's own logo, and the browser never asks Paybis for it. The `src` is a
relative `/api/onramp/method-icon?src=…`, our server fetches the bytes from the CDN, and a relative
URL is structurally incapable of reaching another origin.

That is not a caching decision, it is the whole reason the route exists. The URLs are
`cdn.paybis.com` / `cdn.sandbox.paybis.com`, so a direct `<img>` would fire one request per method,
from the buyer's own IP with a referrer, to a KYC'd payment venue the buyer has not chosen and may
never open, on a screen they are only looking at. Paybis otherwise learns nothing about a buyer until
`request-id` is minted, which is a deliberate act, and an IP is personal data in the EU. Registered
as `CR-TOK-011`, and the reason POO-1603 could carry `icon` through normalization without anything
rendering it for two weeks.

Three things here are load-bearing and each has a test:

- **the allow-list is exact** (`src/lib/onramp/methodIconProxy.ts`, `PP-CORE-SEC-003`). Two hosts, by
  string equality, plus `https:` only, no credentials, no port, a path required, and the outbound URL
  rebuilt from the validated pieces so the query and fragment never reach the vendor. It is shared by
  the picker and the route so there is ONE list, and `serverBoundary.test.ts` keeps it
  client-importable so nobody is ever tempted to make a server-side copy.
- **CSP gains nothing.** No `images.remotePatterns`, no Paybis host in `img-src`, asserted as an
  ABSENCE in `csp.test.ts`. Naming `cdn.paybis.com` there is what a future session would do to "fix" a
  logo that stopped rendering, and it would restore the disclosure in a one-line diff.
- **the fallback is ONE neutral tile**, identical for every method, for all four causes (no icon sent,
  schema refused it, proxy refused it, image failed at runtime). A monogram is deliberately not used:
  POO-1603 [R4] exists to stop this picker inventing a per-method glyph family, and the display name
  is already two elements away on the same row.

**Mock mode shows the tile, not a logo, and that is deliberate.**
`src/mocks/data/onRampPaymentMethods.ts` carries no `icon`, so the visual harness renders the
fallback for all three rows. Adding one would mean inventing a `cdn.paybis.com` path, and this module
already carries the scar from doing exactly that: `schemas.ts` records that an invented `pm_001`
example "seeded three fixtures that modelled a namespace Paybis does not use". When a real icon URL
is captured from the live methods list, dropping it into that fixture is a one-line change and the
harness shows the row as designed. Until then the fixture states the truth it has.

Behaviours worth not undoing:

- the default comes from the LIST via `pickDefaultPaymentMethod`, as a FALLBACK, never an override
  (POO-1578 S4);
- an empty or unreadable list **informs and does not block**: the dialog attributes the gap to the
  provider and Continue proceeds on the rail's own prefill (POO-1576 Q3);
- the selection survives an amount change and is cleared ONLY when the resolved currency changed
  (POO-1576 Q4), because the list is per resolved currency;
- a method whose minimum exceeds the order renders **BLOCKED** (POO-1609, second and standing
  reversal of POO-1576 Q2 on 2026-08-14: "the charge is never raised... the payment method must stay
  blocked with a message explaining it"). The row stays visible, in its normal position, never hidden
  and never reordered: reduced emphasis, `method.blocked` in place of `method.minimum` (one line, not
  two), the radio unselectable, `aria-disabled="true"` rather than `disabled` so it stays reachable
  and announced. Activating it is also this screen's **blocked intent** (premise 11), counted as
  `tx_amount_blocked{flow:"deposit", block_reason:"below_minimum"}` on the refusal itself, exactly
  once per activation. The order itself never moves, automatically or on consent: there is no raise
  to consent to any more.

**The comparison, two tiers** (`isMethodBelowFloor`, `src/lib/onramp/methodFloor.ts`,
`PP-CORE-LIB-101`), defined once and shared by every host that renders a payment-method row:

1. **Tier 1, when the row carries a charge.** Compare that charge to the row's own floor directly.
   Exact, no currency guard: since POO-1599 the listing quote prices every method for the pair in one
   call, and both figures are denominated in the currency the flow resolved, by construction.
2. **Tier 2, when the row carries no charge** (the gas-first buyer, `pricingEnabled: false`). Compare
   the ENTERED amount to the floor instead. This is the common case for that buyer, not a fallback of
   convenience, and it is guarded to the SAME currency only: the entered amount is USDC and the app
   has no FX source (POO-333), so a floor in another currency is never blocked against it. A method
   wrongly blocked removes an option the buyer could have used; a method wrongly offered is
   recoverable at checkout.

When EVERY method is blocked, `Continue` has nothing to act on: it is disabled and `method.allBlocked`
names the LOWEST floor in the list (`lowestFloor`), so the screen states its own exit (the amount
field's own increment chips are already on the same step) rather than leaving a dead end to happen.

**None of the above happens on the Privy rail (POO-1904 [R1]).** `allBlocked` is gated on the
DERIVATION rather than at its render sites, because it fed three things and the third is not
cosmetic: the banner, `Continue`'s `disabled`, and therefore whether the purchase could open at all.
A Paybis floor above the typed amount was withholding a Privy purchase that Privy would have taken,
which is a refusal by a vendor that does not serve that rail. On the Privy rail the floor that may
refuse is `MIN_DEPOSIT`, and nothing else's.

It was reachable only for a **USD-denominated** floor, which is why the rail ran for weeks with it:
tier 1 needs a row charge and the Privy rail suspends the pricing hop, so only tier 2 applies and
tier 2 compares nothing unless the floor is already in USD. The `Minimum EUR 8.59` a buyer reported
was the picker's own per-row minimum, not this banner.

### The Paybis method surface is gone on the Privy rail (POO-1904 [R1])

Both hosts, and the dialog is **not mounted** rather than left closed. `methodOpen` can never become
true on that rail (Continue takes the `confirmFiatPrivy` branch instead of `setMethodOpen(true)`), so
a closed dialog is invisible and removing it looks like a no-op. It is not: reachability is an
argument about one call site, while the rule is that the picker does not EXIST there.
Mounted-but-closed keeps a Paybis list, its charges and its floors threaded into a live surface one
`setMethodOpen` away from the screen, and keeps a dialog in the accessibility tree with no business
on the rail. The suite asserts the mount, not the DOM, because a Radix dialog at `open={false}`
renders nothing and a DOM query cannot tell "absent" from "closed".

The copy on that rail names **no vendor** (POO-1904 [R3], `deposit.secureCheckout`, all 12 locales).
Provider-neutral and deliberately not rail-aware: Privy auto-routes between Stripe, MoonPay, Coinbase
and Meld, and our captured outcome records `category`, `reason`, `asset` and `environment` but not
the provider, so naming the real merchant is not implementable and naming any of them repeats the
merchant-of-record error rejection 14 of the epic's handoff exists to stop. `securedByPaybis` stays,
naming Paybis, on the rail Paybis actually serves (POO-1819's 72-hour rollback target). This was a
compliance defect rather than a cosmetic one: see `docs/COMPLIANCE_REGISTER.md` `CR-CORE-043`.

### The amount step is a panel now, and the list is inline at `lg` and above (POO-1612)

Before this, the amount step was a bare flex column directly on the page background; the panel
(a real surface, `lg:rounded-xl lg:border lg:bg-surface lg:p-6`, centred inside a `1100px` column,
`500px` panel + `24px` gap + `320px` aside) did not exist. It exists now so the payment-method list
has somewhere to sit **inline**, between the amount block and `Continue`, instead of behind a modal:
comparing method prices side by side is the reason this list is inline on a 1440px screen at all, and
a modal that hides the amount the buyer just typed makes that comparison worse for no gain.

`isDesktop` (`useIsDesktop`, PP-CORE-HOK-023) gates the inline section and which of Continue's two
behaviours fires, and it is a JS check rather than the CSS `lg:` classes the rest of this screen uses
for its mobile/desktop split. Two identically-named "Continue" buttons, or two copies of the same
radio group, would both sit in the DOM under a CSS-only toggle (jsdom does not evaluate media
queries), indistinguishable from an actual duplicate to anything querying by role or name.
`isDesktop === null` (unmeasured: SSR, first paint, and every test that does not mock the hook)
resolves to the mobile path, which is the whole reason the dialog stays "mounted and unchanged below
`lg`": nothing below `lg` runs through code this PR added at all.

**Every row shows its OWN charge now (POO-1612, inverts POO-1576 Q1).** Until POO-1599 a quote priced
ONE method, so a charge could only ever render on the SELECTED row; POO-1599 unpinned the listing
quote and `useBuyRouteQuote` now exposes the full answer (`BuyRouteQuoteState.quote`), so the buyer
compares the vendor's own figures side by side. A blocked row is the one exception: it shows
`method.blocked` and no charge, even when the quote priced it.

**No superlative of ours sits beside a charge (D1, epic POO-1129, 16/08).** A **Best price** pill was
built on this screen and is deleted, not hidden: murilo, *"use as labels do vendor so"*. The chip slot
belongs to the vendor's own labels.

**And the comparison behind it is gone too (POO-1639).** `selectBestPriceMethodIds`
(`src/lib/onramp/bestPrice.ts`, PP-CORE-LIB-100) was kept unwired on the argument that it would become
"the comparison behind the cheapest-viable default". That default was never built, and no open issue
schedules one, so what survived D1 was an exported comparison with no caller and no owner. Deleted with
its test; the id is retired, never recycled, and `git show b0624813:src/lib/onramp/bestPrice.ts`
restores it whole if a default ever wants it.

Two states this component owns and does not yet draw: the informational "provider returned no
methods" state still wants a "Try another currency" lateral exit into the control below, and a
currency-change RELOAD (rows drop to skeletons rather than reading as "no methods") needs a narrow
loading discriminator `useBuyRouteQuote` does not publish today. Both are open, not silently
dropped; see the PR description.

### The resolved currency is named, and the buyer can change it (POO-1613, real since POO-1630)

Directly above the payment-method section: `CurrencySelect` (`PP-DEP-CMP-006`) names the currency
the quote and the floors are actually denominated in (`Intl.DisplayNames`, no hand-written table),
real data in BOTH modes since `currencyCodeFrom` already flows from the live hook / the mock quote.
Renders nothing rather than guessing `USD` when unresolved (AC3): a wrong currency label is worse
than an absent one, and POO-1601's fallback path is proof the absence is live.

**The control is interactive in BOTH modes since POO-1630; only the SOURCE of the options differs.**
`options`/`onSelect` are still the switch, and the component still cannot go interactive without both,
so an unreadable set degrades to display-only (POO-494 [R1]) rather than offering a currency it cannot
switch to. Real mode reads the live supported set (`useOnRampCurrencies`, POO-1621); mock reads a
sibling fixture (`src/mocks/data/onRampCurrencies.ts`, `PP-CORE-MCK-006`,
44 codes including `XAF` deliberately, the one code that breaks the two-letter-to-flag trick this
issue explicitly warns against). No flags at all: the simpler of POO-1613's two sanctioned options.
The pick is a **PROPOSAL**: it rides to the methods call as `proposedCurrencyCodeFrom` and the screen
keeps displaying the currency the SERVER echoed, so a refused pick changes nothing rather than naming
a currency the figures beside it are not denominated in. The ECHO is threaded on to
`StandaloneOnRampRail` and from there to `mintOnRampRequest` (POO-1630), so the checkout opens on the
currency the review priced. Without that last hop the mint re-resolves from scratch, which is how a
buyer who picked BRL to reach Pix would have been billed on a card in USD.

Picking a currency in mock mode still triggers the REAL clearing rule (`resolvedCurrencyRef`,
POO-1576 Q4/R3: "one rule, now user-triggerable"), by relabelling the mock fixture's resolved
currency code rather than inventing a second per-currency amount table for 44 currencies: the
figures stay the mock's own, only the denomination the buyer sees changes, which is enough to
exercise the disclosure this issue is actually about without a scope no alpha needs.

### Mock mode gets its own list, because otherwise nobody can see the picker

`useBuyRouteQuote` is gated on `!isMockMode && fiatOnRamp` and there is no mock for
`getOnRampPaymentMethodsAction`, so mock mode rendered the "Paybis did not return any payment
options" caption permanently, the review always printed "Shown at checkout" and the receipt dropped
its Amount row. With no story for the modal either, there was **no configuration in which the
designed picker could be seen at all**, which defeats the point of a visual harness (premise 2).

`src/mocks/data/onRampPaymentMethods.ts` supplies that list behind `isMockMode`: EUR, three methods
(a card, a bank transfer whose floor sits above a typical order so the blocked row is exercisable by
hand, and a local rail), plus a mocked per-method charge so the review and the receipt are not blank. Two
things about it are load-bearing:

- **It never reaches real mode.** `isMockMode` is a build-time constant, so the branch resolves at
  build time; in real mode the screen is byte-for-byte what it was, and the only figure it prints is
  the vendor's own. The deleted `depositQuote.ts` fee model is not being rebuilt: these rates exist
  only where there is no vendor to ask.
- **It resolves after a simulated round trip.** "Still resolving" and "unreadable" render the same
  informational caption by design, so a synchronous fixture would have made the empty state
  impossible to see by hand and would have quietly deleted the assertions that pin it.

The wallet fixture gained `isNative: true` on its Base ETH row in the same pass. It was simply
missing, and `readBaseNativeEth` matches on it, so mock mode read a zero gas balance and sized every
`/deposit` order ETH-FIRST, which is the one case that prints no charge at all.

### The list and the charge belong to the pair that gets MINTED (POO-1513 X1/X2, with POO-1573)

Everything above rested on one assumption that is not always true: that the pair being **quoted** is
the pair being **purchased**. A wallet under `NATIVE_RESERVE_ETH` on Base is sized **ETH-first**
([R1] standalone), and since POO-1573 that leg is quoted received-fixed against
`gasFloorEth + fundingUsd / ethUsd` on the ETH pair's own fee schedule. Quoting `USDC-BASE` at the
entered amount for everyone therefore printed a charge for a pair the buyer is not billed on,
structurally **below** the real one by `gasFloorEth * ethUsd` (~$2.50 on a $100 deposit at $2,500/ETH),
which is the same class and the same size as the 2.78% defect this issue opened on.

- The pair comes from `buildStandaloneOnRampPlan`, the sizer **the rail itself runs**, so the screen
  and the mint cannot drift apart: there is no second predicate here to keep in step.
- The **method list follows that pair** (`useBuyRouteQuote({ currencyCodeTo })`), because
  `resolveWidgetPrefill` resolves the mint's list for `order.currencyCode`. A list resolved for
  another pair offers methods the mint may not find, and one it cannot find falls back to a card,
  which is POO-1578 [R3]'s invisible substitution re-created one layer up.
- On the gas-first pair the **charge is suppressed**, not approximated
  (`useBuyRouteQuote({ pricingEnabled: false })`): its ETH target is solved at mint time against a
  live ETH price the client does not hold, so the review falls to the `Shown at checkout` caption it
  already uses when the provider returns no figure. With no charge to compare, the blocked-row check
  falls to its OWN tier 2 (the entered amount against the floor) rather than going dark: this is the
  buyer POO-1609's tier 2 exists for. A floor the entered amount still cannot clear is left to the
  mint's own `onramp.below_method_minimum` only when the FLOOR itself is in a currency tier 2 cannot
  compare against (POO-333); otherwise the row blocks here, on screen, before the mint is ever asked.
- A **degraded balance read** (`balances: []`, which `useTokenBalances` cannot tell from an empty
  wallet) reads as gas-first and therefore suppresses. That is the safe direction here, as it is in
  the rail: withholding a figure is never worse than asserting a wrong one.

Pinned in `DepositScreen.gasFirst.test.tsx`, which deliberately does **not** stub the rail, because
the stub in `DepositScreen.methods.test.tsx` is precisely why nothing compared the printed charge
against the order that gets minted.

## The fiat confirm: standalone on-ramp rail (POO-1137, epic POO-1129 phase 6)

`DepositScreen.confirmFiat` splits three ways, one per world:

- **Mock mode** (`isMockMode`) keeps its pre-epic mocked success: a direct `completeFiat(null)` with
  no real purchase. Honest, because the whole app is running on fixtures and nobody was charged
  (premise 10, the launched surface is unchanged until the flag flips).
- **Real mode with `fiatOnRamp` on** (`realRail`) hands off to the standalone rail below; the rail
  owns the CONFIRMED settlement that fires `deposit_completed`.
- **Real mode with `fiatOnRamp` dark** REFUSES (POO-1794, next section), because there is no on-ramp
  to run and printing a receipt for a purchase that never happened is a premise-11 violation.

The widget frame is gated off in mock mode and could never settle a real balance delta there.

### Real mode with the flag dark refuses, never fabricates a receipt (POO-1794)

Before POO-1794, `confirmFiat` collapsed two worlds into one `if (!realRail)` branch, and `realRail`
is `!isMockMode && isFeatureEnabled("fiatOnRamp")`. That predicate is true only in real mode with the
flag on, so its negation covered BOTH mock mode (where a receipt is honest) AND **real mode with the
flag off**, where a real production buyer was shown a "Deposit confirmed" receipt and a
`deposit_completed` carrying `value: amount` for a purchase nobody made.

The branch is now split. Mock mode is byte-identical. Real mode with the flag dark:

- **[R1]** the confirm refuses; it never completes and never prints the receipt. It shows a terminal
  `onramp-disabled` step that reuses the "Purchase not completed / no money was moved" copy and mounts
  no rail (unlike `onramp-error`, which keeps the running flow mounted).
- **[R2]** the refusal emits `tx_amount_blocked{flow:"deposit", block_reason:"onramp_disabled"}` and
  calls `abandonment.conclude()`, so the funnel identity closes with no phantom walk-away:
  `started = completed + failed + abandoned + transfer_unobserved + onramp_disabled`.
- **[R3]** mock mode is unchanged in behaviour and in the events it emits.

A correct launch turns the flag on before the fiat method is reachable, so a non-zero
`onramp_disabled` count is the alarm that a real buyer met a dark on-ramp. Pinned by
`DepositScreen.flagOff.test.tsx`; mock mode by the untouched `DepositScreen.test.tsx` and
`DepositScreen.analytics.test.tsx`.

### Pieces

- **`buildStandaloneOnRampPlan`** (`lib/standaloneOnRampPlan.ts`, `PP-DEP-LIB-004`) - the pure half.
  It sizes the order with `sizeOnRampOrder({ standalone: true })` ([R1] standalone gas trigger: buy
  `ETH-BASE` when native ETH on Base is below `PAYBIS_GAS_FLOOR_ETH`, else `USDC-BASE` direct) and
  shapes a `ProvisioningPlan` with a `buy` step plus, when it bought ETH, a `swap-token` ETH->USDC on
  Base. It **never** emits a bridge or an op anchor ([R3]): a standalone purchase stops at USDC on
  Base, even under a deep link that carried a strategy.
- **`StandaloneOnRampRail`** (`components/StandaloneOnRampRail.tsx`, `PP-DEP-CMP-004`) - the React
  half. It runs the plan and reports one terminal outcome (settled / settling / failed) to the screen.

### What it reuses, and what that means

Everything after "Confirm" is the **shipped provisioning rail**: `useProvisioningRail` binds the
wallet, `buildPlanSteps` -> `useWalletSignFlow` executes the buy + the ETH->USDC swap,
`mintOnRampRequest` mints the Paybis `requestId` at execution time RESUMING a journaled in-flight one
first ([R7]/[R8]), and `PaybisWidgetFrame` + `useOnRampSettlement` embed the widget and settle from
the observed balance delta scoped to the token the order bought ([R4]/[R11]). There is **no second
planner, no second rail, no second money path** here.

### Temporary: the widget capture (POO-1598, delete with the fixtures)

`useOnRampSettlement`'s message listener feeds two sinks, not one. The always-on
`breadcrumbPaybisMessage` (PP-CORE-LIB-090) writes Sentry breadcrumbs, which attach only to an event
that is actually SENT, so a purchase that **succeeds** leaves no trace of what happened inside the
checkout. `capturePaybisMessage` (PP-CORE-LIB-102) is the other half: flag-gated on `onRampCapture`
and off by default, it records the same stream as an ordered, allow-list-redacted sequence on the
first-party rail (`/api/client-error` -> container log + Sentry Logs), stamped with `browserTraceId()`
and the Paybis `requestId` so it joins the API's own Paybis capture.

It exists because dev runs Paybis **sandbox**, which sells almost nothing, so the vendor questions
this epic keeps hitting (does the method list geofence, can the buyer change currency and method
inside the widget, what does settlement actually look like) can only be answered by recording ONE
real production purchase. Read `paybisCapture.ts`'s header before touching it: the allow-list, the
`country` inclusion and the retention are all argued there and in `CR-CORE-027`. Both sinks run
through `observe()`, so neither can ever gate a purchase that has already been charged.

Two decisions the rules do not pin were resolved by reusing that machinery rather than inventing a
parallel one: the swap's slippage is the plan's own (the investor default, `STANDALONE_SLIPPAGE_PCT`),
and its approval / re-quote / re-sizing all run through `buildPlanSteps`. The ETH-first purchase whose
`ethUsd` cannot be priced (an empty wallet) carries the **same waived gap** the in-flow rail does
(POO-1136 `fiatSwapFractionBps`): it fails legibly, the funds resting as ETH on Base.

### Why not the two shortcuts

- Reusing the server planner `buildPlan` would let `classifyGasFeasibility` decide gas, which [R1]
  forbids for a standalone buy, and would fabricate a quote for an operation that does not exist.
- Buying USDC direct and stopping strands a no-gas buyer holding USDC, the exact case [R1]'s standalone
  floor exists to prevent.

### The settled-but-unconverted window

A gas-first purchase settles as ETH on Base and still has one leg to go. In that window the deposit is
invisible to a balance read (the ETH is indistinguishable from a holding the user always had), so
re-deriving the plan does not resume anything: it reads a wallet that now **clears** the gas floor,
buys USDC direct, and leaves the first purchase's ETH behind. One intended deposit, two card charges.

Two doors lead there, and both are shut:

- **Try again.** The rail stays mounted through `DepositScreen`'s `onramp-error` step and hands the
  screen a `settled` discriminator plus `flow.retry()`. Post-settlement, Try again **resumes the failed
  step** (the wallet-sign family contract, `ProvisioningPanel.tsx:1087`) and the error copy says the
  purchase went through and the funds are resting as ETH on Base. Only a **pre**-settlement failure
  (a mint or `personal_sign` rejection, or the widget's `closed | rejected | cancelled | error |
  unavailable` terminals) goes back to review and mints again, where [R7] resumes the journaled id.
- **Tab death.** No click is needed to reach the same place, so the conversion is **journaled**. From
  the moment the purchase settles until the swap lands, a `deposit`-kind `FundingJournal` records the
  ETH->USDC leg with the real amount to convert (`settledSwapBaseUnits`, the funding share of the
  observed delta). A later mount finds it (`findStandaloneSwapResume`) and runs
  `buildStandaloneSwapPlan`: the conversion **alone**, with no `buy` step and therefore no mint. The
  shipped POO-1038/1043 leg recovery and the app-wide `FundingRecoveryBanner` come with it, so a user
  who reloads elsewhere is offered the way back to `/deposit`.

`STANDALONE_SWAP_LEG_INDEX` is the one coupling to watch: the journal and the running rail have to
agree on the leg index, and a test asserts it against `planRailSteps`.

### The third door: an intent we cannot verify (POO-1642)

Those two doors are shut for a purchase that SETTLED. A third one stayed open for a purchase we never
saw settle, and it is the same double charge from the other end. `mintOnRampRequest` resumes a
journaled in-flight `requestId` before it mints ([R7]), but two of its branches are not decidable by
the client at all: an intent that was PAID as far as we observed and has not landed, and one that
aged out past `ONRAMP_REQUEST_RESUMABLE_MS` with no observed payment. `paidAt` records only what we
saw, and a bank transfer, a 3DS redirect or a dropped webhook all move money without us seeing it.

POO-1384 built `confirmResume` for exactly this and `ProvisioningPanel` has passed it since. This
surface did not, so the hook took its documented fall-through: reopening the widget onto the vendor's
own completed screen ("he can't go anywhere", from the production report), or minting a SECOND Paybis
intent beside funds still landing. `StandaloneOnRampRail` now takes a `confirmResume` prop and
forwards it in the same mint options object as `paymentMethod` and `currencyCodeFrom`, held through a
ref for the same reason both of those are: the callback closes over the prompt's own state, so its
identity moves every render, and in `runOnRampBuy`'s deps that would re-expand a plan already minutes
into its run.

`DepositScreen` owns the question itself, as it owns every other interstitial and terminal screen
here. It renders an inline `role="alertdialog"` (not a `window.confirm`, and not a second component:
the provisioning twin is inline in `ProvisioningPanel` too, and neither host can render the other's
namespace), moves focus to it, and offers exactly two answers with no dismiss. **Every exit settles
the promise the rail is awaiting**: either answer resolves it and clears the resolver, and the
screen's own teardown REJECTS it with `ONRAMP_ABANDONED`. Rejecting is the rule rather than a detail,
because resolving `"new"` with nobody watching mints the second purchase this whole section is about,
and leaving it pending holds the mint, the step and the run open on a question that can no longer be
answered.

The interruption is this screen's second blocked intent, on the declared `tx_amount_blocked` with
`block_reason` `purchase_paid_unsettled` or `purchase_unverified`. It fires on the interception, once
per question, never on the answer: the two answers are two answers to one blocked attempt. The copy
is lifted verbatim from `strategies.provisioning.onramp.resume` into `deposit.onramp.resume`, in all
12 locales, so one situation does not get two different sentences on two surfaces. The residual
product question (a wrong answer means paying twice, and the 15-minute window is ours rather than the
vendor's) is `CR-CORE-026`.

### No local fee model at all (POO-1513 S3)

`lib/depositQuote.ts` (`computeDepositQuote`) is **deleted**. It was a second, hand-rolled copy of
Paybis' published rates, in dollars, and the vendor already returns the real per-method charge in the
buyer's own currency. The authoritative price is Paybis inside the widget and the authoritative amount
is the settlement delta ([R4]); the review prints the quote's figure and nothing of its own.

The **confirmed receipt** is a different question from the review estimate, and is settled here rather
than deferred: the success rows and `deposit_completed` quote the observed delta the rail reports
(`StandaloneOnRampSettlement`), because the user can change the amount inside the Paybis widget and a
receipt for an amount they never paid is exactly what [R4] exists to prevent. The estimate remains the
fallback for the mocked success (mock mode) and for a resumed conversion, where no delta was observed.
With **neither** a delta nor a quoted charge the "Amount" row is **omitted**: it used to print
`formatUsd(amount)`, which is the USDC the buyer RECEIVES under a label that says what they PAID, and
that is the deleted fee model's mistake one screen later. The received row beside it already carries
that number honestly, and the method row next to both has always been omitted on the same rule.

### Two references on the failure screen (POO-1403)

The `onramp-error` step carries **two** ids, and the labels are what make them useful:

- **Reference** is ours (the backend `correlationId`, falling back to the browser trace id). It finds
  our trace, and Paybis has never heard of it.
- **Paybis ref** is the server-minted `requestId`, read from the on-ramp journal by
  the `paybisRequestId` the rail carries on its failure (POO-1403 [R1]). It is the only identifier Paybis' support can act on,
  which for a failed purchase is the only thing that answers "was this person charged".

The read is **ungated** here, unlike the provisioning panel's: this screen IS the on-ramp, so every
failure it shows is a purchase's, including a post-settlement conversion failure whose code is a plain
wallet rejection. That is the case where the vendor's record matters most. It is **read**, never
re-minted ([R2]); a second `requestId` for a purchase already in flight is the double charge
`onRampJournal` exists to prevent. Absent a journaled purchase the row is omitted, never blank.

## Analytics

`deposit_started` / `deposit_submitted` fire as before. `deposit_completed` + `requestBalanceRefresh`
move to the **confirmed settlement** (real rail) or the mocked success (mock mode only; the real path
with the flag dark now refuses, POO-1794), never at submit, and the completed `value` is the settled
delta rather than the estimate. `deposit_failed` fires
on a terminal purchase failure, pre- or post-settlement, carrying the failure's own code, and
**never** the `requestId`: POO-1403 [R5] keeps that to the first-party sinks (the copied report and
Sentry), because POO-243 [R3] keeps error detail off the third-party channel.


> **Renamed (POO-1801 [R5]):** `PAYBIS_GAS_FLOOR_ETH` is now `NATIVE_RESERVE_ETH` in
> `src/lib/provisioning/nativeReserve.ts` (same 0.001 default, same behaviour; the env var is
> `NEXT_PUBLIC_ONRAMP_GAS_FLOOR_ETH`, with the old name read as a fallback until POO-1815).
