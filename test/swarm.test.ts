import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { UsageTracker } from "../src/agent/events.js";
import { defaultConfig, registerModel } from "../src/config.js";
import type { ChatSession, ModelHandle, ToolCall, TurnInput, TurnResult } from "../src/providers/types.js";
import { runSwarm } from "../src/swarm/orchestrator.js";

// A scripted model: exercises the whole pipeline (planning, parallel
// worktrees, dependency ordering, conflict resolution, verification, apply)
// without network access.
function fakeModel(spec: string): ModelHandle {
  return {
    spec,
    provider: "fake",
    model: spec,
    contextWindow: 100_000,
    createSession: ({ system }) => new FakeSession(system),
  };
}

let ids = 0;
const call = (name: string, input: Record<string, unknown>): ToolCall => ({ id: `t${++ids}`, name, input });

class FakeSession implements ChatSession {
  private turnNo = 0;
  private firstText = "";
  constructor(private system: string) {}
  reset() {
    this.turnNo = 0;
  }
  exportHistory() {
    return [];
  }
  importHistory() {}
  async turn(input: TurnInput): Promise<TurnResult> {
    if (this.turnNo++ === 0) this.firstText = input.text ?? "";
    const done = (text: string): TurnResult => ({ text, toolCalls: [], stop: "end", usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0 }, contextTokens: 15 });
    const tools = (...toolCalls: ToolCall[]): TurnResult => ({ ...done(""), toolCalls, stop: "tool_use" });
    const n = this.turnNo;

    if (this.system.includes("planning lead")) {
      if (n === 1) {
        return tools(
          call("submit_plan", {
            summary: "Create alpha and beta in parallel, then gamma from alpha.",
            tasks: [
              { id: "alpha", title: "Alpha", description: "write alpha.txt", files: ["alpha.txt"], depends_on: [] },
              { id: "beta", title: "Beta", description: "write beta.txt", files: ["beta.txt"], depends_on: [] },
              { id: "gamma", title: "Gamma", description: "write gamma.txt from alpha", files: ["gamma.txt"], depends_on: ["alpha"] },
            ],
            verify_command: "grep -q saw:A gamma.txt && grep -q alpha README.md && grep -q beta README.md",
          }),
        );
      }
      return done("Plan submitted.");
    }

    if (this.system.includes("merge engineer")) {
      if (n === 1) return tools(call("write_file", { path: "README.md", content: "alpha\nbeta\n" }));
      return done("Combined both lines.");
    }

    const id = /YOUR TASK: (\w+)/.exec(this.firstText)?.[1];
    if (id === "alpha" || id === "beta") {
      // Both also rewrite README.md, which forces a real merge conflict.
      if (n === 1) {
        return tools(
          call("write_file", { path: `${id}.txt`, content: id === "alpha" ? "A" : "B" }),
          call("write_file", { path: "README.md", content: `${id}\n` }),
        );
      }
      return done(`${id} done`);
    }
    if (id === "gamma") {
      if (n === 1) return tools(call("read_file", { path: "alpha.txt" }));
      if (n === 2) {
        const saw = input.toolResults?.[0]?.content.includes("A") ? "A" : "none";
        return tools(call("write_file", { path: "gamma.txt", content: `saw:${saw}` }));
      }
      return done("gamma done");
    }
    return done("nothing to do");
  }
}

test("swarm: parallel tasks, dependency, merge conflict, verify, apply", { timeout: 120_000 }, async () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "swarmcode-swarm-"));
  const g = (...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: repo }).toString();
  g("init", "-q");
  fs.writeFileSync(path.join(repo, "README.md"), "base\n");
  g("add", "-A");
  g("commit", "-qm", "init");

  const cfg = defaultConfig();
  for (const role of ["main", "planner", "worker", "explorer"] as const) cfg.models[role] = "fake/model";
  registerModel(fakeModel("fake/model"));

  const statuses: string[] = [];
  const result = await runSwarm({
    goal: "make alpha, beta, gamma",
    root: repo,
    cfg,
    usage: new UsageTracker(),
    events: (e) => {
      if (e.type === "status") statuses.push(e.message);
    },
    confirmPlan: async () => true,
    confirmApply: async () => true,
  });

  assert.deepEqual(result.tasks.map((t) => [t.task.id, t.status]), [["alpha", "done"], ["beta", "done"], ["gamma", "done"]], JSON.stringify(result.tasks, null, 2));
  assert.equal(result.verified, true, statuses.join("\n"));
  assert.ok(statuses.some((s) => s.includes("Merge conflict")), "expected a conflict to be resolved");
  assert.ok(result.applied);
  assert.equal(fs.readFileSync(path.join(repo, "gamma.txt"), "utf8"), "saw:A");
  assert.equal(fs.readFileSync(path.join(repo, "README.md"), "utf8").replace(/\r\n/g, "\n"), "alpha\nbeta\n");
  // Worktrees are cleaned up; only the result branch remains.
  assert.deepEqual(fs.readdirSync(path.join(repo, ".swarmcode", "worktrees", result.runId)), []);
  assert.match(g("branch", "--list", "swarm/*"), new RegExp(`swarm/${result.runId}\\s*$`));
});
