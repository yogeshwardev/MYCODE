// Provider-neutral types. Each provider adapter keeps its conversation history
// in its own native format (so nothing is lost in translation, e.g. Claude
// thinking blocks are echoed back unchanged), and exposes this small surface.

export interface JSONSchema {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface ToolSpec {
  name: string;
  description: string;
  parameters: JSONSchema;
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
  /** Set when the model produced arguments that could not be parsed. */
  parseError?: string;
}

export interface ToolResult {
  id: string;
  content: string;
  isError?: boolean;
}

export interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export type StopKind = "end" | "tool_use" | "max_tokens" | "refusal" | "other";

export interface TurnResult {
  text: string;
  toolCalls: ToolCall[];
  stop: StopKind;
  usage: Usage;
  /** Total tokens the model saw on this turn: our best measure of context size. */
  contextTokens: number;
}

export interface TurnInput {
  text?: string;
  toolResults?: ToolResult[];
  /** Ask for a text-only answer this turn (used for summaries/compaction). */
  noTools?: boolean;
}

export interface TurnHooks {
  onText?: (delta: string) => void;
  signal?: AbortSignal;
}

export interface ChatSession {
  turn(input: TurnInput, hooks?: TurnHooks): Promise<TurnResult>;
  /** Drop all history. The next turn starts a fresh conversation. */
  reset(): void;
  /** Serializable copy of the native history, for saving and resuming sessions. */
  exportHistory(): unknown[];
  importHistory(history: unknown[]): void;
}

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface SessionOptions {
  system: string;
  tools: ToolSpec[];
  effort?: Effort;
  maxOutputTokens?: number;
}

export interface ModelHandle {
  /** "provider/model" as written in config. */
  spec: string;
  provider: string;
  model: string;
  contextWindow: number;
  createSession(opts: SessionOptions): ChatSession;
}

export function emptyUsage(): Usage {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
}

export function addUsage(a: Usage, b: Usage): Usage {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
  };
}
