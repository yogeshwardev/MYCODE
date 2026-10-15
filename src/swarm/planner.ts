import { Agent } from "../agent/agent.js";
import type { EventSink, UsageTracker } from "../agent/events.js";
import type { Effort, ModelHandle } from "../providers/types.js";
import { READ_ONLY_TOOLS, ToolError, type Tool } from "../tools/index.js";

export interface PlanTask {
  id: string;
  title: string;
  description: string;
  files: string[];
  depends_on: string[];
}

export interface CouncilVerdict {
  model: string;
  approved: boolean;
  notes: string;
}

export interface Plan {
  summary: string;
  tasks: PlanTask[];
  verify_command?: string;
  /** Independent critiques from other models (model council), if enabled. */
  council?: CouncilVerdict[];
}

const COUNCIL_PROMPT = `You are on a review council for an engineering plan. Several AI engineers will execute this plan in parallel, so mistakes in the plan are expensive. Use the read-only tools to check the plan against the codebase.

Look for: requirements in the request that no task covers, tasks that would conflict (same files in parallel, missing dependencies), wrong assumptions about the code (files, functions, frameworks that don't exist or work differently), missing tests or verification, and risky approaches (security, data loss, breaking public APIs).

Answer format: the first line is exactly APPROVE if the plan is sound, or CONCERNS if not. Then at most 5 short, concrete points (with file paths where relevant). No praise, no restating the plan.`;

/** Ask each council model to critique the plan independently, in parallel. */
export async function councilReview(opts: {
  goal: string;
  plan: Plan;
  root: string;
  models: ModelHandle[];
  events: EventSink;
  usage: UsageTracker;
  signal?: AbortSignal;
}): Promise<CouncilVerdict[]> {
  const planText = JSON.stringify({ summary: opts.plan.summary, tasks: opts.plan.tasks, verify_command: opts.plan.verify_command }, null, 2);
  return Promise.all(
    opts.models.map(async (model, i) => {
      try {
        const member = new Agent({
          name: `council-${i + 1}`,
          model,
          system: `${COUNCIL_PROMPT}\n\n<environment>\nWorkspace root: ${opts.root}\n</environment>`,
          tools: READ_ONLY_TOOLS.filter((t) => t.spec.name !== "web_fetch"),
          ctx: { root: opts.root, approve: async () => true, signal: opts.signal },
          events: opts.events,
          usage: opts.usage,
          maxTurns: 15,
        });
        const text = (await member.run(`<request>\n${opts.goal}\n</request>\n\n<plan>\n${planText}\n</plan>`, opts.signal)).trim();
        return { model: model.spec, approved: /^\**APPROVE\b/i.test(text), notes: text.replace(/^\**(APPROVE|CONCERNS)\**\s*/i, "").trim() };
      } catch (err) {
        return { model: model.spec, approved: true, notes: `(council member unavailable: ${(err as Error).message.split("\n")[0]})` };
      }
    }),
  );
}

/** Accept common variations in field names that models produce. */
export function normalizePlan(raw: Record<string, unknown>): Plan {
  const pick = (o: Record<string, unknown>, ...keys: string[]) => keys.map((k) => o[k]).find((v) => v !== undefined && v !== null);
  const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : typeof v === "string" && v.trim() ? v.split(/[,\s]+/).filter(Boolean) : []);
  const tasks = (pick(raw, "tasks", "subtasks", "steps") as Array<Record<string, unknown>> | undefined) ?? [];
  return {
    summary: String(pick(raw, "summary", "overview", "approach", "plan") ?? ""),
    verify_command: pick(raw, "verify_command", "verifyCommand", "verify", "test_command") as string | undefined,
    tasks: Array.isArray(tasks)
      ? tasks.map((t) => {
          const id = String(pick(t, "id", "task_id", "taskId", "slug", "name") ?? "")
            .toLowerCase()
            .replace(/[^a-z0-9-]+/g, "-")
            .replace(/^-+|-+$/g, "")
            .slice(0, 40);
          const title = String(pick(t, "title", "name", "summary") ?? id);
          return {
            id,
            title,
            description: String(pick(t, "description", "brief", "details", "instructions", "task") ?? ""),
            files: list(pick(t, "files", "owned_files", "paths")),
            depends_on: list(pick(t, "depends_on", "dependsOn", "dependencies", "deps", "after")),
          };
        })
      : [],
  };
}

