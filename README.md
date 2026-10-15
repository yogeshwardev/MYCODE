# SwarmCode

**One request, many agents.** SwarmCode is an AI coding agent that plans your task, builds it with **parallel agents in isolated git worktrees**, merges their work (an agent resolves the conflicts), runs your tests and fixes what broke, then hands you one reviewed diff to apply. It runs in the terminal and as a desktop app, and works with **any model provider**, including local models.

```bash
npm install -g swarmcode
swarm "add rate limiting to the public API, with per-route config, docs and tests"
```

## Why SwarmCode

Running several agents in parallel worktrees is now common. The hard part is everything around it: deciding how to split the work, keeping agents from colliding, merging, and making sure the combined result still works. Usually a person does that. SwarmCode automates it end to end:

| Step | What SwarmCode does |
|---|---|
| **Decide** | One agent works directly on small tasks, and escalates big ones to the parallel pipeline on its own (the `swarm` tool). |
| **Plan** | A planner explores the repo and submits a dependency graph of tasks with **file ownership**. A plan where two parallel tasks own the same file is rejected before any code is written. |
| **Build** | Up to N workers run at once, each in its own git worktree. A task that depends on others starts from their **merged** result. |
| **Merge** | Each branch merges as soon as it finishes. Conflicts go to a resolver agent, and the merge only lands once every conflict marker is gone. |
| **Verify** | Your test command runs on the original code *while* the agents work (it costs no extra time), so the fixer knows which failures are new and which were already there. Failures are fixed automatically, up to 2 rounds. |
| **Review** | An independent reviewer agent checks the combined diff against your request (missed requirements, bugs, broken callers, security issues), and real findings are fixed before you see the result. |
| **Deliver** | You get one report and one diff. Apply it, or keep it on its `swarm/<run>` branch. Your uncommitted changes are included and your branch is never touched. |

**Hidden-test guarantee** (`--guarantee`, or the **Guarantee** toggle in the desktop app)
- Before any code is written, an independent QA agent turns your request into acceptance tests. The implementing agents never see them; they are stored outside the project, where agent tools can't reach. The work is only accepted when those tests pass. If they fail, the implementer learns which requirement failed, but never sees the test code, so it can't "pass" by weakening or special-casing tests. Works in agent, swarm and best-of modes.

**Proof of every change**
- Each change produces a proof report in `.swarmcode/proofs/`: the request, files changed, and the result of every gate (tests, hidden acceptance tests, independent review, security gate, best-of scores), plus models, tokens, cost and a link to the audit trail. `swarm proof` shows the latest one. `swarm pr` commits the changes to a branch, pushes it and opens a pull request with the proof as its description (it asks first).

**Model council** (`councilModels`)
- Before a parallel run, models from other providers critique the plan independently: missed requirements, conflicting tasks, wrong assumptions about the code. The planner revises once from their concerns, and you see every verdict before approving.

**Autopilot** (`swarm auto`, `swarm estimate`, or **Auto** in the desktop app)
- A cheap model sizes the task. SwarmCode then forecasts tokens, time and cost for Agent, Swarm and Best-of-3 from this project's own history, picks the best value that fits your budget, and runs it.

**Best-of-N: when it has to be right**
- `swarm best "task" -n 3` (or **Best of 3** in the desktop app): several agents, optionally on different models (`bestOfModels`), each solve the whole task independently in their own worktree. Each attempt is graded on your tests and on the security findings it introduced; a judge compares the finalists, and only the winner is applied.

**Quality gates on every change** (agent mode too)
- **Verify loop:** when the agent stops after editing files, your test command runs, and failures go back to the agent automatically.
- **Independent review:** a fresh reviewer with no stake in the implementation checks the diff against the request, and the agent fixes valid findings. With `"review": "auto"` (the default), changes of 15+ lines are reviewed; `"always"` reviews every change and `"off"` none.
- **Security gate:** new high-severity findings or secrets that a change *introduces* are sent back to be fixed before the change is reported done. Pre-existing issues don't block. Turn it off with `"securityGate": "off"`.
- **Undo:** `/undo`, or the desktop app's Undo button, reverts the files changed by the last request.

