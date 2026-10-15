#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import {
  BUILTIN_PROVIDERS,
  CONFIG_TEMPLATE,
  GLOBAL_CONFIG,
  SWARMCODE_HOME,
  loadConfig,
  parseSpec,
  projectConfigPath,
  providerDef,
  providerKey,
  type Role,
  type SwarmCodeConfig,
} from "./config.js";
import { Engine } from "./engine.js";
import { listTraces, renderTrace } from "./audit.js";
import { openPullRequest, planPullRequest } from "./quality/pr.js";
import { latestProof } from "./quality/proof.js";
import { listSessions } from "./sessions.js";
import { loadSkills, type Skill } from "./skills.js";
import { git, resolveProject } from "./swarm/git.js";
import { boardPrinter, c, printPlan, Renderer } from "./ui/term.js";
import { VERSION } from "./version.js";

const HELP = `${c.bold("swarm")} ${c.gray(`v${VERSION}`)} - multi-agent AI coding agent

${c.bold("Usage")}
  swarm                       interactive session in the current directory
  swarm "<task>"              run one task (the agent parallelizes big ones itself)
  swarm run "<task>"          always use the parallel pipeline: plan, agents, merge, verify
  swarm best "<task>" [-n 3]  best-of-N: N independent attempts, the best verified one wins
  swarm auto "<task>"         autopilot: forecast cost/time per mode, run the best value
  swarm estimate "<task>"     forecast only: tokens, time and cost for each mode
  swarm health [--tests]      repo health radar: security, dependencies, tests, hotspots
  swarm health --fix          ...then let the agent fix the top actionable item
  swarm plan "<task>"         read-only investigation and a plan; implement it after you approve
  swarm review [focus]        review uncommitted changes (--base main, --commit <sha>); exit 2 on issues
  swarm init [--agents]       create .swarmcode/config.json (--agents: also write AGENTS.md)
  swarm models                show configured models and whether keys are set
  swarm sessions              list saved sessions for this project
  swarm skills                list expert skills (security, testing, debugging, ...)
  swarm skill create [name]   turn the latest (or --resume) session into a reusable skill
  swarm skill import <src>    install a skill from an https URL or file (--sha256 to pin)
  swarm skill keygen | sign <file> --key <pem>   sign skills you share with your team
  swarm trace [n]             show the audit trail of the latest (or nth latest) session
  swarm replay [--step k]     list the latest session's requests, or step through request k
  swarm fork <k> [-m model]   re-run request k from its exact starting code on a new branch
  swarm proof                 show the latest proof report (checks, files, models, spend)
  swarm pr [--title t]        commit changes to a branch and open a PR with the proof report
  swarm clean                 remove leftover worktrees and swarm/* branches

${c.bold("Options")}
  -m, --model <provider/model>  use this model for every role
  -c, --continue              resume the most recent session
  -r, --resume <id>           resume a specific session
  -p, --parallel <n>          max agents working at once
  --verify "<cmd>"            command that must pass, e.g. "npm test"
  --budget <usd>              stop when estimated spend reaches this amount
  -y, --yes                   never ask: approve edits, commands, plans, results
  --no-apply                  keep a parallel run's result on its branch
  -g, --guarantee             write hidden acceptance tests first; work passes only if they pass
  -s, --skill <name>          apply an expert skill, e.g. --skill security-review (repeatable)
  -i, --image <file>          attach a screenshot or mockup (png, jpg, gif, webp; repeatable)
  --plan                      plan mode: investigate read-only and propose before changing anything
  --json                      machine-readable result on stdout (for CI/scripts)

${c.bold("In prompts")}
  @path/to/file  attach a file's contents to the request

${c.bold("Interactive")}
  /swarm <task>  parallel pipeline   /context  context usage    /usage  tokens and cost
  /undo          revert last change  /skills    list skills      /skill <name> <task>
  /plan <task>   plan, then approve  /review [focus]  review uncommitted changes
  /best <n> <task>  best-of-N attempts
  /clear         new conversation    /models    models           /exit   quit

Providers: ${Object.keys(BUILTIN_PROVIDERS).join(", ")}, or any OpenAI-compatible endpoint.`;

