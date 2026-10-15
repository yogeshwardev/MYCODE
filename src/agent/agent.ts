import type { ChatSession, Effort, ModelHandle, ToolCall, ToolResult, TurnInput, TurnResult } from "../providers/types.js";
import { describeCall, ToolError, validateInput, type Tool, type ToolContext } from "../tools/index.js";
import { clip } from "../util.js";
import type { EventSink, UsageTracker } from "./events.js";
import { Journal, makeRecallTool, offload } from "./journal.js";

export interface AgentOptions {
  name: string;
  model: ModelHandle;
  system: string;
  tools: Tool[];
  ctx: ToolContext;
  events: EventSink;
  usage: UsageTracker;
  effort?: Effort;
  maxTurns?: number;
  /** Fraction of the context window that triggers compaction. */
  compactAt?: number;
}

export interface AgentState {
  model: string;
  requests: string[];
  history: unknown[];
  contextTokens: number;
}

const MAX_TOOL_RESULT_CHARS = 40_000;

// Names that models (especially open-weight ones) commonly invent for our
// tools. Mapping them is cheaper than a failed round trip.
const TOOL_ALIASES: Record<string, string> = {
  search: "grep",
  search_files: "grep",
  find_in_files: "grep",
  ripgrep: "grep",
  rg: "grep",
  find: "glob",
  find_files: "glob",
  ls: "list_dir",
  list_files: "list_dir",
  list_directory: "list_dir",
  read: "read_file",
  cat: "read_file",
  open_file: "read_file",
  view_file: "read_file",
  write: "write_file",
  create_file: "write_file",
  edit: "edit_file",
  str_replace: "edit_file",
  replace_in_file: "edit_file",
  apply_edit: "edit_file",
  shell: "bash",
  run: "bash",
  exec: "bash",
  execute: "bash",
  run_command: "bash",
  terminal: "bash",
};

const COMPACT_PROMPT = `Your context window is nearly full, so your conversation history is about to be replaced by a summary that you write now. Do not call any tools. Write a complete handoff note for yourself covering:
1. The task you were given (restate it in full, with every requirement).
2. What is already done: files created or changed and what changed in each.
3. Key facts you discovered: file paths, function names, line numbers, commands, test results, decisions made and why.
4. The current state, including anything half-finished or failing.
5. The exact next steps remaining.
Be specific; anything you leave out is lost.`;

/**
 * A tool-using agent loop over any provider. Context is managed in four ways:
 * oversized tool output is clipped before it enters history, unchanged files
 * are never re-sent, the session is compacted into a self-written handoff
 * summary near the window limit, and heavy exploration can be pushed into
 * subagents (see subagents.ts) so it never enters this agent's context at all.
 */
export class Agent {
  readonly name: string;
  private session: ChatSession;
  private lastContextTokens = 0;
  private requests: string[] = [];
  /** Tool calls the model made that have not been answered yet (e.g. after Ctrl+C). */
  private pending: ToolCall[] = [];
  private readonly ctx: ToolContext;
  /** Everything this agent saw and said, searchable with `recall` even after compaction. */
  private readonly journal = new Journal();
  private readonly tools: Tool[];

  constructor(private opts: AgentOptions) {
    this.name = opts.name;
    this.ctx = { ...opts.ctx, readCache: new Map() };
    this.tools = [...opts.tools, makeRecallTool(this.journal)];
    this.session = opts.model.createSession({
      system: opts.system,
      tools: this.tools.map((t) => t.spec),
      effort: opts.effort,
    });
  }

  get contextUsed(): { tokens: number; window: number } {
    return { tokens: this.lastContextTokens, window: this.opts.model.contextWindow };
  }

  get modelSpec(): string {
    return this.opts.model.spec;
  }

  /** Clear the conversation (keeps system prompt and tools). */
  reset() {
    this.session.reset();
    this.journal.clear();
    this.requests = [];
    this.pending = [];
    this.lastContextTokens = 0;
    this.ctx.readCache?.clear();
  }

  exportState(): AgentState {
    return { model: this.opts.model.spec, requests: this.requests, history: this.session.exportHistory(), contextTokens: this.lastContextTokens };
  }

  importState(state: AgentState) {
    if (state.model !== this.opts.model.spec) throw new Error(`Session was recorded with ${state.model}, current model is ${this.opts.model.spec}.`);
    this.session.importHistory(state.history);
    this.requests = state.requests;
    this.lastContextTokens = state.contextTokens;
    this.ctx.readCache?.clear();
  }

  /** Run until the model stops calling tools. Returns its final text. */
  async run(prompt: string, signal?: AbortSignal): Promise<string> {
    const ctx = { ...this.ctx, signal: signal ?? this.ctx.signal };
    if (this.overLimit()) await this.compact(this.takePending(), signal);
    this.requests.push(prompt);
    this.journal.add("request", prompt);

    let res = await this.turn({ text: prompt, toolResults: this.takePending() }, signal);
    let steps = 0;
    const maxTurns = this.opts.maxTurns ?? 200;

    for (;;) {
      if (signal?.aborted) throw new Error("Aborted");
      if (res.stop === "refusal") {
        return `${res.text}\n[The model declined to continue this request.]`.trim();
      }
      if (!res.toolCalls.length) {
        if (res.stop === "max_tokens") {
          res = await this.turn({ text: "Your reply was cut off by the output limit. Continue exactly where you stopped." }, signal);
          continue;
        }
        return res.text;
      }
      this.pending = res.toolCalls;
      if (++steps > maxTurns) {
        return `${res.text}\n[Stopped after ${maxTurns} tool rounds without finishing.]`.trim();
      }

      // A tool call cut off by max_tokens has truncated input: never run it.
      const results =
        res.stop === "max_tokens"
          ? res.toolCalls.map((c) => ({
              id: c.id,
              isError: true,
              content:
                "Your tool call was truncated by the output limit and was not run. Split the work into smaller calls (e.g. write a large file in parts with edit_file).",
            }))
          : await this.executeAll(res.toolCalls, ctx);
      this.pending = [];

      if (this.overLimit()) {
        await this.compact(results, signal);
        res = await this.turn({ text: "Continue the task from the handoff summary above." }, signal);
      } else {
        res = await this.turn({ toolResults: results }, signal);
      }
    }
  }

