---
name: mock-service-blueprint
description: Template for creating/maintaining mocks in the Pool Party Frontend. Defines contract as an interface, tests the service first (TDD), implements with simulated latency and errors. Emphasizes maximum realism (scale, distribution, format, network behavior).
---

# Mock Service Blueprint

## Master principle

**Mocks must be indistinguishable from reality in observable behavior.** If a human looking at the UI can tell "this is a mock", the mock failed. Correct scale, plausible distribution, variable latency, rare but present errors, data in motion when applicable.

**One deliberate exception, identifiers.** Every mock-originated id and key carries a `mock` marker (e.g. `mock-strat-stable-yield`, `mockUser_001`). Realism applies to the *observable values* (scale, distribution, states); the *identifiers* self-label as mock so mock-sourced data is unmistakable in code, logs, and the network tab.

The reason: when integrating for real, we want to find real contract/integration bugs, not the gap between an "idealized mock" and a "chaotic network".

## For design/component-only work

Mock mode is your harness (build the visual component from Figma without a backend). When you build a component or screen:

1. **Create its mock here** so it renders realistically (correct scale, states, the `mock`-marked ids/keys above).
2. **If you don't know the real API contract**, define a plausible shape and **flag what you used**: mark the seam `// PP-INTEGRATION-POINT` with the assumed request/response, so the wiring engineer sees your assumption rather than guessing.
3. **Always open a Linear wiring issue** for the real-mode integration of that surface. The mock is not the finish line; it is phase 1 of a two-phase delivery.

Pipeline: **Figma design → visual component built against the mock → real-data wiring** (`server-data-access`, tracked separately).

## Where mocks actually live

```
src/mocks/
├── data/<entity>.ts        # Zod-validated plausible static data (the real home of mock data)
└── utils/simulate.ts       # latency/error helpers (see "Current state": not wired yet)

src/lib/services/index.ts   # the service registry: thin async wrappers over data/, gated by isMockMode
src/lib/schemas/            # Zod schemas the data is validated against (tested via schema.parse)
```

A "mock service" is **not** a file in `src/mocks/services/` (that dir is empty); it is an entry in the `src/lib/services/index.ts` registry (`isMockMode ? mock : mock` today, the real branch being the integration seam). In-session mutable state (e.g. the manager dashboard) uses a `Map` + `structuredClone` with a `resetMockManagerState()` helper so tests stay isolated (`src/lib/services/index.ts`). See `docs/ARCHITECTURE_STATE.md` for the full mock-vs-real surface map (which services are mock-by-default vs already real).

> **Current state vs. target.** The latency/error/jitter "realism engine" below is the *target* (and matches CLAUDE.md premise 2). Today `src/mocks/utils/simulate.ts` is imported by **zero** files: mocks resolve instantly, no error injection. Until that is wired, match the live precedent (zero-latency, deterministic, Zod-validated) and treat the latency/error sections as the spec to implement, not current behavior. Realism of the *data* (scale, distribution, state diversity) is already enforced via schema-parse + distribution tests, do that part now.

## Realism principles

### 1. Correct scale

Numeric values reflect the real magnitude of the domain:

| Metric | Realistic range (DeFi/Base) | Anti-pattern |
|--------|------------------------------|--------------|
| Large pool TVL (USDC/ETH) | $5M-$80M | $42 or $1,000,000,000 |
| Small pool TVL | $50k-$2M | $0.50 |
| Large pool 24h volume | $200k-$15M | $1, $1bn |
| Realistic V3 LP APR | 2%-40% | 0.001%, 9999% |
| Typical retail position | $200-$50k | $1, $50M |
| Whale position | $500k-$10M | - |
| Gas on Base (realistic) | $0.05-$0.50 | $30 (that is mainnet ETH) |
| Default slippage | 0.1%-0.5% | 50% |

Use public references (without copying): defillama.com, protocol/strategy dashboards, public token lists. Look at real distributions and generate mocks in the same range.

### 2. Plausible distribution

Do not use uniform values. Use distributions that look real:

