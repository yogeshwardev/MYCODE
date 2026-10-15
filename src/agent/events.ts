import { addUsage, emptyUsage, type Usage } from "../providers/types.js";

export type AgentEvent =
  | { type: "text"; agent: string; delta: string }
  | { type: "assistant_done"; agent: string }
  | { type: "turn_start"; agent: string }
  | { type: "turn_end"; agent: string }
  | { type: "tool"; agent: string; name: string; summary: string }
  | { type: "tool_error"; agent: string; name: string; error: string }
  | { type: "status"; agent: string; message: string }
  | { type: "compacted"; agent: string; before: number; after: number }
  | { type: "trimmed"; agent: string; before: number; after: number };

export type EventSink = (e: AgentEvent) => void;

// $ per million tokens: [input, output, cache read]. Cache writes bill at 1.25x input.
const PRICES: Array<[RegExp, [number, number, number]]> = [
  [/claude-(fable|mythos)-5/, [10, 50, 1]],
  [/claude-opus-5-5/, [4, 20, 0.2]],
  [/claude-opus-(5|4-[678])/, [5, 25, 0.5]],
  [/claude-sonnet-5/, [2, 10, 0.2]],
  [/claude-sonnet-4/, [3, 15, 0.3]],
  [/claude-haiku-5-5/, [0.1, 0.5, 0.01]],
  [/claude-haiku-4-5/, [1, 5, 0.1]],
];

/** USD per million tokens [input, output, cache read] for a model, if known. */
export function priceOf(model: string, custom: Record<string, [number, number, number]> = {}): [number, number, number] | undefined {
  return custom[model] ?? PRICES.find(([re]) => re.test(model))?.[1];
}

export class BudgetExceededError extends Error {}

export class UsageTracker {
  private byModel = new Map<string, Usage>();

  /** Optional spending cap in USD (only enforceable for models with known prices). */
  constructor(
    public budgetUsd?: number,
    private customPrices: Record<string, [number, number, number]> = {},
  ) {}

  checkBudget() {
    if (this.budgetUsd === undefined) return;
    const spent = this.cost() ?? 0;
    if (spent >= this.budgetUsd) {
      throw new BudgetExceededError(`Budget of $${this.budgetUsd.toFixed(2)} reached ($${spent.toFixed(4)} spent).`);
    }
  }

  totals(): Usage {
    let t = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    for (const u of this.byModel.values()) t = addUsage(t, u);
    return t;
  }

  toJSON() {
    return { byModel: Object.fromEntries(this.byModel), totals: this.totals(), costUsd: this.cost() ?? null };
  }

  add(model: string, u: Usage) {
    this.byModel.set(model, addUsage(this.byModel.get(model) ?? emptyUsage(), u));
  }

  cost(): number | undefined {
    let total = 0;
    let known = false;
    for (const [model, u] of this.byModel) {
      const price = priceOf(model, this.customPrices);
      if (!price) continue;
      known = true;
      total += (u.input * price[0] + u.cacheWrite * price[0] * 1.25 + u.output * price[1] + u.cacheRead * price[2]) / 1e6;
    }
    return known ? total : undefined;
  }

  report(): string {
    if (!this.byModel.size) return "No model usage yet.";
    const lines = [...this.byModel].map(
      ([m, u]) =>
        `  ${m}: ${fmt(u.input + u.cacheRead + u.cacheWrite)} in (${fmt(u.cacheRead)} cached), ${fmt(u.output)} out`,
    );
    const c = this.cost();
    if (c !== undefined) lines.push(`  estimated cost: $${c.toFixed(4)} (known prices only)`);
    return lines.join("\n");
  }
}

const fmt = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n));
