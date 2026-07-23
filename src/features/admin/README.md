# Admin / Ops Console (`ADM`)

Internal Admin / Operations Console surfaces: manager verification, image moderation, and role
management. Every mutation runs through a server action that re-checks the session + capability, and
after a decision the route is refreshed so the server re-reads the queue.

## Queue paging: client-side "Load more" reveal (POO-670, rules v1)

The Admin queues are **mock / thin-backed with NO backend paging**: they receive the whole queue and
page it on the client. Both queues use the shared `useRevealCount` hook (`PP-CORE-HOK-022`,
`src/hooks/useRevealCount.ts` — promoted out of `manager/hooks` for its second consumer here): each
renders the first 5 items and reveals +5 per "Load more" click over the already-loaded set (**[R1]**).
A queue of `<= 5` items shows no button. This **replaces** the POO-628 windowing on these two queues;
the shared windowing primitive (`@/components/virtualized`, POO-625) and its own tests stay intact and
are simply no longer wired here.

- **`ManagerVerificationQueue`** (`PP-ADM-CMP-011`, POO-587) — the pending-verification `<table>`
  renders `rows.slice(0, count)` as a plain `<tbody>`; Reject is gated on the `verification.reject`
  capability; Approve/Reject confirm modals render OUTSIDE the list.
- **`ModerationQueue`** (`PP-ADM-CMP-012`, POO-590) — the pending-image responsive grid (`sm:2 / lg:3`)
  renders `items.slice(0, count)` as a plain `<ul>`; Approve (confirm) / Remove (free-text dialog) are
  gated on `canApprove` / `canRemove`, and both dialogs render OUTSIDE the list.

Neither queue has a status filter, so `useRevealCount` runs with **no `resetKey`**: the count only
grows. A same-set `router.refresh()` re-render (a 45s/focus refetch, or the server re-rendering one
fewer pending item after an approve/reject/remove decision) keeps the revealed count instead of
snapping back to 5 (**[R2] DO-NOT-RESET**, POO-628). `slice(0, count)` clamps the drain naturally, so
no phantom item renders past the new end.

## Not-yet-real seams

- Image thumbnails are placeholders until real image hosting (POO-580).
- `src/features/admin/{verificationActions,moderationActions,rolesActions}.ts` are the server-action
  seams; the queue data itself is served through the mock/thin-backed read path (no client paging
  endpoint), which is why paging is a client-side reveal, not a server page.
