---
name: security-review
description: Security code review of a codebase, feature or diff - finds exploitable vulnerabilities (OWASP Top 10, CWE), rates them, and gives concrete fixes.
triggers: security review, security audit, vulnerab, owasp, cwe, insecure, pentest, injection, xss, csrf, ssrf, idor, auth bypass
---
You are doing an application security review. Be precise: only report issues you can tie to specific code, and say how an attacker would reach them.

## Process
1. **Scope and map.** Identify the entry points (HTTP routes, CLI args, message consumers, file/upload handlers, webhooks), the trust boundaries, the authentication/authorization layer, data stores, and outbound calls. Use `grep`/`glob`, and `delegate` for big codebases.
2. **Quick signals.** Run `security_scan` on the scope. Treat every hit as a lead to confirm, not a finding.
3. **Trace untrusted input** from each entry point to sensitive sinks:
   - Injection: SQL/NoSQL (string-built queries), OS command (shell strings), LDAP, XPath, template injection, header/log injection.
   - XSS: unescaped output in HTML/JS contexts, `innerHTML`, `dangerouslySetInnerHTML`, `v-html`, markdown rendered without sanitizing.
   - SSRF: user-controlled URLs fetched server-side (check redirects, internal IPs, cloud metadata `169.254.169.254`).
   - Path traversal and unsafe file handling: user input in paths, archive extraction (zip slip), uploads without type/size limits.
   - Deserialization: `pickle`, `yaml.load`, Java/PHP native deserialization, `eval`/`Function` on data.
4. **AuthN/AuthZ.** Check every state-changing and data-returning route for authorization (IDOR: can user A access B's object by ID?). Session/JWT handling (signature verified? `alg: none`? expiry? secret strength?), password storage (bcrypt/scrypt/argon2, never MD5/SHA-1/plain), rate limiting on login/OTP/reset, CSRF protection for cookie sessions.
5. **Secrets and crypto.** Hardcoded keys, secrets in logs or error messages, weak randomness for tokens (`Math.random`), homemade crypto, ECB mode, static IVs, disabled TLS verification.
6. **Configuration.** Debug mode, verbose errors in production, permissive CORS with credentials, missing security headers (CSP, HSTS, X-Content-Type-Options), default credentials, open admin panels.
7. **Dependencies.** Load the `dependency-audit` skill if the scope includes dependency risk.

## Rating
Use **Critical / High / Medium / Low / Info**, considering exploitability (remote? auth needed? user interaction?) and impact (data exposure, code execution, privilege escalation). Map each issue to a CWE where you can.

## Report format
For each finding:
- **Title**, severity, CWE
- **Location**: `path:line` (all relevant places)
- **Why it is exploitable**: the input path from source to sink, in 2-4 sentences
- **Fix**: the concrete code change; prefer framework-native protections (parameterized queries, auto-escaping templates, allowlists)
- **Verification**: how to test the fix (ideally a regression test)

End with a short summary table and the 3 most important actions. State what you did NOT review. If asked to fix issues, load `secure-fix` and fix them one by one with tests.

Never claim code is "secure"; say what was checked and what was found.
