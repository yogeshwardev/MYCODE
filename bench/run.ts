// SwarmCode benchmark: identical tasks for SwarmCode's modes and any other agent
// CLI, graded by hidden acceptance tests the agents never see.
//
//   npx tsx bench/run.ts --check                       # prove every task is valid (no model needed)
//   npx tsx bench/run.ts                               # swarmcode agent + swarm modes, all tasks
//   npx tsx bench/run.ts --category large --repeat 2
//   npx tsx bench/run.ts --external "codex=codex exec --full-auto {prompt}"
//
// Each run starts from a fresh copy of the task's fixture in a new git repo. When
// the runner finishes, the task's hidden tests (bench/hidden/<task>/) are copied in
// and the verify command decides pass/fail. {prompt} in an external command is
// replaced with the (shell-quoted) prompt. Results are printed as Markdown and
// saved to bench/results/<timestamp>.json.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Engine } from "../src/engine.js";
import { runShell } from "../src/util.js";

interface Task {
  id: string;
  category: "small" | "medium" | "large";
  fixture: string;
  prompt: string;
  verify: string;
}

interface Result {
  task: string;
  category: string;
  runner: string;
  run: number;
  passed: boolean;
  seconds: number;
  tokens?: number;
  costUsd?: number | null;
  error?: string;
}

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const all = (name: string) => args.flatMap((a, i) => (a === name ? [args[i + 1]] : []));

const tasks: Task[] = JSON.parse(fs.readFileSync(path.join(here, "tasks.json"), "utf8"));
const selected = tasks.filter(
  (t) => (!opt("--only") || opt("--only")!.split(",").includes(t.id)) && (!opt("--category") || opt("--category")!.split(",").includes(t.category)),
);
const repeat = Number(opt("--repeat") ?? 1);
const modes = (opt("--modes") ?? "agent,swarm").split(",").filter(Boolean);
const timeoutMin = Number(opt("--timeout-min") ?? 20);
const externals = all("--external").map((spec) => {
  const eq = spec.indexOf("=");
  if (eq < 0) throw new Error(`--external expects name=command, got ${spec}`);
  return { name: spec.slice(0, eq), command: spec.slice(eq + 1) };
});

function copyInto(src: string, dest: string) {
  if (fs.existsSync(src)) fs.cpSync(src, dest, { recursive: true, force: true });
}

function freshRepo(task: Task): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `bench-${task.id}-`));
  copyInto(path.join(here, "fixtures", task.fixture), dir);
  const g = (...a: string[]) => execFileSync("git", ["-c", "user.name=bench", "-c", "user.email=bench@localhost", "-c", "core.autocrlf=false", ...a], { cwd: dir, stdio: "ignore" });
  g("init", "-q");
  g("add", "-A");
  g("commit", "-qm", "fixture");
  return dir;
}

/** Add the hidden acceptance tests, then run the verify command. */
async function grade(task: Task, dir: string): Promise<boolean> {
  copyInto(path.join(here, "hidden", task.id), dir);
  return (await runShell(task.verify, dir, 5 * 60_000)).code === 0;
}

/** Every single-agent runner (ours and external ones) gets the same prompt. */
const fullPrompt = (task: Task) => `${task.prompt}\n\nWhen you are done, make sure \`${task.verify}\` passes.`;

const quote = (s: string) => (process.platform === "win32" ? `"${s.replace(/"/g, '\\"')}"` : `'${s.replace(/'/g, "'\\''")}'`);

async function runSwarmcode(task: Task, mode: string, dir: string): Promise<Partial<Result>> {
  const engine = await Engine.open(
    dir,
    { events: () => undefined, approve: async () => true, confirmPlan: async () => true, confirmApply: async () => true },
    { autoApprove: true, verifyCommand: task.verify },
  );
  try {
    if (mode === "swarm") await engine.swarm(task.prompt);
    else await engine.send(fullPrompt(task));
    return {};
  } finally {
    const u = engine.usage.toJSON();
    await engine.close();
    // Recorded even when the run throws, so failures still show their cost.
    lastUsage = { tokens: u.totals.input + u.totals.cacheRead + u.totals.cacheWrite + u.totals.output, costUsd: u.costUsd };
  }
}
let lastUsage: { tokens: number; costUsd: number | null } | undefined;

/** --check: the base fixture must fail the hidden tests and the reference solution must pass them. */
async function check(): Promise<number> {
  let bad = 0;
  for (const task of selected) {
    const base = freshRepo(task);
    const baseFails = !(await grade(task, base));
    const solved = freshRepo(task);
    copyInto(path.join(here, "solutions", task.id), solved);
    const solutionPasses = await grade(task, solved);
    const ok = baseFails && solutionPasses;
    if (!ok) bad++;
    console.log(`${ok ? "OK  " : "BAD "} ${task.id.padEnd(24)} base fails: ${baseFails}  solution passes: ${solutionPasses}`);
    if (!solutionPasses) console.log((await runShell(task.verify, solved, 60_000)).stdout.split("\n").filter((l) => /not ok|Error|expected|actual/.test(l)).slice(0, 12).join("\n"));
    fs.rmSync(base, { recursive: true, force: true });
    fs.rmSync(solved, { recursive: true, force: true });
  }
  console.log(bad ? `\n${bad} task(s) are invalid.` : `\nAll ${selected.length} tasks are valid.`);
  return bad ? 1 : 0;
}

