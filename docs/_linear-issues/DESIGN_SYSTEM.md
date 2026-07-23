# DESIGN SYSTEM, Issues

15 design system issues. Tokens first, then primitives. Everything blocks features. Agent: `design-system-builder`.

---

## PP-CORE-STY-001: Extract tokens from Figma

**Project**: Foundation
**Labels**: `area:CORE`, `type:setup`, `priority:p0`
**Depends on**: SETUP-009

### Body

```markdown
## Goal
Run the `figma-tokens-to-tailwind` skill and generate `src/design-system/tokens/`.

## Business rules (TDD)
- [R1] All Figma color Variables become entries in `colors.ts`.
- [R2] Mandatory semantic colors: `primary`, `secondary`, `destructive`, `muted`, `accent`, `background`, `foreground`, `border`, `input`, `ring`.
- [R3] Spacing tokens follow multiples of 4 (0, 1, 2, 4, 6, 8, 12, 16, 24, 32, 48, 64).
- [R4] Typography includes families, sizes (xs-4xl), weights, line-heights.
- [R5] Radii: sm, md, lg, xl, full.
- [R6] Shadows: sm, md, lg.
- [R7] Each token file has a `@generated-from` and `@last-sync` header.

## Business rules revision history
- v1 (YYYY-MM-DD, author): initial rules.

## Acceptance criteria
- [ ] Files in `src/design-system/tokens/`: colors, typography, spacing, radii, shadows, index
- [ ] Test in `tokens.test.ts` validates presence of semantic keys (R2)
- [ ] CSS variables in `globals.css` so Tailwind classes work
```

---

## PP-CORE-STY-002: Configure tailwind.config.ts with tokens

**Project**: Foundation
**Labels**: `area:CORE`, `type:setup`, `priority:p0`
**Depends on**: PP-CORE-STY-001

### Body

```markdown
## Goal
Tailwind consumes the generated tokens.

## Business rules
- [R1] `tailwind.config.ts` imports tokens from `src/design-system/tokens/`.
- [R2] `extend` is used (does not fully replace the default palette).
- [R3] `darkMode: 'class'`.
- [R4] `content` covers `src/**/*.{ts,tsx}`.

## Acceptance criteria
- [ ] Classes like `bg-primary`, `text-foreground`, `rounded-md` work
- [ ] `pnpm build` green
```

---

## PP-CORE-CMP-010 through PP-CORE-CMP-021: Primitives

> Note: `PP-CORE-CMP-001..009` are already taken by Figma-designed components (Search bar, Filter Chip, etc.) in `IDS_REGISTRY.md`. The shadcn primitives below continue the sequence at `010..021`.

For each primitive, create a separate issue with the template below. Full list:

1. `Button` (variants: primary, secondary, ghost, destructive; sizes: sm, md, lg)
2. `Input` (variants: default, error; sizes)
3. `Card` (composed Header, Content, Footer)
4. `Dialog` (generic modal, shadcn base)
5. `Tabs` (controlled and uncontrolled)
6. `Tooltip`
7. `Toast` / `Notification` (Sonner or Radix Toast)
8. `Skeleton`
9. `EmptyState` (with a slot for CTA and i18n)
10. `ErrorState` (with retry CTA and i18n)
11. `Table` wrapper over `@tanstack/react-table`
12. `LocaleSwitcher` (pt-BR, en, es)

### Template per primitive

```markdown
**Title**: [PP-CORE-CMP-<NNN>] Implement <Primitive>
**Project**: Foundation
**Labels**: `area:CORE`, `type:component`, `priority:p0`
**Depends on**: PP-CORE-STY-002

## i18n namespace
Only if applicable (`common.<component>` or none if it is a "dumb" component).

## Business rules
(Adapt per primitive. Button examples:)
- [R1] The button renders children as content.
- [R2] Supports variants: primary, secondary, ghost, destructive.
- [R3] Supports sizes: sm, md, lg.
- [R4] Disabled state blocks onClick and applies a visual.
- [R5] Forwards other HTML props (type, onClick, etc).
- [R6] Accessibility: visible focus, implicit button role.

## Visual states
- [ ] Default
- [ ] Hover
- [ ] Focus
- [ ] Disabled
- [ ] Loading (with spinner)

## Acceptance criteria
- [ ] TDD tests covering all rules
- [ ] Storybook story covering all variants
- [ ] Coverage > 90%
- [ ] Standard header
- [ ] No hardcoded color
```

---

## PP-CORE-LAY-001: AppShell

**Project**: Foundation
**Labels**: `area:CORE`, `type:component`, `priority:p0`
**Depends on**: PP-CORE-CMP-010 through PP-CORE-CMP-021

### Body

```markdown
## Goal
Shell wrapping all authenticated screens: sidebar + topbar + LocaleSwitcher + content area.

## Business rules
- [R1] Sidebar with navigation items (links to the main features).
- [R2] Active item highlighted.
- [R3] Topbar with LocaleSwitcher and a wallet connection placeholder (not functional yet).
- [R4] Responsive: sidebar becomes a drawer on mobile.
- [R5] Supports content area override via children.

## Acceptance criteria
- [ ] Tests covering active navigation and responsiveness
- [ ] Storybook story (not a page story, an isolated shell story)
- [ ] Works in pt-BR, en, es
```