interface Flags {
  _: string[];
  model?: string;
  parallel?: number;
  verify?: string;
  budget?: number;
  resume?: string;
  continue: boolean;
  yes: boolean;
  noApply: boolean;
  json: boolean;
  skills: string[];
  n?: number;
  guarantee: boolean;
  title?: string;
  draft: boolean;
  tests: boolean;
  fix: boolean;
  global: boolean;
  sha256?: string;
  key?: string;
  step?: number;
  prompt?: string;
  plan: boolean;
  images: string[];
  base?: string;
  commit?: string;
  agents: boolean;
}

export function parseArgs(argv: string[]): Flags {
  const f: Flags = { _: [], yes: false, noApply: false, json: false, continue: false, skills: [], guarantee: false, draft: false, tests: false, fix: false, global: false, plan: false, images: [], agents: false };
  const value = (i: number, name: string) => {
    const v = argv[i];
    if (v === undefined || v.startsWith("--")) throw new Error(`${name} needs a value`);
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--model" || a === "-m") f.model = value(++i, a);
    else if (a === "--parallel" || a === "-p") f.parallel = Number(value(++i, a));
    else if (a === "--verify") f.verify = value(++i, a);
    else if (a === "--budget") f.budget = Number(value(++i, a));
    else if (a === "--resume" || a === "-r") f.resume = value(++i, a);
    else if (a === "--continue" || a === "-c") f.continue = true;
    else if (a === "--yes" || a === "-y" || a === "--yolo") f.yes = true;
    else if (a === "--no-apply") f.noApply = true;
    else if (a === "--json") f.json = true;
    else if (a === "--skill" || a === "-s") f.skills.push(value(++i, a));
    else if (a === "-n" || a === "--best-of") f.n = Number(value(++i, a));
    else if (a === "-g" || a === "--guarantee") f.guarantee = true;
    else if (a === "--title") f.title = value(++i, a);
    else if (a === "--draft") f.draft = true;
    else if (a === "--tests") f.tests = true;
    else if (a === "--fix") f.fix = true;
    else if (a === "--global") f.global = true;
    else if (a === "--sha256") f.sha256 = value(++i, a);
    else if (a === "--key") f.key = value(++i, a);
    else if (a === "--step") f.step = Number(value(++i, a));
    else if (a === "--prompt") f.prompt = value(++i, a);
    else if (a === "--plan") f.plan = true;
    else if (a === "--image" || a === "-i") f.images.push(value(++i, a));
    else if (a === "--base") f.base = value(++i, a);
    else if (a === "--commit") f.commit = value(++i, a);
    else if (a === "--agents") f.agents = true;
    else if (a === "--help" || a === "-h") f._.unshift("help");
    else if (a === "--version" || a === "-v") f._.unshift("version");
    else if (a.startsWith("-") && a.length > 1) throw new Error(`Unknown option ${a}. See swarm --help.`);
    else f._.push(a);
  }
  if (f.parallel !== undefined && !(f.parallel >= 1)) throw new Error("--parallel must be a positive number");
  if (f.budget !== undefined && !(f.budget > 0)) throw new Error("--budget must be a positive number of USD");
  return f;
}

interface Cli {
  engine: Engine;
  renderer: Renderer;
  out: NodeJS.WriteStream;
  ask: (q: string) => Promise<string>;
  confirm: (q: string) => Promise<boolean>;
  close: () => Promise<void>;
}