- **Strategy TVLs**: power law. Few large strategies, several medium, many small.
- **Positions per investor**: most have 1-3, some 5+.
- **Position age**: skewed toward recent (more started in the last 30 days).
- **Status**: ~80% active, ~20% paused; risk levels spread across 1-5.

Concrete example:

```ts
// src/mocks/data/strategies.ts
export const mockStrategiesData: Strategy[] = [
  // top: large, established strategies
  { id: 'stable-yield', name: 'Stable Yield', manager: 'BlueOcean', riskLevel: 1, minInvestment: 50, tvl: 6_740_000, investors: 1240, estReturn: 8.2, rateType: 'APY', status: 'active' },
  { id: 'delta-neutral', name: 'Delta-Neutral Farming', manager: 'AlphaDesk', riskLevel: 3, minInvestment: 100, tvl: 2_850_000, investors: 480, estReturn: 16.4, rateType: 'APR', status: 'active' },
  // mid tier
  { id: 'basis-trade', name: 'Basis Trade', manager: 'AlphaDesk', riskLevel: 4, minInvestment: 250, tvl: 1_800_000, investors: 210, estReturn: 24.1, rateType: 'APR', status: 'active' },
  { id: 'lst-loop', name: 'LST Loop', manager: 'StakeLab', riskLevel: 2, minInvestment: 100, tvl: 980_000, investors: 320, estReturn: 6.9, rateType: 'APY', status: 'paused' },
  // long tail
  { id: 'mm-vol', name: 'Volatility Harvest', manager: 'QuantPool', riskLevel: 5, minInvestment: 500, tvl: 180_000, investors: 36, estReturn: 41.0, rateType: 'APR', status: 'active' },
  // ... more in the long tail
]
```

### 3. Realistic addresses

- Always valid format (`0x` + 40 hex).
- Do not invent from nothing: use a utility generating a deterministic hash (`generateMockAddress(seed)`) or copy known Base addresses and change a few chars.
- **Never** copy a real person's wallet address.
- Known tokens (USDC, WETH, cbETH, DAI, USDbC, AERO) may use REAL Base addresses, they are public.

### 4. Variable latency (like a real network)

Mocked latency must **vary** between calls. Real networks have jitter.

```ts
// src/mocks/utils/jitter.ts
export const jitter = (baseMs: number, jitterPct = 0.3): number => {
  const delta = baseMs * jitterPct
  return baseMs + (Math.random() * 2 - 1) * delta
}
// Usage: await simulateDelay(jitter(800)) // ~560-1040ms
```

Realistic latency table (base average):

| Operation | Base latency | Rationale |
|-----------|--------------|-----------|
| Simple read (get pool by id) | 200-400ms | Indexer cache hit |
| Listing (get pools) | 500-900ms | Subgraph query |
| Listing with heavy filters | 1000-1800ms | Subgraph + aggregation |
| Quote before swap | 300-600ms | Simulated on-chain calc |
| Submit transaction | 1500-3500ms | Simulated mining wait |
| Confirm transaction | 8000-15000ms (1-3 Base blocks) | Base finality |

Use 20-40% jitter around the average.

### 5. Rare but present errors

Errors are part of the contract. The mock service must expose:

- **Default mode (dev)**: variable latency, no errors.
- **Error demo mode**: activated by flag (`?mock-error=network`) or parameter to force scenarios: `network`, `timeout`, `rate-limit`, `stale`.
- **Realistic mode** (optional, flag `?mock-realism=high`): 2-5% of calls fail randomly. UI must handle it.

```ts
async list() {
  await simulateDelay(jitter(700))
  if (mockErrorMode === 'network') throw new NetworkError('Failed to fetch')
  if (mockRealismMode === 'high' && Math.random() < 0.03) throw new NetworkError('Random simulated failure')
  return mockPoolsData
}
```

### 6. Data in motion (when applicable)

Some entities have continuously changing values:

- **Token price**: oscillates per call (within +-2% of baseline).
- **24h volume**: grows slowly during the session.
- **TVL**: oscillates slightly.
- **Current block**: increments every 2s (Base block time).
- **"last updated" timestamp**: now() at call time.

