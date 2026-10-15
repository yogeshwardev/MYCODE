import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/**
 * Environment for commands we launch. Variables that only make sense for this
 * process are removed: e.g. NODE_TEST_CONTEXT, set when SwarmCode itself runs
 * under node:test, makes a nested `node --test` report to the parent and exit 0.
 */
export function childEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  return env;
}

/** Run a program (no shell) and collect its output. */
export function run(
  cmd: string,
  args: string[],
  opts: { cwd: string; input?: string; timeoutMs?: number; signal?: AbortSignal } = { cwd: process.cwd() },
): Promise<ExecResult> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: opts.cwd, windowsHide: true, env: childEnv() });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          killTree(child.pid);
        }, opts.timeoutMs)
      : undefined;
    const onAbort = () => killTree(child.pid);
    opts.signal?.addEventListener("abort", onAbort);
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (err) => {
      stderr += String(err);
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
      resolve({ code: code ?? (timedOut ? 124 : 1), stdout, stderr, timedOut });
    });
    if (opts.input !== undefined) child.stdin.end(opts.input);
    else child.stdin.end();
  });
}

export function killTree(pid?: number) {
  if (!pid) return;
  if (process.platform === "win32") spawnSync("taskkill", ["/T", "/F", "/PID", String(pid)], { windowsHide: true });
  else {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        /* already gone */
      }
    }
  }
}

export interface ShellInfo {
  name: string;
  path: string;
  argsFor: (command: string) => string[];
}

let shellCache: ShellInfo | undefined;

/** Prefer bash everywhere (Git Bash on Windows); fall back to PowerShell. */
export function detectShell(): ShellInfo {
  if (shellCache) return shellCache;
  const bash = spawnSync("bash", ["--version"], { windowsHide: true });
  if (bash.status === 0) {
    shellCache = { name: "bash", path: "bash", argsFor: (c) => ["-c", c] };
  } else if (process.platform === "win32") {
    shellCache = { name: "powershell", path: "powershell.exe", argsFor: (c) => ["-NoProfile", "-NonInteractive", "-Command", c] };
  } else {
    shellCache = { name: "sh", path: "/bin/sh", argsFor: (c) => ["-c", c] };
  }
  return shellCache;
}

let rgAvailable: boolean | undefined;
export function hasRipgrep(): boolean {
  rgAvailable ??= spawnSync("rg", ["--version"], { windowsHide: true }).status === 0;
  return rgAvailable;
}

export function runShell(command: string, cwd: string, timeoutMs: number, signal?: AbortSignal) {
  const sh = detectShell();
  return run(sh.path, sh.argsFor(command), { cwd, timeoutMs, signal });
}

/** Keep the head and tail of long output so errors at either end survive. */
export function clip(text: string, max = 30_000): string {
  if (text.length <= max) return text;
  const half = Math.floor(max / 2);
  return `${text.slice(0, half)}\n\n... [${text.length - max} characters omitted] ...\n\n${text.slice(-half)}`;
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

const IGNORED_DIRS = new Set([
  ".git", "node_modules", "dist", "build", "out", ".next", ".swarmcode", "target", "vendor",
  "__pycache__", ".venv", "venv", ".idea", ".vscode", "coverage", ".cache",
]);

// File listings are reused for a few seconds; any write through our tools
// invalidates them, so agents never see a stale view of their own changes.
const listCache = new Map<string, { at: number; files: string[] }>();
const LIST_TTL_MS = 5000;
/** Upper bound on files considered, so a huge tree can't stall an agent. */
const MAX_FILES = 50_000;

export function invalidateFileList(root: string) {
  listCache.delete(root);
}

/** Project files relative to root. Uses git (respects .gitignore) when available. */
export async function listFiles(root: string): Promise<string[]> {
  const hit = listCache.get(root);
  if (hit && Date.now() - hit.at < LIST_TTL_MS) return hit.files;
  const files = await listFilesUncached(root);
  listCache.set(root, { at: Date.now(), files });
  return files;
}

async function listFilesUncached(root: string): Promise<string[]> {
  if (fs.existsSync(path.join(root, ".git"))) {
    const r = await run("git", ["ls-files", "-co", "--exclude-standard", "-z"], { cwd: root, timeoutMs: 20_000 });
    if (r.code === 0 && !r.timedOut) {
      return r.stdout
        .split("\0")
        .filter(Boolean)
        .filter((f) => !f.startsWith(".swarmcode/"))
        .slice(0, MAX_FILES)
        .filter((f) => fs.existsSync(path.join(root, f)));
    }
  }
  const out: string[] = [];
  const deadline = Date.now() + 15_000;
  const walk = (dir: string, rel: string) => {
    if (out.length >= MAX_FILES || Date.now() > deadline) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // unreadable directory
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) walk(path.join(dir, entry.name), rel ? `${rel}/${entry.name}` : entry.name);
      } else if (entry.isFile()) out.push(rel ? `${rel}/${entry.name}` : entry.name);
    }
  };
  walk(root, "");
  return out;
}

/** Translate a glob (supports **, *, ?, {a,b}) to a RegExp over forward-slash paths. */
export function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        i++;
        if (glob[i + 1] === "/") {
          i++;
          re += "(?:.*/)?";
        } else re += ".*";
      } else re += "[^/]*";
    } else if (c === "?") re += "[^/]";
    else if (c === "{") {
      const end = glob.indexOf("}", i);
      if (end === -1) re += "\\{";
      else {
        re += `(?:${glob.slice(i + 1, end).split(",").map(escapeRe).join("|")})`;
        i = end;
      }
    } else re += escapeRe(c);
  }
  // A pattern without a slash matches at any depth, like most tools.
  return new RegExp(glob.includes("/") ? `^${re}$` : `(?:^|/)${re}$`);
}

function escapeRe(s: string) {
  return s.replace(/[.+^$()|[\]\\]/g, "\\$&");
}

/** Resolve a model-supplied path and refuse anything outside root. */
export function confine(root: string, p: string): string {
  const target = path.resolve(root, p);
  const rel = path.relative(root, target);
  if (rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    throw new Error(`Path "${p}" is outside the workspace ${root}`);
  }
  return target;
}

export function toPosix(p: string) {
  return p.split(path.sep).join("/");
}

/** A tiny async mutex: run(fn) executes fns one at a time. */
export class Mutex {
  private tail: Promise<unknown> = Promise.resolve();
  run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.tail.then(fn, fn);
    this.tail = next.catch(() => undefined);
    return next;
  }
}
