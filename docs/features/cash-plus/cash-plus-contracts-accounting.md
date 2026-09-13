# Cash+ contracts, accounting and automation

> Current delivery (13 September 2026): the user selected an interactive UI-only demo, with simulated balances and no contract deployment. See [Cash+ UI demo delivery](cash-plus-ui-demo.md). The protocol requirements below are preserved as the earlier design and optional separate fork workflow; they are not claims about the mock demo.

Version 1.1 · Companion to the [dedicated-page technical specification](cash-plus-technical-spec.md)

This annex defines the contract work required for a real Aqua/SwapVM demo. No platform API, database or HTTP quote service is required. The browser handles investor reads/signatures; local scripts handle management and the demonstration counterparty.

## 1. Contract set and trust boundaries

| Contract | Responsibility |
|---|---|
| `CashPlusVault` | Pooled custody, internal shares, deposit/redeem, accounting, Aqua maker hooks, aggregate policy and activity checkpoints |
| `CashPlusAaveAdapter` | One approved underlying per adapter; supply, withdraw and transfer receipt tokens; vault-only authority |
| `CashPlusPricing` | Immutable SwapVM Extruction target; deterministic exact-input stablecoin pricing plus quote-time policy checks |
| `CashPlusProgramFactory` | Constructs only the canonical Aqua order/program from approved parameters; no arbitrary bytecode shipping |
| Official Aqua | Virtual liquidity accounting and token movement for the selected app/router |
| Official SwapVM | Executes the canonical program and invokes maker hooks |

Deploy one adapter per enabled lending asset. Keeping custody in adapters continues the original architecture. Count each adapter's underlying-equivalent holdings once. An adapter exposes no arbitrary external call, admin rescue or upgrade function.

No separate settlement executor or partner API is necessary for the demo. A designated counterparty wallet calls official SwapVM with the specified taker traits. Optional contract takers are enabled only if tested. The counterparty is a test actor, not proof of commercial demand.

### 1.1 Roles

| Role | Allowed actions | Forbidden actions |
|---|---|---|
| Investor | Deposit own USDC; redeem own shares to own wallet | Spend other accounts' shares; arbitrary receivers through investor UI |
| Keeper | Bounded park/unpark, rotate canonical orders, lower capacity, suspend trading | Withdraw assets to itself, change token/router/oracle, arbitrary calldata, increase hard limits |
| Guardian | Pause deposits/trading; activate explicit emergency exit mode | Transfer investor funds; choose a favorable personal price; silently resume risky operations |
| Governance | Policy changes within immutable hard bounds, resume after checks, authorize demo taker | Bypass hard contract bounds or recover investor assets through a rescue function |
| Aqua/SwapVM | Only their prescribed transfer/hook paths | Unauthenticated hook calls or arbitrary order settlement |

Demo roles may be local accounts. A public deployment binds governance to a reviewed multisig/timelock and uses separate keeper/guardian credentials. Onchain role checks are required regardless of which buttons are visible.

## 2. Deployment manifest and protocol compatibility

Manifest fields: deployment ID, schema version, mode, fork run ID, chain ID, deployment block/hash, vault, adapter array, pricing/factory addresses, official Aqua and SwapVM addresses, token/aToken/oracle addresses and decimals, sequencer feed, role addresses, ABI hashes, code hashes, policy version, canonical-program version, upstream commit and SDK versions.

The inspected original integration uses Arbitrum 42161 and these addresses:

| Binding | Address in inspected integration |
|---|---|
| Aqua | `0x1111113CCf1426A8E30e2bfF5E005d929bF6a90a` |
| Original SwapVM router | `0x1111113Db0e0ef9D0E3A50d5f094a3a57a26C0DE` |
| Native USDC | `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` |
| Aave pool | `0x794a61358D6845594F94dc1DB02A252b5b4814aD` |
| aUSDC | `0x724dc807b04555b71ed48a6896b6F41593b8C637` |

These are continuity evidence, not instructions to deploy against unchecked addresses. A newer official router candidate identified during prior research is `0x111111338c5091e8440b67b168bae16a668ac0de`; compatibility with the required opcode table must be established by code hash, published deployment evidence and fork execution. Do not switch the global router constant used by Active Reserve.

