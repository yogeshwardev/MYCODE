import fs from "node:fs";
import path from "node:path";
import { Agent } from "./agent/agent.js";
import { UsageTracker, type EventSink } from "./agent/events.js";
import { explorerSystemPrompt, mainSystemPrompt } from "./agent/prompts.js";
import { describeFindings, GATE_INSTRUCTIONS, introducedFindings } from "./agent/gate.js";
import { changedLines, diffFromSnapshots, reviewChange } from "./agent/review.js";
import { AuditTrail, TRACE_DIR } from "./audit.js";
import { authorAcceptanceTests, failureSummary, runAcceptance, type AcceptanceSuite } from "./quality/acceptance.js";
import { saveProof, type Check } from "./quality/proof.js";
import { assessTask, forecast, renderForecast, type Forecast, type Mode } from "./quality/autopilot.js";
import { healthCheck, type HealthReport } from "./quality/health.js";
import { makeDelegateTool } from "./agent/subagents.js";
import { loadConfig, resolveModel, type SwarmCodeConfig } from "./config.js";
import { connectMcp, type McpConnection } from "./mcp.js";
import { buildRepoMap, loadProjectInstructions } from "./repo/repomap.js";
import { listSessions, loadSession, newSessionId, saveSession, type SavedSession } from "./sessions.js";
import { loadSkills, makeSkillTool, skillIndex, suggestSkills, type Skill } from "./skills.js";
import { excludeSwarmCodeDir, git, resolveProject } from "./swarm/git.js";
import { runSwarm, type SwarmResult, type TaskState } from "./swarm/orchestrator.js";
import { runBestOf, type BestOfResult } from "./swarm/tournament.js";
import { closeBrowsers } from "./tools/browser.js";
import { makeRememberTool } from "./tools/memory.js";
import { stopProcesses } from "./tools/processes.js";
import type { Plan } from "./swarm/planner.js";
import { CORE_TOOLS, ToolError, type ApprovalKind, type Tool } from "./tools/index.js";
import { clip, runShell } from "./util.js";

const MAX_VERIFY_ROUNDS = 2;
/** In "auto" review mode, changes smaller than this many lines skip the review. */
const REVIEW_MIN_LINES = 15;
const MAX_UNDO = 20;

// The engine is the product's core API. The CLI and the desktop app are thin
// front ends over it: they supply hooks for display and confirmation.

export interface EngineHooks {
  events: EventSink;
  /** Approve a side effect. Not called when permission is "auto". */
  approve: (kind: ApprovalKind, summary: string) => Promise<boolean>;
  confirmPlan: (plan: Plan) => Promise<boolean>;
  /** Show a parallel run's result (report + full diff) before it is applied. */
  showResult?: (report: string, diff: string) => void;
  /** Ask whether to apply a parallel run's result. */
  confirmApply: (report: string, diff: string) => Promise<boolean>;
  onTasks?: (states: TaskState[]) => void;
  /** Non-fatal problems worth showing (e.g. an MCP server that failed to start). */
  onWarning?: (message: string) => void;
  /**
   * Autopilot recommends a costlier mode (parallel agents or best-of): let the
   * user choose. Resolve with the mode to run. Not called in "auto" permission mode.
   */
  chooseMode?: (forecast: Forecast) => Promise<Mode>;
}

export interface EngineOptions {
  model?: string;
  parallel?: number;
  budgetUsd?: number;
  verifyCommand?: string;
  /** Never ask: approve edits, commands, plans and results. */
  autoApprove?: boolean;
  /** Keep parallel results on their branch instead of applying them. */
  noApply?: boolean;
}

export class Engine {
  readonly usage: UsageTracker;
  sessionId = newSessionId();
  /** Built on first use, so a project opens even before an API key is configured. */
  private agentInstance?: Agent;
  private controller?: AbortController;
  private always = new Set<ApprovalKind>();
  /** Whether the main agent changed files during the current request. */
  private edited = false;
  /** Original contents (null = did not exist) of files changed in the current request. */
  private changes = new Map<string, Buffer | null>();
  /** One entry per request that changed files, newest last. */
  private undoStack: Array<Map<string, Buffer | null>> = [];
  readonly skills: Skill[];

