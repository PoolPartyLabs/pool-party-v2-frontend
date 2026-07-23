# 03, Project Structure

> Kept in sync with the code. Folders that exist only as reserved placeholders (a `.gitkeep` or
> a `README.md`, no implementation yet) are marked **reserved**. Areas that are out of the v1
> build are marked **out of v1**.

## Folder tree

```
pool-party-frontend/
├── .github/workflows/ci.yml
├── .husky/
├── .storybook/{main.ts,preview.tsx,decorators/}
├── docs/                              # 00_OVERVIEW … 10_SECURITY + registries
│   ├── IDS_REGISTRY.md                # central ID registry
│   └── INTEGRATION_POINTS.md          # mock → real integration inventory
├── public/{assets/,brand/}            # brand: duck-head + illustrations
├── src/
│   ├── middleware.ts                  # next-intl routing + CSP (Report-Only) + security headers
│   ├── app/
│   │   ├── globals.css                # Tailwind 4 @theme design tokens (the SOLE token source)
│   │   ├── [locale]/
│   │   │   ├── layout.tsx             # html/body, next/font (Poppins), intl + theme providers
│   │   │   ├── (app)/                 # authenticated area
│   │   │   │   ├── layout.tsx         # AppShell (desktop sidebar / mobile tab bar + top bar)
│   │   │   │   ├── page.tsx           # Home  (+ loading.tsx)
│   │   │   │   ├── portfolio/         # page.tsx + loading.tsx
│   │   │   │   ├── strategies/        # page.tsx + loading.tsx, and [id]/{page,loading}.tsx
│   │   │   │   ├── deposit/           # page.tsx + loading.tsx
│   │   │   │   ├── cards/             # page.tsx + loading.tsx  (placeholder, out of v1 build)
│   │   │   │   ├── rewards/{rubber-rush,manager-incentive-program,referral}/{page,loading}.tsx
│   │   │   │   └── profile/           # page.tsx + loading.tsx
│   │   │   │       └── {personal,social,security,notifications,settings,help}/{page,loading}.tsx
│   │   │   ├── sign-in/ · welcome/ · connect/      # pre-auth (no AppShell, use AuthShell)
│   │   │   └── terms/ · privacy/ · risk/ · learn/  # static legal / info pages
│   │   └── api/csp-report/route.ts    # CSP violation report sink (logs today)
│   │
│   ├── i18n/
│   │   ├── request.ts                 # per-locale namespace loader
│   │   ├── routing.ts                 # locales from config.ts (11 today); localeDetection on
│   │   └── messages/{en,pt-BR,es}/*.json   # one file per feature namespace
│   │
│   ├── components/                    # cross-feature components (Storybook lives here)
│   │   ├── ui/                        # primitives: Button, Card, Dialog, Input, Table, Tabs,
│   │   │                              #   Toast, Tooltip, Skeleton, skeletons, EmptyState,
│   │   │                              #   ErrorState, LocaleSwitcher  — stories mandatory
│   │   ├── layout/                    # AppShell, AppFooter, DevMenu, RewardsPill, StatusModal
│   │   ├── data-display/              # MetricTile, PerformanceChart
│   │   ├── analytics/                 # ConsentBanner, AnalyticsListener
│   │   └── feedback/                  # reserved (empty)
│   │
│   ├── features/                      # one folder per functional area
│   │   ├── auth/ home/ portfolio/ strategies/ deposit/ profile/ rewards/ cards/
│   │   │                              #   each = screen component(s) + components/ subfolder
│   │   └── savings/ buy-tokens/ predictions/ perps/ manager/   # reserved (out of v1)
│   │
│   ├── lib/
│   │   ├── services/index.ts          # mock ↔ real factory — the single data/auth seam
│   │   ├── hooks/usePersistentState.ts # SSR-safe localStorage for simple UI prefs
│   │   ├── utils/{cn,format}.ts
│   │   ├── schemas/index.ts           # Zod schemas (the data contracts)
│   │   ├── security/{csp,headers,cookies}.ts
│   │   ├── analytics/{consent,consentSnippet,events,useAnalytics,sanitizeParams,hashWalletAddress}.ts
│   │   └── constants/ · types/        # reserved (.gitkeep)
│   │
│   ├── mocks/{data,services,fixtures,utils}/   # central mock data + latency/error helpers
│   ├── design-system/{primitives/,README.md}   # tokens are NOT here — they live in app/globals.css @theme
│   ├── hooks/ · stores/ · contexts/   # reserved (.gitkeep) — no global state lib in use
│   └── contracts/README.md            # ABIs + addresses (reserved this phase)
│
├── tests/{setup.ts,utils/renderWithProviders.tsx}
├── biome.json · next.config.ts · vitest.config.ts
├── postcss.config.mjs                 # @tailwindcss/postcss (Tailwind 4 CSS-first; no tailwind.config.ts)
└── package.json · tsconfig.json · README.md · CLAUDE.md
```

