import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { ChatSession, ModelHandle, ToolCall, TurnInput, TurnResult } from "../src/providers/types.js";

// User-level state (sessions, global config) goes to a temp dir, not ~.
process.env.SWARMCODE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "swarmcode-home-"));
const { registerModel } = await import("../src/config.js");
const { Engine } = await import("../src/engine.js");

let ids = 0;
const call = (name: string, input: Record<string, unknown>): ToolCall => ({ id: `e${++ids}`, name, input });
const done = (text: string): TurnResult => ({ text, toolCalls: [], stop: "end", usage: { input: 100, output: 20, cacheRead: 0, cacheWrite: 0 }, contextTokens: 120 });
const tools = (...toolCalls: ToolCall[]): TurnResult => ({ ...done(""), toolCalls, stop: "tool_use" });

/** Scripted sessions. "weak" workers always crash, "strong" ones succeed. */
class Scripted implements ChatSession {
  private n = 0;
  private first = "";
  private history: unknown[] = [];
  constructor(private system: string, private strength: "weak" | "strong") {}
  reset() {
    this.n = 0;
    this.history = [];
  }
  exportHistory() {
    return structuredClone(this.history);
  }
  importHistory(h: unknown[]) {
    this.history = h;
  }
  async turn(input: TurnInput): Promise<TurnResult> {
    if (this.n++ === 0) this.first = input.text ?? "";
    if (input.text) this.history.push({ role: "user", content: input.text });
    const res = this.respond(input);
    if (res.text) this.history.push({ role: "assistant", content: res.text });
    return res;
  }
  private respond(input: TurnInput): TurnResult {
    const n = this.n;
    if (this.system.includes("expert AI software engineer")) {
      // Main agent: escalates to the parallel pipeline, then reports.
      if (n === 1) return tools(call("swarm", { goal: "Create solo.txt containing 'solo'" }));
      return done(`Finished: ${input.toolResults?.[0]?.content.split("\n")[0] ?? ""}`);
    }
    if (this.system.includes("planning lead")) {
      if (n === 1) {
        return tools(
          call("submit_plan", {
            summary: "One task.",
            tasks: [{ id: "solo", title: "Solo", description: "write solo.txt", files: ["solo.txt"], depends_on: [] }],
          }),
        );
      }
      return done("ok");
    }
    // Worker
    if (this.strength === "weak") throw new Error("weak model fell over");
    if (/YOUR TASK: solo/.test(this.first) && n === 1) return tools(call("write_file", { path: "solo.txt", content: "solo" }));
    return done("wrote solo.txt");
  }
}

function model(spec: string, strength: "weak" | "strong"): ModelHandle {
  return { spec, provider: "fake", model: spec, contextWindow: 200_000, createSession: ({ system }) => new Scripted(system, strength) };
}

test("engine: agent escalates to the swarm, failed worker is retried on the lead model, session resumes", { timeout: 120_000 }, async () => {
  registerModel(model("fake/strong", "strong"));
  registerModel(model("fake/weak", "weak"));
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "swarmcode-engine-"));
  const g = (...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: repo }).toString();
  g("init", "-q");
  fs.mkdirSync(path.join(repo, ".swarmcode"));
  fs.writeFileSync(
    path.join(repo, ".swarmcode", "config.json"),
    JSON.stringify({ models: { main: "fake/strong", planner: "fake/strong", worker: "fake/weak", explorer: "fake/strong" } }),
  );
  fs.writeFileSync(path.join(repo, ".gitignore"), ".swarmcode/\n");
  g("add", "-A");
  g("commit", "-qm", "init");

  const statuses: string[] = [];
  let finalTasks: Array<{ status: string; model?: string }> = [];
  const hooks = {
    events: (e: { type: string; message?: string }) => {
      if (e.type === "status") statuses.push(e.message!);
    },
    approve: async () => true,
    confirmPlan: async () => true,
    confirmApply: async () => true,
    onTasks: (t: Array<{ status: string; model?: string }>) => (finalTasks = structuredClone(t)),
  };
  const engine = await Engine.open(repo, hooks, { autoApprove: true });
  const reply = await engine.send("please make solo.txt");

  assert.match(reply, /Finished/);
  assert.equal(fs.readFileSync(path.join(repo, "solo.txt"), "utf8"), "solo", statuses.join("\n"));
  assert.ok(statuses.some((s) => s.includes("retrying with fake/strong")), statuses.join("\n"));
  assert.equal(finalTasks[0]?.status, "done");
  assert.equal(finalTasks[0]?.model, "fake/strong");
  await engine.close();

  // A new engine on the same project can resume the conversation.
  const again = await Engine.open(repo, hooks, { autoApprove: true });
  const saved = await again.resume();
  assert.ok(saved, "session should have been saved");
  assert.equal(saved!.title, "please make solo.txt");
  assert.deepEqual(again.transcript()[0], { role: "user", text: "please make solo.txt" });
  await again.close();
});