The secondary token, its exact representation, Aave reserve and price feeds are unresolved deployment bindings. A symbol such as USDT does not establish whether a token is native, bridged or a successor representation. Use `SECONDARY_STABLE` in generic code until these bindings are verified. The demo cannot claim two-sided lending if only one adapter/reserve is configured; show idle secondary inventory accurately.

The verifier MUST check deployed code, token decimals, adapter `VAULT`, adapter underlying/aToken/pool consistency, oracle metadata, official router/Aqua wiring, exact program hash and role assignments. SDK/source version mismatches fail the verification script before UI rehearsal.

### 2.1 Canonical program

Target source: SwapVM `v1.0.2`, commit `32c687c2b73101fc26549e48fa1ff8a4d73afbac`.

Selected program shape:

`deadline → extruction(CashPlusPricing, canonicalArgs) → salt`

The pricing extension is terminal for pricing and sets the missing exact-input output quantity. `salt` is only a hash differentiator. Do not add a flat-fee instruction as well as a spread in the pricing extension unless the explicit pricing formula changes; that would charge twice.

All four maker hooks target the vault. Aqua receiver remains the maker. No WETH unwrap, arbitrary receiver or unsupported callbacks. Initial implementation supports exact-input swaps only; exact-output reverts with an explicit error.

The SDK's current Aqua builder lacks the extension method. Implement a narrowly scoped encoder using official argument layouts and the **Aqua** opcode table from the pinned source. Account for the table's actual generated indexing; do not copy a number from an unrelated router. The factory reconstructs the complete ABI-encoded order and the frontend/CLI compiler must match it byte-for-byte.

`orderHash = keccak256(abi.encode(order))` in Aqua mode. Hashing bare program bytes is incorrect. Golden fixtures cover order traits, hook data, args, salt, deadline, decimals and both token directions.

The vault accepts shipping only from the factory's reconstructed canonical order with current policy version. The keeper never supplies unchecked program bytes. Short order lifetime and docking provide operational control; the hook policy remains authoritative even if docking is delayed.

## 3. Vault accounting and shares

### 3.1 Units and assets

Accounting numeraire: raw native USDC units, 6 decimals on this deployment. Share precision: 18 decimals. Every token has independently validated decimals; no assumption that both stablecoins use 6 decimals.

For token `i`:

`holdings_i = wallet underlying_i + adapter underlying-equivalent_i`

Normalize each feed answer to the same USD precision, then:

`valueInUsdcRaw_i = floor(holdings_i × priceUsd_i × 10^6 / (10^decimals_i × priceUsd_USDC))`

`A = sum(valueInUsdcRaw_i)`

For USDC itself, use its exact raw balance plus adapter balance rather than introducing avoidable oracle-rounding error. USD display still requires USDC/USD if labeled dollars.

Do not count both aTokens and their underlying-equivalent value. Do not add Aqua virtual balances. Aave interest is reflected through the adapter's receipt balance/index. No borrowing, collateral debt or leverage is permitted.

### 3.2 Seed and share formulas

Deploy and seed atomically through the deployment factory. Mint initial shares at `1 USDC raw unit = 10^12 share raw units`. Lock a disclosed sponsor seed in a non-redeemable seed account so `S > 0` for the lifetime of the vault. Suggested local fixture: 1,000 USDC. The sponsor seed remains in TVL but is not attributed to the investor wallet.

This deliberately replaces the original virtual-offset formula with a simple proportional ledger protected by atomic seeding, a locked seed, minimum amounts and user-signed minimum shares. Do not mix the two formula families.

After initialization:

- Deposit `D`: `q = floor(D × S / A_before)`.
- Value of `q` shares: `V = floor(q × A / S)`.
- Cash redeem `q`: `U = floor(q × A / S)` in raw USDC.
- Proportional exit component `j`: `out_j = floor(componentBalance_j × q / S)`.

Mint/burn uses pre-transfer assets and supply. Require positive output; preserve dust in the pool. A direct donation increases the value of all existing shares and is not an investor deposit or conversion income. Test donation/inflation attempts and slippage protection around seed/minimum-deposit sizes.

Reject initialization if unexpected supported-token assets are already present at the predicted vault/adapter addresses, and use a fresh deployment salt if necessary. Token prefunding must not create unowned NAV at the first investor's expense. No public deposit is possible before the atomic seed completes.

