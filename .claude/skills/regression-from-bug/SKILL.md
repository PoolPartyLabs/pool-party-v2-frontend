---
name: regression-from-bug
description: Convert a confirmed Pool Party frontend bug (or a QA/PR/PP-FIXME finding) into a regression test that fails before the fix and passes after. Use for every confirmed bug, so the failure class is locked and cannot return. Builds on the tdd-workflow skill.
---

# Regression from a bug (frontend)

Every confirmed bug becomes a test before it becomes a fix. The test must **fail on the current (buggy) code** and **pass after the fix**: that red-then-green is the proof the test actually guards the failure, not just the happy path.

## Workflow

1. **Reproduce** deterministically. Pin the exact input/state/route that triggers it. If you can't reproduce, you can't regress-test it, keep investigating.
2. **Locate the layer** and write the test there:
   - pure logic / util / formatter / hook → unit test (`*.test.ts`, vitest).
   - component / interaction / a11y → component test (`*.test.tsx`, vitest + Testing Library).
   - cross-screen flow → the highest-value integration test you can write in-repo.
   Test the **observable behavior** the user hit, not the internals.
3. **Map it to the rule.** State which business rule `[R#]` (or which contract) the bug violated; the test asserts that rule.
4. **Confirm RED** on the unfixed code. A regression test that passes before the fix is testing the wrong thing.
5. **Fix → GREEN.** Implement the minimal fix; the new test plus the existing suite pass.
6. **Link it.** Reference the Linear issue / `PP-FIXME` in the test name or a comment, and remove the `PP-FIXME` tag the test now covers.

## Naming

Name the test for the symptom + issue, e.g. `it("keeps the invest amount after modal remount (POO-350)")`. The name should read as the bug it prevents.

## Anti-patterns

- Fixing the bug without a test (the class returns).
- Writing the test against already-fixed code (it never saw red).
- Asserting implementation details (re-render counts, internal calls) instead of user-visible behavior, brittle, and it won't catch the real regression.
- Snapshot-only "coverage" of a logic bug.
- A test that depends on real network/time; mock the seam (`isMockMode`, a fixed clock) so it's deterministic.
