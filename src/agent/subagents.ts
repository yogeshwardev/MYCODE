import type { ModelHandle, Effort } from "../providers/types.js";
import { READ_ONLY_TOOLS, ToolError, type Tool } from "../tools/index.js";
import { Agent } from "./agent.js";
import type { EventSink, UsageTracker } from "./events.js";

export interface DelegateDeps {
  root: string;
  model: ModelHandle;
  effort?: Effort;
  system: string;
  events: EventSink;
  usage: UsageTracker;
  maxParallel: number;
}

let counter = 0;

/**
 * The delegate tool: fans questions out to parallel read-only subagents, each
 * with a fresh context window, and returns only their final answers. This is
 * how one agent effectively works across many context windows at once.
 */
export function makeDelegateTool(deps: DelegateDeps): Tool {
  return {
    readOnly: true,
    spec: {
      name: "delegate",
      description:
        "Run research subagents in parallel. Each gets its own context window and read-only tools (read/list/glob/grep) and returns a written answer. Use for broad investigation so raw file contents don't fill your context. Give each a specific, self-contained question.",
      parameters: {
        type: "object",
        properties: {
          tasks: {
            type: "array",
            description: "One entry per subagent",
            items: {
              type: "object",
              properties: {
                label: { type: "string", description: "Short label, e.g. 'auth flow'" },
                prompt: { type: "string", description: "The full question and what to report back" },
              },
              required: ["label", "prompt"],
            },
          },
        },
        required: ["tasks"],
      },
    },
    async run(input) {
      const tasks = input.tasks as Array<{ label?: string; prompt?: string }>;
      if (!tasks.length) throw new ToolError("tasks is empty.");
      const queue = tasks.map((t, i) => ({ i, label: t.label || `task ${i + 1}`, prompt: t.prompt ?? "" }));
      const answers: string[] = new Array(tasks.length);
      const worker = async () => {
        for (let job = queue.shift(); job; job = queue.shift()) {
          const name = `explore#${++counter} ${job.label}`;
          const agent = new Agent({
            name,
            model: deps.model,
            effort: deps.effort,
            system: deps.system,
            tools: READ_ONLY_TOOLS,
            ctx: { root: deps.root, approve: async () => true },
            events: deps.events,
            usage: deps.usage,
            maxTurns: 40,
          });
          try {
            answers[job.i] = `## ${job.label}\n${await agent.run(job.prompt)}`;
          } catch (err) {
            answers[job.i] = `## ${job.label}\n[subagent failed: ${(err as Error).message}]`;
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(deps.maxParallel, tasks.length) }, worker));
      return answers.join("\n\n");
    },
  };
}
