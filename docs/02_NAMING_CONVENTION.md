# 02, Naming Conventions

Complete naming system: artifact IDs, names for screens, components, hooks, variables, functions, files, and folders.

## Principles

1. **Descriptive over brief.** `usePortfolioStats` beats `usePS`.
2. **English in code, translations in the UI.** All technical identification in English. Translation is the i18n layer's responsibility.
3. **Consistent per category.** If one hook starts with `use`, all do.
4. **No generic prefixes.** Avoid `Wrapper`, `Container`, `Helper`, `Manager`, `Service` when something more specific is possible.
5. **Singular vs plural reflects cardinality.** `position` vs `positions`.

---

## Part A, artifact IDs

### Format
```
PP-[AREA]-[TYPE]-[NNN]
```

| Component | Values | Example |
|-----------|--------|---------|
| Prefix | `PP` (Pool Party) | `PP` |
| AREA | CORE, LAY, ONB, AUTH, DASH, PORT, STR, SAV, TOK, PRED, PERP, CARD, DEP, REW, MGR, PROF, NOTI, ACT, ERR | `DASH` |
| TYPE | SCR, MOD, CMP, LAY, FLW, HOK, CTX, STO, LIB, MCK, STY, I18N | `SCR` |
| NNN | Sequential, zero-padded | `001` |

Final example: `PP-DASH-SCR-001`.

### Areas

Taxonomy reflects the actual Pool Party V2 product surfaces (managed-investing fintech app), as swept from Figma into `IDS_REGISTRY.md` / `FIGMA_INVENTORY.md`.

| Code | Meaning |
|------|---------|
| CORE | Design system, primitives, generic reusable components & modals |
| LAY | Global layouts / app chrome (Mobile Header & Tab Bar, Desktop Sidebar, Top Bar, Footer) |
| ONB | Onboarding (reserved) |
| AUTH | Sign in / sign up, wallet connection, OTP verification |
| DASH | Home / dashboard |
| PORT | Portfolio (holdings & performance) |
| STR | Strategies (managed investing) + invest/collect/withdraw flow |
| SAV | Savings (abstracted lending markets) |
| TOK | Buy tokens (spot exposure) |
| PRED | Predictions (Polymarket + Kalshi) |
| PERP | Futures / Perps (Hyperliquid) |
| CARD | Cards (virtual debit cards) |
| DEP | Deposit (fiat onramp) |
| REW | Rewards (Rubber Rush, Manager Incentive Program, Referral) |
| MGR | Manager: investor-facing manager profile + the B2B Manager Console |
| PROF | Profile & account / settings |
| NOTI | Notifications center |
| ACT | Activity / transaction history |
| ERR | Error pages (404, 500, etc.) |
| ADM | Internal Admin / Ops Console |

### Types
| Code | Meaning | Example |
|------|---------|---------|
| SCR | Screen, full page | `PP-DASH-SCR-001` Home |
| MOD | Modal/Dialog/Drawer/Sheet | `PP-STR-MOD-002` Invest confirm |
| CMP | Reusable component | `PP-CORE-CMP-010` Button |
| LAY | Layout / app chrome | `PP-CORE-LAY-001` AppShell |
| FLW | Flow (multi-screen sequence) | `PP-DEP-FLW-001` Deposit flow |
| HOK | Custom hook | `PP-DASH-HOK-001` usePortfolioStats |
| CTX | React context | `PP-AUTH-CTX-001` WalletContext |
| STO | Zustand store | `PP-AUTH-STO-001` walletStore |
| LIB | Lib/utility | `PP-CORE-LIB-003` formatCurrency |
| MCK | Mock data/service | `PP-CORE-MCK-001` simulation utils |
| STY | Style token | `PP-CORE-STY-001` design tokens |
| I18N | Translation namespace | `PP-CORE-I18N-001` common translations |

### Where the ID appears
1. Figma frame name. 2. Linear issue title: `[PP-XXX-XXX-XXX] description`. 3. File header: `@id PP-XXX-XXX-XXX`. 4. Commit: `feat(PP-DASH-SCR-001): ...`. 5. PR title: `feat(PP-DASH-SCR-001): description @rules-vN`. 6. `docs/IDS_REGISTRY.md`. (The **branch** carries the Linear issue `poo-<num>`, not the artifact ID — see Part E.)

### Reservation and numbering
- IDs are sequential within each AREA+TYPE combination.
- Reserved on demand.
- IDs are **never recycled.** Removed ones become `Removed` in the registry, with history.
- `figma-inventory` reserves blocks during the initial sweep; afterwards, one at a time.

---

## Part B, code artifact naming

### Screens

