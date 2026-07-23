---
name: nextjs-page-blueprint
description: Template for creating a screen (route) in Next 15 App Router with i18n. Defines page.tsx, loading.tsx, error.tsx, not-found.tsx in src/app/[locale]/.... Server Components by default, Client Components only when needed.
---

# Next.js Page Blueprint

## Route structure

```
src/app/[locale]/(app)/<feature>/
├── page.tsx          # main route
├── loading.tsx       # streamed loading state
├── error.tsx         # client component, catches errors
├── not-found.tsx     # optional 404 (none exist today; add only for a real not-found case)
└── layout.tsx        # if the feature has its own layout
```

## page.tsx template (Server Component)

```tsx
/**
 * @id PP-<AREA>-SCR-<NNN> (POO-NNN)
 * @name <ScreenName>
 * @implements-rules-version v1
 * <What this screen shows.>
 */

import { setRequestLocale } from "next-intl/server";
import { isMockMode, <feature>Service } from "@/lib/services";
import { <FeatureScreen> } from "@/features/<feature>/<FeatureScreen>";
import { <FeatureDataLoader> } from "@/features/<feature>/<FeatureDataLoader>";

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function Page({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale); // REQUIRED in async pages: enables static rendering (31 pages do this)

  // Thin orchestrator: mock mode SSRs the mock; real mode delegates to a client DataLoader.
  if (isMockMode) {
    const data = await <feature>Service.list();
    return <<FeatureScreen> data={data} />;
  }
  return <<FeatureDataLoader> />;
}
```

`generateMetadata` is optional (no page uses it today). If a route needs a dynamic `<title>`/meta, add it with `getTranslations({ locale, namespace })`; it is not part of the default scaffold.

## Server vs Client

- **Server (default)**: anything not needing direct interactivity.
- **Client (`'use client'`)**: when using `useState`, `useEffect`, event handlers, custom hooks.
- Complex feature components live in `src/features/.../components/` and can be client. page.tsx orchestrates.

## Loading state

`loading.tsx` is rendered automatically by Next during loading:

```tsx
import { <FeatureSkeleton> } from '@/features/<feature>/components/<FeatureSkeleton>'
export default function Loading() { return <<FeatureSkeleton> /> }
```

## Error boundary

`error.tsx` is a client component. **Never render `error.message` (or any raw error field) to the user**, it can carry sensitive detail (R4). Use the shared `ErrorState` primitive with i18n copy, and report once with the `digest` only. This is the live pattern in `src/app/[locale]/(app)/error.tsx`.

```tsx
"use client";
import { useTranslations } from "next-intl";
import { ErrorState } from "@/components/ui/ErrorState";
import { useTrackView } from "@/lib/analytics/useTrackView";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations("errors");
  useTrackView("app_error_shown", { error_code: error.digest }); // digest only, never error.message
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <ErrorState
        title={t("somethingWentWrong")}
        description={t("description")}
        onRetry={reset}
        retryLabel={t("retry")}
      />
    </div>
  );
}
```

## i18n in screens

- **Server**: `getTranslations({ locale, namespace })`.
- **Client**: `useTranslations(namespace)`.
- **Metadata** (optional): `getTranslations` in `generateMetadata`, only when a route needs dynamic meta.

## Dynamic routes

E.g. `/pools/[poolId]`:

```tsx
interface PageProps {
  params: Promise<{ locale: string; poolId: string }>
}
export default async function PoolDetailPage({ params }: PageProps) {
  const { locale, poolId } = await params
  // ...
}
```

## Anti-patterns

- Fetching data in page.tsx Server Component **without** going through the mock service (always via service factory).
- Forgetting `'use client'` in error.tsx.
- Rendering `error.message` (or any raw error detail) to the user. Leaks sensitive data (R4); use `ErrorState` + i18n and report the digest only.
- Hardcoded text on the page.
- Forgetting `setRequestLocale(locale)` in an async page (breaks static rendering).
