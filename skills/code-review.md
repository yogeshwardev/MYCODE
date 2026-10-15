---
name: code-review
description: Review a diff, branch or pull request like a senior engineer - correctness, edge cases, design, tests, security and maintainability - with prioritized, actionable comments.
triggers: review this, code review, review my, review the pr, pull request, review changes, feedback on my code
---
1. **Get the change.** Use `git diff <base>...HEAD`, `git log --oneline <base>..HEAD`, or the files the user points to. Understand the intent first (PR description, commit messages, linked issue).
2. **Read in context.** For each changed hunk, read enough surrounding code and callers to judge it. Check how changed functions are used elsewhere with `grep`.
3. **Look for, in order of importance**:
   - Correctness: logic errors, off-by-one, null/undefined, wrong conditions, unhandled errors and rejections, races, resource leaks.
   - Missing requirements and edge cases relative to the stated intent.
   - Security: injection, authorization gaps, secrets, unsafe deserialization (run `security_scan` on the changed files).
   - Tests: do they exercise the new behavior and its failure modes? Would they fail if the code were wrong?
   - Design: fit with the existing architecture, duplicated logic, leaky abstractions, misleading names.
   - Performance only where it matters (hot paths, N+1 queries, unbounded loops).
4. **Write comments that can be acted on**: `path:line`, what is wrong, why it matters (ideally a concrete failing input), and a suggested fix. Label each **blocking**, **should fix** or **nit**. Skip style that a formatter or linter handles.
5. **Summarize**: an overall verdict (approve, approve with changes, request changes), the top 3 issues, and what is good about the change.
