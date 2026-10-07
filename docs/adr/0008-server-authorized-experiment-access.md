# 0008. Server-authorized experiment access, separate from V1/V2 preference

- Status: Accepted
- Date: 2026-10-07
- Linear: [POO-2281](https://linear.app/yeildbay/issue/POO-2281), [POO-2282](https://linear.app/yeildbay/issue/POO-2282)
- Implementation: `PP-CORE-LIB-122` to `124`; [delivery plan](../solana-preview-preparation-plan-2026-10-07.md).

## Context

This decision applies to frontend preparation. The API contract remains proposed under POO-2282.

Murilo authorized a hidden Solana preview for multiple approved accounts, with later cohort growth.
`fundContracts` is an environment release gate; `ContractFamily = "v1" | "v2"` is a persisted UI
preference. Neither identifies a tester. A hidden gesture in public code can be reproduced, and
chain transactions remain public. Frontend main and the Solana wallet/launch integration are separate.

## Decision

Keep V1/V2 family, EVM drafts and public investor behavior unchanged. Represent Solana preview as a
separate in-memory preference, subordinate to server-verified experiment access. Both `fundContracts`
and default-off `solanaSpoke` must resolve on the server. The API verifies the session and current
multi-account membership, returning only versioned capabilities and expiry. Preview, catalog and
execution permissions are explicit; no client value authorizes a protected operation.

Use a server-only, uncached read through the existing API transport. All failure classes deny
access. Do not substitute a profile role, decoded JWT, local wallet list, URL or browser flag override.
The future host must clear access on session changes and reject earlier-generation responses;
same-request Next cookie reads cannot detect cross-request logout. API discovery and direct fund
reads must enforce the same restriction before activation.

## Consequences

Accounts can be added or removed at the API without rebuilding the frontend. Public EVM flows do not
inherit Solana state. The hidden gesture is a reveal mechanism, not a security boundary. Preparation
can land with no host or live endpoint, but activation waits for authenticated grants, restricted
discovery, isolated drafts and reviewed execution integration. The API owner still must confirm
grant lifetime, administration and route coverage in POO-2282.

## Alternatives considered

- Triple-click alone or a local flag: reproducible by anyone, with no direct-request protection.
- A hard-coded personal wallet: cannot safely support cohort growth, revocation or verified identity.
- A third `ContractFamily`: conflates execution environment with persisted EVM strategy identity.
- Using `isManager`: grants a business role experiment access without a separate release decision.

Numbering follows the existing imported ADR-0004 through ADR-0007 references. This decision does not
replace those historical on-ramp decisions.
