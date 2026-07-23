---
name: business-rules-clarification
description: Clarify all business rules of an issue before any implementation. Identifies ambiguities, omissions, and contradictions. Asks structured questions until rules are complete, testable, and versioned. STOPS work if anything is vague. Versions every revision.
---

# Business Rules Clarification

A skill to be used **as the first action** in any implementation. Its job is to ensure no line of code (or test) is written with an ambiguous rule.

## Principle

A business rule that cannot become a test cannot become code. If it is not testable, it is not ready. When in doubt, asking is always cheaper than rewriting.

## When this skill activates

Every time a Linear issue arrives for implementation, the agent passes through this skill before anything else. Output: either rules are clean and we proceed, or we stop and ask.

## "Rules ready" criteria

An issue only leaves this skill with a green light if ALL of the following are true:

1. **Each rule is numbered** (`[R1]`, `[R2]`, `[Rn]`).
2. **Each rule is a testable statement**, not a vague UI instruction.
   - Good: `[R1] TVL is the sum of the USD value of all positions with status != 'closed'.`
   - Bad: `[R1] Screen shows TVL nicely.`
3. **No verbal ambiguity.** Words to hunt and disambiguate:
   - "Should be fast" then how fast?
   - "Adequate", "appropriate", "nice", "intuitive" then which objective criteria?
   - "In some cases" then which cases exactly?
   - "Etc.", "..." then enumerate or say "any other" explicitly.
   - "If possible" then is it mandatory or not?
4. **Explicit edge cases**:
   - What happens with empty input?
   - What happens with zero value?
   - What happens with negative value (when applicable)?
   - What happens on timeout?
   - What happens with a very large array?
5. **Explicit visual states**: loading, empty (with CTA?), error (with retry? translated message?), success.
6. **Confirmed data source**: which mock service, which contract.
7. **Confirmed error behavior**: propagate, retry, show toast?
8. **Version registered**: the issue has a "Business rules revision history" section with at least `v1, <date>, <author>`.

## Workflow

### Phase 1, read
1. Read the Linear issue via MCP.
2. Read the Figma frame if present.
3. Read any `Blocked by` issues to understand dependencies.

### Phase 2, audit
4. Apply the 8 criteria above.
5. Compile a list of **gaps**: ambiguities, omissions, contradictions.

### Phase 3, decision
6. **No gaps**: green light. Mark the issue `rules:cleared` and proceed to `tdd-workflow`.
7. **Gaps present**:
   - Move issue status to `Needs Rules`.
   - Remove `claude-code:ready` label if present.
   - Add label `tdd:business-rules-needed`.
   - Comment on the issue with **structured questions** (format below).
   - **STOP**. Implement nothing.
   - Notify the author.

### Phase 4, resumption
8. When the author responds:
   - Update the issue body with refined rules.
   - **Increment version**: add a line to history (`v2, <date>, <author>, changes: <summary>`).
   - Re-run the audit.
   - If clean: proceed. If still gaps: new round of questions.

## Structured questions format

Use this template in the issue comment:

```markdown
**business-rules-clarification: rules incomplete to implement**

I identified <N> points to clarify before starting.

## Blocking (cannot turn into test/code)

### Q1, about [rule or section reference]
<gap description>
**Common options**:
- (a) <plausible option 1>
- (b) <plausible option 2>
- (c) other: describe

## Edge cases not covered
- What happens when <scenario X>?
- Expected behavior if <scenario Y>?

## Visual states
- Loading: do we have a design? Default (skeleton)?
- Empty: empty state text? CTA?
- Error: retry? Specific message?

## Data source
- Which mock service? (Suggest: `mockXxxService.method()`)
- Can it error? How to handle?

---
Issue moved to `Needs Rules`. Waiting for answers to resume. When you reply, I will version it as `v2`.
```

## Examples

### Example 1, vague rules

**Before** (issue arrives like this):
```
Description: Shows available pools on the Pools screen.
Business rules:
- [R1] Lists pools.
- [R2] Filters work.
- [R3] Empty state if nothing matches.
```

**Audit identifies**:
- R1: list from where? Order? How many? Pagination?
- R2: which filters? AND or OR between them? Persist in URL?
- R3: is empty state the same as initial empty list?

### Example 2, resumption after answer

After the author answers, update the issue body with detailed rules and append to "Business rules revision history":
```markdown
## Business rules revision history
- **v1** (2026-05-27, Murilo): initial rules (3 items, incomplete).
- **v2** (2026-05-28, Murilo + business-rules-clarification): refinement. 6 ambiguities resolved. R1 detailed, R2 detailed, R3 split, R4 and R5 added.
```
Then remove `tdd:business-rules-needed`, add `rules:v2`, move to `Ready`, add `claude-code:ready`, proceed to `tdd-workflow`.

## Rule versioning

### Where it lives
1. **Linear issue body**: "Business rules revision history" section, append-only.
2. **Issue label**: `rules:v1`, `rules:v2`, etc. Reflects the current version.
3. **Issue comments**: each change generates an automatic comment with a summary diff.
4. **Implementation PR**: title and body reference the rule version used (`Closes POO-123 @rules-v2`).
5. **Commit messages**: include `[rules-v2]` when applicable.

### Change after implementation
If a rule changes after the PR is merged:
1. Rule version increments (`v3`).
2. Automatic comment: "Rule changed. Current implementation in PP-123 (v2) may be outdated. Consider a follow-up."
3. Create a follow-up issue with label `rules-drift` pointing to the original.

### Drift audit
The `docs-sync-workflow` skill periodically compares the current rule version vs the implemented version (recorded in the file header `@implements-rules-version: vN`). Reports drift in the sync PR.

## Anti-patterns

- **Assuming** what is missing ("probably it's like this"). Always ask.
- Implementing "to see what happens". No. Stop.
- Accepting a rule with "etc.", "..." or "other cases".
- Changing a rule without incrementing the version.
- Implementing based on chat conversation without recording it in the issue.
- Skipping this skill because "the rule seems clear".

## Question language

Ask in the user's language (the user may prefer Portuguese). All written documentation stays in English. No em-dashes.
