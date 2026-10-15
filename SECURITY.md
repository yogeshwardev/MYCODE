# Security

## Reporting a vulnerability

Please report security issues privately using GitHub's "Report a vulnerability" (Security Advisories) on this repository, not in a public issue. We aim to acknowledge reports within 3 business days.

## What SwarmCode can do on your machine

SwarmCode runs AI agents that read and edit files and run shell commands **as your user**. In `ask` mode (the default for the interactive CLI and the desktop app), you approve every edit, command, MCP call and parallel run. In `auto` mode (`--yes`, `--json`), nothing is asked.

Parallel workers edit isolated git worktrees, but their commands are not sandboxed. For untrusted repositories or tasks, run SwarmCode inside a container or VM.

API keys are read from environment variables or, in the desktop app, stored encrypted with the OS keychain (Electron `safeStorage`). They are only sent to the provider they belong to.