async function open(flags: Flags): Promise<Cli> {
  const out = flags.json ? process.stderr : process.stdout;
  const renderer = new Renderer("swarm", { out, quiet: flags.json });
  const rl =
    !flags.json && process.stdin.isTTY ? readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true }) : undefined;
  const ask = async (q: string) => {
    if (!rl) throw new Error("Cannot ask for confirmation in non-interactive mode; pass --yes.");
    renderer.stop();
    return rl.question(q);
  };
  const yesNo = async (q: string) => {
    const a = (await ask(`${c.yellow("?")} ${q} ${c.gray("[Y/n]")} `)).trim().toLowerCase();
    return a === "" || a.startsWith("y");
  };

  let engine!: Engine;
  engine = await Engine.open(
    process.cwd(),
    {
      events: renderer.handle,
      onWarning: (m) => out.write(c.yellow(`! ${m}\n`)),
      onTasks: flags.json ? undefined : boardPrinter(out),
      approve: async (kind, summary) => {
        const label =
          kind === "bash" ? `Run ${c.bold(summary)}` : kind === "swarm" ? `Start parallel agents for: ${c.bold(summary.slice(0, 200))}` : summary;
        const a = (await ask(`${c.yellow("?")} ${label}  ${c.gray("[y]es / [n]o / [a]lways")} `)).trim().toLowerCase();
        if (a === "a" || a === "always") {
          engine.allowAlways(kind);
          return true;
        }
        return a === "y" || a === "yes" || a === "";
      },
      confirmPlan: async (plan) => {
        printPlan(plan, out);
        return yesNo(`Start ${plan.tasks.length} agent task(s)?`);
      },
      showResult: (report) => {
        if (!flags.json) out.write(`\n${report}\n\n`);
      },
      confirmApply: () => yesNo("Apply these changes to your working tree?"),
      ask: rl
        ? async (question, options) => {
            out.write(`\n${c.yellow("?")} ${c.bold(question)}\n`);
            options.forEach((o, i) => out.write(`  ${c.cyan(String(i + 1))}. ${o}\n`));
            const a = (await ask(c.gray(options.length ? "Pick a number or type an answer (Enter to skip): " : "Your answer (Enter to skip): "))).trim();
            const n = Number(a);
            return Number.isInteger(n) && n >= 1 && n <= options.length ? options[n - 1] : a;
          }
        : undefined,
    },
    {
      model: flags.model,
      parallel: flags.parallel,
      budgetUsd: flags.budget,
      verifyCommand: flags.verify,
      autoApprove: flags.yes || flags.json,
      noApply: flags.noApply,
    },
  );

  // Ctrl+C cancels the current run; a second one within 2s (or one at the prompt) quits.
  let last = 0;
  const onInterrupt = () => {
    renderer.stop();
    if (engine.busy && Date.now() - last > 2000) {
      last = Date.now();
      engine.abort();
      out.write(c.yellow("\nInterrupted. (Ctrl+C again to quit)\n"));
      return;
    }
    process.exit(130);
  };
  rl?.on("SIGINT", onInterrupt); // readline swallows Ctrl+C in raw mode
  process.on("SIGINT", onInterrupt);

  if (flags.continue || flags.resume) {
    try {
      const s = await engine.resume(flags.resume);
      out.write(s ? c.gray(`Resumed session ${s.id}: "${s.title}"\n`) : c.yellow("No saved session found; starting a new one.\n"));
    } catch (err) {
      out.write(c.yellow(`Could not resume (${(err as Error).message}); starting a new session.\n`));
    }
  }
  return {
    engine,
    renderer,
    out,
    ask,
    confirm: yesNo,
    close: async () => {
      renderer.stop();
      rl?.close();
      await engine.close();
    },
  };
}

