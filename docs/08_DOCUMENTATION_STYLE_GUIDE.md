# 08, Documentation Style Guide

The house manual for writing any documentation in the Pool Party Frontend project. Applies to: markdown, JSDoc in code, comments, commit messages, PR descriptions, Linear issues, READMEs.

## Master principle

Documentation is code. It has an owner, a version, a review. An outdated document is worse than a missing one: it induces error.

## Part A, writing principles

### Tone
- **English** by default for all written documentation and code (names, headers, JSDoc, comments).
- In interactive replies, match the user's language (the user may prefer Portuguese).
- Direct, no fluff.
- Professional without being overly formal. "You" in English.
- No **em-dashes** (—). Use commas, parentheses, or periods.
- Short sentences. When a sentence passes 25 words, break it.

### Voice
- Active over passive.
  - **Yes**: "The hook returns the data."
  - **No**: "The data is returned by the hook."
- Imperative in instructions (READMEs, guides).
  - **Yes**: "Run `pnpm dev`."
  - **No**: "It is possible to run `pnpm dev`."

### What to avoid
| Avoid | Why |
|-------|-----|
| "Simply", "just", "merely" | Belittles the reader. Nothing is "simple" for everyone. |
| "Obviously", "of course" | Same. |
| Casual filler in formal docs | Too colloquial. OK in casual comments. |
| Decorative emojis in canonical docs | Distracting. Use functionally only (check, warning). |
| Em-dash (—) | Project convention. Use comma, parenthesis, or period. |
| Sentence starting with "I" | Documentation is not first person. |
| "Etc.", "..." in lists | Enumerate or say "any other" explicitly. |
| "Maybe", "probably", "should" | Decide. Documentation is a decision made. |

### Before writing, questions
- Who reads this? (the user, another dev, an AI agent, myself in 3 months)
- What do they need to decide after reading?
- What is the most important thing? Put it at the top.

---

## Part B, markdown structure

### Headers
- Use `#` for the document title (only one).
- Use `##` for main sections.
- Use `###` for subsections.
- Rarely go beyond `####`.

**Header style:**
- Capital only on the first word (and proper nouns).
  - **Yes**: `## Component pattern`
  - **No**: `## Component Pattern`
- No trailing period.
- No emoji in canonical doc headers.

### Lists
- **Bullet** with `-` (never `*`).
- **Numbered** with `1.` (real numbers, not `a)`, `b)`).
- List in order of importance or execution, not random.
- Item starts with a capital.
- Item ends with a period if it is a full sentence; no period if a fragment.

### Tables
- Use a table for comparison or multiple properties.
- Do not use a table just to align two short columns (a list works).
- Header in bold.
- Default alignment (left) except for numbers (right-align).

### Code blocks
Always with a specified language:
````markdown
```ts
const x = 1
```
```bash
pnpm dev
```
````

### Links
- Internal: relative to the file. `[see naming](./02_NAMING_CONVENTION.md)`.
- External: full URL.
- Descriptive link text, not "here" or "click".

### Long snippets
When an example passes 30 lines, consider extracting to `examples/` in the repo and linking instead of embedding.

### Notes and warnings
Use blockquote with a clear prefix:
```markdown
> **Note**: important but non-blocking detail.
> **Caution**: special care needed.
> **Important**: non-negotiable rule.
```

### Line breaks
- Always a blank line between sections.
- Always a blank line before and after code blocks, tables, large lists.
- Do not use forced breaks (`<br>`) except in extreme need.

---

## Part C, JSDoc in code

### Standard file header
Every component, hook, service, or public function file has a header at the top:
```tsx
/**
 * @id PP-AREA-TYPE-NNN
 * @name <TechnicalName>
 * @description <One sentence of what it does, ending in a period.>
 * @figma <frame URL>
 * @linear <issue URL>
 * @owner core-team
 * @since YYYY-MM-DD
 * @i18n-namespace <namespace>
 * @implements-rules-version v<N>
 *
 * @integration-points
 * - <point>: <description of the expected future replacement>
 *
 * @notes
 * <optional, context that does not fit in description>
 */
```

