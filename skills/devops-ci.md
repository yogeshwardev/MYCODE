---
name: devops-ci
description: Create or fix CI/CD pipelines, build systems, containers and deployment config (GitHub Actions, GitLab CI, Docker, compose, Make) so they are fast, reliable and secure.
triggers: ci, pipeline, github actions, gitlab ci, docker compose, deploy, build failing, workflow, makefile
---
1. **Read what exists**: CI workflows, Dockerfiles, compose files, Makefiles, package scripts, deployment manifests. Keep the team's tools and conventions.
2. **Reproduce locally** whatever CI runs (the same commands, Node/Python version and env vars) before changing it. For a failing pipeline, read the full log and find the first real error.
3. **Make it reliable**: pinned tool versions, lockfile installs (`npm ci`, `pip install -r` with hashes), no dependence on network state at test time, deterministic test ordering, sensible timeouts and retries only for genuinely flaky infrastructure.
4. **Make it fast**: dependency caching keyed on lockfiles, parallel jobs or matrices, path filters for monorepos, and Docker layer ordering (dependencies before source).
5. **Make it secure** (load `hardening` for the full checklist): least-privilege tokens, actions pinned to SHAs, secrets only in protected contexts, no untrusted input interpolated into shell steps.
6. **Validate** syntax (`actionlint`, `docker build`, `docker compose config`) where tools exist, and explain how to verify the pipeline end to end.