### 3.3 Fees and account cashflows

Contract demo fees are zero. No performance-fee shares, management-fee accrual or offchain expense liability exists in this version. Real token losses/costs from rebalancing remain reflected in balances. External gas paid by the test operator is not silently deducted from investor NAV.

Maintain `depositedUsdc[owner]`, `withdrawnUsdcEquivalent[owner]` and `hasUnvaluedExit[owner]`. Cash withdrawal adds its actual USDC output. Normal proportional exit adds the validated USDC value of transferred components. Emergency exit without reliable valuation marks the cashflow history incomplete; it never books an invented zero-valued redemption.

`accountResult = currentClaim + cumulativeWithdrawals − cumulativeDeposits` is signed and may be negative. The UI labels whether all withdrawals are valued. A fully exited account can still display historical result. A new deposit after exiting retains lifetime cashflow history; per-period reporting uses events.

### 3.4 Deposit and withdraw behavior

Deposit requires healthy valuation, allowed mode, amount minimum, capacity, current policy version, deadline and `minShares`. Transfer exactly the requested USDC, verify balance delta and mint shares. Fail the entire transaction on mismatch. Supply into Aave happens through a later bounded keeper action, so an Aave supply outage does not strand a partially completed deposit.

Cash redemption requires healthy valuation and sufficient executable USDC. Withdraw the precise shortfall from the USDC adapter; if Aave cannot deliver, revert atomically. Burn shares and pay only the caller. Recheck final output minimum. Cash redemptions may temporarily reduce the hot-buffer target; the buffer is a trading preference, not a reason to prevent an otherwise executable investor exit.

The full post-withdrawal inventory must remain consistent with the trading policy. If redemption makes the secondary-token weight exceed the trading cap, allow the investor's valid exit but atomically pause new trades that increase that exposure and mark a rebalance requirement. Do not misrepresent the trading cap as a guaranteed maximum under withdrawals or price shocks.

## 4. Proposed ABI surface

Signatures are normative interface requirements; tuple packaging may change without changing semantics. Generated ABI is the implementation source of truth.

```solidity
function deposit(uint256 assets, uint256 minShares, uint64 deadline,
                 uint64 expectedPolicyVersion) external returns (uint256 shares);

function redeem(uint256 shares, uint256 minUsdcOut, uint64 deadline,
                uint64 expectedPolicyVersion) external returns (uint256 assets);

function redeemAll(uint256 minUsdcOut, uint64 deadline,
                   uint64 expectedPolicyVersion) external returns (uint256 assets);

function redeemProportional(uint256 shares, uint256[] calldata minAmounts,
                            uint64 deadline) external returns (uint256[] memory amounts);

function previewDeposit(uint256 assets) external view returns (uint256 shares);
function previewRedeem(uint256 shares) external view returns (uint256 usdcValue);
function previewProportional(uint256 shares) external view returns (uint256[] memory amounts);
function sharesOf(address owner) external view returns (uint256);
function totalAssets() external view returns (uint256 usdcRaw);
function totalShares() external view returns (uint256);
function accountCashflows(address owner) external view returns
    (uint256 deposited, uint256 withdrawnValue, bool incomplete);
function status() external view returns (Status memory);
function inventory() external view returns (InventoryItem[] memory);

function park(address token, uint256 amount) external;       // restricted keeper
function unpark(address token, uint256 amount) external;     // restricted keeper
function shipCanonical(ProgramParameters calldata params) external;
function dock(bytes32 orderHash) external;
function lowerDepositCap(uint256 cap) external;
function setPause(bool deposits, bool trading) external;     // role constrained
```

`previewRedeem` is a valuation preview, not a promise of cash liquidity. The client simulates the actual `redeem` call to estimate availability. Cap/minimum/status views remain readable when oracle-dependent valuation fails where possible.

Required events:

