---
name: i18n-translation-rules
description: Translation conventions for the Pool Party Frontend across all 11 configured locales (en source; pt-BR/es curated; fr/de/nl/ja/ko/zh-CN/zh-TW/vi machine-translated, pending native review). Structure, DeFi terms kept in English, ICU MessageFormat, orphan/missing key detection.
---

# i18n Translation Rules

## Locales

Source of truth: `src/i18n/config.ts` (11 locales today). Every new key lands in ALL of them in the same PR (`pnpm i18n:check` enforces parity).

- `en`: source (from Figma).
- `pt-BR`, `es`: curated, human-reviewed.
- `fr`, `de`, `nl`, `ja`, `ko`, `zh-CN`, `zh-TW`, `vi`: machine-translated, pending native review (POO-231).

(Tier policy + per-language tone are detailed below under "Locale tiers" and "Tone per language".)

## Structure

```
src/i18n/messages/
├── en/{auth,cards,common,consent,deposit,errors,home,manager,portfolio,profile,rewards,shell,strategies,wallet}.json   # source
├── pt-BR/ , es/                                                         # curated
└── fr/ , de/ , nl/ , ja/ , ko/ , zh-CN/ , zh-TW/ , vi/                  # machine-translated (same structure)
```

## Key convention

- `camelCase`.
- Hierarchical, max 3 levels.
- Standard suffixes: `.title`, `.description`, `.cta`, `.error`, `.placeholder`, `.tooltip`, `.aria.<name>`.

Example:

```json
{
  "summaryCard": {
    "title": "Portfolio overview",
    "stats": { "tvl": "Total value locked", "pnl24h": "P&L 24h", "activePositions": "Active positions" },
    "emptyState": { "title": "No positions yet", "description": "Start by adding liquidity to a pool", "cta": "Explore pools" }
  }
}
```

## Term policy (depends on surface, CLAUDE.md premise 5)

The **investor app abstracts crypto jargon** (prefer "earn", "invest", "savings", "rewards"; avoid "stake", "LP", "AMM", "yield farming"). Only the **Manager Console** (the `manager.json` namespace) keeps technical DeFi terms in English across all locales.

- **Manager Console only, do not translate:** TVL, APR, APY, slippage, LP, AMM, tick, tick range, pool, swap, yield, stablecoin, gas, smart contract, L1/L2, bridge.
- **Investor app, translate to the abstracted concept**, not the jargon (surface "earnings"/"rewards", not "yield"/"LP fees").
- **Always untranslated (every surface):** product nouns (Pool Party, Quacks, Rubber Rush, Duck Shoot, Say Quack) and token tickers / units (USDC, ETH, cbETH, APY).
- Translatable with care: "wallet" (commonly kept in pt-BR/es); "impermanent loss" → pt-BR "perda impermanente", es "pérdida impermanente" (Manager context). Confirm ambiguous terms with the user and mark `PP-I18N`.

## Locale tiers (policy: docs/01_TECH_STACK.md > Locale policy)

- `en` = source; `pt-BR`/`es` = curated; `fr`, `de`, `nl`, `ja`, `ko`, `zh-CN`, `zh-TW`, `vi` = machine-translated pending native review (POO-231).
- Every new key is translated into ALL locales in the same PR. Never leave English placeholders outside `en`; if genuinely unsure (especially ja/ko/zh), translate conservatively to the en meaning and mark `PP-I18N` for native review.
- Brand and product nouns stay untranslated in every locale: Pool Party, Quacks, Rubber Rush, Duck Shoot, Say Quack, USDC, APY.

## Tone per language

- **EN**: direct, professional, "you".
- **pt-BR**: direct, professional, "você". Brazilian, not Portugal.
- **es**: neutral Latin American. In CTAs and onboarding, formal "usted" ("Conecte su wallet"). In more casual microcopy, "tú" may be used.
- **fr**: professional "vous".
- **de**: formal "Sie"/"Ihre".
- **nl**: formal "u"/"uw".
- **ja**: polite です/ます register; avoid stiff keigo; product nouns stay in Latin script.
- **ko**: polite 해요체; product nouns stay in Latin script.
- **zh-CN / zh-TW**: separate translations (simplified vs traditional); never mechanically convert one into the other; mainland vs Taiwan vocabulary differs.
- **vi**: neutral, friendly "bạn".

## ICU MessageFormat

For plurals:

```json
{ "positionsCount": "{count, plural, =0 {No positions} one {{count} position} other {{count} positions}}" }
```

Validate ICU syntax is correct in all languages.

## Workflow for a new key

1. Developer (or `frontend-implementer`) adds the key in `en/<namespace>.json`.
2. `i18n-translator` is triggered.
3. For each new key: provide ALL 11 locales in the same PR (en source; pt-BR/es curated; the other 8 machine-translated per the per-language register). `i18n:check` fails the build on any gap.
4. Mark sensitive terms with a PR comment `// PP-I18N: term "<x>" may need cultural adaptation`.
5. The user reviews in the PR.

## Script `pnpm i18n:check`

Implemented in `scripts/i18n-check.ts` (4 checks, all failing):
1. **Parity**: every key present in all 11 locales (a key in one but not all fails).
2. **Missing**: keys used in code but absent from the message files.
3. **ICU**: lightweight brace-balance check on ICU MessageFormat.
4. **No em dash** (POO-357): no locale value may contain an em dash (—, U+2014). Restructure with a period, comma, colon or a spaced hyphen. En dashes (–, U+2013) for numeric ranges are allowed.

(There is no "unused key" pass today.)

## Anti-patterns

- Hardcoded string in JSX (`<button>Confirm</button>`).
- Literal translation ignoring context.
- Multiple keys for the same meaning across namespaces.
- Forgetting ICU on keys that need plural.
- Em dash (—) anywhere in copy; use a period, comma, colon or hyphen (POO-357, enforced by `i18n:check`).
