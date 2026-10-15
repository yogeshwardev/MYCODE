---
name: secrets-hygiene
description: Find leaked or hardcoded secrets (API keys, passwords, private keys, tokens) in code, config and git history, and move them to safe storage.
triggers: secret, api key, leaked, credential, password in code, .env, rotate key, gitleaks, hardcoded
---
1. **Scan the working tree** with `security_scan` (kind: "secrets"). Also check config and infra files explicitly: `.env*`, `*.yml`/`*.yaml`, `*.json`, `docker-compose*`, terraform `*.tf`/`*.tfvars`, CI workflows, notebooks (`*.ipynb` outputs), and test fixtures.
2. **Scan git history** (secrets removed from the code are still in history): use `gitleaks detect --source .` or `trufflehog git file://.` if installed; otherwise `git log -p -S "<suspicious prefix>"` for specific patterns (e.g. `AKIA`, `sk-`, `-----BEGIN`).
3. **Classify each hit**: a real credential, a test/dummy value, or a public identifier (publishable keys, client IDs are not secrets). Never print full secret values in your output; mask all but the first 4 characters.
4. **Remediate** (when asked to fix):
   - Replace the value with an environment variable or secret-manager lookup, with a clear error if it is missing.
   - Add `.env` and other secret files to `.gitignore`; provide a `.env.example` with placeholder values.
   - For real credentials that were committed: tell the user they **must rotate/revoke** them at the provider. Rewriting git history (`git filter-repo`) is optional and disruptive; only suggest it, never run it without explicit approval.
5. **Prevent recurrence**: suggest a pre-commit hook (gitleaks or detect-secrets) and CI secret scanning.

Report: findings (location, type, real/test, masked value), actions taken, and the rotation checklist.
