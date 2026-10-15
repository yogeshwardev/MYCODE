# Changelog

## Unreleased

- Desktop: a clean composer. SwarmCode picks skills and the mode itself and asks before using several agents. A `/` command palette chooses modes, `/guarantee` and skills, shown as removable chips.
- Desktop: sign in with GitHub (device flow) or Google (PKCE loopback), with the account in the sidebar and settings; optional, and configured by client IDs.
- Document tools: `read_document` (PDF pages, .docx, text formats) and `generate_pdf` (Markdown or HTML to PDF via the installed Chrome/Edge).
- 6 new general skills (35 total): documents, new-project, mobile-app, deployment, ui-design and automation-scripts. General-purpose copy and suggestions.
- Autopilot answers short requests directly (no extra model call) and asks before costlier modes.

- Hidden-test guarantee (`--guarantee`, `hiddenTests`), with an independent test author and tests stored outside the agents' reach. Works in agent, swarm and best-of modes.
- Proof reports for every change (`.swarmcode/proofs/`, `swarm proof`), and `swarm pr` to open a pull request with the proof as its description.
- Model council (`councilModels`): independent plan critiques from other models, one revision, verdicts shown with the plan.
- Autopilot (`swarm auto`, `swarm estimate`, desktop Auto mode): forecasts tokens, time and cost per mode from project history and picks the best value within the budget.
- Repo health radar (`swarm health`, desktop Health tab) with one-click fixes.
- Time-travel replay: a checkpoint for every request; `swarm replay` and `swarm fork` re-run a past request from its exact code with another model or prompt.
- Skill studio: create skills from sessions; import with SHA-256 pinning and Ed25519 signature verification; `skill keygen` and `skill sign`.
- Context: a searchable journal with the `recall` tool (survives compaction), and offloading of huge tool outputs.
- Fix: commands launched by SwarmCode no longer inherit NODE_TEST_CONTEXT (nested `node --test` falsely passed).

- Browser tools: navigate, snapshot (with element refs), click, type, console and network errors, and screenshots, using the installed Chrome or Edge.
- Background processes: `bash` with `background: true`, plus `process_output` and `process_stop`; cleaned up automatically.
- 13 new skills (29 total), including web QA, code review, database work, upgrades, cloud security, API security testing, compliance evidence, suspicious-code triage and pentest reports.
- Automatic skill selection: each request and worker task is matched against skill triggers, and relevant skills are suggested to the agent.

- Best-of-N tournament mode (`swarm best`, `/best`, desktop "Best of 3"), with mixed models via `bestOfModels`, grading on tests and security, a judge, and the winner applied.
- Security merge gate (`securityGate`) in agent mode and the parallel pipeline: only findings a change introduces are flagged.
- Audit trail (`audit`, `swarm trace`): JSONL record of requests, tool calls, approvals, results and spend.
- Project memory: the `remember` tool and `.swarmcode/memory.md`, loaded into every agent's instructions.
- Actionable errors when a model server can't be reached (e.g. "Is Ollama running?").
- Desktop: premium black redesign, custom title bar, steps timeline, suggestions, keyboard shortcuts, new app icon.

- Independent reviewer gate in agent mode and the parallel pipeline (`review`: auto/always/off).
- Skills: 16 built-in expert playbooks, including 8 for defensive security, plus user and project skills. Adds `use_skill`, `--skill`, `swarm skills` and `/skill`.
- New tools: `security_scan` (secrets and risky code patterns, with masked output) and `web_fetch` (untrusted-labelled page text, with approval in ask mode).
- Undo the last request's file changes (`/undo`, plus a desktop button).
- Prompt-injection guidance for all agents.
- Fix: OpenAI-compatible servers (e.g. Ollama) rejected empty assistant messages sent as `null`.

- Agent mode: when the agent edits files and a verify command is set, the command runs automatically when the agent stops. Failures go back to the agent, for up to 2 rounds. The agent also re-checks every requirement before it answers.
- Robustness with open-weight models: aliases for invented tool names, forgiving plan field names, clearer error messages for malformed edits, and a self-check step for workers.
- A git repository at your home directory (dotfiles) is no longer mistaken for your project. File listing is now time- and size-bounded.
- Benchmark: 12 tasks with hidden acceptance tests, reference solutions, a `--check` mode, and per-category reports.

## 1.0.0

First public release.

- Parallel pipeline: planner with file-ownership validation, a task dependency graph, workers in isolated git worktrees, merge as each task finishes, an agent that resolves conflicts, baseline-aware verification with automatic fixes, and a reviewed apply.
- The main agent escalates large tasks to the pipeline on its own (`swarm` tool).
- Any provider: Anthropic plus every OpenAI-compatible API (OpenAI, OpenRouter, DeepSeek, Gemini, Groq, xAI, Mistral, Together, Ollama, LM Studio, custom). A separate model for each role, and failed workers are retried on the lead model.
- Context management: a repository map, research subagents, read deduplication, output clipping, and self-compaction.
- Tools: read, write, multi-edit, list, glob, grep (ripgrep), shell, delegate, plus MCP servers (stdio and HTTP).
- CLI: interactive mode, one-shot tasks, `--json` for CI, session resume, budgets, piping.
- Desktop app (Electron): chat, plan review, live agents board, diff review, cost and context meters, settings and encrypted key storage.
