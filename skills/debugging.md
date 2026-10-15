---
name: debugging
description: Systematically find the root cause of a bug, crash, flaky test or wrong output, then fix it with a regression test.
triggers: bug, error, crash, exception, stack trace, failing test, test failing, test fails, tests fail, failing, flaky, not working, broken, regression, debug, why does, why is
---
1. **Reproduce.** Get a reliable reproduction first: the failing test, command or input. If it is flaky, run it in a loop to measure how often it fails (`for i in $(seq 20); do ...; done`).
2. **Read the evidence.** The full error message and stack trace, the logs, and what changed recently (`git log -p --since=... -- <paths>`, `git diff`). Find the exact line where the failure surfaces.
3. **Form hypotheses and test them one at a time.** Add temporary logging or assertions, or write a minimal script that isolates the suspect function. Narrow down by bisecting the input, the code path or the commit history (`git bisect run <test>` when a known-good commit exists).
4. **Find the root cause, not the symptom.** Ask why until you reach the real defect (wrong assumption, race, off-by-one, timezone, float rounding, mutation of shared state, stale cache, missing await). Check whether the same mistake exists elsewhere.
5. **Fix and prove.** Write a regression test that fails before the fix and passes after. Remove the temporary debug code. Run the full relevant test suite.
6. **Explain**: the root cause, why it produced this symptom, the fix, and how the test guards against it.

For flaky tests specifically, look for: shared state between tests, ordering dependencies, real time/dates/timezones, randomness without seeds, network calls, unawaited promises, and timeouts too tight for CI.