- `Deposited(owner, assets, shares, policyVersion)`.
- `Redeemed(owner, shares, usdcOut)`.
- `ProportionalExit(owner, shares, tokens, amounts, valueUsdc, valuationAvailable)`.
- `Parked(token, amount)` and `Unparked(token, amount)`.
- `JitUnparked(orderHash, token, amount)`.
- `ConversionSettled(orderHash, taker, tokenIn, tokenOut, amountIn, amountOut, inputValueUsdc, outputValueUsdc, policyVersion)`.
- `StrategyShipped(orderHash, policyVersion, deadline)` and `StrategyDocked(orderHash)`.
- `PolicyUpdated(version, policyHash)`, `PauseUpdated(...)`, `CapacityUpdated(oldCap, newCap, reasonHash)`.
- `StateCheckpoint(totalAssetsUsdc, totalShares, usdcLendingIndex, secondaryLendingIndex, valuationAvailable)` after economic operations.

Use actual ERC-20 transfer logs, adapter events and official SwapVM/Aqua events to corroborate the custom fill event. Event presence alone without receipt success is not settlement.

## 5. Pricing and settlement

### 5.1 Pricing extension

`CashPlusPricing` implements the pinned Extruction interface. It is immutable, does not custody tokens, does not mutate state and returns identical results for identical quote/swap inputs at the same state. It verifies maker, order version, supported pair, exact-input direction, active policy, oracle health and available budgets.

Price formula:

`fairOut = floor(amountIn × priceInUsd × 10^decimalsOut / (priceOutUsd × 10^decimalsIn))`

`effectiveSpreadBps = baseSpreadBps + boundedInventorySurchargeBps`

`amountOut = floor(fairOut × (10000 − effectiveSpreadBps) / 10000)`

Inventory surcharge uses pre-trade weight of the incoming asset above its configured target, with a bounded coefficient. It cannot become negative or exceed the hard spread maximum. This avoids a circular calculation in which output depends on a post-trade weight that itself depends on output. The hooks then validate exact post-trade inventory.

Set `swap.amountOut`; preserve the exact supplied `amountIn`. Do not change virtual registers to manufacture output liquidity. Keep `amountNetPulled` consistent with the absence of extra maker-token fee pulls. Return `nextPC` unchanged so execution proceeds to the canonical salt/end; consume only the documented taker-argument bytes, preferably none for this design. No backward jumps or branch-dependent quote/swap semantics.

The quote must fit the order's Aqua output virtual balance and the vault's aggregate risk budget. A successful quote is not a cash-liquidity guarantee because hooks/Aave settlement are not fully executed by the router's quote call. The CLI also simulates the complete swap.

Chainlink stablecoin prices are not guaranteed to update within a 5 bps trading margin. This is a real limitation: oracle-bounded prices can still be stale relative to the executable market. Short order expiry, small budgets and a designated demo taker bound the demonstration. This specification does not claim the pricing formula is ready for unrestricted profitable market making. Production quoting needs independent live executable-price checks and economically justified spread calibration.

### 5.2 Force input-first settlement

The official router lets a taker select transfer order, and its reentrancy guard is per order hash. A vault may have multiple orders, so that guard is insufficient by itself.

Use all four maker hooks and a vault-global settlement state:

`IDLE → EXPECTING_INPUT → INPUT_RECEIVED → EXPECTING_OUTPUT → IDLE`.

1. `preTransferIn`: only pinned router; maker is vault; taker is allowed; order active and current; state IDLE. Record balances, amounts, pair/order, validated prices and budget snapshot. Enter EXPECTING_INPUT.
2. Router receives taker token and uses `transferFrom + Aqua.push` into the maker. The demo taker must choose this documented path and have allowance.
3. `postTransferIn`: require matching context and exact actual token-in balance delta. Enter INPUT_RECEIVED. Reject fee-on-transfer and unexpected balance behavior.
4. `preTransferOut`: require INPUT_RECEIVED and same context. This makes output-first fail. Recompute/check post-trade exposure and global budgets. Unpark exactly the required token-out shortfall plus any affordable configured post-trade buffer. Snapshot actual token-out balance after unpark. Enter EXPECTING_OUTPUT.
5. Aqua pulls output from the vault to the taker's selected recipient.
6. `postTransferOut`: verify exact output delta, final supported balances and policy. Consume aggregate per-fill/day budgets, emit fill/checkpoint events and return to IDLE.

No deposit, redeem, ship, park, governance change or another order's first hook may execute during non-IDLE settlement. Reentrancy guards must permit only the intended hook sequence, rather than applying a naive nonReentrant modifier that makes legitimate later hooks fail. Reverted transfers restore the whole state, budget and Aave withdrawal.

