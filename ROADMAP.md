# SwarmCode roadmap

## Positioning

Parallel agents in git worktrees are now table stakes: Cursor, the Codex app, GitHub's Copilot app, Conductor and JetBrains Air all run them. SwarmCode competes on **trustworthy output** and **security/enterprise readiness**, which the market still lacks:

| Differentiator | Status |
|---|---|
| **End-to-end automation**: plan with file ownership → parallel build → merge with agent conflict resolution → verify (baseline-aware) → review → apply | Shipped |
| **Best-of-N tournament**: N independent attempts (mixed models), graded on tests and security, judged, best applied | Shipped |
| **Quality gates on every change**: verify loop, independent reviewer, security merge gate | Shipped |
| **Security-first**: 8 defensive security skills, `security_scan`, gate that blocks *introduced* findings | Shipped |
| **Audit trail**: replayable JSONL of every action and approval (`swarm trace`) | Shipped |
| **Any model, per role**: cloud, OpenAI-compatible, local; cheap-first with escalation | Shipped |
| **Project memory** that improves with use | Shipped |
| **Hidden-test guarantee**: acceptance tests written before the code, invisible to the implementers | Shipped |
| **Proof reports and proof PRs** for every change | Shipped |
| **Model council**, **autopilot**, **repo health radar**, **time-travel replay and fork**, **signed skill sharing** | Shipped |
| **Searchable session journal (`recall`) and output offloading** for a larger effective context | Shipped |
| **Published, reproducible benchmark** against other agents with hidden tests | Harness shipped; results pending |

## Next (highest impact first)

1. **Publish benchmark results.** Run `bench/` (12 tasks, hidden tests) against Claude Code, Codex and opencode on 2–3 models with 3 repeats. Numbers are the marketing.
2. **Sandboxed execution.** Run worker and candidate shell commands in containers (Docker/Podman) or OS sandboxes, with network policy. This is required for enterprise and for untrusted repos.
3. **Checkpoints for everything.** Undo currently covers agent file edits. Extend it to shell-command side effects and applied parallel runs (reverse patches), with a timeline UI.
4. **LSP diagnostics after edits.** Type errors and lint feedback without running the full build, so agents iterate faster with fewer tokens.
5. **Cost-aware routing.** Classify each task's difficulty with a cheap model and pick the agent mode and models automatically, with budget forecasts before large runs.
6. **Team features.** Shared skills and memory, a policy file (allowed commands, protected paths, required gates), and SSO/audit export (SIEM) for enterprise.
7. **Image input.** Screenshots and design mockups for front-end work, on providers that support vision.
8. **IDE extension.** VS Code (then JetBrains) on the same engine, so the full pipeline works inside the editor.
9. **Cloud runs.** Run the pipeline on a server against a PR or issue, triggered from GitHub, Linear or Slack, and post the result back.
10. **Full-screen TUI** for the CLI, with live panes per agent.