async function runTask(flags: Flags, task: string, mode: "auto" | "swarm" | "best" | "autopilot" | "estimate" | "health"): Promise<number> {
  if (!task.trim()) throw new Error(mode === "swarm" ? 'Usage: swarm run "<task>"' : 'Usage: swarm "<task>"');
  const cli = await open(flags);
  const { engine, out } = cli;
  const started = Date.now();
  let code = 0;
  let aborted = false;
  try {
    if (mode === "health") {
      const { renderHealth } = await import("./quality/health.js");
      const report = await engine.health({ runTests: flags.tests });
      if (flags.json) process.stdout.write(JSON.stringify(report, null, 2) + "\n");
      else out.write(`${renderHealth(report)}\n`);
      const next = report.items.find((i) => i.fixPrompt);
      if (flags.fix && next?.fixPrompt) {
        out.write(c.bold(`\nFixing: ${next.title}\n`));
        await engine.send(next.fixPrompt, { guarantee: flags.guarantee });
      }
      code = report.items.some((i) => i.severity === "critical") ? 2 : 0;
    } else if (mode === "estimate") {
      const { renderForecast } = await import("./quality/autopilot.js");
      const f = await engine.estimate(task);
      if (flags.json) process.stdout.write(JSON.stringify(f, null, 2) + "\n");
      else out.write(`${renderForecast(f)}\n`);
    } else if (mode === "autopilot") {
      cli.renderer.focus = "swarm";
      const r = await engine.auto(task, { guarantee: flags.guarantee });
      if (flags.json) process.stdout.write(JSON.stringify({ status: "success", mode: r.mode, forecast: r.forecast ?? null, result: r.text, usage: engine.usage.toJSON() }, null, 2) + "\n");
    } else if (mode === "best") {
      cli.renderer.focus = undefined;
      const r = await engine.bestOf(task, flags.n ?? 3, { guarantee: flags.guarantee });
      code = r.winner ? 0 : 2;
      if (flags.json) {
        process.stdout.write(JSON.stringify({ status: r.winner ? "success" : "failed", runId: r.runId, winner: r.winner ?? null, applied: r.applied, branch: r.branch ?? null, candidates: r.candidates.map(({ diff, report, ...c }) => c), usage: engine.usage.toJSON(), durationMs: Date.now() - started }, null, 2) + "\n");
      } else if (!r.applied) out.write(`${r.report}\n`);
    } else if (mode === "swarm") {
      cli.renderer.focus = undefined;
      const r = await engine.swarm(task, { guarantee: flags.guarantee });
      const ok = r.tasks.every((t) => t.status === "done") && r.verified !== false;
      code = ok ? 0 : 2;
      if (flags.json) {
        const json = {
          status: ok ? "success" : "partial",
          runId: r.runId,
          branch: r.branch ?? null,
          applied: r.applied,
          verified: r.verified ?? null,
          tasks: r.tasks.map((t) => ({ id: t.task.id, title: t.task.title, status: t.status, model: t.model ?? null, error: t.error ?? null })),
          diffStat: r.diffStat ?? null,
          usage: engine.usage.toJSON(),
          durationMs: Date.now() - started,
        };
        process.stdout.write(JSON.stringify(json, null, 2) + "\n");
      } else if (!r.applied) {
        out.write(r.branch ? `The result is on branch ${c.bold(r.branch)}. Merge it with: git merge ${r.branch}\n` : `${r.report}\n`);
      }
    } else {
      const images = flags.images.map(loadImage);
      let text = await engine.send(task, { skills: flags.skills, guarantee: flags.guarantee, plan: flags.plan, images });
      if (flags.plan && !flags.json && !flags.yes && (await cli.confirm("Implement this plan?"))) {
        text = await engine.send("Implement the plan above. Follow it, adjust if you find something it missed, and verify the result.", { skills: flags.skills, guarantee: flags.guarantee });
      }
      if (flags.json) {
        const json = { status: "success", session: engine.sessionId, result: text, usage: engine.usage.toJSON(), durationMs: Date.now() - started };
        process.stdout.write(JSON.stringify(json, null, 2) + "\n");
      }
    }
  } catch (err) {
    aborted = (err as Error).message === "Aborted";
    if (flags.json) process.stdout.write(JSON.stringify({ status: "error", error: (err as Error).message, usage: engine.usage.toJSON() }) + "\n");
    else if (!aborted) out.write(c.red(`Error: ${(err as Error).message}\n`));
    code = aborted ? 130 : 1;
  } finally {
    await cli.close();
  }
  if (!flags.json) out.write(c.gray(`\n${Math.round((Date.now() - started) / 1000)}s · ${engine.usage.report()}\n`));
  return code;
}

const AGENTS_PROMPT =
  "Write an AGENTS.md file at the root of this repository for AI coding agents (and new contributors). Explore the code first. Keep it under 120 lines and specific to this project: what it is; how to install, build, run, test and lint (exact commands that work here); the layout of the main folders; code style and conventions you can observe; and gotchas. If AGENTS.md already exists, improve it instead of replacing what is still accurate.";

const IMAGE_TYPES: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp" };

/** Read an image passed with --image. */
function loadImage(file: string) {
  const mediaType = IMAGE_TYPES[path.extname(file).toLowerCase()];
  if (!mediaType) throw new Error(`--image supports ${Object.keys(IMAGE_TYPES).join(", ")}: ${file}`);
  if (!fs.existsSync(file)) throw new Error(`Image not found: ${file}`);
  const data = fs.readFileSync(file);
  if (data.length > 5 * 1024 * 1024) throw new Error(`Image is over 5 MB: ${file}`);
  return { mediaType, data: data.toString("base64") };
}

