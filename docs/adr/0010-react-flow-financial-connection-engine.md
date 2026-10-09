# 0010. React Flow for financial canvas connections

- Status: Accepted
- Date: 2026-10-08
- Linear: [POO-2302](https://linear.app/yeildbay/issue/POO-2302), rules v1

## Context

Build and Manage already share semantic financial nodes, ports and connections. The renderer
still positions edges from rectangles whose dimensions can differ from the painted cards.
Idle output can paint shorter than its measured wrapper, leaving a visible gap. The return
router also forces an outward-and-back corridor even when a direct corridor is clear.
Murilo authorized React Flow infrastructure while preserving the current Pool Party elements.

## Decision

Use pinned `@xyflow/react@12.12.0` with custom nodes wrapping existing cards and custom edges
rendering the financial routes. Declare identified handles on the actual painted card bounds.
React Flow owns the single viewport transform and handle tracking; financial reducers and
our orthogonal router continue to own topology, ledger roles, placement and safe corridors.

Disable native dragging, connecting, reconnecting and Delete. Keep Pool Party menus, staged
panels, removal confirmation, keyboard controls, untransformed overlays and zoom controls.
Load only React Flow base structure CSS, without the React Flow UI component registry or
default node/edge styling. Preserve upstream MIT notices separately from first-party licensing.

## Consequences

Measured handles and stable endpoint identities replace loose renderer coordinates. Resize
updates can track endpoints without recreating drafts. This commits both migrated canvases
to one engine and adds a runtime dependency; custom financial layout remains our responsibility.
Engine adoption alone does not prove routes are unobstructed or financially correct.

Regression checks cover painted bounds, handles, direct clear routes, obstacle clearance,
mutations and stale edges. Actual browser layout/zoom acceptance is still required from Murilo;
unit tests and mocked ResizeObserver do not establish rendered pixel geometry.

The npm tarballs for React Flow 12.12.0 and system 0.0.83 were integrity-checked against npm
SHA-512 metadata. Both declare MIT and have no install lifecycle scripts. This is a bounded
dependency review, not an external security audit.

## Alternatives considered

- React Flow UI registry: copies default components that do not match the current elements.
- Default SmoothStep routing: does not encode principal, fees, shared bridges or safe obstacles.
- Continue only with hand-positioned SVG: keeps us responsible for browser handle measurement
  and viewport coordination in addition to the domain router.
