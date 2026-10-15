---
name: migration-upgrade
description: Upgrade frameworks, libraries, language versions or APIs safely (React, Next.js, Django, Spring, Node, Python, TypeScript, deprecated APIs) in small verified steps.
triggers: upgrade, migrate to, migration guide, bump version, deprecated, breaking change, major version, update to latest, port to
---
1. **Baseline**: make sure the build and tests pass before you start, and record the current versions.
2. **Read the official migration guide and changelog** for every major version you cross (use `web_fetch`). List the breaking changes that affect this codebase by grepping for each affected API.
3. **Plan the steps**: one major version at a time; upgrade peer and related packages together; use official codemods when they exist, then review their diff.
4. **Verify after each step**: install, build, type-check and run the tests, and fix failures before moving on. Keep each step a separate, reviewable change.
5. **Watch for silent behavior changes** that tests may not cover: defaults, timezone and locale handling, serialization, stricter validation. Call them out.
6. **Clean up**: remove compatibility shims, polyfills and workarounds that are no longer needed, and update docs, CI images and runtime versions.
7. Large upgrades across many independent modules are good candidates for the `swarm` tool once the core dependencies are upgraded.