/** swarm review [--base <ref> | --commit <sha>] [focus]: exit 0 if clean, 2 if issues were found. */
async function reviewCommand(flags: Flags, focus: string): Promise<number> {
  const cli = await open(flags);
  const { engine, out } = cli;
  const started = Date.now();
  try {
    out.write(c.gray(`Reviewing ${flags.commit ? `commit ${flags.commit}` : flags.base ? `changes since ${flags.base}` : "uncommitted changes"}...\n`));
    const r = await engine.review({ base: flags.base, commit: flags.commit, focus: focus || undefined });
    if (flags.json) process.stdout.write(JSON.stringify({ status: r.approved ? "clean" : "issues", scope: r.scope, lines: r.diffLines, feedback: r.feedback, usage: engine.usage.toJSON() }, null, 2) + "\n");
    else out.write(`\n${r.approved ? c.green("✔ No material problems found.") : c.yellow("Issues found:")}\n${r.feedback.replace(/^\**LGTM\**\s*/i, "")}\n`);
    return r.approved ? 0 : 2;
  } catch (err) {
    if (flags.json) process.stdout.write(JSON.stringify({ status: "error", error: (err as Error).message }) + "\n");
    else out.write(c.red(`Error: ${(err as Error).message}\n`));
    return 1;
  } finally {
    await cli.close();
    if (!flags.json) out.write(c.gray(`\n${Math.round((Date.now() - started) / 1000)}s · ${engine.usage.report()}\n`));
  }
}

async function interactive(flags: Flags): Promise<number> {
  const cli = await open(flags);
  const { engine, out } = cli;
  out.write(`${c.bold("swarm")} ${c.gray(`v${VERSION}  ${engine.root}`)}\n`);
  out.write(c.gray(`main ${engine.cfg.models.main} · workers ${engine.cfg.models.worker} · /help for commands\n`));
  if (!engine.isRepo) out.write(c.yellow("Not a git repository: parallel agents are off. Run `git init` to enable them.\n"));
  if (engine.mcp?.tools.length) out.write(c.gray(`MCP: ${engine.mcp.tools.length} tool(s) connected\n`));
  out.write("\n");

  for (;;) {
    let input: string;
    try {
      input = (await cli.ask(c.bold(c.cyan("› ")))).trim();
    } catch {
      break; // stdin closed
    }
    if (!input) continue;
    const [command, ...args] = input.split(/\s+/);
    if (command === "/exit" || command === "/quit") break;
    if (command === "/help") out.write(HELP + "\n");
    else if (command === "/usage") out.write(engine.usage.report() + "\n");
    else if (command === "/context") {
      const { tokens, window } = engine.context;
      out.write(`${tokens.toLocaleString()} / ${window.toLocaleString()} tokens (${((tokens / window) * 100).toFixed(1)}%)\n`);
    } else if (command === "/undo") {
      try {
        const files = engine.undo();
        out.write(files.length ? c.gray(`Restored ${files.join(", ")}\n`) : c.gray("Nothing to undo.\n"));
      } catch (err) {
        out.write(c.red(`${(err as Error).message}\n`));
      }
    } else if (command === "/skills") printSkills(engine.skills);
    else if (command === "/clear") {
      engine.newConversation();
      out.write(c.gray("Started a new conversation.\n"));
    } else if (command === "/models") showModels(engine.cfg);
    else {
      try {
        if (command === "/swarm") {
          const goal = args.join(" ");
          if (!goal) out.write("Usage: /swarm <task>\n");
          else {
            cli.renderer.focus = undefined;
            const r = await engine.swarm(goal).finally(() => (cli.renderer.focus = "swarm"));
            if (!r.applied && r.branch) out.write(`The result is on branch ${c.bold(r.branch)}.\n`);
          }
        } else if (command === "/best") {
          const count = Number(args[0]);
          const goal = (Number.isFinite(count) ? args.slice(1) : args).join(" ");
          if (!goal) out.write("Usage: /best [n] <task>\n");
          else {
            cli.renderer.focus = undefined;
            const r = await engine.bestOf(goal, Number.isFinite(count) ? count : 3).finally(() => (cli.renderer.focus = "swarm"));
            if (!r.applied) out.write(`${r.report}\n`);
          }
        } else if (command === "/skill") {
          const [name, ...rest] = args;
          if (!name || !rest.length) out.write("Usage: /skill <name> <task>\n");
          else await engine.send(rest.join(" "), { skills: [name] });
        } else if (command === "/plan") {
          const goal = args.join(" ");
          if (!goal) out.write("Usage: /plan <task>\n");
          else {
            await engine.send(goal, { plan: true });
            if (await cli.confirm("Implement this plan?")) await engine.send("Implement the plan above. Follow it, adjust if you find something it missed, and verify the result.");
          }
        } else if (command === "/review") {
          const r = await engine.review({ focus: args.join(" ") || undefined });
          out.write(`\n${r.approved ? c.green("✔ No material problems found.") : c.yellow("Issues found:")}\n${r.feedback.replace(/^\**LGTM\**\s*/i, "")}\n`);
        } else {
          await engine.send(input, { skills: flags.skills });
        }
      } catch (err) {
        if ((err as Error).message !== "Aborted") out.write(c.red(`Error: ${(err as Error).message}\n`));
      }
      out.write("\n");
    }
  }
  await cli.close();
  out.write(c.gray(engine.usage.report() + "\n"));
  return 0;
}