```ts
const baselinePrices = { USDC: 1, WETH: 3450, cbETH: 3600, AERO: 0.85, DAI: 1, USDbC: 1 }
export const getMockTokenPrice = (symbol: string): number => {
  const baseline = baselinePrices[symbol]
  const drift = (Math.random() * 0.04 - 0.02) // +-2%
  return baseline * (1 + drift)
}
```

### 7. Consistent state within a session

Although values vary, **within a single call** the data must be internally consistent:

- If a position says "$5000 in USDC + 1 ETH", the USD value must match the ETH price returned in the same session.
- If a pool has TVL X, and we list the N largest positions in it, the sum of positions cannot exceed X.
- If a transaction is confirmed at 14:00 and the latest block is at 13:50, contradiction. Fix it.

### 8. Diversity of states

Each mocked collection must have at least one of each relevant state:

**Strategies**: top tier, mid tier, long tail, freshly launched, paused, across all 5 risk levels, both APR and APY rate types.
**Positions**: positive yield, negative yield (drawdown visible), active, paused, freshly opened, old (90+ days), conservative (low return), aggressive (high return), auto-compound and manual-payout.
**Investors**: no positions (empty state), 1 position, 3-5 positions (common case), many positions (pagination).

## Implementation steps

### Step 1, contract
```ts
export interface StrategyServiceContract {
  list(filter?: StrategyFilter): Promise<Strategy[]>
  getById(id: string): Promise<Strategy | null>
  getPerformance(id: string, range: '24h' | '7d' | '30d' | 'all'): Promise<PerformancePoint[]>
}
```

### Step 2, service tests (TDD)
Test: returns >= 15 strategies without filter, latency >= 400ms, default order TVL desc, getById null for unknown, top 3 strategies concentrate > 50% of total TVL (distribution check).

### Step 3, implementation
Filter, sort by TVL desc, simulate latency with jitter, mark `// PP-MOCK` and `// PP-INTEGRATION-POINT`.

### Step 4, realistic data
See "Realism principles". Ensure state coverage.

### Step 5, fixtures
`empty.ts`, `single.ts`, `many.ts`, domain-specific (`longTailOnly.ts`, `pausedStrategies.ts`).

### Step 6, wire it into the service registry
Services are registered in `src/lib/services/index.ts`, which owns the single mock-vs-real switch:

```ts
// src/lib/services/index.ts
export const isMockMode = process.env.NEXT_PUBLIC_MOCK_MODE !== "false"; // default = mock

// Each export resolves to the mock today; the real branch is wired but still points at the mock.
export const strategyService: StrategyService = isMockMode
  ? mockStrategyService
  : mockStrategyService; // PP-INTEGRATION-POINT: real strategy service over apiFetch / subgraph
```

Note the toggle is `!== "false"` (mock unless explicitly disabled), **not** `=== "true"`; default-on-mock is intentional. Real services call the server-only `apiFetch` (`src/lib/api/client.ts`: `x-api-key`, GET retries, Next cache tags) or `analyticsFetch` (`src/lib/analytics-api/client.ts`); a mock service never fetches a backend.

## Conventions

- **Deterministic IDs** (do not randomize). Tests are predictable.
- **Deterministic baseline values.** Variation lives in the "live data" layer (price, timestamp).
- **Known token addresses may be the real Base ones.** Strategy/position/wallet addresses are fictional.
- **Standard header in every mock data file.**
- **Comment the scale source** ("Baseline calibrated to realistic OAMS strategy sizes / DeFi market data as of <date>").

## Anti-patterns

- Mock with 3 test items just to "make it work".
- Zero or fixed latency (does not test real loading state).
- Forced errors that always happen (UI never tests the happy path).
- Absurd values ($999999999 or $0.0001) unless explicitly testing overflow.
- Address `0x123` or similar (not a valid format).
- Static data with no in-session variation (timestamps, prices) when there should be.
- Mock copying a real person's wallet address or a non-public private pool.
