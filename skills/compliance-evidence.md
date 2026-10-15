---
name: compliance-evidence
description: Map a codebase's security controls to compliance frameworks (SOC 2, ISO 27001, PCI DSS, HIPAA, GDPR) - find evidence in code and config, identify gaps, and draft remediation tasks.
triggers: soc 2, soc2, iso 27001, pci, hipaa, gdpr, compliance, audit evidence, security controls, data retention
---
This is engineering support for compliance work, not legal advice; say so in the report.

1. **Scope**: confirm which frameworks and which systems are in scope.
2. **Collect evidence from the repository** for common technical controls, citing `path:line`:
   - access control: authentication, MFA support, RBAC, least privilege in infrastructure code;
   - encryption: TLS settings, encryption at rest, key management;
   - logging and monitoring: audit logs for sensitive actions, retention, alerting;
   - change management: CI tests, review requirements, deployment approvals;
   - vulnerability management: dependency scanning, static analysis in CI, patch cadence;
   - data handling: PII inventory, retention and deletion jobs, backups, data export and deletion endpoints.
3. **Gap analysis**: a table of control, evidence found, gap, and suggested remediation with effort (S/M/L).
4. **Remediation tasks**: concrete engineering tasks for each gap, ready to hand to the agent or the `swarm` tool.
5. Mark what cannot be verified from code (HR processes, vendor management, physical security) as out of scope.