async function confirm(question: string, yes: boolean): Promise<boolean> {
  if (yes) return true;
  if (!process.stdin.isTTY) throw new Error("Pass --yes to confirm non-interactively.");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const a = (await rl.question(`${question} [y/N] `)).trim().toLowerCase();
  rl.close();
  return a.startsWith("y");
}

async function skillCommand(flags: Flags, args: string[], root: string): Promise<number> {
  const studio = await import("./skill-studio.js");
  const [sub, arg] = args;
  const cfg = loadConfig(root);
  const dir = flags.global ? studio.userSkillDir() : studio.projectSkillDir(root);
  if (sub === "create") {
    const cli = await open({ ...flags, continue: !flags.resume });
    try {
      if (!cli.engine.transcript().length) throw new Error("No saved session to learn from. Work on a task first (or pass --resume <id>).");
      const { resolveModel } = await import("./config.js");
      const skill = await studio.createSkillFromSession({ transcript: cli.engine.transcript(), name: arg, model: resolveModel(cli.engine.cfg, "planner"), root, events: cli.renderer.handle, usage: cli.engine.usage });
      console.log(`\n${studio.skillToMarkdown(skill)}`);
      if (!(await confirm(`Save this skill to ${dir}?`, flags.yes))) return 1;
      console.log(`Saved ${studio.saveSkill(skill, dir)}`);
      return 0;
    } finally {
      await cli.close();
    }
  }
  if (sub === "import") {
    if (!arg) throw new Error("Usage: swarm skill import <https-url|file> [--sha256 <hash>] [--global]");
    const keys = cfg.trustedSkillKeys.map((k) => (k.includes("BEGIN") ? k : fs.readFileSync(path.resolve(root, k), "utf8")));
    const got = await studio.fetchSkill(arg, { expectSha256: flags.sha256, trustedKeys: keys });
    console.log(`\n${got.text}\n`);
    console.log(`Skill: ${got.skill.name}  ·  SHA-256 ${got.hash}  ·  signature: ${got.signature === "valid" ? c.green(`valid (key ${got.signer})`) : got.signature === "invalid" ? c.red("INVALID") : c.yellow("none")}`);
    if (got.signature === "invalid") throw new Error("The signature does not match any trusted key. Not installing.");
    if (cfg.requireSignedSkills && got.signature !== "valid") throw new Error("requireSignedSkills is on and this skill is not signed by a trusted key.");
    console.log(c.gray("A skill is instructions agents will follow. Read it above before installing."));
    if (!(await confirm(`Install to ${dir}?`, flags.yes))) return 1;
    console.log(`Installed ${studio.saveSkill({ ...got.skill, source: flags.global ? "user" : "project" }, dir)}  (pin it with --sha256 ${got.hash})`);
    return 0;
  }
  if (sub === "keygen") {
    const k = studio.generateSigningKey(path.join(SWARMCODE_HOME, "keys"));
    console.log(`Private key: ${k.privateKey} (keep it secret)\nPublic key:  ${k.publicKey} (share it; teammates add it to trustedSkillKeys)`);
    return 0;
  }
  if (sub === "sign") {
    if (!arg || !flags.key) throw new Error("Usage: swarm skill sign <skill.md> --key <private-key.pem>");
    console.log(`Wrote ${studio.signSkillFile(arg, fs.readFileSync(flags.key, "utf8"))}`);
    return 0;
  }
  throw new Error("Usage: swarm skill create|import|keygen|sign ...");
}

