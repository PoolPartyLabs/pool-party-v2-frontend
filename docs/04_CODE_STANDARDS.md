# 04, Code Standards, Documentation and TDD

## TypeScript

### General rules
- Strict mode enabled, no exceptions.
- No `any` (use `unknown` and narrow the type).
- No arbitrary `as` casts (prefer type guards or Zod).
- `interface` for public object shapes, `type` for unions/intersections/computed.
- Component props: always a named interface or type, never a complex inline.

### Type pattern
```ts
// In src/lib/types/ or src/features/[area]/types.ts

export interface Position {
  /** Position identifier */
  id: string
  /** Strategy this position belongs to */
  strategyId: string
  /** Amount the investor put in (USD) */
  invested: number
  /** Current mark-to-market value (USD) */
  currentValue: number
  /** Lifetime yield, currentValue - invested net of fees (USD) */
  totalYield: number
  /** Amount currently available to collect/withdraw (USD) */
  available: number
  /** How earnings are handled */
  reinvestment: 'auto-compound' | 'manual-payout'
  /** Position lifecycle status */
  status: 'active' | 'paused' | 'closed'
}
```

## TDD approach

TDD is the default approach for everything with business rules. Application per layer:

| Layer | TDD applies? | Test type |
|-------|--------------|-----------|
| Mock services (`src/mocks/services/`) | Yes, full | Unit, isolated |
| Hooks (`useXxx`) | Yes, full | `renderHook` + state assert |
| Pure logic (`src/lib/utils/`, `src/lib/schemas/`) | Yes, full | Unit |
| Zustand stores | Yes, full | Unit, tests actions |
| Forms | Yes, behavior | RTL, validation flow |
| Modals with logic | Yes, behavior | RTL, interaction |
| Simple visual components (Button, Card) | Minimal | Smoke test: renders, props pass |
| Pages (`page.tsx`) | No | Covered indirectly via Storybook and visual review |

### TDD workflow
1. **The Linear issue carries explicit business rules.** The issue template (see `07_LINEAR_WORKFLOW.md`) has a mandatory "Business rules" section.
2. **The agent writes the tests first.** Covers the rules as test cases. File `Xxx.test.ts` or `Xxx.test.tsx` next to the target file.
3. **Run the tests. All fail (red).** Important to confirm they actually test something.
4. **Implement the minimum to pass (green).**
5. **Refactor keeping green.**
6. **Minimum coverage verified.**

### TDD example in a hook
```ts
// src/features/dashboard/hooks/usePortfolioStats.test.ts
import { renderHook, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { usePortfolioStats } from './usePortfolioStats'

vi.mock('@/mocks/services/portfolioService', () => ({
  mockPortfolioService: { getStats: vi.fn() },
}))

describe('usePortfolioStats', () => {
  beforeEach(() => { vi.clearAllMocks() })

  // @rule R1: TVL is the sum of the USD value of all active positions. Closed positions do not count.
  it('sums only non-closed positions into TVL', async () => {
    // arrange: configure mock
    // act: render hook
    // assert: TVL matches
  })

  // @rule R2: while loading, isLoading=true and data=null.
  it('starts in loading state', () => { /* ... */ })

  // @rule R3: service errors propagate to the consumer.
  it('exposes error when service fails', async () => { /* ... */ })

  // @rule R4: refetch reruns the call and updates data.
  it('refetch triggers a new call and updates data', async () => { /* ... */ })
})
```

Afterwards the agent implements `usePortfolioStats` to make the tests pass.

### Coverage thresholds
Defined in `vitest.config.ts`:
```ts
coverage: {
  thresholds: {
    'src/lib/utils/**': { lines: 95, functions: 95, branches: 90 },
    'src/lib/schemas/**': { lines: 100, functions: 100, branches: 100 },
    'src/mocks/services/**': { lines: 90, functions: 90, branches: 85 },
    'src/hooks/**': { lines: 85, functions: 85, branches: 80 },
    'src/features/**/hooks/**': { lines: 85, functions: 85, branches: 80 },
    'src/stores/**': { lines: 90, functions: 90, branches: 85 },
    // components have no hard threshold, but need at least one test
  }
}
```

### When NOT to use TDD
- Pure visual refactor (moving JSX, adjusting Tailwind classes).
- Storybook story.
- Translation update.
- Changing fixed mock data.

For those, write directly. TDD is not dogma, it is a tool for business rules.

## Component pattern

