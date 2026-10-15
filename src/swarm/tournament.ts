import path from "node:path";
import { Agent } from "../agent/agent.js";
import type { EventSink, UsageTracker } from "../agent/events.js";
import { describeFindings, introducedFindings, type ChangedFile } from "../agent/gate.js";
import { explorerSystemPrompt, workerSystemPrompt } from "../agent/prompts.js";
import { changedLines } from "../agent/review.js";
import { runAcceptance, type AcceptanceSuite } from "../quality/acceptance.js";
import { makeDelegateTool } from "../agent/subagents.js";
import { resolveModel, resolveSpec, type SwarmCodeConfig } from "../config.js";
import { buildRepoMap, loadProjectInstructions } from "../repo/repomap.js";
import { makeSkillTool, skillIndex, type Skill } from "../skills.js";
import { closeBrowsers } from "../tools/browser.js";
import { CORE_TOOLS, READ_ONLY_TOOLS, type Tool } from "../tools/index.js";
import { stopProcesses } from "../tools/processes.js";
import { clip, runShell } from "../util.js";
import { addWorktree, applyToWorkingTree, commitAll, excludeSwarmCodeDir, git, gitOk, removeWorktree, snapshotBase } from "./git.js";

// Best-of-N: several independent agents (optionally on different models)
// each solve the whole task in their own worktree. Every candidate is graded
// on the same evidence (verify command, security findings it introduced, size
// of the change), a judge compares the strongest ones, and only the winner is
// applied. Spend N times the tokens to get the most reliable result.

export interface BestOfOptions {
  goal: string;
  root: string;
  cfg: SwarmCodeConfig;
  n: number;
  events: EventSink;
  usage: UsageTracker;
  verifyCommand?: string;
  extraTools?: Tool[];
  skills?: Skill[];
  /** Hidden acceptance tests every candidate is graded against. */
  acceptance?: AcceptanceSuite;
  /** Receives the report and the winner's diff; return true to apply it. */
  confirmApply?: (report: string, diff: string) => Promise<boolean>;
  signal?: AbortSignal;
}

export interface Candidate {
  index: number;
  model: string;
  status: "done" | "failed";
  verified?: boolean;
  /** Passed the hidden acceptance tests (undefined when there are none). */
  accepted?: boolean;
  findings: number;
  files?: string[];
  lines: number;
  seconds: number;
  branch: string;
  report?: string;
  error?: string;
  diff?: string;
}

export interface BestOfResult {
  runId: string;
  candidates: Candidate[];
  winner?: number;
  reasoning: string;
  applied: boolean;
  branch?: string;
  report: string;
}