  private constructor(
    readonly root: string,
    readonly isRepo: boolean,
    readonly cfg: SwarmCodeConfig,
    private hooks: EngineHooks,
    private opts: EngineOptions,
    readonly mcp?: McpConnection,
  ) {
    this.usage = new UsageTracker(opts.budgetUsd ?? cfg.budgetUsd, cfg.prices);
    this.skills = loadSkills(root);
    const forward = hooks.events;
    this.hooks = {
      ...hooks,
      events: (e) => {
        if (e.type === "tool" && e.agent === "swarm" && (e.name === "write_file" || e.name === "edit_file")) this.edited = true;
        this.audit?.record({ type: "event", event: e });
        forward(e);
      },
    };
  }

  static async open(dir: string, hooks: EngineHooks, opts: EngineOptions = {}): Promise<Engine> {
    if (opts.model) process.env.SWARMCODE_MODEL = opts.model;
    const { root, isRepo, homeRepo } = await resolveProject(dir);
    if (homeRepo) hooks.onWarning?.("This folder is inside a git repository at your home directory; treating the folder itself as the project (parallel agents are off).");
    const cfg = loadConfig(root);
    if (isRepo) excludeSwarmCodeDir(root);
    if (opts.parallel) cfg.maxParallel = opts.parallel;
    if (opts.autoApprove) cfg.permission = "auto";
    let mcp: McpConnection | undefined;
    if (Object.keys(cfg.mcpServers).length) {
      mcp = await connectMcp(cfg.mcpServers, root);
      for (const e of mcp.errors) hooks.onWarning?.(`MCP ${e}`);
    }
    return new Engine(root, isRepo, cfg, hooks, opts, mcp);
  }

  /** The audit trail for the current session (none when auditing is off). */
  get audit(): AuditTrail | undefined {
    if (!this.cfg.audit) return undefined;
    const file = path.join(this.root, TRACE_DIR, `${this.sessionId}.jsonl`);
    if (this.trail?.path !== file) this.trail = new AuditTrail(file);
    return this.trail;
  }
  private trail?: AuditTrail;

  get busy(): boolean {
    return Boolean(this.controller);
  }

  get context() {
    if (!this.agentInstance) return { tokens: 0, window: 0, model: this.cfg.models.main };
    return { ...this.agentInstance.contextUsed, model: this.agentInstance.modelSpec };
  }

  private async agent(): Promise<Agent> {
    this.agentInstance ??= await this.buildMainAgent();
    return this.agentInstance;
  }

