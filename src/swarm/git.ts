import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Mutex, run, type ExecResult } from "../util.js";

// All git calls that touch the shared repository (refs, object store, worktree
// list) go through one mutex so parallel agents never trip over git's locks.
const gitLock = new Mutex();
const IDENTITY = ["-c", "user.name=SwarmCode", "-c", "user.email=swarmcode@localhost", "-c", "commit.gpgsign=false"];

export async function git(cwd: string, args: string[], input?: string): Promise<ExecResult> {
  return gitLock.run(() => run("git", [...IDENTITY, ...args], { cwd, input }));
}

export async function gitOk(cwd: string, args: string[]): Promise<string> {
  const r = await git(cwd, args);
  if (r.code !== 0) throw new Error(`git ${args.join(" ")} failed: ${(r.stderr || r.stdout).trim()}`);
  return r.stdout.trim();
}

export async function isGitRepo(dir: string): Promise<boolean> {
  const r = await run("git", ["rev-parse", "--is-inside-work-tree"], { cwd: dir });
  return r.code === 0 && r.stdout.trim() === "true";
}

export async function repoRoot(dir: string): Promise<string> {
  return path.resolve(await gitOk(dir, ["rev-parse", "--show-toplevel"]));
}

/**
 * Where a folder's project lives. A git repo at the home directory (dotfiles)
 * is not the user's project, so a folder inside it is its own project.
 */
export async function resolveProject(dir: string): Promise<{ root: string; isRepo: boolean; homeRepo: boolean }> {
  if (!(await isGitRepo(dir))) return { root: path.resolve(dir), isRepo: false, homeRepo: false };
  const root = await repoRoot(dir);
  // Compare real paths: on Windows the same folder can appear as a short 8.3
  // name (RUNNER~1) or a long one, and with different letter case.
  const real = (p: string) => {
    try {
      return fs.realpathSync.native(p).toLowerCase();
    } catch {
      return path.resolve(p).toLowerCase();
    }
  };
  const atHome = real(root) === real(os.homedir()) && real(dir) !== real(root);
  return atHome ? { root: path.resolve(dir), isRepo: false, homeRepo: true } : { root, isRepo: true, homeRepo: false };
}

/**
 * The commit agents start from. If the working tree has uncommitted changes to
 * tracked files, `git stash create` makes a commit containing them without
 * touching the working tree or the stash list, so agents see what the user sees.
 */
export async function snapshotBase(root: string): Promise<{ base: string; dirty: boolean; untracked: string[] }> {
  const head = await gitOk(root, ["rev-parse", "HEAD"]).catch(() => {
    throw new Error("The repository has no commits yet. Make an initial commit first.");
  });
  const stash = (await gitOk(root, ["stash", "create", "swarm snapshot"])).trim();
  const untracked = (await gitOk(root, ["ls-files", "--others", "--exclude-standard"])).split("\n").filter(Boolean);
  return { base: stash || head, dirty: Boolean(stash), untracked };
}

export async function addWorktree(root: string, dir: string, branch: string, from: string) {
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  await gitOk(root, ["worktree", "add", "-b", branch, dir, from]);
  linkDependencies(root, dir);
}

export async function removeWorktree(root: string, dir: string) {
  await git(root, ["worktree", "remove", "--force", dir]);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

/**
 * Worktrees don't contain ignored directories like node_modules, so builds and
 * tests would fail in them. Link the main checkout's copies in instead of
 * reinstalling (junctions on Windows need no admin rights).
 */
function linkDependencies(root: string, dir: string) {
  for (const name of ["node_modules", ".venv", "venv", "vendor"]) {
    const src = path.join(root, name);
    const dest = path.join(dir, name);
    if (fs.existsSync(src) && !fs.existsSync(dest)) {
      try {
        fs.symlinkSync(src, dest, process.platform === "win32" ? "junction" : "dir");
      } catch {
        /* best effort */
      }
    }
  }
}

/** Stage and commit everything in a worktree. Returns false when nothing changed. */
export async function commitAll(dir: string, message: string): Promise<boolean> {
  await gitOk(dir, ["add", "-A"]);
  const staged = await git(dir, ["diff", "--cached", "--quiet"]);
  if (staged.code === 0) return false;
  await gitOk(dir, ["commit", "-q", "-m", message]);
  return true;
}

export async function mergeBranch(dir: string, branch: string, message: string): Promise<{ ok: boolean; conflicts: string[] }> {
  const r = await git(dir, ["merge", "--no-ff", "-m", message, branch]);
  if (r.code === 0) return { ok: true, conflicts: [] };
  const conflicts = (await gitOk(dir, ["diff", "--name-only", "--diff-filter=U"])).split("\n").filter(Boolean);
  if (!conflicts.length) throw new Error(`git merge failed: ${(r.stderr || r.stdout).trim()}`);
  return { ok: false, conflicts };
}

export async function filesWithMarkers(dir: string, files: string[]): Promise<string[]> {
  return files.filter((f) => {
    try {
      return /^(<{7}|>{7})( |$)/m.test(fs.readFileSync(path.join(dir, f), "utf8"));
    } catch {
      return false;
    }
  });
}

/** Apply the net result of a run onto the user's working tree. */
export async function applyToWorkingTree(root: string, base: string, head: string, patchFile: string): Promise<void> {
  const diff = await git(root, ["diff", "--binary", base, head]);
  if (diff.code !== 0) throw new Error(diff.stderr);
  if (!diff.stdout.trim()) return;
  fs.mkdirSync(path.dirname(patchFile), { recursive: true });
  fs.writeFileSync(patchFile, diff.stdout);
  const plain = await git(root, ["apply", "--whitespace=nowarn", patchFile]);
  if (plain.code === 0) return;
  const threeWay = await git(root, ["apply", "--3way", "--whitespace=nowarn", patchFile]);
  if (threeWay.code !== 0) {
    throw new Error(`Could not apply the result cleanly (${threeWay.stderr.trim()}). The patch is saved at ${patchFile}.`);
  }
}

/** Keep SwarmCode's working directories out of `git status`. */
export function excludeSwarmCodeDir(root: string) {
  const exclude = path.join(root, ".git", "info", "exclude");
  if (!fs.existsSync(path.dirname(exclude))) return;
  const current = fs.existsSync(exclude) ? fs.readFileSync(exclude, "utf8") : "";
  // The dependency links made by linkDependencies are symlinks, which a
  // "node_modules/" pattern does not match, so exclude them by bare name too.
  const wanted = [".swarmcode/worktrees/", ".swarmcode/runs/", ".swarmcode/traces/", ".swarmcode/outputs/", ".swarmcode/screenshots/", ".swarmcode/proofs/", ".swarmcode/hidden/", "/node_modules", "/.venv", "/venv", "/vendor"];
  const lines = current.split(/\r?\n/);
  const missing = wanted.filter((w) => !lines.includes(w));
  if (missing.length) {
    fs.appendFileSync(exclude, `${current && !current.endsWith("\n") ? "\n" : ""}${missing.join("\n")}\n`);
  }
}