### JSDoc on functions and public methods
```ts
/**
 * Computes the aggregated TVL in USD for a list of positions.
 *
 * Considers only positions with status other than 'closed'.
 * Uses a mocked oracle price, see PP-INTEGRATION-POINT below.
 *
 * @param positions List of user positions.
 * @param prices Price map by token symbol.
 * @returns Aggregated TVL in USD, always >= 0.
 * @throws Does not throw. Positions with invalid data are ignored.
 *
 * @example
 * ```ts
 * const tvl = calculateTVL(positions, { USDC: 1, ETH: 3450 })
 * ```
 */
export function calculateTVL(positions: Position[], prices: PriceMap): number {
  // ...
}
```

### JSDoc on component props
```tsx
export interface PortfolioCardProps {
  /** Wallet address to query. If omitted, uses the one in walletStore. */
  walletAddress?: `0x${string}`
  /** Shows masked values (`****`) for privacy. Default: false. */
  obfuscate?: boolean
  /** Additional classes applied to the root card. */
  className?: string
  /** Callback when a position is clicked. */
  onPositionClick?: (positionId: string) => void
}
```

**Rules:**
- Every prop with JSDoc.
- Short sentences, ending in a period.
- Explicit defaults: "Default: false".
- Types go to the type system, not JSDoc (`@param {string}` is redundant in TS).

### Inline comments in code
Use **sparingly**. Well-named code needs no comment. A comment answers "why", not "what".

**When to comment:**
- A non-obvious decision ("We use `setTimeout` 100ms here to wait for the portal to mount before focusing").
- A workaround with an issue link ("Workaround for Radix bug #1234").
- Project tags: `PP-INTEGRATION-POINT`, `PP-TODO`, etc.

**When NOT to comment:**
- The code is already self-explanatory.
- "Assigns x to y" (literally what the code says).
- Outdated comments (worse than none).

---

## Part D, commit messages

### Format
```
<type>(<id>): <description> [rules-vN]

[optional body, after a blank line]

[optional footer]
```

### Types
| Type | When |
|------|------|
| `feat` | New user-visible functionality |
| `fix` | Bug fix |
| `chore` | Maintenance without behavior change (deps, configs) |
| `docs` | Documentation only |
| `refactor` | Refactor without behavior change |
| `test` | Tests only |
| `perf` | Performance improvement |
| `style` | Formatting only (rare with Biome) |
| `i18n` | Translations only |

### Description
- Imperative: "add", "fix", "remove" (not "added", "adding").
- Lowercase initial (after `: `).
- No trailing period.
- Max 72 characters on the first line.

### Examples
```
feat(PP-DASH-SCR-001): implement portfolio overview [rules-v1]

- Add PortfolioSummaryCard with tests (TDD)
- Add PositionsTable
- Create mocks in src/mocks/data/positions.ts
- translations for all configured locales

Closes POO-123
```
```
fix(PP-CORE-CMP-002): fix visible focus on disabled Button

Disabled button was losing the focus outline when navigated by keyboard.
Adjusted in Button.tsx, added a regression test.
```

---

## Part E, PR descriptions

### Template
Lives in `.github/PULL_REQUEST_TEMPLATE.md`. Summary form:
```markdown
## ID
PP-XXX-XXX-XXX @rules-vN

## Linear
Closes POO-XXX

## Figma
<link>

## What was done
<short list of delivered artifacts>

## TDD checklist
- [ ] Tests written before implementation
- [ ] All business rules covered
- [ ] Coverage above the layer threshold

## i18n
- [ ] en
- [ ] pt-BR
- [ ] es
- [ ] PP-I18N marked for sensitive terms

## Integration points added
<list>

## Technical debt created
<list of auto-created PP-XXX issues>

## Screenshots / Storybook
<link>
```

### Rules
- Title starts with `[ID]` and ends with `@rules-vN`.
- Full body (not "empty, see commits").
- List artifacts with IDs and technical names.
- Screenshots for visual changes.

---

## Part F, Linear issue descriptions

Canonical template in `07_LINEAR_WORKFLOW.md`. Key **style** points:

### Title
```
[<ID>] <short description>
```
- `[PP-DASH-SCR-001] Portfolio overview`
- `[PP-CORE-CMP-002] Implement Input with variants`

### Body
- Always has "Business rules" filled before becoming `Ready`.
- Each `[Rn]` is a testable statement.
- No "etc.", "..." or ambiguity.

### Writing rules
| Good | Bad |
|------|-----|
| `[R1] TVL is the sum of the USD value of all positions with status != 'closed'.` | `[R1] Show the TVL.` |
| `[R2] When the portfolio is empty, show an empty state with a "Explore pools" CTA linking to /pools.` | `[R2] Empty state if empty.` |
| `[R3] An error from mockPortfolioService.getStats() results in an error toast + "Try again" button.` | `[R3] Handle error.` |

