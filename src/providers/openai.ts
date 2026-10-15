import OpenAI from "openai";
import type {
  ChatSession,
  ModelHandle,
  SessionOptions,
  StopKind,
  ToolCall,
  TurnHooks,
  TurnInput,
  TrimPolicy,
  TurnResult,
} from "./types.js";
import { slimArgs } from "./types.js";

// One adapter for every OpenAI-compatible endpoint: OpenAI, OpenRouter,
// DeepSeek, Gemini, Groq, xAI, Mistral, Ollama, LM Studio, vLLM, ...

export interface OpenAIProviderConfig {
  apiKey?: string;
  baseURL?: string;
}

export function openaiModel(
  spec: string,
  provider: string,
  model: string,
  contextWindow: number,
  cfg: OpenAIProviderConfig,
): ModelHandle {
  const client = new OpenAI({
    apiKey: cfg.apiKey || "not-needed",
    baseURL: cfg.baseURL,
    maxRetries: 4,
  });
  return {
    spec,
    provider,
    model,
    contextWindow,
    createSession: (opts) => new OpenAISession(client, model, opts, cfg.baseURL ?? "https://api.openai.com/v1"),
  };
}

type Msg = OpenAI.Chat.ChatCompletionMessageParam;

class OpenAISession implements ChatSession {
  private messages: Msg[] = [];
  private readonly tools: OpenAI.Chat.ChatCompletionTool[];

  constructor(
    private client: OpenAI,
    private model: string,
    private opts: SessionOptions,
    private baseURL: string,
  ) {
    this.tools = opts.tools.map((t) => ({
      type: "function",
      function: { name: t.name, description: t.description, parameters: t.parameters as unknown as Record<string, unknown> },
    }));
    this.reset();
  }

  reset(): void {
    this.messages = [{ role: "system", content: this.opts.system }];
  }

  exportHistory(): unknown[] {
    return structuredClone(this.messages.slice(1));
  }

  importHistory(history: unknown[]): void {
    this.reset();
    this.messages.push(...(history as Msg[]));
  }

  trim(policy: TrimPolicy): number {
    let removed = 0;
    const results = this.messages.filter((m): m is OpenAI.Chat.ChatCompletionToolMessageParam => m.role === "tool");
    for (const m of results.slice(0, Math.max(0, results.length - policy.keepRecent))) {
      if (typeof m.content !== "string" || m.content.length <= policy.minChars) continue;
      const stub = policy.result(m.tool_call_id, m.content);
      removed += m.content.length - stub.length;
      m.content = stub;
    }
    // Large arguments of older calls (e.g. a whole file passed to write_file).
    const calls = this.messages.flatMap((m) => (m.role === "assistant" && m.tool_calls ? m.tool_calls : []));
    for (const c of calls.slice(0, Math.max(0, calls.length - policy.keepRecent))) {
      if (c.type !== "function" || c.function.arguments.length <= policy.minChars) continue;
      try {
        const slim = JSON.stringify(slimArgs(JSON.parse(c.function.arguments), policy.minChars));
        if (slim.length < c.function.arguments.length) {
          removed += c.function.arguments.length - slim.length;
          c.function.arguments = slim;
        }
      } catch {
        // Unparseable arguments are left alone.
      }
    }
    return removed;
  }

  private request(input: TurnInput, signal?: AbortSignal) {
    return this.client.chat.completions.create(
      {
        model: this.model,
        messages: this.messages,
        tools: this.tools.length ? this.tools : undefined,
        tool_choice: this.tools.length ? (input.noTools ? "none" : "auto") : undefined,
        max_completion_tokens: this.opts.maxOutputTokens,
        stream: true,
        stream_options: { include_usage: true },
      },
      { signal },
    );
  }

