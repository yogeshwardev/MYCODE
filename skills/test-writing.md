---
name: test-writing
description: Write high-value automated tests (unit, integration, property-based) that catch real bugs, using the project's existing framework and conventions.
triggers: write tests, unit test, add tests, test coverage, integration test, jest, pytest, vitest, mocha, property-based
---
1. **Learn the conventions.** Find the test framework, file naming, helpers/fixtures, and how tests are run (package scripts, Makefile, CI config). Match them exactly.
2. **Decide what matters.** Test behavior through public interfaces, not implementation details. Prioritize: core business rules, edge cases and boundaries (empty, zero, negative, max, unicode, very long, duplicates), error paths, and previously broken behavior.
3. **Design cases** as a short list before writing: one behavior per test, a descriptive name ("rejects expired coupons"), Arrange-Act-Assert.
4. **Keep tests deterministic.** Control time (inject `now` or use fake timers), randomness (seed it), and network/IO (fakes or local test servers). Reset shared state between tests.
5. **Use the right level.** Pure logic: unit tests. Wiring between modules, DB queries, HTTP handlers: integration tests with real local dependencies where practical. Many input combinations: table-driven or property-based tests (fast-check, Hypothesis) if the project already uses or allows them.
6. **Check the tests can fail.** For important tests, temporarily break the code (or reason explicitly) to confirm the test catches it. A test that can't fail is worthless.
7. **Run the whole suite** and report coverage of the behaviors added, not just line coverage.
