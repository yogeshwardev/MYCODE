import path from "node:path";
import { Agent } from "../agent/agent.js";
import { BudgetExceededError, type EventSink, type UsageTracker } from "../agent/events.js";
import { explorerSystemPrompt, plannerSystemPrompt, resolverSystemPrompt, workerSystemPrompt } from "../agent/prompts.js";
import { describeFindings, GATE_INSTRUCTIONS, introducedFindings, type ChangedFile } from "../agent/gate.js";
import { changedLines, reviewChange } from "../agent/review.js";
import { failureSummary, runAcceptance, type AcceptanceSuite } from "../quality/acceptance.js";
import type { Check } from "../quality/proof.js";
import { makeDelegateTool } from "../agent/subagents.js";
import { makeSkillTool, skillIndex, suggestSkills, type Skill } from "../skills.js";
import { resolveModel, resolveSpec, type SwarmCodeConfig } from "../config.js";
import type { ModelHandle } from "../providers/types.js";
import { buildRepoMap, loadProjectInstructions } from "../repo/repomap.js";
import { closeBrowsers } from "../tools/browser.js";
import { CORE_TOOLS, type Tool } from "../tools/index.js";
import { stopProcesses } from "../tools/processes.js";
import { clip, Mutex, runShell, type ExecResult } from "../util.js";
import {
  addWorktree,
  applyToWorkingTree,
  commitAll,
  excludeSwarmCodeDir,
  filesWithMarkers,
  git,
  gitOk,
  mergeBranch,
  removeWorktree,
  snapshotBase,
} from "./git.js";
import { makePlan, type Plan, type PlanTask } from "./planner.js";

export type TaskStatus = "pending" | "running" | "done" | "failed" | "skipped";

export interface TaskState {
  task: PlanTask;
  status: TaskStatus;
  report?: string;
  error?: string;
  changed?: boolean;
  /** Model that produced the final result (differs from the worker model after an escalation). */
  model?: string;
  startedAt?: number;
  endedAt?: number;
}

export interface SwarmOptions {
  goal: string;
  root: string;
  cfg: SwarmCodeConfig;
  events: EventSink;
  usage: UsageTracker;
  verifyCommand?: string;
  /** Extra tools (e.g. from MCP servers) for every worker. */
  extraTools?: Tool[];
  /** Expert playbooks workers can load. */
  skills?: Skill[];
  /** Hidden acceptance tests the merged result must pass (written before any worker starts). */
  acceptance?: AcceptanceSuite;
  /** Return false to stop before any code is written. */
  confirmPlan?: (plan: Plan) => Promise<boolean>;
  /** Return true to apply the result to the user's working tree. Receives the report and the full diff. */
  confirmApply?: (report: string, diff: string) => Promise<boolean>;
  onTaskUpdate?: (states: TaskState[]) => void;
  signal?: AbortSignal;
}

export interface SwarmResult {
  runId: string;
  branch?: string;
  plan?: Plan;
  tasks: TaskState[];
  verifyCommand?: string;
  verified?: boolean;
  applied: boolean;
  report: string;
  /** Unified diff of everything the run changed. */
  diffStat?: string;
  /** Outcome of every quality gate, for the proof report. */
  checks: Check[];
  filesChanged: string[];
  linesChanged: number;
}

const MAX_FIX_ATTEMPTS = 2;

/**
 * The multi-agent pipeline:
 *   plan -> parallel workers in isolated worktrees -> merge each branch as it
 *   finishes (agent-resolved conflicts) -> verify and auto-fix -> apply.
 * Dependent tasks start from the merged result of the tasks they depend on.
 */