  async turn(input: TurnInput, hooks: TurnHooks = {}): Promise<TurnResult> {
    for (const r of input.toolResults ?? []) {
      this.messages.push({ role: "tool", tool_call_id: r.id, content: r.isError ? `ERROR: ${r.content}` : r.content });
    }
    if (input.text) this.messages.push({ role: "user", content: input.text });

    let stream: Awaited<ReturnType<typeof this.request>>;
    try {
      stream = await this.request(input, hooks.signal);
    } catch (err) {
      throw explain(err, this.baseURL);
    }

    let text = "";
    let finish: string | null = null;
    let promptTokens = 0;
    let completionTokens = 0;
    let cached = 0;
    const partial = new Map<number, { id: string; name: string; args: string }>();

    for await (const chunk of stream) {
      if (chunk.usage) {
        promptTokens = chunk.usage.prompt_tokens ?? 0;
        completionTokens = chunk.usage.completion_tokens ?? 0;
        cached = chunk.usage.prompt_tokens_details?.cached_tokens ?? 0;
      }
      const choice = chunk.choices?.[0];
      if (!choice) continue;
      if (choice.finish_reason) finish = choice.finish_reason;
      const delta = choice.delta;
      if (delta?.content) {
        text += delta.content;
        hooks.onText?.(delta.content);
      }
      for (const tc of delta?.tool_calls ?? []) {
        const cur = partial.get(tc.index) ?? { id: "", name: "", args: "" };
        if (tc.id) cur.id = tc.id;
        if (tc.function?.name) cur.name += tc.function.name;
        if (tc.function?.arguments) cur.args += tc.function.arguments;
        partial.set(tc.index, cur);
      }
    }

    const toolCalls: ToolCall[] = [];
    const rawCalls: OpenAI.Chat.ChatCompletionMessageToolCall[] = [];
    for (const [index, p] of [...partial.entries()].sort((a, b) => a[0] - b[0])) {
      const id = p.id || `call_${Date.now()}_${index}`;
      rawCalls.push({ id, type: "function", function: { name: p.name, arguments: p.args || "{}" } });
      try {
        const parsed = JSON.parse(p.args || "{}");
        const ok = parsed !== null && typeof parsed === "object" && !Array.isArray(parsed);
        toolCalls.push({ id, name: p.name, input: ok ? parsed : {}, parseError: ok ? undefined : "arguments were not a JSON object" });
      } catch {
        toolCalls.push({ id, name: p.name, input: {}, parseError: "arguments were not valid JSON" });
      }
    }

    this.messages.push({
      role: "assistant",
      // Some OpenAI-compatible servers (e.g. Ollama) reject null content, so always send a string.
      content: text,
      ...(rawCalls.length ? { tool_calls: rawCalls } : {}),
    });

    const usage = { input: promptTokens - cached, output: completionTokens, cacheRead: cached, cacheWrite: 0 };
    return {
      text,
      toolCalls,
      stop: mapStop(finish, toolCalls.length > 0),
      usage,
      contextTokens: promptTokens + completionTokens,
    };
  }
}

function mapStop(reason: string | null, hasTools: boolean): StopKind {
  if (hasTools) return "tool_use";
  switch (reason) {
    case "stop":
      return "end";
    case "length":
      return "max_tokens";
    case "content_filter":
      return "refusal";
    default:
      return reason ? "other" : "end";
  }
}

/** Turn opaque network errors into something a user can act on. */
function explain(err: unknown, baseURL: string): unknown {
  if (!(err instanceof OpenAI.APIConnectionError) || err instanceof OpenAI.APIConnectionTimeoutError) return err;
  const local = /localhost|127\.0\.0\.1/.test(baseURL);
  const hint = /:11434/.test(baseURL)
    ? "Is Ollama running? Start it from the Start menu/tray or run `ollama serve`."
    : /:1234/.test(baseURL)
      ? "Is LM Studio's local server running?"
      : local
        ? "Is the local model server running?"
        : "Check your network connection and the provider's base URL.";
  return new Error(`Could not reach the model server at ${baseURL}. ${hint}`);
}