## Structure principles

### 1. Features-first
Everything for a functional area lives in `src/features/[area]/`: the screen component(s) (`XScreen.tsx`, `"use client"`) and an area-specific `components/` subfolder. Some areas keep feature-local data (e.g. `profile/mockUser.ts`). Avoids dumping everything in `components/`.

### 2. Global vs feature components
- `src/components/ui/`: universal primitives (Button, Dialog, Input…). **Stories mandatory.**
- `src/components/layout/`: app-wide chrome (AppShell, AppFooter, DevMenu…).
- `src/components/data-display/`, `analytics/`: cross-feature patterns.
- `src/components/feedback/`: reserved (empty) — feedback primitives currently live in `ui/` (`EmptyState`, `ErrorState`, `Toast`).
- `src/features/[area]/components/`: area-specific. **No stories.**

### 3. Centralized mocks behind the service factory
`src/mocks/` is the single source of mock data; components never import it directly — they go through `src/lib/services/index.ts`, which returns mock or real implementations. Each mock has a `// PP-INTEGRATION-POINT` comment (see `INTEGRATION_POINTS.md`). `src/mocks/utils/` ships `simulateDelay` / `simulateError` helpers for exercising loading / error states.

### 4. Design tokens are CSS-first
There is **no** `design-system/tokens/*.ts`. The single source of truth is the Tailwind 4 `@theme` block in `src/app/globals.css` (colors, radii, fonts). `design-system/primitives/` is reserved.

### 5. No global-state library
`zustand` is **not** a dependency. `src/stores/`, `src/contexts/`, and `src/hooks/` are reserved placeholders. The only shared client state today is `src/lib/hooks/usePersistentState.ts` (simple, non-sensitive UI prefs — never tokens, balances, addresses, or auth/role flags).

### 6. Route-level loading skeletons
Every authenticated `(app)` route has a `loading.tsx` composed from the primitives in `src/components/ui/skeletons.tsx`. When adding an `(app)` route, add a matching `loading.tsx`.

### 7. Contracts prepared but empty
`src/contracts/` holds a README describing what goes there (ABIs, addresses). Reserved space for the on-chain phase.

### 8. i18n per feature, not monolithic
Each feature has its own message file per locale under `src/i18n/messages/{en,pt-BR,es}/`. Register a new namespace in `src/i18n/request.ts` and `tests/utils/renderWithProviders.tsx`. `pnpm i18n:check` enforces key parity + ICU sanity.

## Import aliases (`tsconfig.json`)
```json
{
  "@/*": ["./src/*"],
  "@/components/*": ["./src/components/*"],
  "@/features/*": ["./src/features/*"],
  "@/lib/*": ["./src/lib/*"],
  "@/mocks/*": ["./src/mocks/*"],
  "@/hooks/*": ["./src/hooks/*"],
  "@/stores/*": ["./src/stores/*"],
  "@/contexts/*": ["./src/contexts/*"],
  "@/design-system/*": ["./src/design-system/*"],
  "@/i18n/*": ["./src/i18n/*"]
}
```
(`@/hooks`, `@/stores`, `@/contexts`, `@/design-system` resolve to reserved dirs — aliases exist ahead of use.)

## Import rules
- Feature components **do not import** from other features. If shared, lift to `src/components/` or `src/lib/`.
- `src/components/` **does not import** from `src/features/` (dependencies go down, never up).
- `src/lib/` is the lowest level; it imports from nothing above.
- Storybook does not import from `src/app/`.
