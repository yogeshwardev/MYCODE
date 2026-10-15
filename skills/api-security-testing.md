---
name: api-security-testing
description: Authorized security testing of your own API running locally or in a test environment - authentication and authorization (IDOR) matrices, input validation, rate limits, error leakage - with reproducible findings and fixes.
triggers: test api security, authorization test, idor, broken access control, bola, api pentest, fuzz the api, rate limit test, auth matrix
---
Only test systems the user owns or is authorized to test: local dev servers and the test or staging environments they name. Never target third-party or production systems, and use test accounts and data.

1. **Map the API** from the code (routes, middleware, OpenAPI spec): every endpoint, method, required role and owned resource.
2. **Set up**: start the app locally (`bash` with `background: true`) and create two or more test users with different roles, each with their own resources (seed scripts or the API itself).
3. **Authorization matrix**: for every endpoint x role x resource owner, call it and record the status with a small script and a table of expected results. Look for user A reading or changing user B's objects (IDOR/BOLA), normal users reaching admin endpoints, missing auth on "internal" routes, and mass assignment (sending fields such as `role`, `isAdmin`, `ownerId`).
4. **Input handling**: boundary values, wrong types, huge payloads, unicode, and injection probes against your own app, confirming that it rejects them safely.
5. **Abuse controls**: rate limiting on login, OTP and password-reset endpoints; account enumeration through different error messages or timing; token expiry and revocation after logout or password change.
6. **Error leakage**: stack traces, SQL errors, internal hostnames or versions in responses.
7. **Report and fix**: each finding with the exact request and response to reproduce it, its severity and a fix. Load `secure-fix` to remediate with regression tests that encode the authorization matrix.
