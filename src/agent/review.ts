import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Effort, ModelHandle } from "../providers/types.js";
import { READ_ONLY_TOOLS } from "../tools/index.js";
import { clip, run } from "../util.js";
import { Agent } from "./agent.js";
import type { EventSink, UsageTracker } from "./events.js";

// An independent second opinion on every substantial change: a fresh agent,
// with no stake in the implementation, checks the diff against the request.

const REVIEWER_PROMPT = `You are an exacting senior engineer reviewing a change before it ships. You get the original request and the diff that is supposed to implement it, and read-only tools to inspect the codebase.

Find real, material problems only:
- requirements that are missing, misread or only partly done (check each one)
- bugs: wrong logic, unhandled edge cases (empty, null, zero, boundaries, unicode, concurrency), off-by-one, wrong error handling
- broken callers, tests or types elsewhere in the codebase caused by the change
- security vulnerabilities (injection, XSS, missing authorization, secrets, unsafe deserialization, path traversal)
- tests that don't actually test the behavior they claim to

Read the surrounding code to confirm each problem before reporting it. Do not report style preferences, optional refactors or speculative concerns.

Answer format:
- If there are no material problems: the first line is exactly "LGTM", followed by one sentence.
- Otherwise: a numbered list. Each item: file:line, the problem, why it matters (a concrete failing input if possible), and the fix.`;

export interface ReviewOptions {
  request: string;
  diff: string;
  root: string;
  model: ModelHandle;
  effort?: Effort;
  events: EventSink;
  usage: UsageTracker;
  signal?: AbortSignal;
  name?: string;
}

export interface ReviewResult {
  approved: boolean;
  feedback: string;
}

export async function reviewChange(opts: ReviewOptions): Promise<ReviewResult> {
  const reviewer = new Agent({
    name: opts.name ?? "reviewer",
    model: opts.model,
    effort: opts.effort,
    system: `${REVIEWER_PROMPT}\n\n<environment>\nWorkspace root: ${opts.root}\n</environment>`,
    tools: READ_ONLY_TOOLS.filter((t) => !t.spec.name.startsWith("web_")),
    ctx: { root: opts.root, approve: async () => true, signal: opts.signal },
    events: opts.events,
    usage: opts.usage,
    maxTurns: 30,
  });
  const feedback = (
    await reviewer.run(`<request>\n${clip(opts.request, 20_000)}\n</request>\n\n<diff>\n${clip(opts.diff, 80_000)}\n</diff>`, opts.signal)
  ).trim();
  return { approved: /^\**LGTM\b/i.test(feedback), feedback };
}

/** Lines added or removed in a unified diff. */
export function changedLines(diff: string): number {
  return diff.split("\n").filter((l) => /^[+-](?![+-]{2} )/.test(l)).length;
}

/**
 * Unified diff between saved original contents (null = file did not exist) and
 * the files' current contents. Uses `git diff --no-index`, so it works in any folder.
 */
export async function diffFromSnapshots(root: string, originals: Map<string, Buffer | string | null>): Promise<string> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "swarmcode-diff-"));
  const parts: string[] = [];
  try {
    for (const [file, before] of originals) {
      const rel = path.relative(root, file).split(path.sep).join("/");
      const beforeFile = path.join(tmp, "before");
      const afterFile = path.join(tmp, "after");
      fs.writeFileSync(beforeFile, before ?? "");
      fs.writeFileSync(afterFile, fs.existsSync(file) ? fs.readFileSync(file) : "");
      const r = await run("git", ["diff", "--no-index", "--no-color", "--", beforeFile, afterFile], { cwd: tmp });
      if (!r.stdout.trim()) continue;
      // Relabel the temp paths with the real file name.
      const body = r.stdout.split("\n").slice(r.stdout.startsWith("diff --git") ? 1 : 0).filter((l) => !/^(index |--- |\+\+\+ )/.test(l));
      const status = before === null ? "new file mode 100644\n" : fs.existsSync(file) ? "" : "deleted file mode 100644\n";
      parts.push(`diff --git a/${rel} b/${rel}\n${status}--- ${before === null ? "/dev/null" : `a/${rel}`}\n+++ ${fs.existsSync(file) ? `b/${rel}` : "/dev/null"}\n${body.join("\n")}`);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  return parts.join("\n");
}