function printSkills(skills: Skill[]) {
  if (!skills.length) return console.log("No skills found.");
  for (const s of skills) console.log(`  ${c.cyan(s.name.padEnd(22))} ${s.description}${s.source !== "built-in" ? c.gray(` (${s.source})`) : ""}`);
  console.log(c.gray("\n  Use: swarm --skill <name> \"task\"  ·  add your own in ~/.swarmcode/skills/ or .swarmcode/skills/"));
}

function init(root: string) {
  const file = projectConfigPath(root);
  if (fs.existsSync(file)) return console.log(`${file} already exists.`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(CONFIG_TEMPLATE, null, 2) + "\n");
  console.log(`Created ${file}. Settings for all projects go in ${GLOBAL_CONFIG}.`);
}

function showModels(cfg: SwarmCodeConfig) {
  for (const role of Object.keys(cfg.models) as Role[]) {
    const spec = cfg.models[role];
    let state: string;
    try {
      const def = providerDef(cfg, parseSpec(spec).provider);
      state = !def ? c.red("unknown provider") : !def.apiKeyEnv || providerKey(def) ? c.green("ready") : c.red(`set ${def.apiKeyEnv}`);
    } catch (err) {
      state = c.red((err as Error).message);
    }
    console.log(`  ${role.padEnd(9)} ${spec.padEnd(42)} effort=${cfg.effort[role].padEnd(6)} ${state}`);
  }
  console.log(c.gray(`  max parallel agents: ${cfg.maxParallel}${cfg.budgetUsd ? ` · budget $${cfg.budgetUsd}` : ""}`));
}

async function clean(root: string, isRepo: boolean) {
  if (!isRepo) return console.log("Not a git repository; nothing to clean.");
  const dir = path.join(root, ".swarmcode", "worktrees");
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  await git(root, ["worktree", "prune"]);
  const branches = (await git(root, ["branch", "--list", "swarm/*", "--format=%(refname:short)"])).stdout.split("\n").filter(Boolean);
  for (const b of branches) await git(root, ["branch", "-D", b]);
  console.log(`Removed leftover worktrees and ${branches.length} swarm/* branch(es).`);
}

