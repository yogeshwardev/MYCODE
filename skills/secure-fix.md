---
name: secure-fix
description: Remediate a known vulnerability (from a review, scanner, pentest report or CVE) with a minimal, correct fix and a regression test that proves it.
triggers: fix vulnerab, remediate, patch the vulnerab, cve-, security fix, sql injection, xss fix
---
Fix the vulnerability at its root, prove it with a test, and avoid regressions.

1. **Reproduce first.** Write a failing test that demonstrates the vulnerability: the malicious input succeeds today (e.g. `' OR 1=1 --` returns all rows, `../../etc/passwd` reads outside the directory, user A reads user B's order, a script tag comes back unescaped). If a test is impossible, write down the exact manual reproduction.
2. **Fix at the right layer.**
   - Injection: parameterized queries / prepared statements; pass argument arrays to processes instead of shell strings; never "sanitize" by blocklisting characters.
   - XSS: context-aware output encoding (use the framework's auto-escaping); sanitize HTML with a vetted library (e.g. DOMPurify) only when HTML is truly needed.
   - Path traversal: resolve the path and check it stays inside an allowed base directory; prefer IDs mapped to server-side paths.
   - SSRF: allowlist hosts/schemes, resolve DNS and block private/link-local/metadata ranges, disable redirects or re-check them.
   - Authorization: enforce ownership/role checks on the server for every object access, in one shared place (middleware/policy), not per handler.
   - Secrets: move to environment variables or a secret manager, and tell the user the exposed secret must be **rotated** (removing it from code does not un-leak it; it is in git history).
   - Crypto: use the platform's vetted primitives (bcrypt/argon2 for passwords, `crypto.randomBytes`/`secrets` for tokens, AES-GCM for encryption).
3. **Keep the fix minimal.** Don't refactor unrelated code in a security patch; it makes review harder.
4. **Look for siblings.** Grep for the same pattern elsewhere (`grep`, `security_scan`); the same mistake is usually repeated. Fix or list every occurrence.
5. **Verify.** The new test passes; the full test suite passes; legitimate inputs still work (add a test for the happy path near the boundary).
6. **Report.** What was vulnerable, the root cause, the fix, the tests added, sibling occurrences, and any follow-ups (secret rotation, log review for past exploitation, dependency upgrades).
