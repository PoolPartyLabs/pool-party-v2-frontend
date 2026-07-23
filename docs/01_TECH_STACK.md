# 01, Tech Stack

## Main dependencies

### Core
```json
{ "next": "^15.x", "react": "^19.x", "react-dom": "^19.x", "typescript": "^5.x" }
```

### Internationalization
```json
{ "next-intl": "^4.x" }
```
Chosen as the modern standard for App Router. First-class Server Components support, localized routes (`/pt-BR/dashboard`, `/en/dashboard`, `/es/dashboard`), typed translation keys, translatable Zod error messages.

### Styling
```json
{ "tailwindcss": "^4.x", "@tailwindcss/typography": "^0.5.x", "tailwind-merge": "^2.x", "clsx": "^2.x", "class-variance-authority": "^0.7.x" }
```

### UI primitives (Radix, shadcn base)
```json
{ "@radix-ui/react-dialog": "*", "@radix-ui/react-dropdown-menu": "*", "@radix-ui/react-tabs": "*", "@radix-ui/react-toast": "*", "@radix-ui/react-tooltip": "*" }
```

### State and forms
```json
{ "zustand": "^5.x", "react-hook-form": "^7.x", "zod": "^3.x", "@hookform/resolvers": "^3.x" }
```

### Tables and data
```json
{ "@tanstack/react-table": "^8.x" }
```

### Animations and icons
```json
{ "motion": "^11.x", "lucide-react": "^0.4xx" }
```

### Tooling
```json
{ "@biomejs/biome": "^2.x", "husky": "^9.x", "lint-staged": "^17.x", "@commitlint/cli": "^21.x", "@commitlint/config-conventional": "^21.x" }
```

### Tests
```json
{ "vitest": "^4.x", "@testing-library/react": "^16.x", "@testing-library/user-event": "^14.x", "@testing-library/jest-dom": "^6.x", "jsdom": "^29.x", "@vitest/coverage-v8": "^4.x" }
```

### Storybook (D7 = yes, restricted scope)
```json
{ "storybook": "^10.x", "@storybook/nextjs-vite": "^10.x", "@storybook/addon-a11y": "^10.x" }
```
Storybook 10 ships essentials in core (no separate `@storybook/addon-essentials`), so the package set is the `@storybook/nextjs-vite` framework plus `@storybook/addon-a11y`. The Vitest/test addon was deferred.

### Web3 libraries (installed but in mock mode this phase)
```json
{ "wagmi": "^2.x", "viem": "^2.x", "@rainbow-me/rainbowkit": "^2.x", "@tanstack/react-query": "^5.x" }
```

## Key configurations

### `tsconfig.json`
- `strict: true`, `noUncheckedIndexedAccess: true`, `paths` with aliases.

### `next.config.ts`
- React Strict Mode on, `experimental.typedRoutes: true`, next-intl plugin integrated, basic security headers (relaxed CSP this phase, with a TODO to review before mainnet).

### Tailwind 4 (CSS-first, no `tailwind.config.ts`)
- Tailwind 4 is configured CSS-first. There is no `tailwind.config.ts`. Design tokens are exposed to Tailwind via the `@theme` directive in `src/app/globals.css`, mirroring the versioned tokens in `src/design-system/tokens/`. Dark mode uses the `dark` class applied on `<html>` (it does not change).
- PostCSS uses the `@tailwindcss/postcss` plugin in `postcss.config.mjs`.

### `biome.json`
- Unified linter + formatter, strict rules (no-explicit-any, no-unused-vars, prefer-const, etc).

### `vitest.config.ts`
- Environment jsdom, setup `tests/setup.ts` (registers jest-dom, next-intl mock provider), coverage provider v8, explicit per-layer thresholds (see `04_CODE_STANDARDS.md`).

## Environment variables
```env
NEXT_PUBLIC_APP_ENV=development
NEXT_PUBLIC_MOCK_MODE=true   # when false, in the future, enables real integrations
NEXT_PUBLIC_CHAIN_ID=8453     # Base mainnet, placeholder
NEXT_PUBLIC_DEFAULT_LOCALE=en # fallback locale
# NEXT_PUBLIC_RPC_URL=         # commented, empty this phase
# NEXT_PUBLIC_WC_PROJECT_ID=   # commented, empty this phase
```
The `NEXT_PUBLIC_MOCK_MODE=true` flag is central: every real integration call sits in a branch that checks this flag and falls back to the mock by default.

## i18n configuration details

### Locale policy (canonical)

The runtime source of truth is `src/i18n/config.ts` (11 locales today): `en`, `pt-BR`, `es`, `fr`, `de`, `nl`, `ja`, `ko`, `zh-CN`, `zh-TW`, `vi`.

- `en` is the **source** language (copy comes from Figma).
- `pt-BR` and `es` are **curated** translations (human-reviewed in PR).
- The other 8 (`fr`, `de`, `nl`, `ja`, `ko`, `zh-CN`, `zh-TW`, `vi`, added in PR #70) are **machine-translated pending native review** (POO-231). They still must stay in sync: parity is enforced.
- `pnpm i18n:check` enforces parity, ICU syntax, used keys and **no em dash (—, U+2014) in any locale value** (POO-357 standing copy rule) across **all** locale folders, so every new key lands in every locale in the same PR.
- Docs, agents and skills reference this section instead of enumerating locales; when the list changes, update `config.ts` and this section only.

### Translation file structure
Per feature, not one giant file:

```
src/i18n/
├── config.ts                      # supported locales, default, routing
├── request.ts                     # server-side message loading
├── routing.ts                     # typed navigation
└── messages/
    ├── en/{common,errors,home,portfolio,strategies,savings,buyTokens,predictions,perps,cards,deposit,rewards,profile,auth}.json
    └── … one folder per locale in `config.ts` (11 today), same structure
```

### Key typing
next-intl generates types automatically. Components get autocomplete:
```ts
const t = useTranslations('dashboard.emptyState')
t('title') // typed, errors if key does not exist
```

### Default locale and detection
- Default fallback: `en`.
- Detection: browser `Accept-Language` header, then persistent `NEXT_LOCALE` cookie when the user switches.
- Routes: `/pt-BR/dashboard`, `/en/dashboard`, `/es/dashboard`. No prefix redirects to the detected one.

## Versions and management
- Node: 22 LTS (`.nvmrc`).
- Package manager: pnpm (`packageManager` in package.json).
- Commitlint + husky enforce the commit standard.
