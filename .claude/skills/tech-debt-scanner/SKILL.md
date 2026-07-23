---
name: tech-debt-scanner
description: Scan the code for PP-DEBT, PP-FIXME, PP-TODO, PP-I18N, PP-A11Y, PP-PERF, PP-SECURITY tags, create corresponding Linear issues, and add the issue reference as a comment in the code.
---

# Tech Debt Scanner

## Scan regex

```regex
\/\/\s*(PP-DEBT\(SEV:(LOW|MED|HIGH)\)|PP-FIXME|PP-TODO|PP-I18N|PP-A11Y|PP-PERF|PP-SECURITY):?\s*(.*)
```

## Tag to Linear mapping

| Tag | Label | Priority |
|-----|-------|----------|
| `PP-DEBT(SEV:LOW)` | `tech-debt` | p3 |
| `PP-DEBT(SEV:MED)` | `tech-debt` | p2 |
| `PP-DEBT(SEV:HIGH)` | `tech-debt` | p1 |
| `PP-FIXME` | `bug` | p1 |
| `PP-TODO` | `tech-debt` | p3 |
| `PP-I18N` | `i18n` | p3 |
| `PP-A11Y` | `a11y` | p2 |
| `PP-PERF` | `perf` | p3 |
| `PP-SECURITY` | `security` | p1 |

## Existing issue detection

Each occurrence should have, on the same or next line, a marker:

```ts
// PP-DEBT(SEV:MED): PnL calc uses mocked price, replace with oracle
// Tracked in PP-456
const pnl = computeNaive(position)
```

If there is no `Tracked in PP-XXX`, it is an occurrence without an issue.

## Workflow

1. Recursive grep in `src/`.
2. For each match, capture: file + line, tag, description, 5 lines of context above/below, parent artifact ID.
3. Detect existing issue via `// Tracked in PP-<NUM>`.
4. **If no issue**: create the Linear issue (title, body with file/line/context), then add `// Tracked in <ISSUE_ID>` after the tag comment.
5. **If issue exists**: check it is open. If closed but tag remains, comment "tag still present, please resolve or remove".

## Resolved tag detection

For each `Tracked in PP-XXX`: check Linear status; if Done but the tag remains, comment on the issue.

## Anti-patterns

- Creating an issue on every run for the same tag (always check `Tracked in`).
- Updating code without creating the issue first.
- Ignoring context: tags in test files may be for tests, not real debt.
- Breaking code formatting when adding `Tracked in`.