For the demo, the counterparty CLI fixes recipient to the counterparty wallet, disables arbitrary callbacks, uses input-first and binds minimum output/deadline. Maker hooks do not expose the payout recipient; do not claim that the vault independently validates a business beneficiary. That feature would require an executor or another binding mechanism outside this scope.

### 5.3 Just-in-time funding

Let `B` be current wallet output-token balance, `O` required output and `T` the desired post-trade hot buffer. Required unpark is `max(0, O + T − B)`, bounded by actual adapter holdings and available Aave liquidity. If the optional target would make an otherwise solvent trade fail, policy must specify whether T is mandatory for trades; in this version the configured trading buffer is mandatory, while investor redemptions have priority.

Do not count the output tokens as still earning lending interest after they have left the adapter. Do not claim a virtual allocation locks those tokens. The final actual balances and lending indices determine NAV.

Re-supply incoming excess in a subsequent keeper operation, rather than adding another external protocol dependency to every settlement's final hook. The UI can show “Conversion completed” before the next park completes; it must not claim the whole amount is already earning on Aave.

## 6. Risk policy

Illustrative fork fixtures, not validated production risk limits:

| Parameter | Fixture |
|---|---:|
| Hot USDC target | 5% of NAV |
| Secondary-token target / trade-increase cap | 10% / 20% of NAV |
| Maximum one fill | 1% of NAV |
| Daily gross trade budget | 20% of start-of-day NAV |
| Base spread | 5 bps |
| Maximum inventory surcharge | 10 bps |
| Order lifetime | 5 minutes; keeper rotates before expiry |
| Example peg-deviation halt | 50 bps relative to $1, independently for each stablecoin |

Gross daily budget counts both directions, not net exposure. Fix daily denominator at the first canonical policy checkpoint of the UTC day, so a deposit cannot repeatedly reset consumed budget. Cap decreases and pause operations do not reset consumption. Every order shares the same budget. Same-day order rotation cannot bypass it.

Oracle checks: positive answer, valid round/timestamp, not future-dated, `answeredInRound` consistency where applicable, configured per-feed heartbeat plus tolerance, maximum cross-feed timestamp skew, peg bounds and L2 sequencer status/grace period. Do not inherit the old ETH feed's staleness constant for stablecoins.

Trading must check expected aggregate post-fill inventory, not only each order's virtual allocation. During a price shock, actual weight can exceed a target without a new trade. Pause exposure-increasing trades; avoid claiming a stop prevents the first loss.

All token transfers use approved ERC-20s with known behavior and SafeERC20. Reject fee-on-transfer/rebasing underlying assets. Aave receipt behavior is isolated in the adapters. Verify any token approval-reset requirement in fork tests. No debt, leverage, bridges, ETH price exposure or arbitrary strategy calls inside the vault.

Allowances are specific to each leg: investor → vault, vault → its adapter, adapter → Aave pool, vault → official Aqua, and counterparty → official SwapVM for the chosen push path. Do not confuse Aqua's pull authority with the router's input allowance. Prefer exact per-operation adapter/pool allowances; bound/reconcile the Aqua allowance against the supported output policy and revoke it on shutdown. Hook policy is mandatory even when allowance exists. Never let a keeper choose a new spender.

## 7. Proportional and emergency exit

The deterministic component order is `[USDC wallet, secondary wallet, aUSDC adapter, secondary aToken adapter]`, omitting disabled adapters by manifest version. A proportional exit transfers `floor(q/S × componentBalance)` of each component. The adapter must implement `transferReceipt(to, amount)`, callable only by its vault, so the exit need not redeem Aave underlying.

Update shares and cashflow state before external transfers; guard reentrancy; enforce the reviewed minimum array and deadline. If any transfer fails, the entire exit reverts. This path cannot guarantee liquidity of receipt tokens and can itself be affected by token/protocol transfer restrictions.

When oracles are healthy, record the USDC-equivalent withdrawal. When governance/guardian has activated emergency proportional mode because valuation is unusable, redemption uses quantities and share ratios only, marks valuation unavailable and records incomplete account P&L. No performance-fee issue exists because demo fee rates are zero.

Emergency mode halts deposits and new trades. It must not let an investor manufacture a fake oracle failure to receive assets at a preferential price; all exits remain strictly proportional to token quantities. Removing trading inventory through exits invalidates later quotes naturally; the keeper docks/rotates orders, while hook checks remain the immediate protection.