  /**
   * Send a message to the main agent (which may escalate to a parallel run
   * itself). When the agent stops after changing files, quality gates run, and
   * anything they find goes back to the agent:
   *   verify command → independent review → security gate → hidden acceptance tests.
   * Every request that changes files produces a proof report.
   */
  async send(prompt: string, opts: { skills?: string[]; guarantee?: boolean } = {}): Promise<string> {
    const agent = await this.agent();
    const status = (message: string) => this.hooks.events({ type: "status", agent: "swarm", message });
    let fullPrompt = prompt;
    for (const name of opts.skills ?? []) {
      const skill = this.skills.find((s) => s.name === name);
      if (!skill) throw new Error(`Unknown skill "${name}". Available: ${this.skills.map((s) => s.name).join(", ")}`);
      fullPrompt = `Follow the "${skill.name}" skill for this request:\n\n${skill.body}\n\n---\n\n${fullPrompt}`;
    }
    // Point the agent at playbooks that match the request; it still decides whether to load them.
    const suggested = opts.skills?.length ? [] : suggestSkills(prompt, this.skills);
    if (suggested.length) {
      fullPrompt += `\n\n[SwarmCode: skills that look relevant to this request: ${suggested.map((s) => s.name).join(", ")}. Load them with use_skill if they fit.]`;
    }
    const guarantee = opts.guarantee ?? this.cfg.hiddenTests === "always";
    this.audit?.record({ type: "request", mode: guarantee ? "agent+guarantee" : "agent", prompt });
    await this.checkpointCommit();
    const started = Date.now();
    const tokensBefore = this.tokenTotal();
    const costBefore = this.usage.cost() ?? 0;
    const checks: Check[] = [];

    return this.exclusive(async (signal) => {
      this.changes = new Map();
      this.edited = false;
      let text = "";
      try {
        let suite: AcceptanceSuite | undefined;
        if (guarantee) {
          status("Writing hidden acceptance tests from your request (the implementing agent won't see them)...");
          suite = await authorAcceptanceTests({ request: prompt, root: this.root, model: resolveModel(this.cfg, "planner"), effort: this.cfg.effort.planner, events: this.hooks.events, usage: this.usage, signal });
          if (!suite) checks.push({ name: "Hidden acceptance tests", status: "warning", detail: "The test author did not produce tests." });
          else status(`Hidden acceptance tests ready (${suite.files.length} file(s))${suite.failedBefore ? "" : "; note: they already pass on the current code"}.`);
        }

        text = await agent.run(fullPrompt, signal);
        let verify = await this.verifyLoop(agent, signal, status);
        text = verify.text ?? text;

        if (this.cfg.review !== "off" && this.changes.size) {
          const diff = await diffFromSnapshots(this.root, this.changes);
          if (diff && (this.cfg.review === "always" || changedLines(diff) >= REVIEW_MIN_LINES)) {
            status("Reviewing the changes...");
            const review = await reviewChange({ request: prompt, diff, root: this.root, model: resolveModel(this.cfg, "planner"), effort: this.cfg.effort.planner, events: this.hooks.events, usage: this.usage, signal });
            if (review.approved) {
              status("Review passed.");
              checks.push({ name: "Independent review", status: "passed", detail: review.feedback.replace(/^\**LGTM\**\s*/i, "") });
            } else {
              status("The reviewer found issues; the agent is addressing them.");
              this.edited = false;
              text = await agent.run(
                `An independent reviewer checked your changes against the original request and reported:\n\n${review.feedback}\n\n` +
                  "Fix every valid issue. If you disagree with a point, explain why in one sentence instead. Run the relevant tests, then give your final summary.",
                signal,
              );
              verify = await this.verifyLoop(agent, signal, status, verify);
              text = verify.text ?? text;
              checks.push({ name: "Independent review", status: "passed", detail: `Issues found and addressed: ${review.feedback.split("\n").slice(0, 3).join(" ")}` });
            }
          } else checks.push({ name: "Independent review", status: "skipped", detail: diff ? `Small change (under ${REVIEW_MIN_LINES} lines)` : "No diff" });
        }

        // Security gate: findings this request introduced go back to the agent once.
        if (this.cfg.securityGate !== "off" && this.changes.size) {
          const changed = () => [...this.changes].map(([file, before]) => ({ rel: path.relative(this.root, file).split(path.sep).join("/"), before }));
          const found = await introducedFindings(this.root, changed());
          if (found.length) {
            status(`Security gate: ${found.length} new finding(s); the agent is addressing them.`);
            this.edited = false;
            text = await agent.run(GATE_INSTRUCTIONS.replace("{findings}", describeFindings(found)), signal);
            verify = await this.verifyLoop(agent, signal, status, verify);
            text = verify.text ?? text;
            const still = await introducedFindings(this.root, changed());
            status(still.length ? `Security gate: ${still.length} finding(s) remain (the agent says they are false positives or could not fix them).` : "Security gate passed.");
            checks.push(still.length ? { name: "Security gate", status: "warning", detail: `${still.length} finding(s) remain: ${still.map((f) => `${f.file}:${f.line} ${f.title}`).join("; ")}` } : { name: "Security gate", status: "passed", detail: `${found.length} introduced finding(s) fixed` });
          } else checks.push({ name: "Security gate", status: "passed", detail: "No new secrets or high-severity patterns introduced" });
        }

        // Hidden acceptance tests decide whether the work is accepted.
        if (suite) {
          for (let round = 1; ; round++) {
            status("Running hidden acceptance tests...");
            const res = await runAcceptance(suite, this.root, signal);
            if (res.passed) {
              status("Hidden acceptance tests passed.");
              checks.push({ name: "Hidden acceptance tests", status: "passed", detail: suite.summary || `${suite.files.length} file(s)` });
              break;
            }
            if (round > MAX_VERIFY_ROUNDS) {
              status("Hidden acceptance tests still fail.");
              checks.push({ name: "Hidden acceptance tests", status: "failed", detail: failureSummary(res.output).slice(0, 300) });
              break;
            }
            status(`Hidden acceptance tests failed; the agent is fixing it (${round}/${MAX_VERIFY_ROUNDS}).`);
            this.edited = false;
            text = await agent.run(
              `Independent acceptance tests (which you cannot see) checked your work against the original request and failed:\n\n${failureSummary(res.output)}\n\n` +
                "Re-read the original request, find which requirement is not met, and fix the implementation (not by special-casing tests). Then give your final summary.",
              signal,
            );
            verify = await this.verifyLoop(agent, signal, status, verify);
            text = verify.text ?? text;
          }
        }
        if (verify.ran) checks.unshift({ name: `Tests (${this.verifyCommand()})`, status: verify.passed ? "passed" : "failed", detail: verify.passed ? undefined : "Still failing after the fix rounds" });

        this.audit?.record({ type: "result", mode: "agent", summary: text });
        return text;
      } catch (err) {
        this.audit?.record({ type: "error", message: (err as Error).message });
        throw err;
      } finally {
        this.audit?.record({ type: "usage", usage: this.usage.toJSON() });
        if (this.changes.size) {
          this.undoStack.push(this.changes);
          if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
          try {
            const diff = await diffFromSnapshots(this.root, this.changes);
            this.lastProof = saveProof(this.root, {
              id: `${new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14)}-agent`,
              mode: guarantee ? "agent (hidden-test guarantee)" : "agent",
              request: prompt,
              models: [this.cfg.models.main, ...(checks.some((c) => c.name === "Independent review" && c.status !== "skipped") || guarantee ? [this.cfg.models.planner] : [])].filter((m, i, a) => a.indexOf(m) === i),
              startedAt: new Date(started).toISOString(),
              durationMs: Date.now() - started,
              filesChanged: [...this.changes.keys()].map((f) => path.relative(this.root, f).split(path.sep).join("/")),
              linesChanged: changedLines(diff),
              checks,
              summary: text,
              tokens: this.tokenTotal() - tokensBefore,
              costUsd: this.usage.cost() == null ? null : (this.usage.cost() ?? 0) - costBefore,
              tracePath: this.audit?.path ? path.relative(this.root, this.audit.path).split(path.sep).join("/") : undefined,
            });
            status(`Proof report: ${this.lastProof}`);
          } catch {
            /* a proof report must never break the request */
          }
        }
        saveSession(this.root, this.sessionId, agent.exportState());
      }
    });
  }