**Bigger effective context, fewer tokens**
- **Recall:** every agent keeps a searchable journal of everything it saw and did. After its context is compacted, the `recall` tool still finds earlier file contents, command output and decisions, so long sessions don't lose information.
- **Offloading:** huge tool outputs (build logs, test runs, big searches) are saved to `.swarmcode/outputs/`, and only their head and tail enter the context. The agent reads the exact part it needs.
- These come on top of read de-duplication, the repository map, research subagents with their own context windows, and prompt caching.

**Built for teams and audits**
- **Repo health radar** (`swarm health`, or the **Health** tab): a score with hardcoded secrets, high-risk code patterns, vulnerable dependencies (npm audit, pip-audit), test status, very large files, TODO debt and change hotspots. Every problem comes with a one-click fix task (`swarm health --fix`).
- **Time-travel replay:** every request records a checkpoint of the exact code it started from. `swarm replay` lists a session's requests and `swarm replay --step 3` walks through one. `swarm fork 3 --model <other>` re-runs request 3 from that exact code on a new branch, optionally with another model or an edited `--prompt`. Your working tree is not touched.
- **Skill studio:** `swarm skill create` turns your latest session into a reusable skill. `swarm skill import <https-url|file>` shows the full skill before installing it, pins it by SHA-256, and verifies Ed25519 signatures against `trustedSkillKeys` (`requireSignedSkills` makes signatures mandatory). `swarm skill keygen` and `swarm skill sign` let teams publish signed skills.
- **Audit trail:** every request, tool call, approval decision, gate result and the spend is written to `.swarmcode/traces/<session>.jsonl` (kept out of git). `swarm trace` prints the latest session as a timeline. Disable with `"audit": false`.
- **Project memory:** the agent saves durable lessons (build commands, conventions, gotchas, your preferences) to `.swarmcode/memory.md`, and every future session starts with them. Commit the file to share it with your team, and edit it freely.

**Efficiency**
- **The right model for each role.** A strong model plans; fast, cheap models do the volume work; read-only research goes to the cheapest one. A worker that fails is retried once, from scratch, on the strong model.
- **Context that lasts.** Each worker and research subagent gets its own context window, and only its conclusions come back. Every agent starts with a map of the repository. Unchanged files are never re-sent. Large tool output is trimmed before it enters history. Near the limit, an agent writes itself a handoff summary and continues in a fresh session.
- **Fewer round trips.** Batched multi-edit, edits that echo back the changed region (no re-read needed), ripgrep search, read-only tools run in parallel, and prompt caching on Anthropic models.
- **Cost control.** Live token and cost meter, plus `--budget <usd>` to stop at a spending cap.

## Install

**CLI** (Node 20+):

```bash
npm install -g swarmcode
```

