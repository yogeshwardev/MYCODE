---
name: refactoring
description: Restructure code safely (extract, rename, split modules, remove duplication, migrate APIs) without changing behavior.
triggers: refactor, rename, extract, restructure, clean up, cleanup, duplicate code, split module, tech debt
---
1. **Lock behavior first.** Make sure tests cover the code being changed; if coverage is thin, add characterization tests that record the current behavior (including odd behavior) before refactoring.
2. **Find every usage** before renaming or moving anything: grep for the symbol, string references, dynamic access, re-exports, docs, configs and tests. Large refactors spanning independent areas are good candidates for the `swarm` tool.
3. **Small, verifiable steps.** One kind of change at a time (rename, then move, then simplify), running the tests after each step. Never mix refactoring with behavior changes; if you find a bug, note it and fix it separately.
4. **Preserve public contracts** (exported APIs, HTTP routes, file formats, CLI flags) unless the task says to change them; if they change, update all callers and document it.
5. **Finish cleanly**: remove dead code and now-unused imports, run the formatter, linter and type checker, and confirm the full test suite passes. Summarize what moved where.
