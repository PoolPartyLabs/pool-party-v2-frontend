---
name: adr
description: Record an architecture decision (ADR) for the Pool Party frontend as an immutable, numbered entry. Use when a design choice must not be silently reversed later (state/data-fetching pattern, folder or boundary conventions, a deliberate deviation from a blueprint skill, the mock-vs-real seam, a library choice). Read-only against code.
---

# Architecture Decision Record (frontend)

An ADR captures one significant, hard-to-reverse frontend decision and the reasoning behind it, so a future contributor (or agent) does not silently undo it. It is a project memory, not a design doc.

## When to write one

- A choice future work must respect: state-management approach, data-fetching/caching pattern, routing/folder structure, the mock-vs-real boundary (`isMockMode`), error-handling strategy, a shared abstraction.
- A deliberate deviation from a blueprint skill (`react-component-blueprint`, `nextjs-page-blueprint`, `mock-service-blueprint`), document why.
- Picking between libraries/approaches with real tradeoffs.
- **Skip it** for reversible, local, or obvious choices, those belong in the PR description.

## Where they live

`docs/adr/NNNN-kebab-title.md`, zero-padded sequential (`0001-…`). Create `docs/adr/` if absent. One decision per file.

## Format

```markdown
# NNNN. <decision title>
- Status: Proposed | Accepted | Superseded by ADR-XXXX
- Date: YYYY-MM-DD
- Linear: POO-NNN   PR: #NNN

## Context
The forces at play: constraints, the problem, what made this non-obvious.

## Decision
The choice, in active voice ("We use X").

## Consequences
What gets easier, what gets harder, what this commits us to, follow-ups.

## Alternatives considered
Each option and why it lost.
```

## Rules

- **Immutable once Accepted.** Never rewrite a decided ADR. To change course, write a NEW ADR and set the old one's Status to `Superseded by ADR-XXXX`.
- Number monotonically; never reuse a number.
- Link the ADR from the PR that implements it, and reference the Linear issue.
- Keep it to roughly one screen. Reasoning over prose.

## Anti-patterns

- Editing an Accepted ADR instead of superseding it.
- An ADR for a trivial/reversible choice (noise).
- Recording the decision but omitting alternatives or consequences (the valuable part).
- A decision that contradicts a CLAUDE.md premise without calling that out explicitly.