### Standard structure
```tsx
/**
 * @id PP-DASH-CMP-005
 * @name PortfolioSummaryCard
 * @description Card displaying aggregated portfolio metrics (TVL, P&L 24h, active positions).
 * @figma https://figma.com/file/.../node-id=...
 * @linear https://linear.app/.../PP-XX
 * @owner core-team
 * @since 2026-XX-XX
 * @i18n-namespace dashboard.summaryCard
 * @implements-rules-version v1
 *
 * @integration-points
 * - usePortfolioStats(): returns mock today, will query the indexer in the future.
 * - formatCurrency(): uses a mocked exchange rate, future will come from an oracle.
 */

import { type FC } from 'react'
import { useTranslations } from 'next-intl'
import { Card } from '@/components/ui/Card'
import { usePortfolioStats } from '@/features/dashboard/hooks/usePortfolioStats'
import { cn } from '@/lib/utils/cn'

export interface PortfolioSummaryCardProps {
  /** User wallet address. If omitted, uses the one connected in the store. */
  walletAddress?: `0x${string}`
  /** Additional classes applied to the root card */
  className?: string
}

/**
 * Main component.
 *
 * Visual states:
 * - loading: skeleton
 * - error: message with retry
 * - success: renders metrics
 */
export const PortfolioSummaryCard: FC<PortfolioSummaryCardProps> = ({ walletAddress, className }) => {
  const t = useTranslations('dashboard.summaryCard')
  const { data, isLoading, error } = usePortfolioStats(walletAddress)

  // PP-INTEGRATION-POINT: when integrating, the hook above returns real data
  // from the indexer / OAMS contracts. Validate that the shape stays compatible (Position[]).

  if (isLoading) return <PortfolioSummaryCardSkeleton className={className} />
  if (error) return <PortfolioSummaryCardError error={error} className={className} />

  return (
    <Card className={cn('p-6', className)}>
      <h2 className="text-lg font-semibold">{t('title')}</h2>
      {/* ...render... */}
    </Card>
  )
}
```

### Conventions
1. **Mandatory header** with ID, name, description, Figma and Linear links, i18n namespace, **`@implements-rules-version: vN`** (the business rule version the code implements), integration points. Instrumented components also carry an **`@analytics-events`** header line listing the events they fire (see `analytics-tracking` skill).
2. **Props always typed** with a named interface.
3. **JSDoc on props** describing what each does.
4. **Visual states separated** into helper components (`*Skeleton`, `*Error`, `*Empty`).
5. **Named function** with `export const` + arrow, no default exports.
6. **`cn()` for className merge** supporting consumer override.
7. **Every user-facing string goes through `useTranslations`.** No hardcoded text.

## Storybook pattern (only on eligible components)
```tsx
// Button.stories.tsx
import type { Meta, StoryObj } from '@storybook/react'
import { Button } from './Button'
import { Plus } from 'lucide-react'

/**
 * @id PP-CORE-CMP-010
 * Stories for Button. Covers all variants and sizes.
 */
const meta: Meta<typeof Button> = {
  title: 'UI/Button',
  component: Button,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
  argTypes: {
    variant: { control: 'select', options: ['primary', 'secondary', 'ghost', 'destructive'] },
    size: { control: 'select', options: ['sm', 'md', 'lg'] },
    disabled: { control: 'boolean' },
  },
}
export default meta
type Story = StoryObj<typeof Button>

export const Primary: Story = { args: { variant: 'primary', children: 'Confirm' } }
export const Disabled: Story = { args: { variant: 'primary', disabled: true, children: 'Confirm' } }
export const AllSizes: Story = {
  render: () => (
    <div className="flex items-center gap-3">
      <Button size="sm">Small</Button>
      <Button size="md">Medium</Button>
      <Button size="lg">Large</Button>
    </div>
  ),
}
```

## Comment and tag system

Standardized tags that Claude Code recognizes and processes:

| Tag | Meaning | When to use |
|-----|---------|-------------|
| `// PP-INTEGRATION-POINT` | Point that will receive real logic in the future | Every mock service call, every wallet/contract placeholder |
| `// PP-TODO` | Simple pending item, with description | Small improvements, short refactors |
| `// PP-FIXME` | Known bug to fix | Identified problems not yet resolved |
| `// PP-DEBT(SEV:LOW\|MED\|HIGH)` | Explicit technical debt | Conscious shortcuts needing revisit |
| `// PP-MOCK` | Mocked data/logic | Every function with simulated behavior |
| `// PP-NOTE` | Explanatory note for future readers | Non-obvious design decisions |
| `// PP-PERF` | Performance attention point | Large loops, heavy renders |
| `// PP-A11Y` | Accessibility attention point | When there is something to verify |
| `// PP-SECURITY` | Sensitive security point | User inputs, validations |
| `// PP-I18N` | Missing or suspicious translation | Hard-to-translate technical term, flag for review |
| `// PP-ANALYTICS` | Analytics tracking point | Where a user action is (or should be) tracked via `useAnalytics()` |

### Automatic issue generation from tags
The Tech Debt agent (see `06_CLAUDE_CODE_AGENTS.md`) periodically scans the code and creates/updates Linear issues for each `PP-DEBT`, `PP-FIXME`, and `PP-TODO` without an associated issue.

## i18n pattern