  private takePending(): ToolResult[] | undefined {
    if (!this.pending.length) return undefined;
    const out = this.pending.map((c) => ({ id: c.id, isError: true, content: "Interrupted by the user before this ran." }));
    this.pending = [];
    return out;
  }

  private overLimit() {
    return this.lastContextTokens > (this.opts.compactAt ?? 0.8) * this.opts.model.contextWindow;
  }

  private async turn(input: TurnInput, signal?: AbortSignal): Promise<TurnResult> {
    this.opts.usage.checkBudget();
    this.opts.events({ type: "turn_start", agent: this.name });
    let res: TurnResult;
    try {
      res = await this.session.turn(input, {
        signal,
        onText: (delta) => this.opts.events({ type: "text", agent: this.name, delta }),
      });
    } finally {
      this.opts.events({ type: "turn_end", agent: this.name });
    }
    if (res.text) {
      this.opts.events({ type: "assistant_done", agent: this.name });
      this.journal.add("reply", res.text);
    }
    this.opts.usage.add(this.opts.model.spec, res.usage);
    this.lastContextTokens = res.contextTokens;
    return res;
  }

  /**
   * Replace the history with a handoff summary written by the model itself.
   * The session is reset rather than edited, so providers that bind reasoning
   * to an unmodified history never see a rewritten transcript.
   */
  private async compact(pending: ToolResult[] | undefined, signal?: AbortSignal) {
    const before = this.lastContextTokens;
    this.opts.events({ type: "turn_start", agent: this.name });
    try {
      const res = await this.session.turn({ toolResults: pending, text: COMPACT_PROMPT, noTools: true }, { signal });
      this.opts.usage.add(this.opts.model.spec, res.usage);
      this.session.reset();
      this.ctx.readCache?.clear();
      const asks = this.requests.slice(-5).map((r, i) => `Request ${i + 1}:\n${clip(r, 8000)}`).join("\n\n");
      const seed = `[Context was compacted. The user's requests so far:]\n${asks}\n\n[Your handoff summary of the work so far:]\n${res.text}\n\n[Everything from before compaction (file contents, command output, earlier replies) is still searchable with the recall tool.]`;
      const seeded = await this.session.turn(
        { text: `${seed}\n\nAcknowledge briefly; you will be told to continue.`, noTools: true },
        { signal },
      );
      this.opts.usage.add(this.opts.model.spec, seeded.usage);
      this.lastContextTokens = seeded.contextTokens;
    } finally {
      this.opts.events({ type: "turn_end", agent: this.name });
    }
    this.opts.events({ type: "compacted", agent: this.name, before, after: this.lastContextTokens });
  }

  private async executeAll(calls: ToolCall[], ctx: ToolContext): Promise<ToolResult[]> {
    const byName = new Map(this.tools.map((t) => [t.spec.name, t]));
    for (const [alias, real] of Object.entries(TOOL_ALIASES)) {
      if (!byName.has(alias) && byName.has(real)) byName.set(alias, byName.get(real)!);
    }
    // Consecutive read-only calls run concurrently; anything with side effects
    // runs alone, in the order the model asked for.
    const out: ToolResult[] = [];
    let batch: ToolCall[] = [];
    const flush = async () => {
      out.push(...(await Promise.all(batch.map((c) => this.execute(c, byName.get(c.name), ctx)))));
      batch = [];
    };
    for (const c of calls) {
      if (byName.get(c.name)?.readOnly) batch.push(c);
      else {
        await flush();
        out.push(await this.execute(c, byName.get(c.name), ctx));
      }
    }
    await flush();
    return out;
  }

  private async execute(call: ToolCall, tool: Tool | undefined, ctx: ToolContext): Promise<ToolResult> {
    const fail = (error: string): ToolResult => {
      this.opts.events({ type: "tool_error", agent: this.name, name: call.name, error });
      return { id: call.id, isError: true, content: error };
    };
    if (!tool) return fail(`Unknown tool "${call.name}". Available tools: ${this.tools.map((t) => t.spec.name).join(", ")}.`);
    if (call.parseError) return fail(`Invalid tool input: ${call.parseError}. Re-issue the call with valid JSON arguments.`);
    const invalid = validateInput(tool.spec, call.input);
    if (invalid) return fail(invalid);

    const summary = describeCall(call.name, call.input, ctx.root);
    this.opts.events({ type: "tool", agent: this.name, name: call.name, summary });
    try {
      const out = await tool.run(call.input, ctx);
      if (call.name !== "recall") this.journal.add("tool", `${call.name} ${summary}\n${out}`);
      // Huge outputs go to a file; only the head and tail use context.
      return { id: call.id, content: clip(call.name === "read_file" ? out : offload(out, ctx.root, `${this.name}-${call.name}`), MAX_TOOL_RESULT_CHARS) };
    } catch (err) {
      if (ctx.signal?.aborted) throw err;
      const msg = err instanceof ToolError || err instanceof Error ? err.message : String(err);
      return fail(msg);
    }
  }
}
