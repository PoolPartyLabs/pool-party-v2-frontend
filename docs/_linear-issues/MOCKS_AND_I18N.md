# MOCKS_AND_I18N, Foundation Issues

5 issues that establish the mock and translation base, so features have something to build on.

---

## PP-CORE-MCK-001: Simulation utils (delay, error, random)

**Project**: Foundation
**Labels**: `area:CORE`, `mock-data`, `priority:p0`
**Depends on**: SETUP-004

### Body

```markdown
## Goal
Utility functions used by all mock services.

## Business rules
- [R1] `simulateDelay(min: number, max: number): Promise<void>`, waits a random time between min and max ms.
- [R2] `simulateError(probability: number): void`, throws an Error with the given chance (0 to 1).
- [R3] `randomFromArray<T>(arr: T[]): T`, returns a random item.
- [R4] All functions have tests (TDD).
- [R5] `simulateError(1)` always throws, `simulateError(0)` never throws.

## Acceptance criteria
- [ ] Files in `src/mocks/utils/`
- [ ] Coverage 100%
- [ ] Standard header
```

---

## PP-CORE-MCK-002: Domain types and Zod schemas

**Project**: Foundation
**Labels**: `area:CORE`, `mock-data`, `priority:p0`
**Depends on**: SETUP-001

### Body

```markdown
## Goal
Canonical domain types + Zod schemas (which serve to validate mock data AND real forms in the future).

## Business rules
- [R1] Type `Token` with fields: address, symbol, name, decimals, logoUrl, chainId.
- [R2] Type `Strategy` with fields: id, name, manager, riskLevel (1-5), minInvestment, tvl, investors, estReturn, rateType ('APR'|'APY'), status ('active'|'paused').
- [R3] Type `Position` with fields per the `docs/04_CODE_STANDARDS.md` example (strategyId, invested, currentValue, totalYield, available, reinvestment, status).
- [R4] Type `SavingsMarket` (id, asset, venue, netApy, baseApy, boostApy, liquidity, deposited) and Type `Transaction` (hash, type, status, tokenAmount, tokenSymbol, usdValueAtTime, unitPriceAtTime, timestamp).
- [R5] For each type, a corresponding exported Zod schema.
- [R6] Schemas validate `0x...` address format where applicable.
- [R7] Tests validate parsing of a valid object and rejection of an invalid one.

> Note: replaces the earlier Uniswap-style Pool/PoolPosition types. This matches the real product (managed investing) and Linear issue PP-CORE-MCK-002 (POO-62).

## Acceptance criteria
- [ ] Types in `src/lib/types/`
- [ ] Schemas in `src/lib/schemas/`
- [ ] 100% schema coverage
```

---

## PP-CORE-MCK-003: Token mock data

**Project**: Foundation
**Labels**: `area:CORE`, `mock-data`, `priority:p0`
**Depends on**: PP-CORE-MCK-002

### Body

```markdown
## Goal
List of plausible fake tokens for Base mainnet.

## Business rules
- [R1] Includes at least: USDC, ETH (WETH), cbETH, DAI, USDbC, AERO.
- [R2] Addresses in `0x` + 40 hex format (known tokens may use the real Base addresses, they are public).
- [R3] Logo URLs point to placeholders or public TokenLists.
- [R4] Validated by the Zod schema.

## Acceptance criteria
- [ ] File in `src/mocks/data/tokens.ts`
- [ ] List validated by the schema at import time (parse or throw)
```

---

## PP-CORE-MCK-004: Service factory in `src/lib/services/index.ts`

**Project**: Foundation
**Labels**: `area:CORE`, `mock-data`, `priority:p0`
**Depends on**: SETUP-001

### Body

```markdown
## Goal
Single future switch point between mock and real.

## Business rules
- [R1] Reads `NEXT_PUBLIC_MOCK_MODE` to decide.
- [R2] Exports `tokenService`, `strategyService`, `positionService`, `savingsService`, `transactionService`.
- [R3] Today, all branches point to mocks (no real yet).
- [R4] Each export has a `// PP-INTEGRATION-POINT` comment describing the expected replacement.

## Acceptance criteria
- [ ] File exists with 5 exported services
- [ ] All with PP-INTEGRATION-POINT
```

---

## PP-CORE-I18N-001: Base translation files

**Project**: Foundation
**Labels**: `area:CORE`, `i18n`, `priority:p0`
**Depends on**: SETUP-005

### Body

```markdown
## Goal
Minimum message structure in all 3 languages.

## Business rules
- [R1] Files `common.json` and `errors.json` exist in `src/i18n/messages/{en,pt-BR,es}/`.
- [R2] `common.json` has: connectWallet, disconnect, save, cancel, confirm, close, loading, error.tryAgain.
- [R3] `errors.json` has fallback messages: somethingWentWrong, networkError, validationFailed.
- [R4] All 3 languages have exactly the same keys.
- [R5] `pnpm i18n:check` green.

## Acceptance criteria
- [ ] 6 JSON files created (2 namespaces x 3 languages)
- [ ] `pnpm i18n:check` green
- [ ] DeFi terms kept in English per `docs/_claude-code-config/skills/i18n-translation-rules/SKILL.md`
```