**Technical name (in code):**
- PascalCase, ending in `Page`.
- Clear noun for what it shows, not a verb.
- No articles: not `TheDashboard`, use `DashboardPage`.
- No possessives: not `MyPortfolioPage`, use `PortfolioOverviewPage`.

| ID | Technical name | File name |
|----|----------------|-----------|
| PP-DASH-SCR-001 | `HomePage` | `src/app/[locale]/(app)/home/page.tsx` |
| PP-PORT-SCR-001 | `PortfolioPage` | `src/app/[locale]/(app)/portfolio/page.tsx` |
| PP-STR-SCR-001 | `StrategiesExplorePage` | `src/app/[locale]/(app)/strategies/page.tsx` |
| PP-STR-SCR-002 | `StrategyDetailPage` | `src/app/[locale]/(app)/strategies/[strategyId]/page.tsx` |
| PP-SAV-SCR-001 | `SavingsMarketsPage` | `src/app/[locale]/(app)/savings/page.tsx` |
| PP-PROF-SCR-001 | `ProfilePage` | `src/app/[locale]/(app)/profile/page.tsx` |

> Mobile and Desktop of the same screen **share one ID** (responsive, one `page.tsx`). The full mapping of every ID to its Figma frames lives in `IDS_REGISTRY.md` and `FIGMA_INVENTORY.md`.

**User-facing name (translated in JSONs):** clear noun in the locale language, no technical code, varies per locale.

### Modals
- PascalCase. Suffix `Modal`, `Dialog`, or `Drawer`. Verb-noun describing the action.

| Good | Bad | Why |
|------|-----|-----|
| `InvestConfirmModal` | `InvestModal` | Confirm step or amount step? Ambiguous. |
| `WithdrawConfirmModal` | `WithdrawModal` | Which step? |
| `ConnectWalletDialog` | `WalletDialog` | Connect OR view balance? |

### Components
- PascalCase. Descriptive noun. Optional suffix indicating the component "shape":

| Suffix | When | Example |
|--------|------|---------|
| `Card` | Card-shaped component | `StrategyCard` |
| `List` | Rendered list | `StrategyList` |
| `Item` | One element of a list | `StrategyListItem` |
| `Row` | Table row | `PositionTableRow` |
| `Form` | Full form | `InvestForm` |
| `Field` | Form field | `TokenAmountField` |
| `Section` | Page section | `StatsSection` |
| `Header`, `Footer` | Header or footer | `AppHeader` |
| `Provider` | React provider | `WalletProvider` |
| `Skeleton` | Loading state | `StrategyCardSkeleton` |
| `Empty` | Empty state | `PositionsEmpty` |
| `Error` | Error state | `StrategyListError` |

**Avoid:** `Wrapper`, `Container`, `Box`, `Helper`, `Manager`, `Util` (vague); `Generic`, `Common`, `Base` (except as an explicit base class).

### Hooks
- camelCase, always starting with `use`. Verb when describing an action (`useConnectWallet`), noun when describing state/data (`usePortfolioStats`).

### Stores Zustand
- camelCase, suffix `Store`: `walletStore`, `uiStore`, `transactionQueueStore`.

### Contexts
- PascalCase, suffix `Context`; provider with suffix `Provider`.

### Variables
- camelCase. Booleans with `is`/`has`/`should`/`can`/`was`. Arrays plural (`positions`). Lookup maps `positionById`. Global constants `SCREAMING_SNAKE_CASE` (`MAX_SLIPPAGE_BPS`).

### Functions
- camelCase, starting with a verb:

| Prefix | Meaning |
|--------|---------|
| `get` | Returns existing value |
| `fetch` | Async external fetch |
| `compute`, `calculate` | Pure, derives a value |
| `format` | Converts for display |
| `parse` | String to type |
| `validate`, `assert` | Validates, throws on bad |
| `is`, `has`, `can` | Booleans |
| `create`, `make`, `build` | Constructs new |
| `submit`, `save`, `update`, `delete` | Side-effect |

Avoid `handle*` except for event handlers; avoid `do*`, `process*` (vague).

### Types and interfaces
- PascalCase, noun, no `I` prefix. Suffix by purpose: none (domain entity), `Props`, `Options`, `Input`, `Result`, `Contract`, `Filter`, `State`, `Action`, `Event`.

Discriminated unions for state machines:
```ts
type TransactionStatus =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'pending', hash: `0x${string}` }
  | { kind: 'confirmed', hash: `0x${string}`, blockNumber: number }
  | { kind: 'failed', hash: `0x${string}`, error: string }
```

### Enums and literals
Prefer string literal unions over `enum`. Use kebab-case for readable literals:
```ts
type PositionStatus = 'active' | 'paused' | 'closed'
type RiskLevel = 1 | 2 | 3 | 4 | 5
type ChartRange = '24h' | '7d' | '30d' | '90d' | 'all'
```