export async function runSwarm(opts: SwarmOptions): Promise<SwarmResult> {
  const { root, cfg, events, usage, signal } = opts;
  const status = (message: string) => events({ type: "status", agent: "swarm", message });
  const runId = new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 17);
  const runDir = path.join(root, ".swarmcode", "worktrees", runId);
  excludeSwarmCodeDir(root);

  const snap = await snapshotBase(root);
  if (snap.dirty) status("Including your uncommitted changes in the starting point.");
  if (snap.untracked.length) {
    status(`${snap.untracked.length} untracked file(s) are not visible to agents (commit or git add them to include).`);
  }

  // ---- Plan -------------------------------------------------------------
  const instructions = loadProjectInstructions(root);
  const explorer = resolveModel(cfg, "explorer");
  const delegateFor = (dir: string, map: string) =>
    makeDelegateTool({
      root: dir,
      model: explorer,
      effort: cfg.effort.explorer,
      system: explorerSystemPrompt(dir, map),
      events,
      usage,
      maxParallel: cfg.maxParallel,
    });

  status("Planning...");
  const rootMap = await buildRepoMap(root, 10_000);
  const plan = await makePlan({
    goal: opts.goal,
    root,
    model: resolveModel(cfg, "planner"),
    effort: cfg.effort.planner,
    system: plannerSystemPrompt(root, rootMap, instructions, cfg.maxParallel),
    events,
    usage,
    extraTools: [delegateFor(root, rootMap)],
    council: cfg.councilModels.map((m) => resolveSpec(cfg, m)),
    signal,
  });
  const states: TaskState[] = plan.tasks.map((task) => ({ task, status: "pending" }));
  if (opts.confirmPlan && !(await opts.confirmPlan(plan))) {
    return { runId, plan, tasks: states, applied: false, report: "Plan not approved; nothing was changed.", checks: [], filesChanged: [], linesChanged: 0 };
  }

  const branch = `swarm/${runId}`;
  const integrationDir = path.join(runDir, "_integration");
  const baselineDir = path.join(runDir, "_baseline");
  const verifyCmd = opts.verifyCommand || cfg.verifyCommand || plan.verify_command;
  const workerModel = resolveModel(cfg, "worker");
  const leadModel = resolveModel(cfg, "main");
  const extra = opts.extraTools ?? [];
  const skills = opts.skills ?? [];
  const skillTools = skills.length ? [makeSkillTool(skills)] : [];
  const update = () => opts.onTaskUpdate?.(states);
  let halted: string | undefined;

  const baselineAbort = new AbortController();
  signal?.addEventListener("abort", () => baselineAbort.abort());
  let baseline: Promise<ExecResult | undefined> = Promise.resolve(undefined);

  await addWorktree(root, integrationDir, branch, snap.base);
  try {
    // Run the verify command on the untouched code while the agents work, so
    // the fixer later knows which failures were already there. Costs no time.
    baseline = verifyCmd
      ? (async () => {
          await gitOk(root, ["worktree", "add", "--detach", baselineDir, snap.base]);
          try {
            return await runShell(verifyCmd, baselineDir, 600_000, baselineAbort.signal);
          } finally {
            await removeWorktree(root, baselineDir).catch(() => undefined);
          }
        })().catch(() => undefined)
      : Promise.resolve(undefined);

    // ---- Merge ------------------------------------------------------------
    const mergeLock = new Mutex();
    const mergeTask = async (t: PlanTask, taskBranch: string) => {
      const merged = await mergeBranch(integrationDir, taskBranch, `swarm: merge ${t.id} (${t.title})`);
      if (merged.ok) return;
      status(`Merge conflict in ${merged.conflicts.join(", ")}; resolving...`);
      const resolver = new Agent({
        name: `merge:${t.id}`,
        model: leadModel,
        effort: cfg.effort.main,
        system: resolverSystemPrompt(integrationDir),
        tools: CORE_TOOLS,
        ctx: { root: integrationDir, approve: async () => true, signal },
        events,
        usage,
        maxTurns: 60,
      });
      try {
        await resolver.run(
          `Merging task "${t.id}" (${t.title}) produced conflicts in:\n${merged.conflicts.map((f) => `- ${f}`).join("\n")}\n\n` +
            `Task brief for context:\n${t.description}\n\nOverall plan:\n${plan.summary}`,
          signal,
        );
        const left = await filesWithMarkers(integrationDir, merged.conflicts);
        if (left.length) throw new Error(`Could not resolve merge conflicts in ${left.join(", ")}`);
        await gitOk(integrationDir, ["add", "-A"]);
        await gitOk(integrationDir, ["commit", "-q", "--no-edit"]);
      } catch (err) {
        await git(integrationDir, ["merge", "--abort"]);
        throw err;
      }
    };

    // ---- Work ----------------------------------------------------------------
    // The cheaper worker model goes first; if it fails, the task is retried
    // once from scratch with the lead model. Most tasks finish cheaply, and the
    // hard ones still get done.
    const attempts: ModelHandle[] = workerModel.spec === leadModel.spec ? [workerModel] : [workerModel, leadModel];

    const runTask = async (st: TaskState) => {
      const t = st.task;
      st.status = "running";
      st.startedAt = Date.now();
      update();
      const dir = path.join(runDir, t.id);
      const taskBranch = `${branch}-${t.id}`;
      try {
        // Start from the current integration head, which already contains the
        // merged work of every task this one depends on.
        const from = await gitOk(integrationDir, ["rev-parse", "HEAD"]);
        await addWorktree(root, dir, taskBranch, from);
        const map = await buildRepoMap(dir, 6000);
        for (const [i, model] of attempts.entries()) {
          const last = i === attempts.length - 1;
          if (i > 0) {
            status(`${t.id}: retrying with ${model.spec}`);
            await gitOk(dir, ["reset", "-q", "--hard", from]);
            await gitOk(dir, ["clean", "-q", "-fd"]);
          }
          try {
            const worker = new Agent({
              name: t.id,
              model,
              effort: i === 0 ? cfg.effort.worker : cfg.effort.main,
              system: workerSystemPrompt(dir, map, instructions, skillIndex(skills)),
              tools: [...CORE_TOOLS, ...extra, ...skillTools, delegateFor(dir, map)],
              ctx: { root: dir, approve: async () => true, signal },
              events,
              usage,
              maxTurns: cfg.maxTurns,
              compactAt: cfg.compactAt,
            });
            const hints = suggestSkills(`${t.title} ${t.description}`, skills);
            const brief = taskPrompt(opts.goal, plan, t, states, verifyCmd) + (hints.length ? `\n\n[Relevant skills: ${hints.map((s) => s.name).join(", ")}. Load with use_skill if they fit.]` : "");
            st.report = await worker.run(brief, signal);
            st.model = model.spec;
            if (/\[Stopped after \d+ tool rounds/.test(st.report) && !last) continue;
            break;
          } catch (err) {
            if (last || signal?.aborted || err instanceof BudgetExceededError) throw err;
            status(`${t.id}: ${(err as Error).message.split("\n")[0]}`);
          }
        }
        st.changed = await commitAll(dir, `swarm(${t.id}): ${t.title}`);
        if (st.changed) await mergeLock.run(() => mergeTask(t, taskBranch));
        st.status = "done";
      } catch (err) {
        st.status = "failed";
        st.error = (err as Error).message.split("\n")[0];
        if (err instanceof BudgetExceededError) halted = st.error;
      } finally {
        st.endedAt = Date.now();
        stopProcesses(dir);
        await closeBrowsers(dir);
        await removeWorktree(root, dir).catch(() => undefined);
        await git(root, ["branch", "-D", taskBranch]);
        update();
      }
    };

    // ---- Schedule -------------------------------------------------------------
    status(`Running ${plan.tasks.length} task(s), up to ${cfg.maxParallel} in parallel.`);
    const running = new Map<string, Promise<void>>();
    const byId = new Map(states.map((s) => [s.task.id, s]));
    for (;;) {
      for (const st of states) {
        if (st.status !== "pending") continue;
        const deps = st.task.depends_on.map((d) => byId.get(d)!);
        const blocked = deps.find((d) => d.status === "failed" || d.status === "skipped");
        if (halted || signal?.aborted || blocked) {
          st.status = "skipped";
          st.error = halted ?? (signal?.aborted ? "cancelled" : `dependency ${blocked!.task.id} did not complete`);
          update();
        } else if (deps.every((d) => d.status === "done") && running.size < cfg.maxParallel) {
          running.set(st.task.id, runTask(st).finally(() => running.delete(st.task.id)));
        }
      }
      if (!running.size) break;
      await Promise.race(running.values());
    }

    // ---- Verify & fix -----------------------------------------------------------
    let verified: boolean | undefined;
    const checks: Check[] = [];
    const failedTasks = states.filter((s) => s.status !== "done");
    checks.push(
      failedTasks.length
        ? { name: "Parallel tasks", status: "failed", detail: failedTasks.map((s) => `${s.task.id}: ${s.error ?? s.status}`).join("; ") }
        : { name: "Parallel tasks", status: "passed", detail: `${states.length} task(s) done and merged` },
    );
    const anyChanged = states.some((s) => s.status === "done" && s.changed);
    if (verifyCmd && anyChanged && !signal?.aborted && !halted) {
      for (let attempt = 0; ; attempt++) {
        status(`Verifying: ${verifyCmd}`);
        const r = await runShell(verifyCmd, integrationDir, 600_000, signal);
        verified = r.code === 0;
        if (verified) {
          status("Verification passed.");
          break;
        }
        const before = await baseline;
        if (attempt >= MAX_FIX_ATTEMPTS) {
          status("Verification still failing; leaving the result for you to review.");
          break;
        }
        status(`Verification failed (exit ${r.code}); a fixer agent is on it (attempt ${attempt + 1}/${MAX_FIX_ATTEMPTS}).`);
        const fixer = new Agent({
          name: "fixer",
          model: leadModel,
          effort: cfg.effort.main,
          system: workerSystemPrompt(integrationDir, await buildRepoMap(integrationDir, 6000), instructions),
          tools: [...CORE_TOOLS, ...extra],
          ctx: { root: integrationDir, approve: async () => true, signal },
          events,
          usage,
          maxTurns: cfg.maxTurns,
          compactAt: cfg.compactAt,
        });
        const baselineNote =
          before === undefined
            ? ""
            : before.code === 0
              ? "\n\nThe same command PASSED on the code before these changes, so every failure was introduced by this run."
              : `\n\nThe same command ALSO FAILED before these changes (exit ${before.code}). Only fix failures introduced by this run; leave pre-existing ones alone and say which they are. Output before the changes:\n\n${clip(before.stdout + "\n" + before.stderr, 6000)}`;
        await fixer.run(
          `Several engineers just implemented this goal in parallel and their work was merged:\n${opts.goal}\n\n` +
            `Plan:\n${plan.summary}\n\nThe verification command \`${verifyCmd}\` fails:\n\n${clip(r.stdout + "\n" + r.stderr, 20_000)}${baselineNote}\n\n` +
            `Find the root cause and fix it so the command passes. Do not weaken or delete tests to make them pass.`,
          signal,
        );
        await commitAll(integrationDir, "swarm: fix verification failures");
        if (before && before.code !== 0 && attempt === 0) {
          // The command can't go green if it was red before; one targeted fix pass is enough.
          const again = await runShell(verifyCmd, integrationDir, 600_000, signal);
          verified = again.code === 0;
          break;
        }
      }
    }

    // ---- Independent review ---------------------------------------------------------
    // A fresh reviewer checks the merged result against the goal; real issues
    // go to a fixer, and the verify command runs again afterwards.
    if (cfg.review !== "off" && anyChanged && !signal?.aborted && !halted) {
      const diff = (await git(integrationDir, ["diff", snap.base, "HEAD"])).stdout;
      if (diff && (cfg.review === "always" || changedLines(diff) >= 15)) {
        status("Reviewing the combined changes...");
        const review = await reviewChange({
          request: opts.goal,
          diff,
          root: integrationDir,
          model: resolveModel(cfg, "planner"),
          effort: cfg.effort.planner,
          events,
          usage,
          signal,
        });
        checks.push({ name: "Independent review", status: "passed", detail: review.approved ? review.feedback.replace(/^\**LGTM\**\s*/i, "") : `Issues found and addressed: ${review.feedback.split("\n").slice(0, 3).join(" ")}` });
        if (review.approved) status("Review passed.");
        else {
          status("The reviewer found issues; a fixer agent is addressing them.");
          const fixer = new Agent({
            name: "review-fixer",
            model: leadModel,
            effort: cfg.effort.main,
            system: workerSystemPrompt(integrationDir, await buildRepoMap(integrationDir, 6000), instructions, skillIndex(skills)),
            tools: [...CORE_TOOLS, ...extra, ...skillTools],
            ctx: { root: integrationDir, approve: async () => true, signal },
            events,
            usage,
            maxTurns: cfg.maxTurns,
            compactAt: cfg.compactAt,
          });
          await fixer.run(
            `Several engineers implemented this goal in parallel and their work was merged:\n${opts.goal}\n\n` +
              `An independent reviewer checked the combined diff and reported:\n\n${review.feedback}\n\n` +
              "Fix every valid issue (briefly explain any you disagree with). Run the relevant tests.",
            signal,
          );
          await commitAll(integrationDir, "swarm: address review findings");
          if (verifyCmd) {
            status(`Verifying: ${verifyCmd}`);
            verified = (await runShell(verifyCmd, integrationDir, 600_000, signal)).code === 0;
            status(verified ? "Verification passed." : "Verification fails after the review fixes; leaving the result for you to review.");
          }
        }
      }
    }

    // ---- Security gate ----------------------------------------------------------------
    // Findings the combined change introduced (not pre-existing ones) go to a fixer once.
    if (cfg.securityGate !== "off" && anyChanged && !signal?.aborted && !halted) {
      const changedFiles = async (): Promise<ChangedFile[]> => {
        const names = (await git(integrationDir, ["diff", "--name-only", snap.base, "HEAD"])).stdout.split("\n").filter(Boolean);
        const out: ChangedFile[] = [];
        for (const rel of names) {
          const shown = await git(integrationDir, ["show", `${snap.base}:${rel}`]);
          out.push({ rel, before: shown.code === 0 ? shown.stdout : null });
        }
        return out;
      };
      const found = await introducedFindings(integrationDir, await changedFiles());
      if (found.length) {
        status(`Security gate: ${found.length} new finding(s); a fixer agent is addressing them.`);
        const fixer = new Agent({
          name: "security-fixer",
          model: leadModel,
          effort: cfg.effort.main,
          system: workerSystemPrompt(integrationDir, await buildRepoMap(integrationDir, 6000), instructions, skillIndex(skills)),
          tools: [...CORE_TOOLS, ...extra, ...skillTools],
          ctx: { root: integrationDir, approve: async () => true, signal },
          events,
          usage,
          maxTurns: cfg.maxTurns,
          compactAt: cfg.compactAt,
        });
        await fixer.run(`Goal of this change:\n${opts.goal}\n\n${GATE_INSTRUCTIONS.replace("{findings}", describeFindings(found))}`, signal);
        await commitAll(integrationDir, "swarm: address security gate findings");
        const still = await introducedFindings(integrationDir, await changedFiles());
        status(still.length ? `Security gate: ${still.length} finding(s) remain; review them before applying.` : "Security gate passed.");
        checks.push(still.length ? { name: "Security gate", status: "warning", detail: still.map((f) => `${f.file}:${f.line} ${f.title}`).join("; ") } : { name: "Security gate", status: "passed", detail: `${found.length} introduced finding(s) fixed` });
        if (verifyCmd) verified = (await runShell(verifyCmd, integrationDir, 600_000, signal)).code === 0;
      } else checks.push({ name: "Security gate", status: "passed", detail: "No new secrets or high-severity patterns introduced" });
    }

    // ---- Hidden acceptance tests -------------------------------------------------------
    if (opts.acceptance && anyChanged && !signal?.aborted && !halted) {
      for (let round = 1; ; round++) {
        status("Running hidden acceptance tests...");
        const res = await runAcceptance(opts.acceptance, integrationDir, signal);
        if (res.passed) {
          status("Hidden acceptance tests passed.");
          checks.push({ name: "Hidden acceptance tests", status: "passed", detail: opts.acceptance.summary });
          break;
        }
        if (round > MAX_FIX_ATTEMPTS) {
          status("Hidden acceptance tests still fail.");
          checks.push({ name: "Hidden acceptance tests", status: "failed", detail: failureSummary(res.output).slice(0, 300) });
          break;
        }
        status(`Hidden acceptance tests failed; a fixer agent is on it (${round}/${MAX_FIX_ATTEMPTS}).`);
        const fixer = new Agent({
          name: "acceptance-fixer",
          model: leadModel,
          effort: cfg.effort.main,
          system: workerSystemPrompt(integrationDir, await buildRepoMap(integrationDir, 6000), instructions, skillIndex(skills)),
          tools: [...CORE_TOOLS, ...extra, ...skillTools],
          ctx: { root: integrationDir, approve: async () => true, signal },
          events,
          usage,
          maxTurns: cfg.maxTurns,
          compactAt: cfg.compactAt,
        });
        await fixer.run(
          `Several engineers implemented this goal in parallel and their work was merged:\n${opts.goal}\n\n` +
            `Independent acceptance tests (which you cannot see) failed:\n\n${failureSummary(res.output)}\n\n` +
            "Find which requirement is not met and fix the implementation (not by special-casing tests). Run the project's tests.",
          signal,
        );
        await commitAll(integrationDir, "swarm: meet hidden acceptance tests");
      }
    }
    if (verifyCmd) checks.splice(1, 0, { name: `Tests (${verifyCmd})`, status: verified === undefined ? "skipped" : verified ? "passed" : "failed" });

    // ---- Report & apply -----------------------------------------------------------
    const head = await gitOk(integrationDir, ["rev-parse", "HEAD"]);
    const stat = head !== snap.base ? await gitOk(root, ["diff", "--stat", snap.base, head]) : "";
    const report = buildReport(states, stat, verifyCmd, verified, branch, halted);
    let applied = false;
    const diff = stat ? clip((await git(root, ["diff", snap.base, head])).stdout, 2_000_000) : "";
    if (stat && opts.confirmApply && !signal?.aborted && (await opts.confirmApply(report, diff))) {
      await applyToWorkingTree(root, snap.base, head, path.join(root, ".swarmcode", "runs", `${runId}.patch`));
      applied = true;
      status("Changes applied to your working tree.");
    }
    const filesChanged = stat ? (await git(root, ["diff", "--name-only", snap.base, head])).stdout.split("\n").filter(Boolean) : [];
    return { runId, branch: stat ? branch : undefined, plan, tasks: states, verifyCommand: verifyCmd, verified, applied, report, diffStat: stat || undefined, checks, filesChanged, linesChanged: changedLines(diff) };
  } finally {
    baselineAbort.abort();
    await baseline;
    await removeWorktree(root, integrationDir).catch(() => undefined);
    if (!(await git(root, ["rev-parse", "--verify", "-q", branch]).then((r) => r.stdout.trim() !== snap.base))) {
      // Nothing was produced: don't leave an empty branch behind.
      await git(root, ["branch", "-D", branch]);
    }
  }
}

