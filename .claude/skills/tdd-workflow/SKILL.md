---
name: tdd-workflow
description: TDD approach for the Pool Party Frontend. Use whenever implementing a hook, service, lib/utils, store, or form. Maps business rule to test case, writes the test first, confirms red, implements green, refactors.
---

# TDD Workflow

## When to use

Everything with business rules. Canonical table in `docs/04_CODE_STANDARDS.md`.

## Cycle

1. **Read** the issue. Identify rules `[R1]`, `[R2]`, etc.
2. **Map** each rule to at least one `it()` with comment `// @rule Rn`.
3. **Write the test** with a clear `expect`.
4. **Run watch**: `pnpm test:watch <file>`.
5. **Confirm red** with a coherent message (not an import crash).
6. **Implement the minimum** to pass.
7. **Confirm green.**
8. **Refactor** keeping green.

## Standard test structure

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

describe('useXxx', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // @rule R1: literal rule description
  it('expected behavior when <condition>', () => {
    // arrange
    // act
    // assert
  })
})
```

## Mock pattern

Services live in `src/lib/services` (not `@/mocks/services`). For service / Privy / server-action seams, use `vi.hoisted` for a mutable mock bag and `importOriginal` for partial mocks (keep the real error classes, stub only the I/O):

```ts
const mocks = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock("@/lib/services", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/services")>()),
  strategyService: { list: mocks.list },
}));
```

For async hooks, assert with `waitFor`, not `act(advanceTimersByTime)` over a settled promise (false green).

## renderWithProviders pattern

For components depending on NextIntl, stores, etc, use the `tests/utils/renderWithProviders.tsx` helper. Import it by relative path (most tests do; there is no `@/../` alias for `tests/`):

```ts
import { renderWithProviders } from "../../../../tests/utils/renderWithProviders";
renderWithProviders(<PortfolioCard />, { locale: "en" });
```

## Coverage thresholds (per layer)

- `src/lib/utils/`, `src/lib/schemas/`: 95-100%
- `src/lib/services/`, `src/mocks/`: 90%
- `src/hooks/`, `src/features/**/hooks/`: 85%
- `src/stores/`: 90%
- Components: no hard threshold, but at least one smoke test

## Checklist before committing

- [ ] Each `[Rn]` rule has a test tagged `// @rule Rn`.
- [ ] States (loading, error, empty, success) tested when applicable.
- [ ] Coverage above threshold.
- [ ] `pnpm test:coverage` green.

## Anti-patterns

- Writing all tests afterwards ("performative TDD").
- A test that passes before implementation (mock too generic).
- Testing implementation instead of behavior.
- Snapshot tests as a crutch.