---

## Part C, file and folder naming

### Files
| Type | Pattern | Example |
|------|---------|---------|
| React component | `PascalCase.tsx` | `Button.tsx` |
| Hook | `camelCase.ts` (with `use*`) | `usePortfolioStats.ts` |
| Utility | `camelCase.ts` | `formatCurrency.ts` |
| Types | `camelCase.ts` or `types.ts` | `position.ts` |
| Zod schema | `camelCase.ts` | `positionSchema.ts` |
| Zustand store | `camelCase.ts` (with `*Store`) | `walletStore.ts` |
| Context | `PascalCase.tsx` (with `*Context`) | `WalletContext.tsx` |
| Mock service | `camelCase.ts` (with `*Service`) | `strategyService.ts` |
| Mock data | `camelCase.ts` (plural for collections) | `pools.ts` |
| Fixture | `camelCase.ts` | `manyPools.ts` |
| Test | same name + `.test.{ts,tsx}` | `Button.test.tsx` |
| Story | same name + `.stories.tsx` | `Button.stories.tsx` |
| Translation | `<namespace>.json` | `dashboard.json` |
| Markdown doc | `kebab-case.md` or `NUMBERED_TITLE.md` for canonical | `04_CODE_STANDARDS.md` |

### Folders
- **kebab-case** always. Plural for collections (`components/`), singular for single concepts (`app/`, `lib/`). No spaces, accents, or special characters.

---

## Part D, translation naming (i18n)

### Keys
- **camelCase**, hierarchical, max 3 levels. Pattern: `<namespace>.<sub>.<element>`.

### Standard suffixes by string type
`.title`, `.description`, `.cta`, `.label`, `.placeholder`, `.tooltip`, `.error`, `.aria.<name>`.

### Namespaces
`common`, `errors`, `dashboard`, `pools`, `positions`, `wallet`, `settings`, `onboarding`.

---

## Part E, branches, commits, PRs

**Model.** Trunk-based: short-lived branches off `origin/main`, **one per Linear issue**, squash-merged through a PR, then **deleted on merge** (the repo auto-deletes the head branch). Never commit to `main`. Land partial work **behind a feature flag** so a branch can merge before the whole feature is done — that is what keeps branches short and few at a time, not fewer branches. Operational detail in `_claude-code-config/skills/git-workflow/SKILL.md`.

**Branch** — `<type>/<area>-poo-<num>-<slug>`

> **This section is the single source of truth for branch naming.** If `CLAUDE.md` or any skill (`git-workflow`, `pr-review-checklist`, …) disagrees, this wins.

| Part | Values |
|------|--------|
| `<type>` | `feat` `fix` `chore` `docs` `refactor` `test` `perf` `ci` (Conventional Commits) |
| `<area>` | **required** — the lowercase **domain token** (see below) that separates the surfaces. **Never omit it**: `feat/mgr-poo-242-move-range`, not `feat/poo-242-move-range`. |
| `poo-<num>` | the **Linear issue key, lowercase** — this is what auto-links the branch in Linear; one issue per branch. Not the artifact ID. |
| `<slug>` | 2–4 kebab words |

`<area>` is the lowercased Part A AREA for UI work (`core` `lay` `auth` `dash` `port` `str` `sav` `tok` `pred` `perp` `card` `dep` `rew` `mgr` `prof` `noti` `act`) **plus** the non-UI domains the backend/integration teams own: `int` (onchain integration), `wallet`, `chain`, `api`, `bff`, `db`, `adm` (admin/ops), and cross-cutting `i18n` `a11y` `analytics` `security`. The token is the surface separator: `mgr-*` (Manager) vs the user-app areas vs `api-*`/`db-*`/`int-*` (backend).

Examples: `feat/mgr-poo-242-move-range` · `feat/dep-poo-250-paybis-handoff` · `fix/port-poo-003-risk-bands` · `feat/int-poo-194-privy-providers` · `feat/api-poo-205-bff-routes` · `feat/db-poo-260-drizzle-schema` · `chore/i18n-poo-231-native-review`.

**Commit** — `<type>(<PP-ID>): <description> [rules-vN]` · **PR title** — `<type>(<PP-ID>): <description> @rules-vN` (Conventional Commits — squash-merge makes the PR title the commit subject on `main`, so it must be a valid commit subject, not a `[<ID>]` bracket form), body references `Closes POO-<num>`.

> The **branch** carries the **Linear issue** (`poo-<num>`) for work-item auto-linking; the **commit and PR title** carry the **artifact ID** (`PP-AREA-TYPE-NNN`) for artifact traceability. Backend/integration/db work with no UI artifact uses the Linear issue (`POO-<num>`) in the commit/PR instead of a `PP-ID`. A meta chore with no issue may omit `poo-<num>` (e.g. `docs/core-branching-convention`).

