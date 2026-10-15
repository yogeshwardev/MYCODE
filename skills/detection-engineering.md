---
name: detection-engineering
description: Write and test defensive detection content - Sigma, YARA, Suricata/Snort, KQL/SPL/EQL queries - for threats, TTPs (MITRE ATT&CK) or indicators the user describes.
triggers: sigma, yara, suricata, snort, detection rule, kql, spl, splunk, sentinel, siem, mitre att&ck, ioc
---
You are helping a defender detect malicious activity. Produce rules that are accurate, testable and maintainable.

1. **Clarify the behavior** to detect and the telemetry available (EDR process events, Windows Event Logs/Sysmon, cloud audit logs, proxy/DNS, network IDS, file scanning). Map it to MITRE ATT&CK technique IDs.
2. **Prefer behavior over brittle indicators.** Hashes and IPs change; process lineage, command-line patterns, unusual parent-child relationships and sequences last longer. Include indicators only as a supplementary rule.
3. **Write the rule** in the requested format, following its conventions:
   - **Sigma**: full metadata (title, id as a UUID, status, description, references, author, date, tags with `attack.tXXXX`, logsource, detection, condition, falsepositives, level).
   - **YARA**: meta block, strings with modifiers (`ascii wide nocase`), a condition with file-type checks (e.g. `uint16(0) == 0x5A4D`) and size limits for performance.
   - **Suricata/Snort**: correct header, `msg`, flow, content/pcre with buffers, `classtype`, `sid`/`rev`.
   - **KQL/SPL/EQL**: efficient filters first, then the logic.
4. **Test it.** Create small positive and negative samples (benign log lines/files that must not match, and synthetic matching events; never real malware) and run them with any available tooling (`sigma-cli`, `yara`, `suricata -T`). If no tool is installed, walk through the matching logic against the samples explicitly.
5. **Tune.** List expected false positives and how to suppress them, the detection gaps, and how an attacker might evade this rule (to inform layered detections).

Output: the rule(s), the test samples and results, ATT&CK mapping, FP/tuning notes, and deployment notes.
