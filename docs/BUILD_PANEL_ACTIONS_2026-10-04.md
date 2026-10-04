# Build panel actions above navigation

POO-2202, business rules v1. Artifact: PP-MGR-CMP-045.

The fixed 640px grid did not reserve vertical space when the top-aligned configuration panel
grew. Long fields and the blocked-leave notice could overflow into the following sticky Back /
Next bar, hiding Apply changes.

BuildStepLayout now gives the grid a minimum height of 640px and preserves a fixed 640px canvas
column. The panel retains intrinsic height and expands the page before navigation. Its existing
Apply/Discard/Remove controls, focus behavior, leave guard, values and analytics callbacks are
unchanged. Normal page scrolling reaches every action; no nested scroll region is added.

Validation: the new CSS sizing regression failed before the patch and passed after. The focused
BuildStepLayout and BlockPanel suites passed 33 tests, including dirty/apply, blocked leave and
discard, apply gate/error and remove confirmation. JSDOM does not calculate layout geometry;
this test guards the sizing contract, not pixel overlap. The long-panel Storybook fixture is
provided for manual desktop and short-viewport inspection. No browser journey was run.

This repair adds no compliance claims, money routes, venues, credentials or personal data.
The parent session maintains the shared compliance register and artifact indexes.
