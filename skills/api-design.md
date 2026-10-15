---
name: api-design
description: Design or extend HTTP/REST/GraphQL APIs - resources, validation, errors, pagination, versioning, auth - consistent with the existing codebase.
triggers: api, endpoint, rest, graphql, route, openapi, swagger, pagination, http handler
---
1. **Follow the house style first.** Read existing routes, validation, error format, naming (camelCase vs snake_case), auth middleware and tests. New endpoints must look like the old ones.
2. **Resources and methods.** Nouns for resources, HTTP verbs for actions, correct status codes (200/201/204, 400 validation, 401 unauthenticated, 403 forbidden, 404, 409 conflict, 422 if the codebase uses it, 429 rate limited). Idempotent PUT/DELETE; support idempotency keys for payment-like POSTs.
3. **Validate every input** at the boundary with a schema (the project's library: zod, joi, pydantic, class-validator...): types, ranges, lengths, enums, unknown fields. Never trust client-provided IDs for ownership: check authorization server-side.
4. **Consistent errors**: one shape (e.g. `{ error: { code, message, details } }`), no stack traces or internals in responses.
5. **Collections**: pagination (cursor-based for large or changing data, offset for simple cases), filtering and sorting with allowlisted fields, sane default and maximum page sizes.
6. **Evolution**: additive changes are safe; renames and removals need versioning or a deprecation period. Document the change.
7. **Security**: authentication on everything that is not explicitly public, rate limits on expensive or sensitive endpoints, no mass assignment (pick allowed fields explicitly), CORS restricted to known origins.
8. **Deliver** the handler, validation, tests (happy path, validation errors, auth failures, not found), and updated API docs/OpenAPI if the project has them.
