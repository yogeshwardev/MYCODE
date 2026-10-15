---
name: performance
description: Find and fix performance problems (slow endpoints, queries, builds, memory leaks, high CPU) by measuring first and optimizing the real bottleneck.
triggers: slow, performance, optimi, latency, memory leak, cpu, profil, n+1, speed up, bundle size
---
1. **Measure before changing anything.** Establish a reproducible benchmark or timing: a script, a load test (`autocannon`, `wrk`, `k6`), a test-suite timing, or the slow query with `EXPLAIN ANALYZE`. Record the baseline numbers.
2. **Profile to find the bottleneck**: Node `--cpu-prof` / `clinic`, Python `cProfile`/`py-spy`, Go `pprof`, browser Performance panel and Lighthouse, database slow-query logs. Don't guess.
3. **Common culprits**: N+1 queries (batch or join), missing indexes (check query plans), unbounded result sets (paginate), repeated work in loops (hoist or memoize), synchronous I/O on hot paths, excessive serialization, large bundles (code-split, tree-shake), memory leaks (growing caches or listeners without eviction).
4. **Fix the top bottleneck only**, keeping behavior identical. Prefer algorithmic improvements over micro-optimizations.
5. **Re-measure** with the same benchmark and report before/after numbers. Run the tests to confirm nothing broke.
6. Note trade-offs (memory vs speed, cache staleness, complexity) and the next bottleneck if one remains.
