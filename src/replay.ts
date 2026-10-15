import fs from "node:fs";
import path from "node:path";
import type { AgentEvent } from "./agent/events.js";
import { Engine, type EngineHooks } from "./engine.js";
import { addWorktree, commitAll, git, gitOk, removeWorktree } from "./swarm/git.js";

// Time-travel replay: every request in an audit trail records a git checkpoint
// of the code it started from. You can step through what happened in any past
// request, and fork it: re-run that request (or an edited version, or with a
// different model) from exactly that code, on a new branch, without touching
// your working tree.

export interface ReplayRequest {
  index: number;
  ts: string;
  mode: string;
  prompt: string;
  checkpoint?: string;
  steps: Array<{ ts: string; line: string }>;
  result?: string;
}

export function readRequests(traceFile: string): ReplayRequest[] {
  const out: ReplayRequest[] = [];
  for (const raw of fs.readFileSync(traceFile, "utf8").split("\n").filter(Boolean)) {
    let r: Record<string, unknown>;
    try {
      r = JSON.parse(raw);
    } catch {
      continue;
    }
    const ts = String(r.ts ?? "");
    const cur = out[out.length - 1];
    if (r.type === "request") {
      out.push({ index: out.length + 1, ts, mode: String(r.mode), prompt: String(r.prompt), steps: [] });
    } else if (!cur) continue;
    else if (r.type === "checkpoint") cur.checkpoint = String(r.commit);
    else if (r.type === "result") cur.result = String(r.summary);
    else if (r.type === "approval") cur.steps.push({ ts, line: `${r.allowed ? "approved" : "denied"} ${r.kind}: ${String(r.summary).split("\n")[0]}` });
    else if (r.type === "event") {
      const e = r.event as AgentEvent;
      if (e.type === "tool") cur.steps.push({ ts, line: `[${e.agent}] ${e.name} ${e.summary}` });
      else if (e.type === "tool_error") cur.steps.push({ ts, line: `[${e.agent}] ${e.name} FAILED: ${e.error.split("\n")[0]}` });
      else if (e.type === "status") cur.steps.push({ ts, line: `-- ${e.message}` });
    }
  }
  return out;
}

export function renderRequests(reqs: ReplayRequest[], detail?: number): string {
  if (detail !== undefined) {
    const r = reqs[detail - 1];
    if (!r) throw new Error(`No request #${detail}; this session has ${reqs.length}.`);
    return [
      `#${r.index}  ${r.ts.slice(0, 19).replace("T", " ")}  (${r.mode})  checkpoint ${r.checkpoint?.slice(0, 10) ?? "none"}`,
      `> ${r.prompt}`,
      "",
      ...r.steps.map((s, i) => `${String(i + 1).padStart(3)}  ${s.ts.slice(11, 19)}  ${s.line.slice(0, 200)}`),
      "",
      `Result: ${(r.result ?? "(none)").replace(/\s+/g, " ").slice(0, 600)}`,
    ].join("\n");
  }
  return reqs
    .map((r) => `#${r.index}  ${r.ts.slice(0, 19).replace("T", " ")}  ${r.mode.padEnd(16)} ${String(r.steps.length).padStart(3)} steps  ${r.checkpoint ? "⟲" : " "}  ${r.prompt.replace(/\s+/g, " ").slice(0, 90)}`)
    .join("\n");
}

export interface ForkResult {
  branch: string;
  base: string;
  reply: string;
  diffStat: string;
}

/** Re-run request #index from its checkpoint on a new branch, optionally with another model or prompt. */
export async function forkRequest(
  root: string,
  req: ReplayRequest,
  hooks: EngineHooks,
  opts: { model?: string; prompt?: string; guarantee?: boolean } = {},
): Promise<ForkResult> {
  if (!req.checkpoint) throw new Error(`Request #${req.index} has no checkpoint (it was recorded outside a git repository or by an older version).`);
  await gitOk(root, ["cat-file", "-e", `${req.checkpoint}^{commit}`]).catch(() => {
    throw new Error(`Checkpoint ${req.checkpoint} no longer exists in this repository.`);
  });
  const id = new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);
  const branch = `swarm/fork-${req.index}-${id}`;
  const dir = path.join(root, ".swarmcode", "worktrees", `fork-${id}`);
  await addWorktree(root, dir, branch, req.checkpoint);
  try {
    const engine = await Engine.open(dir, hooks, { model: opts.model, autoApprove: true });
    let reply: string;
    try {
      reply = await engine.send(opts.prompt ?? req.prompt, { guarantee: opts.guarantee });
    } finally {
      await engine.close();
    }
    await commitAll(dir, `fork of request #${req.index}${opts.model ? ` with ${opts.model}` : ""}`);
    const diffStat = (await git(root, ["diff", "--stat", req.checkpoint, branch])).stdout.trim();
    return { branch, base: req.checkpoint, reply, diffStat };
  } finally {
    await removeWorktree(root, dir).catch(() => undefined);
  }
}
