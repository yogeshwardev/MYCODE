# Changelog

## 1.1.0

New
- **Plan mode** (`swarm plan`, `--plan`, `/plan` in the app): the agent investigates read-only and proposes a plan; nothing changes until you approve it.
- **`swarm review`** (`/review` in the app): reviews uncommitted changes, a branch (`--base main`) or a commit (`--commit`), never edits, and exits with code 2 when it finds issues, so it can gate CI.
- **Permission rules** (`rules.allow` / `rules.deny`, e.g. `"bash:npm test*"`, `"write:src/**"`). Deny rules come from any config; allow rules only from your global config, so a cloned repo can't pre-approve its own commands.
- **Destructive-command guard**: force pushes, `git reset --hard`, recursive deletes of root/home, disk formatting, dropping databases and piping downloads into a shell always need a person, even in auto mode, and the approval prompt says why.
- **Hooks**: `hooks.afterEdit` runs commands (formatters, linters) on each file the agent writes; failures go back to the agent.
- **Web search** (`web_search`): Brave or Tavily with an API key, DuckDuckGo otherwise.
- **Images**: `--image` in the CLI, paste or drop screenshots in the app.
- **`@file` mentions** attach files to a request.
- **Checklist** (`todo`) for multi-step work, shown live in the terminal and the app.
- **Clarifying questions** (`ask_user`): the agent can ask one short question with suggested answers instead of guessing.
- `swarm init --agents` writes an AGENTS.md for the project.

Better
- Much lower token use on long tasks: older tool output is trimmed from context in batches (recall still finds it), and `contextBudget` (default 160k) caps the working context even on 1M-token models. One benchmark task went from 2.18M to 0.59M tokens.
- Works better with any model: common tool and argument names from other agents (`file_path`, `old_str`, `query`, `print_tree`, ...) are understood, no-op edits no longer count as errors, and an agent that stops without replying or mid-step is told to continue.
- Strongly matching skills are included automatically; skill triggers cover more everyday requests.
- Browser tools: type by field label, and clicks by text prefer buttons and links.
- Smaller, faster desktop app: installer 125 MB to 101 MB, minified bundles, startup about 1 s.

Fixed
- Parallel workers, merge and fix agents, and best-of candidates now follow deny rules and the destructive-command guard (they approved everything before).
- A folder inside a git repo at your home directory is treated as its own project everywhere (`init` wrote to `~`, `clean` touched the home repo); paths are compared as real paths on Windows.
- CI: Node 22+ is required (the PDF library needs it); release builds no longer fail when signing secrets are absent.

## 1.0.0

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