---

## Part G, READMEs

### Repo README (root)
Minimum structure:
1. **Title** with the project name.
2. **Pitch** in 1-2 sentences.
3. **Status** (version, stage: foundation, beta, prod).
4. **Quick start** (3-5 commands to run locally).
5. **Documentation**: link to `docs/`.
6. **Scripts**: table of available `pnpm` commands.
7. **Contributing**: link to a guide.
8. **License**: (if applicable).

### Feature README (`src/features/<area>/README.md`)
Template in `_claude-code-config/skills/docs-sync-workflow/SKILL.md`. Key points:
1. Feature name.
2. i18n namespace.
3. Global status (X/Y screens implemented).
4. ID table with name, type, status, coverage.
5. Specific integration points.
6. Notes (special states, dependencies).

---

## Part H, writing business rules (`[Rn]`)

The most important rule: **every rule must be turnable into a test.**

### Formula
```
[Rn] <condition>, <expected behavior>.
```
or
```
[Rn] <subject> <verb> <object> [<qualifier>].
```

### Good examples
- `[R1] Total portfolio value is the sum of the current USD value of all positions with status other than 'closed'.`
- `[R2] The usePortfolioStats hook returns { isLoading: true, data: null } during the initial call.`
- `[R3] An invest amount below the strategy's minInvestment is rejected and surfaces a validation message.`
- `[R4] The yield calculation is net of management and performance fees.`

### Bad examples (redo)
- `[R1] Show the TVL.` then how to compute? Include closed? In USD or native?
- `[R2] Empty state when the list is empty.` then how does the empty state look? CTA? Text?
- `[R3] Error is handled.` then how? Toast? Page? Retry? Log?

### Checklist (internal to `business-rules-clarification`)
For each `[Rn]`:
- [ ] Has an explicit subject (what does it do?)
- [ ] Has an explicit condition (when?)
- [ ] Has measurable behavior (how to verify?)
- [ ] No vague words ("adequate", "nice", "fast", "etc.")
- [ ] Edge cases covered or referenced in another rule

---

## Part I, keeping docs in sync

### Who updates what
| Document | Frequency | Who |
|----------|-----------|-----|
| `00_OVERVIEW.md` to `08_DOCUMENTATION_STYLE_GUIDE.md` | On demand (rule change) | Human via explicit PR |
| `IDS_REGISTRY.md` | Each merged PR | `documentation-keeper` |
| `INTEGRATION_POINTS.md` | Each merged PR | `documentation-keeper` |
| `FIGMA_INVENTORY.md` | When BOOTSTRAP runs | `figma-inventory` |
| `RULES_DRIFT.md` | Daily (generated once `docs-sync-workflow` is promoted from staging) | `docs-sync-workflow` |
| `CONSISTENCY_REPORT.md` | Weekly (generated once `consistency-checker` is promoted from staging) | `consistency-checker` |
| `CHANGELOG.md` | Each release | `documentation-keeper` |
| `src/features/*/README.md` | Each feature PR | `documentation-keeper` |

### Drift detection
Every week `consistency-checker` runs and verifies:
- Cross references between docs (`[see X](./X.md)`) still exist.
- IDs referenced in docs still exist in the registry.
- Referenced skill/agent names are current.
- Rule versions in code (`@implements-rules-version`) match Linear.
- Naming conventions from `02_NAMING_CONVENTION.md` are respected in code.

Detected drift becomes a Linear issue with label `docs-drift`.

---

## Part J, doc versioning

### Versioning
The 9 canonical documents (`00` to `08` + `CHANGELOG`) are versioned as a set. Version reflected in `CHANGELOG.md`.
- `v0.x`: foundation. Frequent changes.
- `v1.0`: milestone. Stabilized structure.
- Minor changes (`v0.x.y`): fixes, refinements.
- Major changes (`vN+1.0`): reorganization, principle change.

### How to change a canonical doc
1. Prior discussion (Linear issue with label `docs`).
2. Explicit PR changing the doc.
3. Update `CHANGELOG.md` in the same PR.
4. Communicate the change in the appropriate channel.
5. Agents read it automatically in the next session.

### When NOT to change a canonical doc
- Instead of changing, ADD a new section when possible (less disruptive).
- Removing a rule without a migration plan: never. To deprecate, mark as `[Deprecated in vN]` and keep it for at least 1 version.