---

## Part F, negative naming (what NOT to use)

| Category | Avoid | Use instead |
|----------|-------|-------------|
| Generic prefixes | `data`, `info`, `item`, `obj` | Specific name |
| Generic suffixes | `Manager`, `Handler`, `Helper`, `Util`, `Wrapper`, `Container` | Specific name describing the function |
| Obscure abbreviations | `pos`, `pol`, `usr`, `cfg` | `position`, `pool`, `user`, `config` |
| Hungarian notation | `strName`, `bIsActive` | TypeScript already covers types |
| Boolean anti-pattern | `flag`, `status` (without saying what) | `isOpen`, `connectionStatus` |
| `My*` in entities | `MyDashboard` | `PortfolioOverview` |
| Verbs without object | `process`, `do`, `run` | `processTransaction` |
| Ambiguous plurals | `infos`, `datas` | `details`, `records` |
| Portuguese names in code | `posicao`, `formatarMoeda` | `position`, `formatCurrency` |

---

## Part G, screen naming, canonical list

The canonical reference of every screen, modal, and component name now lives in **`IDS_REGISTRY.md`** (the central ID registry) and **`FIGMA_INVENTORY.md`** (the per-area Figma sweep). Both were populated from the Figma sweep on 2026-05-29 (99 artifacts: 40 screens, 25 modals, 34 components across Mobile + Desktop). Do not duplicate the list here - update the registry. The entry template below documents the registry row shape.

Entry template:
```
### PP-AREA-TYPE-NNN
- Technical name: `XxxPage`
- User-facing (en): "..."
- User-facing (pt-BR): "..."
- User-facing (es): "..."
- Figma: <link>
- i18n namespace: `xxx`
- Type: Screen | Modal | Component
- Status: Backlog | In Progress | Done
```

---

## Part H, analytics event naming

Analytics events follow `<area>_<object>_<action>`, snake_case, max 40 chars (GA4 requirement).

- `area`: an OAMS product surface: `auth`, `wallet`, `nav`, `app`, `dashboard`, `portfolio`, `strategy`, `savings`, `token`, `prediction`, `perp`, `card`, `deposit`, `reward`.
- `object`: the thing acted on (signin, connect, list, detail, invest, deposit, withdraw, buy, sell, bet, trade, request, topup, etc.).
- `action`: past tense for completion (`viewed`, `completed`, `failed`, `closed`), present for attempt/intent (`started`, `submitted`).
- Transactional flows use the funnel `started` then `submitted` then `completed` (or `failed`).

There are no `pool_*`, `liquidity_*`, or `swap_*` events (the product has no Uniswap-style primitives). The canonical event list is `docs/ANALYTICS_EVENTS.md`, kept in sync with the typed `AnalyticsEvent` union in `src/lib/analytics/events.ts`. Full spec in `09_ANALYTICS.md` and the `analytics-tracking` skill. Privacy: never put secrets in event names or params; the wallet address travels only as a hashed `user_id`.

## Part I, GTM container naming (tags, triggers, variables)

Names inside the Google Tag Manager container follow `<type> - <description>` so the workspace stays scannable as it grows. The container and GA4 ids are recorded in Linear (the analytics activation issue), not in the repo; the container id is injected at runtime via `NEXT_PUBLIC_GTM_ID` (host env / `.env.local`), never committed to `.env.example`.

**Tags** -> `GA4 - <function>`

- `GA4 - Configuration` -- the Google tag; sends `page_view` + Enhanced Measurement on the `Init - All Pages` trigger.
- `GA4 - Event - <name>` -- e.g. `GA4 - Event - All app events`, which forwards every dataLayer event via the built-in `{{Event}}` variable.

**Triggers** -> `<type> - <description>`, with the type abbreviated:

- `CE - …` = Custom Event. e.g. `CE - App events` -- a Custom Event trigger matching the regex `^[a-z_]+$`, so it catches our snake_case events and skips GTM's own `gtm.*` events (which contain a dot). GTM uses RE2; do not use lookahead.
- `PV - …` = Pageview · `Click - …` · `Init - …` = Initialization.

**Variables** -> `DLV - <key>` = Data Layer Variable, one per dataLayer key, used to map params onto GA4 events (Phase 2):

- `DLV - value`, `DLV - currency`, `DLV - usd_value_at_time`, `DLV - strategy_id`, `DLV - position_id`, `DLV - deposit_method`, `DLV - risk_level`, `DLV - reward_program`, `DLV - token_symbol`, `DLV - token_amount`.

GA4 is configured inside GTM (the hub), never hardcoded in app code -- see `09_ANALYTICS.md`.