  /**
   * Record the exact code a request starts from (including uncommitted changes
   * to tracked files) so it can be replayed or forked later.
   */
  private async checkpointCommit() {
    if (!this.isRepo || !this.audit) return;
    try {
      const stash = (await git(this.root, ["stash", "create", "swarmcode checkpoint"])).stdout.trim();
      const commit = stash || (await git(this.root, ["rev-parse", "HEAD"])).stdout.trim();
      if (!commit) return;
      // Keep stash-only commits reachable so git gc can't delete them.
      if (stash) await git(this.root, ["update-ref", `refs/swarmcode/checkpoints/${commit}`, commit]);
      this.audit.record({ type: "checkpoint", commit });
    } catch {
      /* a checkpoint must never block the request */
    }
  }

  /** Repo health radar: risk signals with ready-made fix tasks. */
  health(opts: { runTests?: boolean } = {}): Promise<HealthReport> {
    return healthCheck(this.root, { runTests: opts.runTests, testCommand: this.verifyCommand(), isRepo: this.isRepo });
  }

  /** Forecast tokens, cost and time for each mode, and the best-value pick. */
  async estimate(task: string): Promise<Forecast> {
    const assessment = await assessTask(task, this.root, resolveModel(this.cfg, "explorer"), this.hooks.events, this.usage);
    return forecast(assessment, this.cfg, this.root, this.isRepo, this.opts.budgetUsd ?? this.cfg.budgetUsd);
  }

