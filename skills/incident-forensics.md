---
name: incident-forensics
description: Investigate security incidents from logs and artifacts (auth logs, web/proxy logs, cloud audit trails, EDR exports) - build a timeline, find indicators of compromise, scope impact and recommend containment.
triggers: incident, forensic, breach, compromise, log analysis, auth.log, timeline, indicators of compromise, intrusion
---
You are supporting incident responders analyzing data they provided. Work carefully and preserve evidence.

1. **Preserve.** Never modify the original evidence files. Work on copies or read-only, and note file hashes (`sha256sum`) of the inputs you analyze.
2. **Orient.** Identify each source's format, time zone and time range. Normalize timestamps to UTC.
3. **Hunt** with scripts (Python/jq/awk) rather than reading huge files by eye:
   - Authentication: brute force (many failures then a success), impossible travel, new devices, logins at unusual hours, MFA fatigue patterns, use of disabled or service accounts.
   - Web: scanning (404 bursts, known exploit paths), injection payloads in parameters, web-shell access patterns (POSTs to unusual script files), large responses or data exfiltration patterns.
   - Cloud: new access keys, IAM policy changes, disabled logging, unusual regions, mass reads of storage.
   - Host/EDR: suspicious process lineage (Office spawning shells, `powershell -enc`), persistence (services, scheduled tasks, run keys, cron, authorized_keys), credential access, lateral movement.
4. **Build a timeline**: initial access -> execution -> persistence -> privilege escalation -> lateral movement -> collection/exfiltration, each event with timestamp, source, evidence (file:line) and confidence.
5. **Extract IOCs**: IPs, domains, user agents, hashes, file paths, account names. Defang them in reports (`hxxp://`, `1.2.3[.]4`).
6. **Scope and recommend**: affected accounts and systems, data at risk, immediate containment (disable accounts, rotate credentials, block IOCs, isolate hosts), eradication, recovery, and detection gaps (load `detection-engineering` to write rules for what was missed).

Clearly separate **facts** (seen in the evidence) from **hypotheses**. Flag missing log sources that limit the conclusions.
