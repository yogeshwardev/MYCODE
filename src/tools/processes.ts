import { spawn, type ChildProcess } from "node:child_process";
import { childEnv, clip, detectShell, killTree } from "../util.js";
import { ToolError, type Tool } from "./types.js";

// Long-running commands (dev servers, watchers, `docker compose up`) run in the
// background so the agent can keep working, then check their output, e.g. to
// test a web app it just started with the browser tools.

interface BackgroundProcess {
  id: string;
  root: string;
  command: string;
  child: ChildProcess;
  output: string;
  /** How much of `output` the agent has already seen. */
  seen: number;
  exitCode: number | null;
  started: number;
}

const MAX_BUFFER = 200_000;
const processes = new Map<string, BackgroundProcess>();
let seq = 0;

export function startBackground(command: string, root: string): BackgroundProcess {
  const sh = detectShell();
  const child = spawn(sh.path, sh.argsFor(command), { cwd: root, windowsHide: true, env: childEnv(), detached: process.platform !== "win32" });
  const proc: BackgroundProcess = { id: `p${++seq}`, root, command, child, output: "", seen: 0, exitCode: null, started: Date.now() };
  const onData = (d: Buffer) => {
    proc.output += d.toString();
    if (proc.output.length > MAX_BUFFER) {
      const drop = proc.output.length - MAX_BUFFER;
      proc.output = proc.output.slice(drop);
      proc.seen = Math.max(0, proc.seen - drop);
    }
  };
  child.stdout?.on("data", onData);
  child.stderr?.on("data", onData);
  child.on("close", (code) => (proc.exitCode = code ?? 1));
  child.on("error", (err) => {
    proc.output += `\n[failed to start: ${err.message}]`;
    proc.exitCode = 1;
  });
  processes.set(proc.id, proc);
  return proc;
}

function describe(p: BackgroundProcess) {
  const secs = Math.round((Date.now() - p.started) / 1000);
  return `${p.id} [${p.exitCode === null ? `running ${secs}s` : `exited with code ${p.exitCode}`}] ${p.command}`;
}

/** New output since the last read (or everything when `all`). */
function readOutput(p: BackgroundProcess, all = false) {
  const text = all ? p.output : p.output.slice(p.seen);
  p.seen = p.output.length;
  return clip(text.trim() || "(no new output)", 20_000);
}

/** Wait until the process prints something matching `until`, exits, or the timeout passes. */
async function waitFor(p: BackgroundProcess, ms: number, until?: RegExp, signal?: AbortSignal) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline && p.exitCode === null && !signal?.aborted) {
    if (until && until.test(p.output.slice(p.seen))) return;
    await new Promise((r) => setTimeout(r, 200));
  }
}

export async function runInBackground(command: string, root: string, signal?: AbortSignal): Promise<string> {
  const p = startBackground(command, root);
  // Give servers a moment to print their address or fail fast.
  await waitFor(p, 4000, /listening|ready|running|started|local:|http:\/\/|error/i, signal);
  return `Started background process ${describe(p)}\nUse process_output to check on it and process_stop to end it.\n\n${readOutput(p)}`;
}

export function stopProcesses(root?: string) {
  for (const p of processes.values()) {
    if (root && p.root !== root) continue;
    if (p.exitCode === null) killTree(p.child.pid);
    processes.delete(p.id);
  }
}

// Stop everything we started when the app exits.
process.once("exit", () => stopProcesses());

export const processOutput: Tool = {
  readOnly: true,
  spec: {
    name: "process_output",
    description:
      "Read new output from a background process started with bash (background: true), or list all background processes when id is omitted. Optionally wait up to wait_ms for more output (e.g. until a server is ready).",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string" },
        wait_ms: { type: "integer", description: "Wait up to this long for new output (max 60000)" },
        all: { type: "boolean", description: "Return the whole buffered output, not just new lines" },
      },
    },
  },
  async run(input, ctx) {
    if (!input.id) {
      const mine = [...processes.values()].filter((p) => p.root === ctx.root);
      return mine.length ? mine.map(describe).join("\n") : "No background processes.";
    }
    const p = processes.get(String(input.id));
    if (!p || p.root !== ctx.root) throw new ToolError(`No background process ${input.id}.`);
    if (input.wait_ms) await waitFor(p, Math.min(60_000, Number(input.wait_ms)), /./, ctx.signal);
    return `${describe(p)}\n\n${readOutput(p, Boolean(input.all))}`;
  },
};

export const processStop: Tool = {
  readOnly: false,
  spec: {
    name: "process_stop",
    description: "Stop a background process (and its children) by id.",
    parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
  async run(input, ctx) {
    const p = processes.get(String(input.id));
    if (!p || p.root !== ctx.root) throw new ToolError(`No background process ${input.id}.`);
    if (p.exitCode === null) killTree(p.child.pid);
    processes.delete(p.id);
    return `Stopped ${p.id}. Final output:\n${readOutput(p)}`;
  },
};
