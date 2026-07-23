---
name: pr-review-checklist
description: Review a Pool Party Frontend PR. Complete conformance checklist for standards, TDD, i18n, IDs, integration points, coverage. Structured feedback in blocking vs suggestion blocks.
---

# PR Review Checklist

Review in priority order: correctness first, regressions second, then conformance. A clean-looking PR
that breaks a rule or a working path still fails.

## Complete checklist

### Business-logic soundness (highest priority)
- [ ] Every behavioral change traces to a numbered `[Rn]` rule; if a rule changed, the version bumped in
      all four places (Linear `rules:vN`, PR title `@rules-vN`, file header `@implements-rules-version: vN`,
      issue revision history).
- [ ] Numbers, units, scale are right: USDC 6 decimals; wei vs USD vs bps vs ticks not mixed; "Max" fills
      the full-precision balance; spendable balance is per-network (not a unified sum); fee bounds,
      minimums, and thresholds (dust < $5 then close; > 50% then close) match the rule.
- [ ] The rendered value comes from the data source the rule names (not a plausible-but-wrong one).
- [ ] Edge cases handled: zero/empty (block the zero-leg), degenerate inputs (0/0 is a hard error),
      closed positions, full-vs-partial boundary. Error behavior matches the rule; raw error messages never
      reach analytics.

### Functional safety / regression
- [ ] **Mock-vs-real parity:** the change works in both `isMockMode` true and false; the untouched path is
      preserved; both paths are tested. (Ask: does this reflect in real mode, not only mock mode?)
- [ ] **Core-logic / data-standardization changes flagged:** any change to `apiFetch`, server actions, the
      `network` param, schemas/Zod, mappers, or `BuiltTx` is named explicitly with how it changes the
      baseline (old interface + live endpoints = protected baseline).
- [ ] **Contract preserved on refactor:** call sites + tests moved with a changed hook/executor shape; any
      retained compatibility path reproduces the old behavior exactly (actions, order, return shape).
- [ ] **Async flows tested with `findBy`/`waitFor`,** not `act(advanceTimersByTime)` over a promise-settled
      flow (false green). Steppers: labels and runtime steps index-aligned + same length; "Try again"
      resumes from the failed step.
- [ ] Feature flag vs `isManager` vs `isMockMode` not conflated; gating via `requireFeature`, not raw env.
- [ ] **Caching/throttle:** new pp_api reads cache only wallet-independent data (`revalidate` + `tags`); per-wallet reads stay no-store; writes are never cached. No new uncached SSR read that re-fetches on every navigation (the per-IP 429 risk).
- [ ] **Network-agnostic:** chain/RPC/token/config reads derive from the single chain source, not hardcoded per-network literals.

### Structural
- [ ] Branch name: `<type>/<area>-poo-<num>-<slug>` — `<area>` present (never dropped), `poo-<num>` is the **lowercase Linear key** (auto-links the branch). The artifact ID `PP-AREA-TYPE-NNN` belongs in the commit scope + PR title, **not** the branch. Canonical: `docs/02_NAMING_CONVENTION.md`.
- [ ] Commit messages: Conventional Commits with scope `(PP-XXX-XXX-XXX)` or `(POO-NNN)`.
- [ ] PR title is Conventional Commits `<type>(<id>): desc` (it becomes the squash commit subject on main).
- [ ] PR body has `Closes POO-NNN` (Linear issue key is `POO`).

### Header of each new file
- [ ] `@id`, `@name`, `@description`, `@figma`, `@linear`, `@i18n-namespace` (if user-facing), `@implements-rules-version`.

### TypeScript
- [ ] No `any` in the diff.
- [ ] No arbitrary `as` casts.
- [ ] Props typed with a named `interface`.
- [ ] Reusable types exported.

### TDD
- [ ] Issue has listed `[Rn]` rules.
- [ ] Each rule has an `it()` with `// @rule <Rn>`.
- [ ] States (loading, error, empty, success) covered when applicable.
- [ ] Coverage above the layer threshold.

### Mocks and integration
- [ ] Mock service calls have a nearby `// PP-INTEGRATION-POINT`.
- [ ] New service has a contract interface.
- [ ] No direct fetch/axios/wagmi in components.

### i18n
- [ ] No hardcoded user-facing strings.
- [ ] Keys present in every locale folder (11 today; `i18n:check` enforces parity).
- [ ] **Semantic**: non-en locales hold real translations in that language, not English placeholders; new copy is stored as keys, not raw data rendered verbatim (the Cards-perks regression, PR #62).
- [ ] DeFi terms in English where applicable.
- [ ] `pnpm i18n:check` green.

### Accessibility & security
- [ ] Interactive / modal / money-rendering components pass the `a11y-checklist` (focus, contrast, aria-live on dynamic values, keyboard).
- [ ] Security-touching changes (headers/CSP, cookies/SIWE, wallet signing/approvals, a new app API route, any secret) pass `frontend-security`; no non-public secret reaches the client; raw addresses / `error.message` never hit analytics.

### Storybook
- [ ] Components in `src/components/` have `.stories.tsx`.
- [ ] Complex modals have `.stories.tsx`.
- [ ] Stories cover main variants.

### Docs
- [ ] `docs/IDS_REGISTRY.md` updated.
- [ ] `src/features/<area>/README.md` updated.
- [ ] `docs/INTEGRATION_POINTS.md` updated if new ones added.

### Local pre-merge validation (CI is billing-broken, validate locally)
Run, in order, and require green: `pnpm typecheck`, `pnpm lint`, `pnpm i18n:check`, `pnpm test:coverage`, then `rm -rf .next && pnpm build`. Do not gate on CI status; merge only against a locally-validated, up-to-date `main`.

## Feedback format

### Approval
```
Approved by qa-reviewer
- Coverage: <X>%
- Lint, typecheck, i18n, build: green
No new debt. Issue moved to Done.
```

### Change request
Two sections. **Blocking** (prevent merge): each item cites file, line, and the canonical doc defining the rule. **Suggestions** (non-blocking). PR kept in `In Review`.

## Conduct

- **Cite the canonical doc** whenever requesting a change.
- **Do not invent standards.** Suggest doc updates separately.
- **Direct but respectful** tone. No snark.
- **Do not approve** with an open blocking item.
- **Do not merge** alone.
- **Never touch a worktree you're not reviewing or not using.** Review is read-only. Read the PR via `gh pr diff` and `git show origin/<branch>:<path>`; never create, remove, prune, reset, checkout, pull, or `rm -rf` any worktree. Other worktrees may hold a concurrent session's live, uncommitted work that git cannot recover. A stale/unexpected worktree is a **report-to-the-user** event, not a cleanup, and never run a blanket `git worktree prune`.

## Anti-patterns

- Approving without running checks.
- Requesting subjective style changes without a doc to cite.
- Mixing blocking with suggestion.
- Approving a PR that ignores TDD even if the code looks clean.
- Creating, removing, or pruning any worktree during review. Review is read-only, and touching a worktree you're not reviewing can destroy a concurrent session's unrecoverable work.