**Desktop app**: download the installer for Windows, macOS or Linux from the Releases page, or build it yourself (see [Development](#development)).

Then set a key for at least one provider (or run a local model with Ollama):

```bash
export ANTHROPIC_API_KEY=...      # or OPENAI_API_KEY, GEMINI_API_KEY, OPENROUTER_API_KEY, ...
```

The desktop app can also store keys for you, encrypted with your OS keychain.

## Using the CLI

```bash
swarm                          # interactive session
swarm "fix the flaky auth test"  # one task; big ones get parallelized automatically
swarm run "build the billing module" --verify "npm test"   # always use the parallel pipeline
swarm -c                       # continue the last session
```

| Command | |
|---|---|
| `swarm` | Interactive. Inside it: `/swarm <task>`, `/context`, `/usage`, `/clear`, `/models`, `/exit` |
| `swarm "<task>"` / `swarm ask "<task>"` | Run one task and exit |
| `swarm run "<task>"` | Plan → parallel agents → merge → verify → review → apply |
| `swarm best "<task>" -n 3` | Best-of-N: independent attempts, the best verified one wins |
| `swarm trace [n]` | Show the audit trail of a recent session |
| `swarm auto "<task>"` / `swarm estimate "<task>"` | Autopilot / forecast only |
| `swarm health [--tests] [--fix]` | Repo health radar |
| `swarm proof` / `swarm pr` | Latest proof report / open a PR with it |
| `swarm replay [--step k]` / `swarm fork <k>` | Time-travel replay and fork |
| `swarm skill create\|import\|keygen\|sign` | Skill studio |
| `swarm init` | Create `.swarmcode/config.json` |
| `swarm models` | Show models per role and whether their keys are set |
| `swarm sessions` | List saved sessions |
| `swarm clean` | Remove leftover worktrees and `swarm/*` branches |

| Option | |
|---|---|
| `-m, --model provider/model` | Use one model for every role |
| `-p, --parallel N` | Max agents at once (default 4) |
| `--verify "cmd"` | Command that must pass |
| `--budget USD` | Spending cap |
| `-c, --continue` / `-r, --resume ID` | Resume a session |
| `-g, --guarantee` | Hidden acceptance tests decide whether the work is accepted |
| `-y, --yes` | Never ask (edits, commands, plans, apply) |
| `--no-apply` | Keep a parallel result on its branch |
| `--json` | Machine-readable output, for CI. Exit codes: 0 success, 2 partial or verification failed, 1 error |

Piping works too: `echo "update the changelog" | swarm`.

## The desktop app

- **Chat** with streaming replies, inline approval cards (*Allow* / *Always allow* / *Deny*), and **Agent** or **Swarm** mode.
- **Plan review**: see every task, its files and its dependencies before any agent starts.
- **Agents board**: live status, elapsed time, model and recent activity for every worker, plus helpers (planner, researchers, merge resolver, fixer).
- **Changes**: a full diff viewer for the agent's edits, or for a parallel run's result, with *Apply* and *Keep on branch*.
- **Cost and context meters**, a session history per project, and settings for models, effort, parallelism, the verify command, permissions, budget and API keys.

Built for safety: a sandboxed renderer, context isolation, a strict Content-Security-Policy, and no remote content.

## Skills: expert playbooks, including cybersecurity

Skills are expert playbooks. Only a one-line index sits in context until one is needed. The agent picks skills itself: every request is matched against each skill's trigger words, and the relevant ones are suggested to the agent automatically. 29 are built in:

| Area | Skills |
|---|---|
| **Security (defensive)** | `security-review` (OWASP/CWE code review with severity and fixes), `secure-fix` (remediation with a regression test that proves it), `threat-model` (STRIDE, data flows, trust boundaries), `dependency-audit` (CVEs, supply chain, upgrade plan), `secrets-hygiene` (leaked keys in code and git history, rotation), `hardening` (Docker, Kubernetes, nginx, CI/CD, cloud IaC), `detection-engineering` (Sigma, YARA, Suricata, KQL/SPL with tests), `incident-forensics` (log timelines, IOCs, containment) |
| **More security** | `cloud-security` (IAM, exposure, encryption from IaC), `api-security-testing` (authorized authz/IDOR matrices against your own API), `compliance-evidence` (SOC 2, ISO 27001, PCI, HIPAA, GDPR), `suspicious-code-triage` (static analysis of possibly malicious packages and scripts), `pentest-report` |
| **Engineering** | `debugging`, `test-writing`, `code-review`, `refactoring`, `performance`, `api-design`, `database`, `migration-upgrade`, `frontend-quality` (WCAG 2.2 AA), `web-qa` (end-to-end testing in a real browser), `devops-ci`, `git-workflow`, `docs-writing`, `explain-codebase`, `data-analysis`, `llm-apps` |

```bash
swarm skills                                         # list them
swarm --skill security-review "review the payment service"
swarm --skill threat-model "threat model our auth flow"
```

The agent also picks relevant skills on its own. To add your team's playbooks (house style, review checklists, runbooks), drop Markdown files with `name` and `description` frontmatter into `~/.swarmcode/skills/` or `<project>/.swarmcode/skills/`.

**Browser and background processes.** Agents can start dev servers and watchers in the background (`bash` with `background: true`, `process_output`, `process_stop`), then test the running app in a real headless browser (`browser_navigate`, `browser_click`, `browser_type`, `browser_console`, `browser_screenshot`). This uses the Chrome or Edge already installed on your machine; set `SWARMCODE_BROWSER` to use another Chromium-based browser.

The **`security_scan`** tool gives every agent a fast first pass: hardcoded secrets (masked in output), injection, XSS sinks, `eval`, unsafe deserialization, disabled TLS verification, and weak hashes and randomness, across JS/TS, Python, Go, Java, PHP, C#, shell and Docker. Findings are leads that the security skills then confirm by reading the code.

SwarmCode is built for **defensive** security work, authorized testing, CTFs and education. It declines to write malware or tools for attacking systems you are not authorized to test.

## Desktop app: how it works day to day

- **Just type.** SwarmCode picks the right skills itself. For a big job it shows a forecast (time and cost for one agent, parallel agents or best-of-3) and **asks you** before using several agents.
- **Type `/` to take control:** `/agent`, `/swarm` and `/best` force a mode, `/guarantee` adds hidden acceptance tests, and `/<skill>` (e.g. `/documents`, `/ui-design`, `/security-review`) applies a playbook. Your choices appear as chips above the input; Backspace removes the last one.
- **Documents:** agents read PDFs (by page) and Word files with `read_document`, and create polished PDFs from Markdown or HTML with `generate_pdf`.

### Sign-in setup (GitHub and Google)

Sign-in is optional; everything works without an account. To enable it in your build, register OAuth apps and provide their client IDs:

- **GitHub**: create an OAuth App (GitHub → Settings → Developer settings → OAuth Apps), tick **Enable Device Flow**, and set `SWARMCODE_GITHUB_CLIENT_ID`. Users approve on github.com with a short code; no password touches the app.
- **Google**: create an OAuth client of type **Desktop app** in Google Cloud Console and set `SWARMCODE_GOOGLE_CLIENT_ID` and `SWARMCODE_GOOGLE_CLIENT_SECRET`. Desktop client secrets are not confidential by design; the flow uses PKCE and a loopback redirect.

The IDs can also go in `~/.swarmcode/desktop.json` as `{"oauth": {"githubClientId": "...", "googleClientId": "...", "googleClientSecret": "..."}}`. Tokens are encrypted with the OS keychain.

## Models and providers

Models are written `provider/model`. Each role can use a different one:

| Role | Default | Job |
|---|---|---|
| `main` | `anthropic/claude-opus-5-5` | Conversation, merge conflicts, verification fixes, retries |
| `planner` | `anthropic/claude-opus-5-5` | Splits work into a task graph |
| `worker` | `anthropic/claude-sonnet-5-5` | Builds tasks in parallel |
| `explorer` | `anthropic/claude-haiku-5-5` | Read-only research subagents |

Built in: `anthropic`, `openai`, `openrouter`, `deepseek`, `gemini`, `groq`, `xai`, `mistral`, `together`, `ollama`, `lmstudio`. Any OpenAI-compatible server (vLLM, LiteLLM, TGI, ...) can be added in config.

## Configuration

Settings are layered: built-in defaults, then `~/.swarmcode/config.json`, then `<project>/.swarmcode/config.json`. Run `swarm init` to create a project config.

```json
{
  "models": { "main": "anthropic/claude-opus-5-5", "worker": "openrouter/qwen/qwen3-coder", "explorer": "ollama/qwen3-coder" },
  "effort": { "main": "high", "planner": "high", "worker": "medium", "explorer": "low" },
  "maxParallel": 6,
  "verifyCommand": "npm test",
  "permission": "ask",
  "budgetUsd": 5,
  "providers": { "my-vllm": { "type": "openai", "baseURL": "http://localhost:8000/v1", "apiKeyEnv": "MY_KEY" } },
  "prices": { "my-vllm/my-model": [0.5, 1.5, 0.05] },
  "contextWindows": { "my-vllm/my-model": 128000 },
  "mcpServers": {
    "github": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-github"], "env": { "GITHUB_TOKEN": "..." } },
    "docs": { "url": "https://example.com/mcp", "headers": { "Authorization": "Bearer ..." }, "trusted": true }
  }
}
```

**Project instructions** are read from `SWARMCODE.md`, `AGENTS.md`, `CLAUDE.md` or `.cursorrules`, so existing repos work as they are.

**MCP**: tools from any Model Context Protocol server (stdio or HTTP) are available to every agent. Calls need approval unless the server is marked `trusted`.

## Safety model

- **Permissions.** In `ask` mode, every file edit, shell command, MCP call and parallel run needs your approval. `auto` (or `--yes`) skips approvals.
- **Isolation.** Parallel workers edit only their own worktree, and nothing reaches your working tree until you apply the result. Workers' shell commands still run as your user, on your machine, so run untrusted tasks in a container or VM.
- **Guardrails.** File paths are confined to the project, and obviously destructive commands are refused (for example `rm -rf /`, `git push --force`, disk formatting).
- **Prompt-injection defense.** Agents are instructed to treat file contents, command output and web pages as data, never as instructions. `web_fetch` labels everything it returns as untrusted, and in `ask` mode every web request needs approval.
- **Keys.** Keys stay in your environment or your OS keychain. They are sent only to the provider they belong to.

## Benchmarks

Claims should be measured. `bench/` contains 12 realistic tasks (4 small, 4 medium, 4 large and parallelizable) on three starter projects. Every task is graded by **hidden acceptance tests** that agents never see. The tests are copied in only after an agent finishes. Each task also ships a reference solution, and `--check` proves that the starting code fails its hidden tests and the solution passes them.

```bash
npm run bench -- --check                                   # validate the tasks themselves
npm run bench                                              # SwarmCode agent + swarm modes
npm run bench -- --category large --repeat 3
npm run bench -- --external "other=other-agent-cli -p {prompt}"   # compare any agent CLI
```

The report shows pass rate, time and tokens per task and per category, plus the fastest correct runner for each task. To add a task, add an entry to `bench/tasks.json`, put its hidden tests in `bench/hidden/<id>/` and its reference solution in `bench/solutions/<id>/`.

To publish results on the website, run `npx tsx bench/export-site.ts --model "<model used>"`. It writes `website/benchmarks.json` from the latest file in `bench/results/`.

## Website

`website/` is a static site for Cloudflare Pages: no build step, black theme, and benchmarks loaded from `benchmarks.json`.

1. Upload the installer somewhere that serves large files. Cloudflare Pages caps files at 25 MiB, so use GitHub Releases or a Cloudflare R2 bucket with a public URL.
2. Put that URL (and optionally your repo URL) in `website/config.js`.
3. Deploy: `npx wrangler pages deploy website --project-name swarmcode`. Or connect the repo in the Cloudflare dashboard with build output directory `website` and no build command.

`/download` shows install steps and starts the download. `_headers` sets security headers and caching. To refresh the screenshots, run `npm run preview && npx electron scripts/screenshots.mjs` in `desktop/`.

## Development

```bash
npm install
npm run typecheck && npm test      # includes end-to-end pipeline tests with scripted models
npm run dev -- run "task"          # run the CLI from source

cd desktop
npm install
npm start                          # run the desktop app
npm run preview                    # UI with a mock backend: serve dist-preview/renderer in a browser
npm run dist                       # build installers into desktop/release
```

Layout: `src/engine.ts` is the core API that both front ends use. The rest of the code is in `src/agent` (agent loop, compaction, subagents, prompts), `src/providers` (Anthropic + OpenAI-compatible), `src/swarm` (planner, orchestrator, git worktrees), `src/tools`, `src/mcp.ts`, `src/index.ts` (the CLI), and `desktop/` (Electron).

## License

[Apache-2.0](LICENSE)
