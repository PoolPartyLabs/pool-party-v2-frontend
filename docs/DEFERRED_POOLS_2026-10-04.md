# Deferred pools at zero allocation

POO-2204 rules v1. Pool panel artifact: PP-MGR-CMP-069. Zero allocation preserves the selected pool in the build plan and mandate,
while deferring range configuration and execution. The current draft allocation drives the panel,
so changing zero to positive immediately restores the live-price and range gate. Changing positive
to zero hides range and preserves earlier ticks. A pool selected without a range receives
missing range defaults from its first applicable positive live snapshot, making range controls
usable without replacing a saved range. Applying persists the pool and zero share.

The configured zero pool does not start the single-pool live read or catalog batch for range
defaults. Review skips range completeness only for deferred pool chains, retaining authorization,
malformed-config, share and structural checks. Launch omits their swap/open and zero-spoke
bridge/arrival execution. Derivation still validates deferred config and IDs. The journey wrapper
allows these deferred chains through its allocation guard.

At least one positive executable allocation remains necessary. All-idle funds remain blocked
pending the separately requested decision. Aave zero allocation has not been generalized into
this rule. Stored plan and immutable mandate are not filtered or rewritten.

Regression evidence: pre-fix tests failed on Review incomplete range and launch execution gap.
Focused tests cover draft positive/zero transitions, persistence, no range data read at zero,
positive range gates, malformed and unauthorized pool refusal, invalid allocation, and the shared
Review/launch agreement. Browser journeys are intentionally left to Murilo's QA.

This change introduces no new fee, venue, asset, custody or personal-data behavior. The parent
session owns updates to the shared compliance register and artifact indexes.