## 8. Local automation

`pnpm cash-plus:keeper` performs one serial loop:

1. Read chain/run ID, manifest code hashes, policy, pause state, oracle/sequencer health, balances and outstanding orders.
2. If invalid, stop creating exposure, attempt permitted pause/dock actions and print a structured reason. Never retry a failed write in an unbounded loop.
3. Reconcile completed/pending keeper transactions and nonce before proposing a new one.
4. Move eligible idle assets into Aave above the hot buffer; withdraw to restore a depleted trading buffer only when policy permits.
5. Rotate expired/near-expiry canonical programs within aggregate virtual and real budgets.
6. Evaluate deposit capacity and exposure. Lower capacity when configured inputs require it; do not increase hard caps without the appropriate authority.
7. Emit a concise local status line and wait with backoff. Default fixture interval 10 seconds, one pending management transaction per signer.

No private key in the browser. The UI reads resulting events rather than relying on the script's stdout for financial state. Script restart reconciles onchain active orders; it does not blindly ship duplicates. All writes are simulated with explicit chain and destination checks before send.

### 8.1 Capacity demonstration

Onchain hard cap limits deposits. The keeper may lower an effective cap; only governance can raise it within a hard ceiling. Existing investors are never forced out if a cap drops below NAV; headroom simply becomes zero.

Economic-capacity calculation is an optional, clearly labeled simulation on the page. With annual external margin `M`, fixed costs `C`, buffer drag `d`, target investor excess `e` and excess fee `f`, illustrative capacity is:

`capacity = max(0, (M − C) / (d + e/(1−f)))`.

Using M=$12,000, C=$4,000, d=0.002, e=0.005, f=0.20 gives approximately $969,697. Historical/assumed volume does not guarantee future demand. The demo does not turn its own counterparty fills into validated annual commercial volume.

For an onchain cap-change scene, the operator applies an explicitly named fixture policy report hash. The presentation must call it a simulated capacity decision, not a discovered real B2B revenue forecast. Automated lowering due to actual inventory/health constraints can be shown separately as a real policy response.

## 9. Suggested CLI contracts

| Command | Behavior |
|---|---|
| `pnpm cash-plus:verify` | Validate selected manifest, bytecode and protocol bindings |
| `pnpm cash-plus:deploy-fork` | Deploy/seed Cash+ and adapters on the configured local fork; export artifacts |
| `pnpm cash-plus:ship` | Compile canonical order, compare factory bytes, simulate and ship |
| `pnpm cash-plus:keeper` | Run the bounded management loop |
| `pnpm cash-plus:counterparty --scenario normal` | Execute a real stablecoin conversion through official SwapVM/Aqua on the selected demo chain |
| `pnpm cash-plus:counterparty --scenario exceeds-limit` | Simulate and show expected rejection, optionally send only on the local fork if a reverted receipt is needed |
| `pnpm cash-plus:demo --step ...` | Orchestrate named rehearsal steps, stopping on failed evidence |

Do not use one command that resets a chain containing an unreconciled demonstration wallet transaction. Reset is explicit, local-only, gives a new run ID and re-exports a manifest. Production mode refuses impersonation, balance modification and time-travel RPC methods.

## 10. Critical invariants

1. Investor claims plus locked seed ownership reconcile with actual NAV, subject only to documented rounding.
2. Aqua virtual balances never increase NAV or create another independent risk budget.
3. Deposits cannot mint against post-deposit assets; withdrawals cannot burn another investor's shares.
4. Failed swaps revert all input/output movements, adapter operations and consumed budget.
5. Output cannot precede verified input in an accepted Cash+ fill.
6. One order cannot reenter a second order or a deposit/redemption path during settlement.
7. No keeper action transfers investor assets to the keeper or accepts arbitrary external calls.
8. Quote and swap amounts match at identical state; exact-output and unsupported pairs fail explicitly.
9. Proportional exit transfers the same ownership fraction of every supported component and cannot use stale dollar prices to favor one investor.
10. The demo UI reports chain evidence separately from modeled annual economics.

These are implementation/test requirements. This specification is not a security audit or proof that the selected strategy outperforms lending.