  /** Autopilot: forecast, show it, then run the best-value mode. */
  async auto(task: string, opts: { guarantee?: boolean; skills?: string[] } = {}): Promise<{ forecast?: Forecast; mode: Mode; text: string }> {
    // Conversation and small requests go straight to the agent: no extra model call.
    if (task.length < 160 || !this.isRepo) return { mode: "agent", text: await this.send(task, opts) };
    const status = (message: string) => this.hooks.events({ type: "status", agent: "swarm", message });
    const f = await this.estimate(task);
    let mode: Mode = f.pick;
    if (mode !== "agent") {
      if (this.hooks.chooseMode && this.cfg.permission !== "auto") mode = await this.hooks.chooseMode(f);
      else for (const line of renderForecast(f).split("\n")) status(line);
    }
    if (mode === "swarm") return { forecast: f, mode, text: (await this.swarm(task, { guarantee: opts.guarantee })).report };
    if (mode === "best") return { forecast: f, mode, text: (await this.bestOf(task, 3, { guarantee: opts.guarantee })).report };
    return { forecast: f, mode, text: await this.send(task, opts) };
  }

  /** Path (relative to the project) of the most recent proof report. */
  lastProof?: string;

  private tokenTotal() {
    const t = this.usage.totals();
    return t.input + t.output + t.cacheRead + t.cacheWrite;
  }

  private verifyCommand() {
    return this.opts.verifyCommand || this.cfg.verifyCommand;
  }

  /**
   * Runs the verify command after edits; failures go back to the agent.
   * Returns the agent's last reply (if it was asked to fix something) and the outcome.
   */
  private async verifyLoop(
    agent: Agent,
    signal: AbortSignal,
    status: (m: string) => void,
    prev: { ran: boolean; passed: boolean } = { ran: false, passed: false },
  ): Promise<{ text?: string; ran: boolean; passed: boolean }> {
    const verifyCmd = this.verifyCommand();
    let text: string | undefined;
    let ran = prev.ran;
    let passed = prev.passed;
    for (let round = 1; verifyCmd && this.edited && round <= MAX_VERIFY_ROUNDS + 1; round++) {
      this.edited = false;
      status(`Verifying: ${verifyCmd}`);
      const r = await runShell(verifyCmd, this.root, 600_000, signal);
      ran = true;
      passed = r.code === 0;
      if (passed) {
        status("Verification passed.");
        break;
      }
      if (round > MAX_VERIFY_ROUNDS) {
        status(`Verification still fails (exit ${r.code}).`);
        break;
      }
      status(`Verification failed (exit ${r.code}); the agent is fixing it (${round}/${MAX_VERIFY_ROUNDS}).`);
      text = await agent.run(
        `The project's verification command \`${verifyCmd}\` fails after your changes:\n\n${clip(r.stdout + "\n" + r.stderr, 15_000)}\n\n` +
          "Re-read the original request, find the cause and fix it. Do not weaken or delete tests. Then give your final summary.",
        signal,
      );
    }
    return { text, ran, passed };
  }