function taskPrompt(goal: string, plan: Plan, t: PlanTask, states: TaskState[], verifyCmd?: string): string {
  const others = plan.tasks
    .filter((o) => o.id !== t.id)
    .map((o) => `- ${o.id}: ${o.title}${o.files.length ? ` (files: ${o.files.join(", ")})` : ""}`)
    .join("\n");
  const deps = t.depends_on
    .map((d) => states.find((s) => s.task.id === d))
    .filter((s): s is TaskState => Boolean(s))
    .map((s) => `### ${s.task.id}: ${s.task.title}\n${clip(s.report ?? "(no report)", 4000)}`)
    .join("\n\n");
  return `# Overall goal
${goal}

# Plan (shared by every engineer)
${plan.summary}

# Other tasks, handled by other engineers in parallel. Don't do their work.
${others || "(none)"}
${deps ? `\n# Finished tasks you build on (already merged into your starting code)\n${deps}\n` : ""}
# YOUR TASK: ${t.id} - ${t.title}
${t.description}
${t.files.length ? `\nFiles you own: ${t.files.join(", ")}` : ""}${verifyCmd ? `\n\nOnce all tasks are merged, the project must pass \`${verifyCmd}\`. Run it (or the part relevant to you) before you finish.` : ""}`;
}

function buildReport(
  states: TaskState[],
  stat: string,
  verifyCmd: string | undefined,
  verified: boolean | undefined,
  branch: string,
  halted: string | undefined,
): string {
  const icon: Record<TaskStatus, string> = { done: "✔", failed: "✖", skipped: "⊘", running: "…", pending: "·" };
  const lines = states.map((s) => {
    const secs = s.startedAt && s.endedAt ? ` (${Math.round((s.endedAt - s.startedAt) / 1000)}s)` : "";
    const why = s.error ? `: ${s.error}` : s.status === "done" && !s.changed ? ": no file changes" : "";
    return `${icon[s.status]} ${s.task.id}: ${s.task.title}${secs}${why}`;
  });
  if (halted) lines.push("", `Stopped early: ${halted}`);
  if (verifyCmd) lines.push("", `Verification (${verifyCmd}): ${verified === undefined ? "not run" : verified ? "passed" : "FAILED"}`);
  if (stat) lines.push("", stat, "", `Result branch: ${branch}`);
  else lines.push("", "No file changes were produced.");
  return lines.join("\n");
}
