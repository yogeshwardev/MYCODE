---
name: dependency-audit
description: Audit third-party dependencies for known vulnerabilities (CVEs), malicious or abandoned packages and license risk, then plan safe upgrades.
triggers: npm audit, cve, vulnerable dependenc, outdated dependenc, supply chain, sbom, pip-audit, dependency audit, upgrade dependenc
---
## 1. Inventory
Find every manifest and lockfile: `package.json`/lockfiles, `requirements*.txt`/`pyproject.toml`/`poetry.lock`, `go.mod`, `Cargo.toml`, `pom.xml`/`build.gradle`, `Gemfile.lock`, `composer.lock`, Dockerfile base images, GitHub Actions `uses:` lines.

## 2. Run the ecosystem's scanner (whichever is installed; check first, don't install globally without asking)
- Node: `npm audit --json` (or `pnpm audit --json`, `yarn npm audit --json`)
- Python: `pip-audit` (or `safety check`)
- Go: `govulncheck ./...`
- Rust: `cargo audit`
- Multi-ecosystem: `osv-scanner -r .`, `trivy fs .`, `grype .`
- Containers: `trivy image <image>`
If none is available, say so and fall back to reviewing versions manually; use `web_fetch` on advisories (GitHub Advisory Database, OSV, NVD) for specific packages.

## 3. Triage each finding (don't just dump scanner output)
- Is the vulnerable package **reachable**: a runtime dependency, used in production code paths, or only dev/test tooling?
- Is the vulnerable function actually called? Grep for it.
- Severity (CVSS), exploit availability, and whether a fixed version exists.
- Classify: **Fix now** / **Fix soon** / **Accept with justification**.

## 4. Supply-chain hygiene
Flag: unpinned versions or missing lockfiles, packages with install scripts from unknown publishers, typosquat-looking names, abandoned packages (no release in 2+ years, archived repo), GitHub Actions pinned to tags instead of commit SHAs, `curl | sh` in build steps, base images using `latest`.

## 5. Upgrade plan
Prefer the smallest version bump that fixes the issue. For each upgrade: from -> to, breaking-change notes (read the changelog), and run the test suite after each change. Apply upgrades only if the user asked for fixes; otherwise deliver the plan.

## Report
A table (package, current, fixed in, severity, reachable?, action) plus a summary: counts by severity and the top actions.
