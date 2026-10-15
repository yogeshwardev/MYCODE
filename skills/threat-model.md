---
name: threat-model
description: Threat model a system, feature or architecture (STRIDE, data flows, trust boundaries) and produce prioritized mitigations.
triggers: threat model, stride, attack surface, trust boundar, data flow diagram, abuse case
---
Produce a practical threat model grounded in the actual code and configuration, not a generic checklist.

## 1. Understand the system
From the code, config, infrastructure files (Dockerfile, k8s, terraform, CI) and docs, describe:
- **Assets**: what is valuable (user data, credentials, money movement, availability, models, IP).
- **Actors**: anonymous users, authenticated users, admins, internal services, third parties, CI/CD.
- **Components and data flows**: draw them as a Mermaid flowchart, marking **trust boundaries** (internet to app, app to DB, app to third-party APIs, CI to production).
- **Entry points**: every way data or control enters.

## 2. Enumerate threats with STRIDE per element/flow
- **S**poofing (weak auth, token theft, missing mTLS between services)
- **T**ampering (unsigned data, client-side trust, writable storage, supply chain)
- **R**epudiation (missing audit logs for sensitive actions)
- **I**nformation disclosure (verbose errors, over-broad APIs, logs with PII/secrets, misconfigured buckets)
- **D**enial of service (unbounded queries/uploads, no rate limits, expensive regex, queue flooding)
- **E**levation of privilege (IDOR, missing role checks, injection, container escape paths, over-privileged service accounts)

Include **abuse cases** specific to the business logic (coupon stacking, race conditions on balances, account enumeration).

## 3. Rate and mitigate
For each threat: likelihood x impact -> **High/Medium/Low**, existing controls found in the code (cite `path:line`), gaps, and a concrete mitigation with an owner-sized effort estimate (S/M/L).

## Output
1. System summary and Mermaid data-flow diagram with trust boundaries
2. Threat table: ID, element, STRIDE category, threat, rating, existing controls, mitigation
3. Top 5 prioritized actions
4. Assumptions and open questions for the team

Be concrete and avoid padding: 15 well-founded threats beat 60 generic ones.
