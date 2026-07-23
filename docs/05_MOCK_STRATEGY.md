# 05, Mock Strategy

## Goal

Every piece of data in this phase is mocked. The architecture ensures components never know whether data is mocked or real, so the future transition to real integrations requires no component refactor. Mocks are realistic (see `_claude-code-config/skills/mock-service-blueprint/SKILL.md`).

## Layers

```
Component  →  Hook  →  Service (factory)  →  mockService   (current)
                                          →  realService   (future)
```

- **Component**: pure presentation. Receives data via hook or props.
- **Hook**: orchestrates state, calls the service. Example: `usePortfolioStats`.
- **Service (factory)**: `src/lib/services/index.ts` decides mock vs real based on `NEXT_PUBLIC_MOCK_MODE`. Single switch point.
- **mockService**: implements the contract with simulated latency and errors.

## Factory pattern

```ts
// src/lib/services/index.ts
import { mockStrategyService } from '@/mocks/services/strategyService'

// unset OR "true" => mock; only the literal "false" opts into the real services.
// Matches src/lib/services/index.ts (`!== "false"`), so mock is the safe default.
const MOCK_MODE = process.env.NEXT_PUBLIC_MOCK_MODE !== 'false'

export const strategyService = MOCK_MODE
  ? mockStrategyService
  : mockStrategyService // PP-INTEGRATION-POINT: replace with realStrategyService (indexer + OAMS contracts) when ready
```

When real integration arrives, only this file changes per service. Components and hooks remain untouched.

## Contracts

Every service defines a TypeScript interface (contract). The mock implements it; the future real implementation will implement the same one. This guarantees shape compatibility.

```ts
export interface StrategyServiceContract {
  list(filter?: StrategyFilter): Promise<Strategy[]>
  getById(id: string): Promise<Strategy | null>
  getPerformance(id: string, range: '24h' | '7d' | '30d' | 'all'): Promise<PerformancePoint[]>
}
```

## Realism

Mocks must be indistinguishable from reality in observable behavior. Full principles in `mock-service-blueprint`:

1. Correct scale (strategy TVL in the thousands to millions, APY 2%-40%, position yields, fees in basis points, plausible USD values).
2. Plausible distribution (power law for strategy TVLs; a realistic mix of position statuses: ~80% active, ~20% paused; risk levels spread across 1-5).
3. Realistic addresses (valid `0x` format; known tokens may use real Base addresses).
4. Variable latency with jitter.
5. Rare but present errors (modes: default, error demo, realistic 2-5%).
6. Data in motion (prices oscillate, timestamps are now()).
7. Session consistency.
8. Diversity of states.

## Simulation utilities

- `simulateDelay(min, max)`: variable latency.
- `simulateError(probability)`: throws with a given chance.
- `jitter(baseMs, pct)`: latency variation around a base.
- `randomFromArray(arr)`: random pick.

## Integration points

Every mock service method that will become a real call is marked with `// PP-INTEGRATION-POINT: <description of expected replacement>`. The `documentation-keeper` aggregates these into `docs/INTEGRATION_POINTS.md`.

## State in mocks

- Services are stateless by default. Deterministic for predictable tests.
- When a session needs state (e.g. "a transaction was just submitted"), use an in-memory Zustand store that resets on reload.

## Mock directory

```
src/mocks/
├── data/        # static plausible data per entity
├── services/    # services implementing contracts
├── fixtures/    # variants for Storybook/tests (empty, single, many, states)
└── utils/       # simulateDelay, simulateError, jitter, randomFromArray
```

## Anti-patterns

- Components knowing whether data is mocked.
- Mock service coupled directly to UI.
- Zero or fixed latency.
- Mocks that always error or never error.
- Unrealistic values or invalid address formats.
