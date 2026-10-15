import fs from "node:fs";
import path from "node:path";
import { Agent } from "../agent/agent.js";
import { priceOf, type EventSink, type UsageTracker } from "../agent/events.js";
import type { SwarmCodeConfig } from "../config.js";
import type { ModelHandle } from "../providers/types.js";
import { listFiles } from "../util.js";

// Cost and time autopilot: before running, size the task with a cheap model,
// forecast tokens, cost and wall time for each mode from this project's own
// history (proof reports) or defaults, and pick the best value that fits the
// budget. The forecast is shown to the user either way.

export type Mode = "agent" | "swarm" | "best";
export type Size = "small" | "medium" | "large";

export interface Assessment {
  size: Size;
  parallelizable: boolean;
  risk: "low" | "high";
  reason: string;
}

export interface ModeForecast {
  mode: Mode;
  tokens: number;
  seconds: number;
  costUsd: number | null;
  fitsBudget: boolean;
}

export interface Forecast {
  assessment: Assessment;
  options: ModeForecast[];
  pick: Mode;
  why: string;
  basedOn: "history" | "defaults";
}

// Typical totals for the agent mode by size (tokens, seconds), from benchmark runs.
const DEFAULTS: Record<Size, [number, number]> = { small: [30_000, 45], medium: [180_000, 150], large: [500_000, 600] };
// How the other modes compare with the agent mode, relative to its tokens and time.
const RELATIVE: Record<Exclude<Mode, "agent">, { tokens: number; time: Record<Size, number> }> = {
  swarm: { tokens: 1.4, time: { small: 2.5, medium: 1.2, large: 0.45 } },
  best: { tokens: 3.2, time: { small: 1.3, medium: 1.2, large: 1.15 } },
};

export async function assessTask(task: string, root: string, model: ModelHandle, events: EventSink, usage: UsageTracker, signal?: AbortSignal): Promise<Assessment> {
  const files = (await listFiles(root)).length;
  const judge = new Agent({
    name: "autopilot",
    model,
    effort: "low",
    system:
      'You size software tasks. Reply with only a JSON object: {"size":"small|medium|large","parallelizable":true|false,"risk":"low|high","reason":"one sentence"}. small = a focused change in 1-3 files; medium = several files or a feature in one area; large = many files or several independent features. parallelizable = the work splits into independent parts. risk = high when mistakes would be costly (security, payments, data migrations, public APIs).',
    tools: [],
    ctx: { root, approve: async () => true, signal },
    events,
    usage,
    maxTurns: 1,
  });
  const text = await judge.run(`Project: ${files} files.\nTask: ${task}`, signal);
  try {
    const j = JSON.parse(/\{[\s\S]*\}/.exec(text)?.[0] ?? "{}");
    const size: Size = ["small", "medium", "large"].includes(j.size) ? j.size : "medium";
    return { size, parallelizable: Boolean(j.parallelizable), risk: j.risk === "high" ? "high" : "low", reason: String(j.reason ?? "") };
  } catch {
    return { size: "medium", parallelizable: false, risk: "low", reason: "Could not size the task; assuming medium." };
  }
}

/** Average tokens and seconds per mode from this project's proof reports. */
function history(root: string): Partial<Record<Mode, { tokens: number; seconds: number; n: number }>> {
  const dir = path.join(root, ".swarmcode", "proofs");
  const out: Partial<Record<Mode, { tokens: number; seconds: number; n: number }>> = {};
  if (!fs.existsSync(dir)) return out;
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    try {
      const p = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
      const mode: Mode = String(p.mode).startsWith("swarm") ? "swarm" : String(p.mode).startsWith("best") ? "best" : "agent";
      if (!p.tokens) continue;
      const h = (out[mode] ??= { tokens: 0, seconds: 0, n: 0 });
      h.tokens += p.tokens;
      h.seconds += p.durationMs / 1000;
      h.n++;
    } catch {
      /* skip unreadable reports */
    }
  }
  return out;
}

