import fs from "node:fs";
import path from "node:path";
import { Agent } from "../agent/agent.js";
import type { EventSink, UsageTracker } from "../agent/events.js";
import { SWARMCODE_HOME } from "../config.js";
import type { Effort, ModelHandle } from "../providers/types.js";
import { READ_ONLY_TOOLS, ToolError, type Tool } from "../tools/index.js";
import { clip, confine, runShell } from "../util.js";

// Hidden-test guarantee: before any code is written, an independent QA agent
// turns the request into acceptance tests. The implementing agents never see
// them, so they cannot pass by weakening or special-casing the tests. The work
// counts as done only when the hidden tests pass.

export interface AcceptanceSuite {
  id: string;
  files: Array<{ path: string; content: string }>;
  command: string;
  summary: string;
  /** True when the tests failed on the code before the change (as they should for new behavior). */
  failedBefore: boolean;
}

export interface AcceptanceResult {
  passed: boolean;
  output: string;
}

const AUTHOR_PROMPT = `You are a senior QA engineer writing HIDDEN acceptance tests for a change before it is implemented. The engineer implementing the change will never see these tests; they decide whether the work is accepted.

Process:
1. Read the request carefully and investigate the codebase with the read-only tools: find the test framework, test file conventions, how tests are run, and the existing code the change touches.
2. Write tests that check the externally observable behavior the request asks for: every stated requirement, plus the important edge cases and error cases it implies. Use names, signatures, files and messages exactly as the request states them. Do not depend on implementation details the request leaves open.
3. Put the tests in NEW files that follow the project's conventions (for example test/hidden_acceptance_<topic>.test.js); never overwrite existing files.
4. Provide a command that runs ONLY your new test files with the project's test runner, from the project root.
5. Call submit_tests exactly once.

The tests must be correct: a correct implementation must pass them. Prefer fewer, precise tests over many speculative ones.`;

function submitTool(root: string, onSubmit: (s: Omit<AcceptanceSuite, "id" | "failedBefore">) => void): Tool {
  return {
    readOnly: false,
    spec: {
      name: "submit_tests",
      description: "Submit the hidden acceptance tests. Call exactly once.",
      parameters: {
        type: "object",
        properties: {
          files: {
            type: "array",
            items: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] },
          },
          command: { type: "string", description: "Runs only these test files, from the project root" },
          summary: { type: "string", description: "One line per requirement covered" },
        },
        required: ["files", "command", "summary"],
      },
    },
    async run(input) {
      const files = (input.files as Array<{ path: string; content: string }>) ?? [];
      if (!files.length) throw new ToolError("files is empty.");
      for (const f of files) {
        if (!f.path || typeof f.content !== "string") throw new ToolError("Every file needs a path and content.");
        const abs = confine(root, f.path);
        if (fs.existsSync(abs)) throw new ToolError(`${f.path} already exists; use a new file name.`);
      }
      if (!String(input.command ?? "").trim()) throw new ToolError("command is required.");
      onSubmit({ files: files.map((f) => ({ path: f.path.replace(/\\/g, "/"), content: f.content })), command: String(input.command), summary: String(input.summary ?? "") });
      return "Tests received. Reply with one short sentence.";
    },
  };
}

/** Write the suite into `dir`, run it, and remove the files again (unless keep). */
export async function runAcceptance(suite: AcceptanceSuite, dir: string, signal?: AbortSignal, keep = false): Promise<AcceptanceResult> {
  const written: string[] = [];
  try {
    for (const f of suite.files) {
      const abs = confine(dir, f.path);
      if (fs.existsSync(abs)) continue; // never clobber a real file
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, f.content);
      written.push(abs);
    }
    const r = await runShell(suite.command, dir, 600_000, signal);
    return { passed: r.code === 0, output: clip(`${r.stdout}\n${r.stderr}`.trim(), 12_000) };
  } finally {
    if (!keep) for (const f of written) fs.rmSync(f, { force: true });
  }
}

/** Failure details without the test source, so implementers learn what broke but can't overfit the code. */
export function failureSummary(output: string): string {
  const interesting = output
    .split("\n")
    .filter((l) => /not ok|fail|error|expected|actual|assert|✖|✗|●|\bFAILED\b/i.test(l))
    .slice(0, 60)
    .join("\n");
  return clip(interesting || output, 5000);
}

export async function authorAcceptanceTests(opts: {
  request: string;
  root: string;
  model: ModelHandle;
  effort?: Effort;
  events: EventSink;
  usage: UsageTracker;
  signal?: AbortSignal;
}): Promise<AcceptanceSuite | undefined> {
  let submitted: Omit<AcceptanceSuite, "id" | "failedBefore"> | undefined;
  const author = new Agent({
    name: "test-author",
    model: opts.model,
    effort: opts.effort,
    system: `${AUTHOR_PROMPT}\n\n<environment>\nWorkspace root: ${opts.root}\n</environment>`,
    tools: [...READ_ONLY_TOOLS.filter((t) => t.spec.name !== "web_fetch"), submitTool(opts.root, (s) => (submitted = s))],
    ctx: { root: opts.root, approve: async () => true, signal: opts.signal },
    events: opts.events,
    usage: opts.usage,
    maxTurns: 40,
  });
  await author.run(`<request>\n${opts.request}\n</request>`, opts.signal);
  if (!submitted) await author.run("You have not submitted the tests. Call submit_tests now.", opts.signal);
  if (!submitted) return undefined;

  const suite: AcceptanceSuite = { id: `acc-${Date.now()}`, ...submitted, failedBefore: false };
  // Stored outside the project, where agents' file tools (confined to the project) can't read it.
  const store = path.join(SWARMCODE_HOME, "hidden", suite.id);
  fs.mkdirSync(store, { recursive: true });
  fs.writeFileSync(path.join(store, "suite.json"), JSON.stringify(suite, null, 2));
  // On the code before the change, tests of new behavior should fail.
  suite.failedBefore = !(await runAcceptance(suite, opts.root, opts.signal)).passed;
  return suite;
}