/** A main agent that stops early once; the verify step must send it back. */
class Lazy implements ChatSession {
  private n = 0;
  reset() {}
  exportHistory() {
    return [];
  }
  importHistory() {}
  async turn(input: TurnInput): Promise<TurnResult> {
    this.n++;
    if (this.n === 1) return tools(call("write_file", { path: "a.txt", content: "half" }));
    if (this.n === 2) return done("Done!"); // claims success too early
    if (this.n === 3) {
      assert.match(input.text ?? "", /verification command/);
      return tools(call("write_file", { path: "a.txt", content: "complete" }));
    }
    return done("Now really done.");
  }
}

test("engine: auto-verify sends an agent that stopped early back to work", { timeout: 60_000 }, async () => {
  registerModel({ spec: "fake/lazy", provider: "fake", model: "lazy", contextWindow: 100_000, createSession: () => new Lazy() });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "swarmcode-verify-"));
  const statuses: string[] = [];
  const engine = await Engine.open(
    dir,
    {
      events: (e: { type: string; message?: string }) => void (e.type === "status" && statuses.push(e.message!)),
      approve: async () => true,
      confirmPlan: async () => true,
      confirmApply: async () => true,
    },
    { autoApprove: true, model: "fake/lazy", verifyCommand: `node -e "process.exit(require('fs').readFileSync('a.txt','utf8')==='complete'?0:1)"` },
  );
  const reply = await engine.send("write a.txt with the word complete");
  assert.equal(reply, "Now really done.");
  assert.equal(fs.readFileSync(path.join(dir, "a.txt"), "utf8"), "complete");
  assert.ok(statuses.some((s) => s.startsWith("Verification failed")));
  assert.ok(statuses.includes("Verification passed."));
  delete process.env.SWARMCODE_MODEL;
  await engine.close();
});

/** Main agent that writes a buggy file, then fixes it after review feedback. */
class Reviewed implements ChatSession {
  private n = 0;
  constructor(private system: string) {}
  reset() {}
  exportHistory() {
    return [];
  }
  importHistory() {}
  async turn(input: TurnInput): Promise<TurnResult> {
    this.n++;
    if (this.system.includes("reviewing a change")) {
      return done(input.text?.includes("return a - b") ? "1. math.js:1 subtract instead of add; add(2, 3) returns -1." : "LGTM - looks right.");
    }
    if (this.n === 1) return tools(call("write_file", { path: "math.js", content: "export const add = (a, b) => {\n  return a - b;\n};\n" }));
    if (this.n === 2) return done("Added add().");
    if (this.n === 3) {
      assert.match(input.text ?? "", /independent reviewer/);
      return tools(call("write_file", { path: "math.js", content: "export const add = (a, b) => {\n  return a + b;\n};\n" }));
    }
    return done("Fixed the reviewer's finding.");
  }
}

test("engine: reviewer findings go back to the agent; undo restores files", { timeout: 60_000 }, async () => {
  registerModel({ spec: "fake/reviewed", provider: "fake", model: "reviewed", contextWindow: 100_000, createSession: ({ system }) => new Reviewed(system) });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "swarmcode-review-"));
  fs.mkdirSync(path.join(dir, ".swarmcode"));
  fs.writeFileSync(path.join(dir, ".swarmcode", "config.json"), JSON.stringify({ review: "always" }));
  const statuses: string[] = [];
  const engine = await Engine.open(
    dir,
    {
      events: (e: { type: string; message?: string }) => void (e.type === "status" && statuses.push(e.message!)),
      approve: async () => true,
      confirmPlan: async () => true,
      confirmApply: async () => true,
    },
    { autoApprove: true, model: "fake/reviewed" },
  );
  const reply = await engine.send("add an add(a, b) function in math.js");
  assert.equal(reply, "Fixed the reviewer's finding.");
  assert.match(fs.readFileSync(path.join(dir, "math.js"), "utf8"), /a \+ b/);
  assert.ok(statuses.some((s) => s.includes("reviewer found issues")), statuses.join("\n"));
  assert.ok(engine.canUndo);
  assert.deepEqual(engine.undo(), ["math.js"]);
  assert.equal(fs.existsSync(path.join(dir, "math.js")), false, "undo removes a file the agent created");
  delete process.env.SWARMCODE_MODEL;
  await engine.close();
});