function summarize(results: Result[]) {
  const avg = (xs: Array<number | undefined | null>) => {
    const v = xs.filter((x): x is number => typeof x === "number");
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : undefined;
  };
  const fmtTok = (n?: number) => (n === undefined ? "n/a" : n >= 1000 ? `${(n / 1000).toFixed(0)}k` : String(Math.round(n)));
  const runners = [...new Set(results.map((r) => r.runner))];

  console.log("\n### Per task\n\n| task | category | runner | pass | avg time | avg tokens |\n|---|---|---|---|---|---|");
  for (const task of [...new Set(results.map((r) => r.task))]) {
    for (const runner of runners) {
      const rs = results.filter((r) => r.task === task && r.runner === runner);
      if (!rs.length) continue;
      console.log(`| ${task} | ${rs[0].category} | ${runner} | ${rs.filter((r) => r.passed).length}/${rs.length} | ${avg(rs.map((r) => r.seconds))!.toFixed(0)}s | ${fmtTok(avg(rs.map((r) => r.tokens)))} |`);
    }
  }

  console.log("\n### By category\n\n| category | runner | pass rate | avg time | avg time when passed | avg tokens |\n|---|---|---|---|---|---|");
  for (const category of ["small", "medium", "large", "all"]) {
    for (const runner of runners) {
      const rs = results.filter((r) => r.runner === runner && (category === "all" || r.category === category));
      if (!rs.length) continue;
      const passed = rs.filter((r) => r.passed);
      const pct = Math.round((passed.length / rs.length) * 100);
      console.log(`| ${category} | ${runner} | ${passed.length}/${rs.length} (${pct}%) | ${avg(rs.map((r) => r.seconds))!.toFixed(0)}s | ${passed.length ? `${avg(passed.map((r) => r.seconds))!.toFixed(0)}s` : "n/a"} | ${fmtTok(avg(rs.map((r) => r.tokens)))} |`);
    }
  }

  // Fastest passing runner per task (by average time over its passing runs).
  console.log("\n### Fastest correct runner per task\n");
  for (const task of [...new Set(results.map((r) => r.task))]) {
    const best = runners
      .map((runner) => {
        const rs = results.filter((r) => r.task === task && r.runner === runner);
        const ok = rs.length > 0 && rs.every((r) => r.passed);
        return { runner, ok, t: avg(rs.map((r) => r.seconds)) ?? Infinity };
      })
      .filter((x) => x.ok)
      .sort((a, b) => a.t - b.t)[0];
    console.log(`- ${task}: ${best ? `${best.runner} (${best.t.toFixed(0)}s)` : "no runner passed every run"}`);
  }
}

async function main(): Promise<number> {
  if (args.includes("--check")) return check();
  const results: Result[] = [];
  const runners = [...modes.map((m) => `swarmcode:${m}`), ...externals.map((e) => e.name)];
  for (const task of selected) {
    for (let run = 1; run <= repeat; run++) {
      for (const runner of runners) {
        const dir = freshRepo(task);
        const started = Date.now();
        const r: Result = { task: task.id, category: task.category, runner, run, passed: false, seconds: 0 };
        process.stdout.write(`${task.id} · ${runner} · run ${run} ... `);
        lastUsage = undefined;
        try {
          if (runner.startsWith("swarmcode:")) {
            await runSwarmcode(task, runner.split(":")[1], dir);
          } else {
            const ext = externals.find((e) => e.name === runner)!;
            const out = await runShell(ext.command.replace("{prompt}", quote(fullPrompt(task))), dir, timeoutMin * 60_000);
            if (out.code !== 0) r.error = out.timedOut ? "timeout" : `exit ${out.code}`;
            // Some CLIs report their own token use (e.g. Codex: "tokens used\n116,435").
            const used = /tokens used\s*:?\s*([\d,]+)/i.exec(out.stdout + out.stderr);
            if (used) r.tokens = Number(used[1].replace(/,/g, ""));
          }
        } catch (err) {
          r.error = (err as Error).message.split("\n")[0].slice(0, 120);
        }
        if (lastUsage) Object.assign(r, lastUsage);
        r.seconds = Math.round((Date.now() - started) / 100) / 10;
        r.passed = await grade(task, dir);
        console.log(`${r.passed ? "PASS" : "FAIL"} ${r.seconds}s${r.tokens ? ` ${Math.round(r.tokens / 1000)}k tok` : ""}${r.error ? ` (${r.error})` : ""}`);
        results.push(r);
        fs.writeFileSync(path.join(here, ".last-results.json"), JSON.stringify(results, null, 2));
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  }
  summarize(results);
  const outDir = path.join(here, "results");
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, `${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(file, JSON.stringify(results, null, 2));
  console.log(`\nSaved ${path.relative(process.cwd(), file)}`);
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