  /** Records a file's original content before the agent first changes it in this request. */
  private checkpoint = (file: string) => {
    if (this.changes.has(file)) return;
    this.changes.set(file, fs.existsSync(file) ? fs.readFileSync(file) : null);
  };

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  /**
   * Restore the files changed by the most recent request to their earlier
   * contents. Covers file edits made through the agent's tools (not shell
   * commands or applied parallel runs). Returns the restored paths.
   */
  undo(): string[] {
    if (this.busy) throw new Error("Stop the running agent first.");
    const last = this.undoStack.pop();
    if (!last) return [];
    const restored: string[] = [];
    for (const [file, original] of last) {
      if (original === null) fs.rmSync(file, { force: true });
      else {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, original);
      }
      restored.push(path.relative(this.root, file).split(path.sep).join("/"));
    }
    return restored;
  }

  /** Always use the parallel pipeline. */
  async swarm(goal: string, opts: { autoApply?: boolean; guarantee?: boolean } = {}): Promise<SwarmResult> {
    const guarantee = opts.guarantee ?? this.cfg.hiddenTests === "always";
    this.audit?.record({ type: "request", mode: guarantee ? "swarm+guarantee" : "swarm", prompt: goal });
    await this.checkpointCommit();
    const started = Date.now();
    const tokensBefore = this.tokenTotal();
    const costBefore = this.usage.cost() ?? 0;
    try {
      const r = await this.exclusive(async (signal) => {
        const acceptance = guarantee ? await this.writeHiddenTests(goal, signal) : undefined;
        return this.runPipeline(goal, signal, Boolean(opts.autoApply), acceptance);
      });
      this.audit?.record({ type: "result", mode: "swarm", summary: r.report });
      if (r.filesChanged.length) {
        this.lastProof = this.writeProof({
          mode: guarantee ? "swarm (hidden-test guarantee)" : "swarm (parallel agents)",
          request: goal,
          models: [this.cfg.models.planner, this.cfg.models.worker, this.cfg.models.main],
          started,
          tokensBefore,
          costBefore,
          filesChanged: r.filesChanged,
          linesChanged: r.linesChanged,
          checks: r.checks,
          summary: r.report,
          extra: r.applied ? "Applied to the working tree." : r.branch ? `Result kept on branch \`${r.branch}\`.` : undefined,
        });
      }
      return r;
    } catch (err) {
      this.audit?.record({ type: "error", message: (err as Error).message });
      throw err;
    } finally {
      this.audit?.record({ type: "usage", usage: this.usage.toJSON() });
    }
  }

  /**
   * Best-of-N: n independent candidates solve the whole task in parallel; the
   * best verified, security-clean one (picked by a judge) is applied.
   */
  async bestOf(goal: string, n = 3, opts: { guarantee?: boolean } = {}): Promise<BestOfResult> {
    if (!this.isRepo) throw new Error("Best-of-N needs a git repository (each candidate works in its own worktree). Run `git init` and commit first.");
    const guarantee = opts.guarantee ?? this.cfg.hiddenTests === "always";
    this.audit?.record({ type: "request", mode: `best-of-${n}${guarantee ? "+guarantee" : ""}`, prompt: goal });
    await this.checkpointCommit();
    const started = Date.now();
    const tokensBefore = this.tokenTotal();
    const costBefore = this.usage.cost() ?? 0;
    try {
      const r = await this.exclusive(async (signal) =>
        runBestOf({
          acceptance: guarantee ? await this.writeHiddenTests(goal, signal) : undefined,
          goal,
          root: this.root,
          cfg: this.cfg,
          n,
          events: this.hooks.events,
          usage: this.usage,
          verifyCommand: this.opts.verifyCommand,
          extraTools: this.mcp?.tools,
          skills: this.skills,
          signal,
          confirmApply: async (report, diff) => {
            this.hooks.showResult?.(report, diff);
            if (this.opts.noApply) return false;
            if (this.cfg.permission === "auto") return true;
            return this.hooks.confirmApply(report, diff);
          },
        }),
      );
      this.audit?.record({ type: "result", mode: `best-of-${n}`, summary: r.report });
      const win = r.candidates.find((c) => c.index === r.winner);
      if (win) {
        this.lastProof = this.writeProof({
          mode: `best-of-${n}${guarantee ? " (hidden-test guarantee)" : ""}`,
          request: goal,
          models: r.candidates.map((c) => c.model).concat(this.cfg.models.planner),
          started,
          tokensBefore,
          costBefore,
          filesChanged: win.files ?? [],
          linesChanged: win.lines,
          checks: [
            { name: "Candidates", status: "passed", detail: `${r.candidates.filter((c) => c.status === "done").length}/${r.candidates.length} produced a result; winner: #${win.index} (${win.model})` },
            { name: "Tests", status: win.verified === undefined ? "skipped" : win.verified ? "passed" : "failed" },
            ...(win.accepted === undefined ? [] : [{ name: "Hidden acceptance tests", status: (win.accepted ? "passed" : "failed") as "passed" | "failed" }]),
            { name: "Security gate", status: win.findings ? "warning" : "passed", detail: win.findings ? `${win.findings} new finding(s)` : "No new secrets or high-severity patterns introduced" },
            { name: "Judge", status: "passed", detail: r.reasoning.replace(/^WINNER:\s*\d+\s*/i, "").slice(0, 300) },
          ],
          summary: r.report,
          extra: r.applied ? "Applied to the working tree." : r.branch ? `Result kept on branch \`${r.branch}\`.` : undefined,
        });
      }
      return r;
    } catch (err) {
      this.audit?.record({ type: "error", message: (err as Error).message });
      throw err;
    } finally {
      this.audit?.record({ type: "usage", usage: this.usage.toJSON() });
    }
  }

  abort() {
    this.controller?.abort();
  }

  newConversation() {
    this.agentInstance?.reset();
    this.sessionId = newSessionId();
  }

  sessions(): SavedSession[] {
    return listSessions(this.root);
  }

  /** Resume a saved session (latest when id is omitted). */
  async resume(id?: string): Promise<SavedSession | undefined> {
    const saved = loadSession(this.root, id);
    if (!saved) return undefined;
    (await this.agent()).importState(saved.state);
    this.sessionId = saved.id;
    return saved;
  }

  /**
   * The visible conversation (user requests and the agent's replies) from the
   * native history, for front ends that display a resumed session.
   */
  transcript(): Array<{ role: "user" | "assistant"; text: string }> {
    const out: Array<{ role: "user" | "assistant"; text: string }> = [];
    if (!this.agentInstance) return [];
    for (const raw of this.agentInstance.exportState().history as Array<{ role?: string; content?: unknown }>) {
      if (raw.role !== "user" && raw.role !== "assistant") continue;
      let text = "";
      if (typeof raw.content === "string") text = raw.content;
      else if (Array.isArray(raw.content)) {
        text = raw.content
          .filter((b): b is { type: string; text: string } => b && typeof b === "object" && b.type === "text" && typeof b.text === "string")
          .map((b) => b.text)
          .join("");
      }
      if (!text.trim() || text.startsWith("[Context was compacted") || text.startsWith("Your context window is nearly full")) continue;
      out.push({ role: raw.role, text });
    }
    return out;
  }

  /** Uncommitted changes in the project (what the main agent has edited). */
  async workingDiff(): Promise<string> {
    if (!this.isRepo) return "";
    const tracked = (await git(this.root, ["diff", "HEAD"])).stdout;
    const untracked = (await git(this.root, ["ls-files", "--others", "--exclude-standard"])).stdout.split("\n").filter(Boolean);
    const added = await Promise.all(
      untracked.slice(0, 50).map(async (f) => (await git(this.root, ["diff", "--no-index", "--", "/dev/null", f])).stdout),
    );
    return [tracked, ...added].filter(Boolean).join("\n");
  }

  async close() {
    this.abort();
    stopProcesses();
    await closeBrowsers();
    await this.mcp?.close();
  }

  // -----------------------------------------------------------------------------

  private async exclusive<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.controller) throw new Error("The agent is already working. Stop it first.");
    this.controller = new AbortController();
    try {
      return await fn(this.controller.signal);
    } finally {
      this.controller = undefined;
    }
  }

  private approve = async (kind: ApprovalKind, summary: string): Promise<boolean> => {
    const allowed = this.cfg.permission === "auto" || this.always.has(kind) ? true : await this.hooks.approve(kind, summary);
    this.audit?.record({ type: "approval", kind, summary, allowed });
    return allowed;
  };

  /** Front ends call this when the user picks "always allow" for a kind. */
  allowAlways(kind: ApprovalKind) {
    this.always.add(kind);
  }

  private async writeHiddenTests(request: string, signal: AbortSignal): Promise<AcceptanceSuite | undefined> {
    const status = (message: string) => this.hooks.events({ type: "status", agent: "swarm", message });
    status("Writing hidden acceptance tests from your request (the implementing agents won't see them)...");
    const suite = await authorAcceptanceTests({ request, root: this.root, model: resolveModel(this.cfg, "planner"), effort: this.cfg.effort.planner, events: this.hooks.events, usage: this.usage, signal });
    status(suite ? `Hidden acceptance tests ready (${suite.files.length} file(s))${suite.failedBefore ? "" : "; note: they already pass on the current code"}.` : "The test author did not produce hidden tests; continuing without them.");
    return suite;
  }

  private writeProof(p: { mode: string; request: string; models: string[]; started: number; tokensBefore: number; costBefore: number; filesChanged: string[]; linesChanged: number; checks: Check[]; summary?: string; extra?: string }): string | undefined {
    try {
      const cost = this.usage.cost();
      const file = saveProof(this.root, {
        id: `${new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14)}-${p.mode.split(" ")[0]}`,
        mode: p.mode,
        request: p.request,
        models: [...new Set(p.models)],
        startedAt: new Date(p.started).toISOString(),
        durationMs: Date.now() - p.started,
        filesChanged: p.filesChanged,
        linesChanged: p.linesChanged,
        checks: p.checks,
        summary: p.summary,
        extra: p.extra,
        tokens: this.tokenTotal() - p.tokensBefore,
        costUsd: cost == null ? null : cost - p.costBefore,
        tracePath: this.audit?.path ? path.relative(this.root, this.audit.path).split(path.sep).join("/") : undefined,
      });
      this.hooks.events({ type: "status", agent: "swarm", message: `Proof report: ${file}` });
      return file;
    } catch {
      return undefined;
    }
  }

  private async runPipeline(goal: string, signal: AbortSignal, autoApply: boolean, acceptance?: AcceptanceSuite): Promise<SwarmResult> {
    if (!this.isRepo) {
      throw new Error("The parallel pipeline needs a git repository (each agent works in its own worktree). Run `git init` and commit first.");
    }
    return runSwarm({
      goal,
      root: this.root,
      cfg: this.cfg,
      usage: this.usage,
      events: this.hooks.events,
      verifyCommand: this.opts.verifyCommand,
      extraTools: this.mcp?.tools,
      skills: this.skills,
      acceptance,
      signal,
      onTaskUpdate: this.hooks.onTasks,
      confirmPlan: async (plan) => (this.cfg.permission === "auto" ? true : this.hooks.confirmPlan(plan)),
      confirmApply: async (report, diff) => {
        this.hooks.showResult?.(report, diff);
        if (this.opts.noApply) return false;
        if (autoApply || this.cfg.permission === "auto") return true;
        return this.hooks.confirmApply(report, diff);
      },
    });
  }

  private async buildMainAgent(): Promise<Agent> {
    const { root, cfg, usage, hooks } = this;
    const map = await buildRepoMap(root, 8000);
    const tools: Tool[] = [
      ...CORE_TOOLS,
      ...(this.mcp?.tools ?? []),
      makeDelegateTool({
        root,
        model: resolveModel(cfg, "explorer"),
        effort: cfg.effort.explorer,
        system: explorerSystemPrompt(root, map),
        events: hooks.events,
        usage,
        maxParallel: cfg.maxParallel,
      }),
    ];
    tools.push(makeRememberTool());
    if (this.skills.length) tools.push(makeSkillTool(this.skills));
    if (this.isRepo) tools.push(this.swarmTool());
    return new Agent({
      name: "swarm",
      model: resolveModel(cfg, "main"),
      effort: cfg.effort.main,
      system: mainSystemPrompt(root, map, loadProjectInstructions(root), this.isRepo, skillIndex(this.skills)),
      tools,
      ctx: { root, approve: this.approve, checkpoint: this.checkpoint },
      events: hooks.events,
      usage,
      maxTurns: cfg.maxTurns,
      compactAt: cfg.compactAt,
    });
  }

  /** Lets the main agent escalate big tasks to the parallel pipeline on its own. */
  private swarmTool(): Tool {
    return {
      readOnly: false,
      spec: {
        name: "swarm",
        description:
          "Hand a large task to the parallel pipeline: a planner splits it into independent tasks, several engineer agents implement them at the same time in isolated git worktrees, their work is merged, verified and applied to the working tree. Use it when the work is big and splits into mostly independent parts (several features, modules or layers). Do NOT use it for small or tightly coupled changes; do those yourself, it is faster. Returns a report of what was done.",
        parameters: {
          type: "object",
          properties: {
            goal: {
              type: "string",
              description: "Complete, self-contained description of the work, including every requirement and the relevant context you have gathered",
            },
          },
          required: ["goal"],
        },
      },
      run: async (input, ctx) => {
        const goal = String(input.goal);
        if (!(await ctx.approve("swarm", goal))) throw new ToolError("User declined the parallel run.");
        const r = await this.runPipeline(goal, ctx.signal ?? new AbortController().signal, true);
        return `${r.report}\n\n${r.applied ? "The changes are applied to the working tree." : r.branch ? `Not applied; the result is on branch ${r.branch}.` : ""}`;
      },
    };
  }
}

export type { SwarmResult, TaskState, Plan, ApprovalKind, BestOfResult };
