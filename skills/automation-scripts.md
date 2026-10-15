---
name: automation-scripts
description: Write reliable scripts and small tools to automate repetitive work - file processing, data conversion, renaming, scraping your own sites, backups, reports, scheduled jobs - in Python, Node, PowerShell or Bash.
triggers: script, automate, automation, batch, bulk rename, convert files, cron, scheduled task, scrape, backup, cli tool, one-off script, process these files
---
1. **Pick the language already available** on the machine and in the project (check `python --version`, `node --version`; PowerShell on Windows, Bash elsewhere). Prefer the standard library; add dependencies only if they clearly simplify things.
2. **Be safe with data**: dry-run mode by default for anything that moves, renames, deletes or overwrites files; print what would change; never delete originals without an explicit flag; and write outputs to a new folder.
3. **Be robust**: handle missing files, encodings (UTF-8 with BOM, Windows line endings), spaces in paths, and partial failures (continue, log, and report a summary at the end). Make it idempotent so running it twice is harmless.
4. **Be usable**: clear command-line arguments with `--help`, sensible defaults, and progress output for long runs.
5. **Test on a small sample** first, show the result, then run on everything only when the user confirms.
6. For scheduled jobs, use the platform scheduler (cron, systemd timers, Windows Task Scheduler) and document how to disable it.
