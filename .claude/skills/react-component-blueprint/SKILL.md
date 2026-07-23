---
name: react-component-blueprint
description: Template for creating a React component following the Pool Party pattern. Standard header, strict typing, CVA variants, separated states, mock integration via hook, mandatory i18n.
---

# React Component Blueprint

## Initial template

```tsx
/**
 * @id PP-<AREA>-CMP-<NNN> (POO-NNN)
 * @name <ComponentName>
 * @implements-rules-version v1
 * <One-line description of what it does.>
 */
"use client"; // ONLY if it uses state/effects/handlers/refs. useTranslations alone does NOT require it.

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils/cn";

/** Public props for {@link <ComponentName>}. */
export interface <ComponentName>Props {
  /** <prop description> */
  className?: string;
}

export function <ComponentName>({ className }: <ComponentName>Props) {
  const t = useTranslations("<namespace>");
  return <div className={cn("...", className)}>{t("label")}</div>;
}
```

A **ref-forwarding primitive** (Button, Input, Dialog) uses `forwardRef` + `displayName` instead (see `src/components/ui/Button.tsx`):

```tsx
export const <Primitive> = forwardRef<HTMLButtonElement, <Primitive>Props>(
  ({ className, ...props }, ref) => (
    <button ref={ref} className={cn(<primitive>Variants(props), className)} {...props} />
  ),
);
<Primitive>.displayName = "<Primitive>";
```

## Decisions

- **`export function`** for components; **`forwardRef` + `displayName`** for ref-forwarding primitives (Button, Input, Dialog). Do **not** use `FC` (it is used nowhere in the repo).
- **No default exports** (eases automatic refactor and tree-shaking).
- **Double quotes** (biome enforces them; single quotes fail lint).
- **Minimal header**: `@id` with the ticket in parens (e.g. `(POO-321)`), `@name`, `@implements-rules-version`, one description line. Not the `@figma`/`@owner`/`@since` block.
- **Props always as a named interface** ending in `Props`, with JSDoc on each prop.
- **`cn()`** for className merge, always accepting a `className` override.
- **`"use client"`** only when the component uses state/effects/handlers/refs; `useTranslations` works in Server Components.

## Variants via CVA

```tsx
import { cva, type VariantProps } from 'class-variance-authority'

const buttonVariants = cva(
  'inline-flex items-center justify-center rounded-md font-medium transition-colors',
  {
    variants: {
      variant: {
        primary: 'bg-primary text-primary-foreground hover:bg-primary/90',
        secondary: 'bg-secondary text-secondary-foreground',
        ghost: 'hover:bg-accent',
        destructive: 'bg-destructive text-destructive-foreground',
      },
      size: { sm: 'h-8 px-3 text-sm', md: 'h-10 px-4', lg: 'h-12 px-6 text-lg' },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  }
)
```

## Visual states

Data hooks in this repo are **hand-rolled, not react-query**. `@tanstack/react-query` is installed only for wagmi; there are **no `useQuery`/`useMutation`** call sites in app code. The convention (see `src/lib/positions/usePositions.ts`): `null` while loading, an `error` value, and a `refresh()`. Split the states into sub-components in the same file, using the shared `Skeleton`/`ErrorState`/`EmptyState` primitives (`src/components/ui/`) rather than hand-rolling each:

```tsx
export function PortfolioCard(props: Props) {
  const { positions, error, refresh } = usePositions(); // null = loading
  if (error) return <ErrorState onRetry={refresh} />;
  if (positions === null) return <Skeleton />;
  if (positions.length === 0) return <EmptyState />;
  return <PortfolioCardContent positions={positions} />;
}
```

In **mock mode** the routes SSR the mock directly; the client data hook runs only in **real mode**, inside a feature DataLoader. Mark the hook/service call `// PP-INTEGRATION-POINT`.

## i18n

- **Every visible string** goes through `useTranslations`.
- **Namespace declared in the header** (`@i18n-namespace`).
- **New keys** go to `src/i18n/messages/en/<namespace>.json` first.
- **`i18n-translator` agent** proposes pt-BR and es afterwards.

## Integration points

- **Every mock service reference**, hook consuming a service, or function that will become an on-chain call: mark `// PP-INTEGRATION-POINT: <description>`.
- **Describe the expected replacement** (wagmi readContract, subgraph query, etc).

## Corresponding tests

File `<ComponentName>.test.tsx`: smoke (renders), variants (each variant renders correct class), states (loading, error, empty, success), behavior (click, change, submit).

## Storybook (if eligible)

If in `src/components/` or a complex modal: `<ComponentName>.stories.tsx` alongside, covering variants, states, viewports, including Loading and Error stories.

## Accessibility

For any interactive component, modal/sheet, or component rendering dynamic monetary values, run the `a11y-checklist` skill (focus management, contrast, aria-live for values, keyboard support) before considering the component done.
