---
name: number-formatting
description: How the Pool Party frontend handles numbers end-to-end — display formatting (money/USD, token amounts, percentages, large M/B/T, ultra-tiny crypto values), numeric inputs and validation, money-math precision (never JS float), and numeric-input safety. Use whenever you format a value for display, build or validate a numeric input/amount field, do any money/amount arithmetic, or show a token/USD/%/count. Builds on `format.ts` (PP-CORE-LIB-013) and the transaction-display rule; defers general security to the `frontend-security` skill.
---

# Numbers, money & inputs

Everything numeric in a fintech UI is a correctness + trust surface: a rounding slip, a float drift, or a value that silently renders `0` reads as a bug to an investor. This skill is the single source of truth for **how we represent, format, input, and guard numbers**. It extends the formatters in `src/lib/utils/format.ts` (`PP-CORE-LIB-013`) and the **transaction-display rule** (always show the per-token amount *and* its USD value at the moment of the tx). For general app security (CSP, headers, cookies, XSS surface) see the **`frontend-security`** skill — this one only covers the *numeric-input* slice of that.

Product decision already in force: **the app displays money in USD, formatting pinned to `en-US`** regardless of UI locale (so `$1.2M`, not localized `1,2 mi`). Keep it.

---

## 1 · Principle: never do money math in floating point

`0.1 + 0.2 !== 0.3`. JS `number` is IEEE-754 double — fine for *display*, never for *money/amount arithmetic* (balances, fees, totals, conversions). A drifted cent or a wrong token amount is a real-money bug.

- **Fiat / USD:** compute in **integer minor units (cents)** or with **`decimal.js`**. Never sum/multiply dollars as floats.
- **Token amounts:** they arrive from chain as **integer base units** (`BigInt`, e.g. 18 decimals). Do math on the `BigInt`; convert to a human decimal **only at display** via a `formatUnits(value, decimals)` helper. Never `parseFloat` a token amount (instant precision loss).
- **Decimal lib (prescribed):** use **`decimal.js`** for general decimal arithmetic + **`BigInt`** for token base units. (`dinero.js` is an option but is fiat/minor-unit-centric and fits crypto's 18-decimals poorly — prefer decimal.js + BigInt here.)
- **Float is display-only.** The moment a value influences a stored balance, a fee, or a confirmed amount, it must have come from a decimal/BigInt source, not a float.

> Today the codebase has **no decimal lib** (float + Intl only). New money/amount math must follow this rule; the lib adoption + back-fill is tracked as code remediation (see §8).

---

## 2 · Display formatting by value type

Format **only at the edge** (render), from the decimal/BigInt source. Reuse the helpers; don't hand-roll `Intl` per component.

| Value | Helper (extend `format.ts`) | Rule | Example |
|-------|------------------------------|------|---------|
| USD money | `formatUsd` | 2 dp, `en-US`, thousands sep | `4532.5 → "$4,532.50"` |
| USD delta | `formatSignedUsd` | explicit `+`/`−`, 2 dp | `-120 → "−$120.00"` |
| USD large (tiles/charts) | `formatUsdCompact` | compact `K/M/B/T`, ≤2 dp | `1.25e6 → "$1.25M"` |
| Token amount | `formatTokenAmount` | by magnitude (see §4) | `12.85, "USDC" → "12.85 USDC"` |
| Percentage | `formatPercent` | 1–2 dp; signed for PnL; cap absurd APY (`>999%`) | `7.4 → "7.4%"` |
| Count (investors, friends) | `Intl` integer | integer + thousands sep, no decimals | `1234 → "1,234"` |
| Quacks (reward points) | integer / compact | integer; compact when large | `1250 → "1.25K"` |

Rules of thumb:
- **Exact vs compact:** show the **exact** value in transaction/confirmation/detail contexts; use **compact** only where scanning matters (dashboard tiles, chart axes, hero numbers).
- **Trim trailing zeros** on token amounts (`12.5000` → `12.5`) but **keep** the 2 fixed dp on fiat (`$12.50`, not `$12.5`).
- **Sign:** deltas/PnL always carry an explicit sign; balances don't.
- Per the transaction-display rule, a token line shows **both** the token amount and the USD-at-time (`−12.99 USDC · $12.99 @ $1.00`).

---

## 3 · Large numbers (thousands → trillions)

- Use **compact notation**: `K` (1e3), `M` (1e6), `B` (1e9), `T` (1e12), **`en-US`**, 1–2 dp (`$1.2M`, `$3.45B`). `formatUsdCompact` already does this for money.
- **Threshold:** switch to compact at **≥ 1,000,000** for body/detail; in very tight UI (chart axis, dense tile) compact at **≥ 10,000**. Below the threshold, format exact.
- Keep it deterministic across locales (we pin `en-US`), so a number reads the same everywhere.

---

## 4 · Tiny numbers (the crypto long-tail) — subscript-zero

Token amounts can be `0.0000000000000001` (1e-16). The current `formatTokenAmount(1e-16, "TKN", 4)` returns **`"0 TKN"`** — the value vanishes. **Decision (murilo):** use **subscript-zero (DEX-style) notation**, like Uniswap.

**Algorithm** (magnitude-aware):
- `|x| ≥ 1` → up to ~4 dp, trim trailing zeros, thousands sep.
- `1 > |x| ≥ 1e-4` → **significant figures** (≈4 sig-figs): `0.0001234`.
- `|x| < 1e-4` (would otherwise round to 0) → **subscript-zero**: compress the run of leading zeros after the decimal into a subscript count, then show ~4 sig-figs.
  - `0.0000000000000001234` → `0.0₁₅1234` (the `₁₅` = fifteen leading zeros).
  - Exact `0` stays `0` (subscript only for *nonzero* sub-threshold values).
- Never show **scientific notation** (`1.2e-16`) in the UI, and never let a nonzero amount render as `0` (that reads as "nothing there").

**Rendering:** the subscript needs a small render helper — either a `<TokenAmount>` component using `<sub>`, or a parts-returning `formatTokenAmountParts()` so callers can style the count. Provide the exact value on hover/title for copyability. (Implementation tracked in §8.)

---

## 5 · Numeric inputs — allow only what's necessary

Today each field (AmountKeypad, TopUpDialog, deposit, the manager fee/range inputs) re-implements its own sanitizing. **Consolidate into one reusable numeric-input helper** and reuse it.

Rules:
- **Whitelist, don't blacklist:** permit only `[0-9]`, a single decimal separator, and (where valid) a leading `−`. Strip everything else on input. Never try to enumerate "bad" characters.
- **One separator; bounded decimals:** at most one `.`; clamp to the field's max decimal places (USD → 2; token → the token's decimals).
- **Clamp the range:** `≥ 0` for amounts; enforce min/max (e.g. the Performance fee field is 5–90; deposit ≥ min). Reject/clamp out-of-range, don't silently accept.
- **Locale separator:** accept the user's decimal separator (`,` in pt-BR) and normalize to `.` internally; never send a locale-formatted string to math.
- **Validate at the boundary with Zod** (the project standard): coerce + bound (`z.coerce.number().min(0)`, `.max(...)`, `.finite()`), and parse before the value crosses into a service/API. Reject `NaN`/`Infinity`.
- The input's *string* state and the parsed *number/decimal* are different things — keep the raw string for the field, parse to a decimal/number for logic.