export async function runBestOf(opts: BestOfOptions): Promise<BestOfResult> {
  const { root, cfg, events, usage, signal } = opts;
  const n = Math.max(2, Math.min(8, Math.round(opts.n)));
  const status = (message: string) => events({ type: "status", agent: "swarm", message });
  const runId = new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 17);
  const runDir = path.join(root, ".swarmcode", "worktrees", runId);
  excludeSwarmCodeDir(root);
  const snap = await snapshotBase(root);
  const verifyCmd = opts.verifyCommand || cfg.verifyCommand;
  const instructions = loadProjectInstructions(root);
  const skills = opts.skills ?? [];
  const specs = cfg.bestOfModels.length ? cfg.bestOfModels : [cfg.models.main];
  const candidates: Candidate[] = Array.from({ length: n }, (_, i) => ({
    index: i + 1,
    model: specs[i % specs.length],
    status: "failed",
    findings: 0,
    lines: 0,
    seconds: 0,
    branch: `swarm/${runId}-c${i + 1}`,
  }));
  status(`Running ${n} independent candidates${specs.length > 1 ? ` on ${[...new Set(candidates.map((c) => c.model.split("/").pop()))].join(", ")}` : ""}; the best verified result wins.`);

  const dirs: string[] = [];
  let keepBranch: string | undefined;
  const runOne = async (c: Candidate) => {
    const dir = path.join(runDir, `c${c.index}`);
    dirs.push(dir);
    const started = Date.now();
    try {
      await addWorktree(root, dir, c.branch, snap.base);
      const map = await buildRepoMap(dir, 6000);
      const agent = new Agent({
        name: `candidate-${c.index}`,
        model: resolveSpec(cfg, c.model),
        effort: cfg.effort.main,
        system: workerSystemPrompt(dir, map, instructions, skillIndex(skills)),
        tools: [
          ...CORE_TOOLS,
          ...(opts.extraTools ?? []),
          ...(skills.length ? [makeSkillTool(skills)] : []),
          makeDelegateTool({ root: dir, model: resolveModel(cfg, "explorer"), effort: cfg.effort.explorer, system: explorerSystemPrompt(dir, map), events, usage, maxParallel: 2 }),
        ],
        ctx: { root: dir, approve: async () => true, signal },
        events,
        usage,
        maxTurns: cfg.maxTurns,
        compactAt: cfg.compactAt,
      });
      c.report = await agent.run(
        `# YOUR TASK (you are working alone on the complete task)\n${opts.goal}` +
          (verifyCmd ? `\n\nThe project must pass \`${verifyCmd}\` when you are done. Run it before you finish.` : ""),
        signal,
      );
      await commitAll(dir, `best-of candidate ${c.index}`);
      c.diff = (await git(dir, ["diff", snap.base, "HEAD"])).stdout;
      c.lines = changedLines(c.diff);
      if (verifyCmd && c.lines) c.verified = (await runShell(verifyCmd, dir, 600_000, signal)).code === 0;
      if (opts.acceptance && c.lines) c.accepted = (await runAcceptance(opts.acceptance, dir, signal)).passed;
      const names = (await git(dir, ["diff", "--name-only", snap.base, "HEAD"])).stdout.split("\n").filter(Boolean);
      c.files = names;
      const files: ChangedFile[] = [];
      for (const rel of names) {
        const shown = await git(dir, ["show", `${snap.base}:${rel}`]);
        files.push({ rel, before: shown.code === 0 ? shown.stdout : null });
      }
      c.findings = (await introducedFindings(dir, files)).length;
      c.status = c.lines ? "done" : "failed";
      if (!c.lines) c.error = "made no changes";
    } catch (err) {
      c.error = (err as Error).message.split("\n")[0].slice(0, 160);
    } finally {
      c.seconds = Math.round((Date.now() - started) / 1000);
      status(`Candidate ${c.index} (${c.model.split("/").pop()}): ${c.status === "done" ? `${c.lines} lines changed${c.verified === undefined ? "" : c.verified ? ", verification passed" : ", verification FAILED"}${c.accepted === undefined ? "" : c.accepted ? ", hidden tests passed" : ", hidden tests FAILED"}${c.findings ? `, ${c.findings} new security finding(s)` : ""}` : `failed (${c.error})`}`);
    }
  };

  try {
    // Run candidates concurrently, at most maxParallel at a time.
    const queue = [...candidates];
    await Promise.all(
      Array.from({ length: Math.min(cfg.maxParallel, n) }, async () => {
        for (let c = queue.shift(); c; c = queue.shift()) await runOne(c);
      }),
    );
    if (signal?.aborted) throw new Error("Aborted");

    // Grade: verified beats unverified, fewer new security findings beats more.
    const done = candidates.filter((c) => c.status === "done");
    const score = (c: Candidate) => (c.accepted === false ? 4 : 0) + (c.verified === false ? 2 : 0) + (c.findings ? 1 : 0);
    const best = Math.min(...done.map(score));
    const finalists = done.filter((c) => score(c) === best);
    let winner: Candidate | undefined;
    let reasoning = "";
    if (finalists.length === 1) {
      winner = finalists[0];
      reasoning = "Only candidate in the top tier (verification and security).";
    } else if (finalists.length > 1) {
      status(`Judging ${finalists.length} finalists...`);
      const judge = new Agent({
        name: "judge",
        model: resolveModel(cfg, "planner"),
        effort: cfg.effort.planner,
        system:
          "You are a principal engineer choosing the best of several independent implementations of the same task. Judge correctness against every requirement first, then robustness (edge cases, error handling), security, fit with the existing codebase, and simplicity. Use the read-only tools to inspect the code if needed. Answer with the first line exactly `WINNER: <number>`, followed by a short justification comparing the candidates.",
        tools: READ_ONLY_TOOLS.filter((t) => t.spec.name !== "web_fetch"),
        ctx: { root, approve: async () => true, signal },
        events,
        usage,
        maxTurns: 20,
      });
      const budget = Math.floor(90_000 / finalists.length);
      reasoning = (
        await judge.run(
          `<task>\n${clip(opts.goal, 10_000)}\n</task>\n\n` +
            finalists
              .map(
                (c) =>
                  `<candidate number="${c.index}" model="${c.model}" verification="${c.verified === undefined ? "not run" : c.verified ? "passed" : "failed"}" hidden_acceptance_tests="${c.accepted === undefined ? "none" : c.accepted ? "passed" : "failed"}" new_security_findings="${c.findings}" changed_lines="${c.lines}">\n<agent_report>\n${clip(c.report ?? "", 3000)}\n</agent_report>\n<diff>\n${clip(c.diff ?? "", budget)}\n</diff>\n</candidate>`,
              )
              .join("\n\n"),
          signal,
        )
      ).trim();
      const picked = Number(/WINNER:\s*(\d+)/i.exec(reasoning)?.[1]);
      winner = finalists.find((c) => c.index === picked) ?? finalists.sort((a, b) => a.lines - b.lines)[0];
    }

    keepBranch = winner?.branch;
    const table = candidates
      .map(
        (c) =>
          `${c === winner ? "★" : c.status === "done" ? "·" : "✖"} candidate ${c.index} (${c.model}): ${c.status === "done" ? `${c.lines} lines, verify ${c.verified === undefined ? "n/a" : c.verified ? "passed" : "FAILED"}${c.accepted === undefined ? "" : `, hidden tests ${c.accepted ? "passed" : "FAILED"}`}, ${c.findings} new security finding(s)` : c.error}, ${c.seconds}s`,
      )
      .join("\n");
    let applied = false;
    let report = `${table}\n\n${winner ? `Winner: candidate ${winner.index}. ${reasoning.replace(/^WINNER:\s*\d+\s*/i, "").trim()}` : "No candidate produced a usable result."}`;
    if (winner && opts.confirmApply && !signal?.aborted) {
      if (await opts.confirmApply(report, winner.diff ?? "")) {
        const head = await gitOk(path.join(runDir, `c${winner.index}`), ["rev-parse", "HEAD"]);
        await applyToWorkingTree(root, snap.base, head, path.join(root, ".swarmcode", "runs", `${runId}.patch`));
        applied = true;
        status(`Applied candidate ${winner.index}.`);
      }
    }
    if (!applied && winner) report += `\n\nThe winning result is on branch ${winner.branch}.`;
    return { runId, candidates, winner: winner?.index, reasoning, applied, branch: winner?.branch, report };
  } finally {
    for (const dir of dirs) {
      stopProcesses(dir);
      await closeBrowsers(dir);
      await removeWorktree(root, dir).catch(() => undefined);
    }
    // Keep only the winner's branch (for inspection or a later merge).
    for (const c of candidates) {
      if (c.branch !== keepBranch) await git(root, ["branch", "-D", c.branch]);
    }
  }
}
