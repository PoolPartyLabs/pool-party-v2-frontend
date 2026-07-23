---
name: figma-tokens-to-tailwind
description: Extract tokens from Pool Party Figma Variables and generate versioned files in src/design-system/tokens/, wire them via the @theme directive in src/app/globals.css (Tailwind 4 CSS-first, no JS config). Keeps a single source of truth.
---

# Figma Tokens to Tailwind

> **Current state:** today tokens are CSS-first, hand-authored in `src/app/globals.css` via `@theme` (the working single source of truth). The `src/design-system/tokens/*.ts` files, `tokens.test.ts`, and `pnpm tokens:sync` below describe the **target Figma-sync pipeline, not built yet** (`src/design-system/tokens/` does not exist). Follow this when wiring Figma sync; until then, `@theme` in `globals.css` is the source.

## Prerequisite

- Figma MCP connected.
- The Pool Party file has organized Variables (confirmed).

## Expected Variable types

- **Colors**: semantic (`background`, `foreground`, `primary`, `secondary`, `muted`, `accent`, `destructive`, `border`, `input`, `ring`, `card`, `popover`), brand (`brand-gold`, `brand-grape`, `brand-flame`, `brand-pink`, …), surfaces (`surface`, `surface-raised`), status (`success`, `warning`, `info`, `error-surface`, `error-border`), and risk levels (`risk-1`…`risk-5`). No `gray-50..950` palette today.
- **Typography**: font families, sizes, line heights, weights.
- **Spacing**: scale (`0`, `1`, `2`, `4`, `6`, `8`, `12`, `16`, `24`, etc, typically multiples of 4).
- **Radii** (px): `xs` 4, `sm` 8, `md` 12, `lg` 16, `xl` 20, `2xl` 24.
- **Shadows**: `sm`, `md`, `lg`.

## Workflow

### 1. List Variables
Via Figma MCP: `list_variables(fileKey)`. Receive list with name, value, type, collection.

### 2. Map to files

```ts
// src/design-system/tokens/colors.ts
/**
 * @id PP-CORE-STY-001
 * @generated-from Figma Variables, collection "Colors"
 * @last-sync YYYY-MM-DD
 *
 * DO NOT EDIT MANUALLY.
 * Update via design-system-builder agent or figma-tokens-to-tailwind skill.
 */
export const colors = {
  primary: { DEFAULT: 'hsl(var(--primary))', foreground: 'hsl(var(--primary-foreground))' },
  destructive: { DEFAULT: 'hsl(var(--destructive))', foreground: 'hsl(var(--destructive-foreground))' },
  gray: { 50: '#FAFAFA', 100: '#F4F4F5', 950: '#0A0A0A' },
} as const
export type ColorToken = keyof typeof colors
```

And CSS variables in `src/app/globals.css`:

```css
:root.dark {
  --primary: 222 47% 51%;
  --primary-foreground: 210 40% 98%;
  --destructive: 0 84% 60%;
}
```

### 3. Wire tokens via @theme in globals.css

Tailwind 4 is CSS-first: there is no `tailwind.config.ts`. Expose the tokens to Tailwind with the `@theme` directive in `src/app/globals.css`, mirroring the versioned files in `src/design-system/tokens/`. Each `@theme` entry generates the matching utility class (e.g. `--color-primary` enables `bg-primary`, `text-primary`).

```css
@import "tailwindcss";

/* Real pattern: flat hex directly in @theme (no hsl(var()) indirection, no separate :root layer). Dark-only today. */
@theme {
  --color-background: #171717;
  --color-foreground: #efefef;
  --color-primary: #f7ce02;
  --color-primary-foreground: #171717;
  --color-surface: #1f1f1f;
  --color-surface-raised: #2a2a2a;
  --color-success: #22c55e;
  --color-warning: #f7ce02;
  --color-info: #3b82f6;
  --color-risk-3: #f7ce02;     /* risk-1..risk-5 */
  --radius-md: 12px;           /* px: xs 4 / sm 8 / md 12 / lg 16 / xl 20 / 2xl 24 */
}

/* Fonts use a second `inline` block so utilities reference the runtime next/font vars from the layout. */
@theme inline {
  --font-sans: var(--font-poppins), ui-sans-serif, system-ui, sans-serif;
  --font-mono: var(--font-geist-mono), ui-monospace, monospace;
}
```

Each `@theme` entry generates the matching utility (`--color-primary` → `bg-primary`/`text-primary`; `--color-risk-3` → `bg-risk-3`). Dark-only today; values live directly in `@theme` (a light theme later would switch to a CSS-variable indirection).

### 4. Validation

Tests in `src/design-system/tokens/tokens.test.ts`: essential semantic colors exist, spacing scale complete.

## Sync

- `pnpm tokens:sync` runs this flow.
- Result: commit `chore(tokens): sync from figma <date>`.
- Caution: token changes affect the whole app. Make an isolated PR.

## Conventions

- **Naming**: kebab-case in files, camelCase in object keys.
- **Versioning**: generated file has `@last-sync` in the header.
- **Do not edit manually.** To change a token, change it in Figma and re-sync.

## Anti-patterns

- Editing generated files manually.
- Mixing new tokens with code changes in the same PR.
- Using hardcoded values outside the design system.