async function main(): Promise<number> {
  const flags = parseArgs(process.argv.slice(2));
  const [cmd, ...rest] = flags._;
  const { root, isRepo } = await resolveProject(process.cwd());
  switch (cmd) {
    case "help":
      console.log(HELP);
      return 0;
    case "version":
      console.log(VERSION);
      return 0;
    case "init":
      init(root);
      if (flags.agents) return runTask(flags, AGENTS_PROMPT, "auto");
      return 0;
    case "plan":
      return runTask({ ...flags, plan: true }, rest.join(" "), "auto");
    case "review":
      return reviewCommand(flags, rest.join(" "));
    case "models":
      if (flags.model) process.env.SWARMCODE_MODEL = flags.model;
      showModels(loadConfig(root));
      return 0;
    case "sessions":
      for (const s of listSessions(root).slice(0, 20)) console.log(`${c.cyan(s.id)}  ${c.gray(s.updated.slice(0, 16).replace("T", " "))}  ${s.title}`);
      return 0;
    case "clean":
      await clean(root, isRepo);
      return 0;
    case "skills":
      printSkills(loadSkills(root));
      return 0;
    case "run":
      return runTask(flags, rest.join(" "), "swarm");
    case "best":
      return runTask(flags, rest.join(" "), "best");
    case "auto":
      return runTask(flags, rest.join(" "), "autopilot");
    case "estimate":
      return runTask(flags, rest.join(" "), "estimate");
    case "health":
      return runTask(flags, "health check", "health");
    case "proof": {
      const file = latestProof(root);
      console.log(file ? `${c.gray(file)}\n\n${fs.readFileSync(file, "utf8")}` : "No proof reports yet. One is written whenever an agent changes files.");
      return 0;
    }
    case "pr": {
      const plan = await planPullRequest(root, { title: flags.title, draft: flags.draft });
      console.log(`Branch: ${plan.branch}\nTitle: ${plan.title}\nFiles: ${plan.files.length}\nDescription: ${plan.proof ?? "(no proof report yet)"}`);
      if (!flags.yes) {
        if (!process.stdin.isTTY) throw new Error("Pass --yes to create the pull request non-interactively.");
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        const a = (await rl.question("Commit, push and open this pull request? [y/N] ")).trim().toLowerCase();
        rl.close();
        if (!a.startsWith("y")) return 1;
      }
      console.log(await openPullRequest(root, plan, { draft: flags.draft }));
      return 0;
    }
    case "replay":
    case "fork": {
      const { readRequests, renderRequests, forkRequest } = await import("./replay.js");
      const traces = listTraces(root);
      const trace = traces[Math.max(0, Number(flags.n ?? 1) - 1)];
      if (!trace) throw new Error("No audit trails yet; they are recorded as you work.");
      const reqs = readRequests(trace);
      if (cmd === "replay") {
        console.log(`${c.gray(trace)}\n${renderRequests(reqs, flags.step)}`);
        return 0;
      }
      const index = Number(rest[0]);
      const req = reqs[index - 1];
      if (!req) throw new Error(`Usage: swarm fork <request number> [--model provider/model] [--prompt "..."]. This session has ${reqs.length} request(s).`);
      const renderer = new Renderer(undefined);
      console.log(c.gray(`Forking request #${index} from checkpoint ${req.checkpoint?.slice(0, 10) ?? "?"}${flags.model ? ` with ${flags.model}` : ""}...`));
      const r = await forkRequest(root, req, { events: renderer.handle, approve: async () => true, confirmPlan: async () => true, confirmApply: async () => true }, { model: flags.model, prompt: flags.prompt, guarantee: flags.guarantee });
      renderer.stop();
      console.log(`\n${r.diffStat || "No changes."}\n\nThe fork is on branch ${c.bold(r.branch)}. Compare with: git diff ${r.base.slice(0, 10)} ${r.branch}`);
      return 0;
    }
    case "skill":
      return skillCommand(flags, rest, root);
    case "trace": {
      const traces = listTraces(root);
      const which = Number(rest[0] ?? 1);
      if (!traces.length) console.log("No audit trails yet. They are written to .swarmcode/traces/ as you work.");
      else console.log(`${c.gray(traces[Math.max(0, which - 1)] ?? traces[0])}\n${renderTrace(traces[Math.max(0, which - 1)] ?? traces[0])}`);
      return 0;
    }
    case "ask":
      return runTask(flags, rest.join(" "), "auto");
    case undefined:
      if (!process.stdin.isTTY) {
        // Piped input: echo "task" | swarm
        const piped = fs.readFileSync(0, "utf8").trim();
        if (piped) return runTask({ ...flags, yes: true }, piped, "auto");
      }
      return interactive(flags);
    default: {
      const near = flags._.length === 1 ? nearCommand(cmd) : undefined;
      if (near) {
        console.error(c.red(`swarm: unknown command "${cmd}". Did you mean "swarm ${near}"?`) + c.gray(` To send it to the agent as a task, quote it with more words.`));
        return 1;
      }
      return runTask(flags, flags._.join(" "), "auto");
    }
  }
}

const COMMANDS = ["help", "version", "init", "models", "sessions", "clean", "skills", "run", "best", "auto", "estimate", "health", "proof", "pr", "replay", "fork", "skill", "trace", "ask"];

/** A one-word argument that is a typo of a command (same first letter, edit distance <= 2). */
function nearCommand(word: string | undefined): string | undefined {
  if (!word || word.length < 4 || !/^[a-z-]+$/.test(word)) return undefined;
  const dist = (a: string, b: string) => {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++)
      for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[a.length][b.length];
  };
  return COMMANDS.filter((cmd) => cmd !== word && cmd[0] === word[0] && cmd.length >= 4)
    .map((cmd) => ({ cmd, d: dist(word, cmd) }))
    .filter((x) => x.d <= 2)
    .sort((a, b) => a.d - b.d)[0]?.cmd;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(c.red(`swarm: ${(err as Error).message}`));
    process.exit(1);
  },
);
