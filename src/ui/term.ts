import type { AgentEvent } from "../agent/events.js";
import type { Plan } from "../swarm/planner.js";
import type { TaskState } from "../swarm/orchestrator.js";

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const wrap = (code: string) => (s: string) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
export const c = {
  bold: wrap("1"),
  dim: wrap("2"),
  red: wrap("31"),
  green: wrap("32"),
  yellow: wrap("33"),
  blue: wrap("34"),
  magenta: wrap("35"),
  cyan: wrap("36"),
  gray: wrap("90"),
};

const AGENT_COLORS = [c.cyan, c.magenta, c.yellow, c.blue, c.green];
const colorFor = new Map<string, (s: string) => string>();
function tag(agent: string) {
  if (!colorFor.has(agent)) colorFor.set(agent, AGENT_COLORS[colorFor.size % AGENT_COLORS.length]);
  return colorFor.get(agent)!(`[${agent}]`);
}

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/**
 * Prints agent events. The "focus" agent (the one the user is talking to)
 * streams its text live, with a spinner while the model is thinking;
 * background agents (subagents, swarm workers) get one compact line per tool
 * call so many of them can run at once readably.
 */
export class Renderer {
  private midLine = false;
  private spinner?: NodeJS.Timeout;
  private spinnerShown = false;
  private readonly out: NodeJS.WriteStream;
  private readonly interactive: boolean;

  constructor(
    public focus: string | undefined,
    opts: { out?: NodeJS.WriteStream; quiet?: boolean } = {},
  ) {
    this.out = opts.out ?? process.stdout;
    this.interactive = Boolean(this.out.isTTY) && !opts.quiet;
    this.quiet = Boolean(opts.quiet);
  }
  private quiet: boolean;

  private clearSpinner() {
    if (this.spinner) clearInterval(this.spinner);
    this.spinner = undefined;
    if (this.spinnerShown) {
      this.out.write("\r\x1b[2K");
      this.spinnerShown = false;
    }
  }

  private startSpinner() {
    if (!this.interactive || this.midLine) return;
    this.clearSpinner();
    const started = Date.now();
    let i = 0;
    this.spinner = setInterval(() => {
      const secs = Math.round((Date.now() - started) / 1000);
      this.out.write(`\r\x1b[2K${c.cyan(FRAMES[i++ % FRAMES.length])} ${c.gray(`thinking${secs >= 2 ? ` ${secs}s` : ""} · Ctrl+C to interrupt`)}`);
      this.spinnerShown = true;
    }, 100);
    this.spinner.unref();
  }

  private line(s: string) {
    this.clearSpinner();
    if (this.midLine) {
      this.out.write("\n");
      this.midLine = false;
    }
    this.out.write(s + "\n");
  }

  stop() {
    this.clearSpinner();
  }

  handle = (e: AgentEvent) => {
    const mine = e.agent === this.focus;
    switch (e.type) {
      case "turn_start":
        if (mine) this.startSpinner();
        return;
      case "turn_end":
        if (mine) this.clearSpinner();
        return;
      case "text":
        if (!mine || this.quiet) return;
        this.clearSpinner();
        this.out.write(e.delta);
        this.midLine = !e.delta.endsWith("\n");
        return;
      case "assistant_done":
        if (mine && this.midLine) this.line("");
        return;
      case "tool":
        if (this.quiet && !mine) return;
        this.line(mine ? c.gray(`  ⚙ ${e.name} ${e.summary}`) : `${tag(e.agent)} ${c.gray(`${e.name} ${e.summary}`)}`);
        return;
      case "tool_error":
        this.line(`${mine ? " " : tag(e.agent)} ${c.red(`✖ ${e.name}: ${e.error.split("\n")[0].slice(0, 200)}`)}`);
        return;
      case "status":
        this.line(c.bold(c.blue(`● ${e.message}`)));
        return;
      case "compacted":
        this.line(c.yellow(`${mine ? "" : tag(e.agent) + " "}↺ context compacted: ${fmtK(e.before)} → ${fmtK(e.after)} tokens`));
        return;
      case "trimmed":
        if (!this.quiet) this.line(c.gray(`  ↺ older tool output trimmed: ${fmtK(e.before)} → ${fmtK(e.after)} tokens`));
        return;
      case "todos": {
        if (this.quiet) return;
        const mark = { pending: c.gray("○"), in_progress: c.yellow("◐"), done: c.green("●") } as const;
        this.line(e.items.map((i) => `  ${mark[i.status]} ${i.status === "done" ? c.gray(i.text) : i.text}`).join("\n"));
        return;
      }
    }
  };
}

const fmtK = (n: number) => `${(n / 1000).toFixed(1)}k`;

export function printPlan(plan: Plan, out: NodeJS.WriteStream = process.stdout) {
  const w = (s = "") => out.write(s + "\n");
  w("\n" + c.bold("Plan: ") + plan.summary + "\n");
  for (const t of plan.tasks) {
    const deps = t.depends_on.length ? c.gray(` after ${t.depends_on.join(", ")}`) : c.green(" (starts immediately)");
    w(`  ${c.cyan(t.id)} ${c.bold(t.title)}${deps}`);
    if (t.files.length) w(c.gray(`      files: ${t.files.join(", ")}`));
  }
  if (plan.verify_command) w(c.gray(`\n  verify: ${plan.verify_command}`));
  for (const v of plan.council ?? []) {
    w(`\n  ${v.approved ? c.green("council ✔") : c.yellow("council ⚠")} ${c.bold(v.model)}`);
    for (const line of v.notes.split("\n").filter(Boolean).slice(0, 6)) w(c.gray(`      ${line}`));
  }
  w();
}

export function boardPrinter(out: NodeJS.WriteStream = process.stdout) {
  let last = "";
  return (states: TaskState[]) => {
    const counts = { pending: 0, running: 0, done: 0, failed: 0, skipped: 0 };
    for (const s of states) counts[s.status]++;
    const board = `${c.bold("tasks")} ${c.green(`${counts.done} done`)} · ${c.cyan(`${counts.running} running`)} · ${counts.pending} queued${counts.failed ? " · " + c.red(`${counts.failed} failed`) : ""}${counts.skipped ? ` · ${counts.skipped} skipped` : ""}`;
    if (board !== last) {
      last = board;
      out.write(board + "\n");
    }
  };
}