export function validatePlan(plan: Plan): string | undefined {
  if (!plan.summary?.trim()) return "summary is required (the overall approach and shared contracts).";
  if (!Array.isArray(plan.tasks) || !plan.tasks.length) return "tasks must be a non-empty array.";
  const ids = new Set<string>();
  for (const [i, t] of plan.tasks.entries()) {
    if (!t.id || !/^[a-z0-9][a-z0-9-]{0,40}$/.test(t.id)) return `Task ${i + 1} needs an "id": a short slug of lowercase letters, digits and dashes (got ${JSON.stringify(t.id)}).`;
    if (ids.has(t.id)) return `Duplicate task id "${t.id}".`;
    ids.add(t.id);
    if (!t.title?.trim()) return `Task "${t.id}" needs a "title".`;
    if (!t.description?.trim()) return `Task "${t.id}" needs a "description": the complete brief for its engineer.`;
    t.files ??= [];
    t.depends_on ??= [];
  }
  for (const t of plan.tasks) {
    for (const d of t.depends_on) if (!ids.has(d)) return `Task "${t.id}" depends on unknown task "${d}".`;
  }
  // Cycle check (depth-first search).
  const state = new Map<string, 1 | 2>();
  const byId = new Map(plan.tasks.map((t) => [t.id, t]));
  const visit = (id: string): string | undefined => {
    if (state.get(id) === 2) return;
    if (state.get(id) === 1) return `Dependency cycle through "${id}".`;
    state.set(id, 1);
    for (const d of byId.get(id)!.depends_on) {
      const err = visit(d);
      if (err) return err;
    }
    state.set(id, 2);
  };
  for (const t of plan.tasks) {
    const err = visit(t.id);
    if (err) return err;
  }
  // Parallel tasks editing the same file will conflict at merge time.
  const reach = (from: string, to: string): boolean =>
    byId.get(from)!.depends_on.some((d) => d === to || reach(d, to));
  for (const a of plan.tasks) {
    for (const b of plan.tasks) {
      if (a.id >= b.id || reach(a.id, b.id) || reach(b.id, a.id)) continue;
      const shared = a.files.filter((f) => b.files.includes(f));
      if (shared.length) {
        return `Tasks "${a.id}" and "${b.id}" run in parallel but both edit ${shared.join(", ")}. Merge them, or make one depend on the other.`;
      }
    }
  }
  return undefined;
}

function submitPlanTool(onPlan: (p: Plan) => void): Tool {
  return {
    readOnly: false,
    spec: {
      name: "submit_plan",
      description: "Submit the final execution plan. Call exactly once, after investigating.",
      parameters: {
        type: "object",
        properties: {
          summary: { type: "string", description: "The overall approach and any shared contracts all tasks must follow" },
          tasks: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string", description: "Short slug, e.g. 'api-routes'" },
                title: { type: "string" },
                description: { type: "string", description: "Complete, self-contained brief for the engineer" },
                files: { type: "array", items: { type: "string" }, description: "Files this task creates or edits" },
                depends_on: { type: "array", items: { type: "string" }, description: "Task ids that must finish first" },
              },
              required: ["id", "title", "description", "files", "depends_on"],
            },
          },
          verify_command: { type: "string", description: "Optional shell command that checks the whole result" },
        },
        required: ["summary", "tasks"],
      },
    },
    async run(input) {
      const plan = normalizePlan(input);
      const err = validatePlan(plan);
      if (err) throw new ToolError(`Plan rejected: ${err} Fix it and call submit_plan again.`);
      onPlan(plan);
      return "Plan accepted. Reply with one short sentence; do not call more tools.";
    },
  };
}

export async function makePlan(opts: {
  goal: string;
  root: string;
  model: ModelHandle;
  effort?: Effort;
  system: string;
  events: EventSink;
  usage: UsageTracker;
  extraTools?: Tool[];
  /** Model council: other models critique the plan; the planner revises once if they raise concerns. */
  council?: ModelHandle[];
  signal?: AbortSignal;
}): Promise<Plan> {
  let plan: Plan | undefined;
  const agent = new Agent({
    name: "planner",
    model: opts.model,
    effort: opts.effort,
    system: opts.system,
    tools: [...READ_ONLY_TOOLS, ...(opts.extraTools ?? []), submitPlanTool((p) => (plan = p))],
    ctx: { root: opts.root, approve: async () => true },
    events: opts.events,
    usage: opts.usage,
    maxTurns: 60,
  });
  await agent.run(`Plan this request:\n\n${opts.goal}`, opts.signal);
  if (!plan) await agent.run("You have not submitted a plan. Call submit_plan now.", opts.signal);
  if (!plan) throw new Error("The planner did not produce a plan.");
  if (opts.council?.length) {
    opts.events({ type: "status", agent: "swarm", message: `Model council reviewing the plan (${opts.council.map((m) => m.model).join(", ")})...` });
    let verdicts = await councilReview({ goal: opts.goal, plan, root: opts.root, models: opts.council, events: opts.events, usage: opts.usage, signal: opts.signal });
    const concerns = verdicts.filter((v) => !v.approved);
    if (concerns.length) {
      opts.events({ type: "status", agent: "swarm", message: `Council raised concerns (${concerns.length}/${verdicts.length}); the planner is revising the plan.` });
      const before = plan;
      await agent.run(
        `An independent review council critiqued your plan:\n\n${concerns.map((v) => `[${v.model}]\n${v.notes}`).join("\n\n")}\n\n` +
          "Address every valid concern and call submit_plan again with the revised plan. If a concern is wrong, keep that part and say why in the summary.",
        opts.signal,
      );
      if (plan === before) opts.events({ type: "status", agent: "swarm", message: "The planner kept its plan." });
      verdicts = verdicts.map((v) => (v.approved ? v : { ...v, notes: `${v.notes}\n(addressed in the revised plan)` }));
    } else opts.events({ type: "status", agent: "swarm", message: "Council approved the plan." });
    plan.council = verdicts;
  }
  return plan;
}