### Rules
1. **No hardcoded text** in user-facing components.
2. **Keys structured per feature**, with the namespace declared in the header.
3. **Pluralization** via ICU MessageFormat (natively supported by next-intl).
4. **Typed interpolations.** `next-intl` enforces variable types.
5. **Term policy by surface.** The investor app abstracts crypto complexity: avoid jargon (no "stake", "LP", "AMM", "slippage" surfaced to investors), prefer plain finance words ("earn", "invest", "savings"). The Manager Console (B2B) keeps technical/DeFi terms in English across PT/ES by industry convention. Product nouns (USDC, APY, Pix) stay as-is everywhere.
6. **Dates, numbers, currencies** use next-intl's `useFormatter` (locale-aware automatically).

### Usage example
```tsx
import { useTranslations, useFormatter } from 'next-intl'

export const Stat = ({ value, change }: { value: number; change: number }) => {
  const t = useTranslations('dashboard.stats')
  const format = useFormatter()
  return (
    <div>
      <p>{t('tvl')}</p>
      <p>{format.number(value, { style: 'currency', currency: 'USD' })}</p>
      <p>{t('changeIn24h', { change: format.number(change, { style: 'percent' }) })}</p>
    </div>
  )
}
```

### Corresponding translation files
```json
// src/i18n/messages/en/dashboard.json
{ "stats": { "tvl": "Total value locked", "changeIn24h": "{change} in 24h" } }
```
```json
// src/i18n/messages/pt-BR/dashboard.json
{ "stats": { "tvl": "Total value locked", "changeIn24h": "{change} em 24h" } }
```
```json
// src/i18n/messages/es/dashboard.json
{ "stats": { "tvl": "Total value locked", "changeIn24h": "{change} en 24h" } }
```
Note: TVL stays in English across all three (DeFi term).

### Translation workflow with Claude Code
1. Agent implements in the source language (`en`, from Figma).
2. Agent proposes translations for the other two (pt-BR, es).
3. Marks sensitive terms with `// PP-I18N` in the commit message.
4. The user reviews all three versions in the PR.

## Feature documentation

Each `src/features/[area]/` folder has a `README.md`:
```markdown
# Feature: Dashboard

## i18n namespace
`dashboard.*` (files in `src/i18n/messages/[locale]/dashboard.json`)

## IDs
| ID | Type | Name | Status | Test coverage |
|----|------|------|--------|---------------|
| PP-DASH-SCR-001 | Screen | Portfolio Overview | Done | n/a |
| PP-DASH-CMP-001 | Component | PortfolioSummaryCard | Done | 92% |
| PP-DASH-HOK-001 | Hook | usePortfolioStats | Done | 95% |
| PP-DASH-CMP-002 | Component | PositionsTable | In Progress | 78% |
| PP-DASH-MOD-001 | Modal | DepositConfirmation | Backlog | n/a |

## Integration points
- `mockPortfolioService.getStats()`: becomes an indexer call in the future.
- `usePortfolioStats()`: returns mock today. NOTE: data hooks are hand-rolled (`null`=loading / `error` / `refresh`, see `usePositions`), NOT TanStack Query (react-query is installed for wagmi only). See the `server-data-access` skill.

## Notes
- The Portfolio Overview screen has viewport variations.
- Empty state when the user has no positions.
```

## Commits and PRs

### Conventional Commits
```
<type>(<scope>): <description> [rules-vN]

[optional body]

[optional footer]
```
Types: `feat`, `fix`, `chore`, `docs`, `style`, `refactor`, `test`, `perf`, `i18n`. Scope: main affected artifact ID.

Example:
```
feat(PP-DASH-SCR-001): implement portfolio overview with mocks [rules-v1]

- Add PortfolioSummaryCard with tests (TDD)
- Add PositionsTable with tanstack-table
- Create mocks in src/mocks/data/positions.ts
- Add translations for every locale in `src/i18n/config.ts` (en is the source; see 01_TECH_STACK > Locale policy)

Closes POO-123
```

### PR template
`.github/PULL_REQUEST_TEMPLATE.md`:
```markdown
## ID
PP-XXX-XXX-XXX @rules-vN

## Linear
Closes POO-XXX

## Figma
[link]

## What was done

## TDD checklist
- [ ] Tests written before implementation
- [ ] All business rules covered
- [ ] Coverage above the layer threshold

## i18n
- [ ] en written/reviewed
- [ ] pt-BR written/reviewed
- [ ] es written/reviewed
- [ ] Terms marked with PP-I18N (if any)

## Integration points added

## Technical debt created

## Screenshots / Storybook URL
```

## Accessibility (baseline)
- Every button has accessible text (visible or via `aria-label`).
- Every image has `alt`.
- Every input has an associated `label`.
- Visible focus on all interactive elements.
- Minimum AA contrast (verify color tokens).
- Modals trap focus and close on ESC (Radix handles this).
- `lang` on `<html>` reflects the current locale (next-intl does this).

Use `// PP-A11Y` markers when a point needs special attention.
