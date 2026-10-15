---
name: suspicious-code-triage
description: Statically analyze a suspicious script or package (e.g. a possibly malicious npm or PyPI dependency, or a macro or script from an attachment) to determine what it does, extract indicators and recommend a response - without executing it.
triggers: malicious, suspicious, malware, obfuscated, is this safe, backdoor, postinstall, typosquat, phishing attachment, analyze this script
---
Defensive analysis only. Never execute the sample, and never install or import it. Work on a copy and record its SHA-256 hash.

1. **Triage**: file type, size and hashes; for packages, the metadata: publisher, release history, install hooks (`preinstall`/`postinstall`, `setup.py` code), and how closely the name imitates a popular package (typosquatting).
2. **Deobfuscate statically**: pretty-print it, and decode base64, hex, char-code arrays and string concatenations with a separate small script that only transforms strings. Never evaluate the sample's code. Follow dynamic `require`/`import` targets.
3. **Determine behavior**: network calls (domains, IPs, URLs), file reads (credential files, browser data, SSH keys, `.env` files, wallets), process execution, persistence (startup entries, cron, shell profiles), environment-variable harvesting and exfiltration paths.
4. **Indicators of compromise**: hashes, domains, IPs, URLs, file paths, registry keys and package versions. Defang network indicators in the report (for example `hxxps://evil[.]example`).
5. **Verdict and response**: malicious, suspicious or benign, with confidence and reasoning. If malicious: who may be affected (projects depending on it, machines that installed it), credentials to rotate, packages to remove and pin, and detection ideas (load `detection-engineering` to write rules).