---

## 6 · Input safety (the numeric slice)

The general security surface lives in **`frontend-security`**; here's what's numeric-specific:

- **Frontend, the real risk is XSS, not SQL.** React escapes by default — render values as text. **Never** `dangerouslySetInnerHTML` with anything derived from user input (incl. numbers formatted into HTML). Mirror the analytics `sanitizeParams` discipline (blacklist secrets, never pass raw addresses).
- **Backend (when Neon + Drizzle lands): SQL injection.** Use the **Drizzle query builder / parameterized queries only** — never string-concatenate a value (even a "number") into SQL. A value coming off a numeric *input* is still attacker-controlled until validated.
- **Validate server-side too:** client Zod is UX, not a trust boundary. Re-validate + coerce at the API edge; bound ranges there as well.
- **Money columns are `numeric`/`decimal`, never `float`/`double`** — precision must survive the DB round-trip.
- **Don't leak precision/secrets in events:** analytics gets the rounded/bounded value, never raw wallet-linked figures beyond the catalog params.

---

## 7 · Do / Don't

**Do**
- Format at render, from a decimal/BigInt source.
- Reuse `format.ts` + the one numeric-input helper.
- Show exact in tx/confirm; compact in tiles/charts.
- Subscript-zero (not `0`, not `1e-16`) for tiny token amounts.
- Whitelist input chars; bound + Zod-validate at every boundary.

**Don't**
- Do money/amount math on `number`/float.
- `parseFloat` a token base-unit.
- Let a nonzero amount render as `0` or as scientific notation.
- Concatenate a value into SQL, or `dangerouslySetInnerHTML` a formatted value.
- Re-implement input sanitizing per component.

---

## 8 · Current gaps this skill targets (code remediation — follow-up)

The skill states the target; the code isn't there yet. Tracked as a separate remediation issue:
- **Bug:** `formatTokenAmount(1e-16, …, 4)` → `"0"` — add the magnitude-aware path + subscript-zero (§4).
- **No decimal lib:** adopt `decimal.js` (+ `BigInt`/`formatUnits` for tokens); back-fill any money math off floats (§1).
- **Hand-rolled inputs:** extract the one reusable numeric-input helper and migrate AmountKeypad / TopUpDialog / deposit / manager fee+range fields to it (§5).

Until then: green `i18n:check`/typecheck does **not** prove numeric correctness — review tiny/large/precision cases by hand.
