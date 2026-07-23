# Wallet (connected-wallet modal)

`PP-CORE-MOD-005` (modal) · `PP-CORE-CMP-025` (trigger) · Linear **POO-238** (epic POO-237).

Tapping the connected-wallet chip in the app chrome (`AppShell` header) opens a modal showing the
account, total balance, quick actions, a network filter, and the per-token balances. Bottom-sheet on
mobile, centered dialog on desktop.

## Pieces

- **`WalletMenu`** (`PP-CORE-CMP-025`) — the header entry point: the connected chip + modal, or the
  connect/login fallback when no wallet is connected. This is the single `AppShell` seam for the
  wallet stack (INT-W); it reads connected state from `useAuth()`.
- **`WalletModal`** (`PP-CORE-MOD-005`) — presentational, responsive, composed directly on
  `@radix-ui/react-dialog` (no bottom-sheet primitive exists in the design system yet).
- **`networks.ts`** — display metadata (name + brand color) for the supported networks. The
  canonical chain list lives in `src/lib/chains/config.ts` (POO-195).
- **Balance source** — `src/lib/balances/` (`getTokenBalances` + `useTokenBalances`) and the mock
  `src/mocks/data/balances.ts`. Kept separate from the account service so the INT-W wallet
  integration is untouched.

## Actions

| Action | Behavior |
|--------|----------|
| Buy | Navigates to `/deposit` (Paybis on-ramp). **Live.** |
| Receive | Navigates to `/deposit?mode=receive` (crypto-receive step). **Live.** |
| Swap / Send | In-modal "Coming soon" placeholder. Full flows: **POO-240** / **POO-241**. |
| Copy address | Copies the full checksummed address with an inline "Copied" confirm. |
| Refresh balance | Manually re-reads the balance in place (**POO-808**). Received tokens don't change the address, so the balance never re-reads on its own; the control sits next to the total and spins while running, without blanking to the skeleton. No automatic polling. |
| Manage wallet | Navigates to `/profile`. |
| Disconnect | Logs out via `useAuth().logout()`. |

## Data

- Connected state + address: `useAuth()`.
- Wallet kind (embedded / external): `useAccountService().getWalletKind()` (INT-W5 / POO-197).
- Balances (token amount **and** USD value, per chain): `useTokenBalances()`, which also exposes
  `refresh()` + `isRefreshing` for the manual in-place refresh (**POO-808**).
  `PP-INTEGRATION-POINT` (**POO-239** / **POO-815**): real mode reads the FULL multi-token holdings
  (Alchemy-priced on the backend) from pool-party-api `GET /wallet/{address}?network=` per network,
  merged — server action `getWalletHoldingsAction` → `fetchWalletHoldings` (`apiFetch`, `mapHolding`,
  `walletHoldingsSchema`). On endpoint-unavailable / failure it **falls back to the USDC-only**
  on-chain read (`getRealTokenBalances`), so nothing regresses until the backend (**POO-813**) lands.
- Holdings list layout (**POO-814**): `groupWalletBalances()` splits the holdings into **USDC first**
  (across every network) → a **soft divider** → **all other tokens**, each group sorted by USD desc,
  with rows **< $1 hidden** (the total above still counts them). Each row renders the **token logo**
  (`resolveTokenLogo`, PP-CORE-LIB-021) and its **network logo** (`NetworkLogo`, PP-CORE-CMP-041 via
  `networkSlug(chainId)`).

## i18n

`wallet` namespace, all 11 locales. `en` / `pt-BR` / `es` are authored; the other 8 are
machine-translated pending a native pass (tracked with POO-231). Per the transaction-display rule,
token rows always show the token amount alongside its USD value.