/** Blended cost per token for a mode's mix of models (most tokens are input). */
function costPerToken(cfg: SwarmCodeConfig, mode: Mode): number | null {
  const specs = mode === "agent" ? [cfg.models.main] : mode === "swarm" ? [cfg.models.worker, cfg.models.worker, cfg.models.planner] : cfg.bestOfModels.length ? cfg.bestOfModels : [cfg.models.main];
  const prices = specs.map((s) => priceOf(s, cfg.prices));
  if (prices.some((p) => !p)) return null;
  // ~85% input (of which a share is cached), ~15% output.
  return prices.reduce((sum, p) => sum + (0.6 * p![0] + 0.25 * p![2] + 0.15 * p![1]) / 1e6, 0) / prices.length;
}

export function forecast(assessment: Assessment, cfg: SwarmCodeConfig, root: string, isRepo: boolean, budgetUsd?: number): Forecast {
  const hist = history(root);
  const [baseTokens, baseSeconds] = DEFAULTS[assessment.size];
  const modes: Mode[] = isRepo ? ["agent", "swarm", "best"] : ["agent"];
  const options = modes.map((mode): ModeForecast => {
    const h = hist[mode];
    const tokens = h && h.n >= 2 ? h.tokens / h.n : mode === "agent" ? baseTokens : baseTokens * RELATIVE[mode].tokens;
    const seconds = h && h.n >= 2 ? h.seconds / h.n : mode === "agent" ? baseSeconds : baseSeconds * RELATIVE[mode].time[assessment.size];
    const cpt = costPerToken(cfg, mode);
    const costUsd = cpt === null ? null : tokens * cpt;
    return { mode, tokens: Math.round(tokens), seconds: Math.round(seconds), costUsd, fitsBudget: budgetUsd === undefined || costUsd === null || costUsd <= budgetUsd };
  });

  // Preference order by task shape; then take the first that fits the budget.
  const order: Mode[] =
    assessment.size === "large" && assessment.parallelizable
      ? ["swarm", "agent"]
      : assessment.risk === "high"
        ? ["best", "agent"]
        : ["agent"];
  const available = options.filter((o) => o.fitsBudget);
  const pick = order.find((m) => available.some((o) => o.mode === m)) ?? available.sort((a, b) => (a.costUsd ?? 0) - (b.costUsd ?? 0))[0]?.mode ?? "agent";
  const why =
    pick === "swarm"
      ? "Large task that splits into independent parts: parallel agents finish it fastest."
      : pick === "best"
        ? "High-risk change: several independent attempts, graded on tests and security, give the most reliable result."
        : order[0] !== "agent"
          ? `The preferred mode (${order[0]}) exceeds the budget; the single agent fits.`
          : "Focused task: a single agent is fastest and cheapest.";
  return { assessment, options, pick, why, basedOn: Object.keys(hist).length ? "history" : "defaults" };
}

export function renderForecast(f: Forecast): string {
  const label: Record<Mode, string> = { agent: "Agent", swarm: "Swarm", best: "Best of 3" };
  const fmt = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : `${Math.round(n / 1000)}k`);
  const rows = f.options.map(
    (o) =>
      `${o.mode === f.pick ? "→" : " "} ${label[o.mode].padEnd(9)} ~${fmt(o.tokens).padStart(5)} tokens  ~${o.seconds >= 60 ? `${Math.round(o.seconds / 60)}m` : `${o.seconds}s`}`.padEnd(42) +
      `${o.costUsd === null ? "cost n/a" : `~$${o.costUsd.toFixed(o.costUsd < 1 ? 3 : 2)}`}${o.fitsBudget ? "" : "  (over budget)"}`,
  );
  return `Task size: ${f.assessment.size}${f.assessment.parallelizable ? ", parallelizable" : ""}${f.assessment.risk === "high" ? ", high risk" : ""}. ${f.assessment.reason}\n${rows.join("\n")}\nChoice: ${label[f.pick]}. ${f.why} (estimates from ${f.basedOn === "history" ? "this project's history" : "typical runs"})`;
}
