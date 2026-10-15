import Anthropic from "@anthropic-ai/sdk";
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

// Models that accept the server-side refusal fallback in its "default" form.
const FALLBACK_MODELS = new Set(["claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"]);
// Older models that do not take adaptive thinking.
const NO_ADAPTIVE = /claude-(3|haiku-4|sonnet-4-5|opus-4-5|opus-4-1|opus-4-0|sonnet-4-0)/;
const MAX_JSON_RETRIES = 2;

export interface AnthropicProviderConfig {
  apiKey?: string;
  baseURL?: string;
}

export function anthropicModel(
  spec: string,
  provider: string,
  model: string,
  contextWindow: number,
  cfg: AnthropicProviderConfig,
): ModelHandle {
  const client = new Anthropic({
    apiKey: cfg.apiKey ?? process.env.ANTHROPIC_API_KEY,
    baseURL: cfg.baseURL,
    maxRetries: 4,
  });
  // Server-side features such as refusal fallbacks only exist on the first-party API.
  const firstParty = !cfg.baseURL && !process.env.ANTHROPIC_BASE_URL;
  return {
    spec,
    provider,
    model,
    contextWindow,
    createSession: (opts) => new AnthropicSession(client, model, firstParty, opts),
  };
}

class AnthropicSession implements ChatSession {
  private messages: Anthropic.Beta.BetaMessageParam[] = [];
  private readonly tools: Anthropic.Beta.BetaTool[];

  constructor(
    private client: Anthropic,
    private model: string,
    private firstParty: boolean,
    private opts: SessionOptions,
  ) {
    this.tools = opts.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters as Anthropic.Beta.BetaTool.InputSchema,
      eager_input_streaming: true,
    }));
  }

  reset(): void {
    this.messages = [];
  }

  exportHistory(): unknown[] {
    return structuredClone(this.messages);
  }

  importHistory(history: unknown[]): void {
    this.messages = history as Anthropic.Beta.BetaMessageParam[];
  }

  // Only tool results are trimmed: assistant turns (tool inputs next to
  // thinking blocks) are left exactly as the model produced them.
  trim(policy: TrimPolicy): number {
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const m of this.messages) {
      if (m.role !== "user" || !Array.isArray(m.content)) continue;
      for (const b of m.content) if (b.type === "tool_result") results.push(b);
    }
    let removed = 0;
    for (const b of results.slice(0, Math.max(0, results.length - policy.keepRecent))) {
      if (typeof b.content !== "string" || b.content.length <= policy.minChars) continue;
      const stub = policy.result(b.tool_use_id, b.content);
      removed += b.content.length - stub.length;
      b.content = stub;
    }
    return removed;
  }

  async turn(input: TurnInput, hooks: TurnHooks = {}): Promise<TurnResult> {
    const content: Anthropic.Beta.BetaContentBlockParam[] = [];
    for (const r of input.toolResults ?? []) {
      content.push({ type: "tool_result", tool_use_id: r.id, content: r.content, is_error: r.isError || undefined });
    }
    for (const img of input.images ?? []) {
      content.push({ type: "image", source: { type: "base64", media_type: img.mediaType as "image/png", data: img.data } });
    }
    if (input.text) content.push({ type: "text", text: input.text });
    this.messages.push({ role: "user", content });

    let jsonRetries = 0;
    for (;;) {
      const params: Anthropic.Beta.MessageCreateParamsStreaming = {
        model: this.model,
        max_tokens: this.opts.maxOutputTokens ?? 64000,
        // The system prompt and tool list never change within a session, so
        // they form a stable, cacheable prefix.
        system: [{ type: "text", text: this.opts.system, cache_control: { type: "ephemeral" } }],
        tools: this.tools.length ? this.tools : undefined,
        tool_choice: input.noTools && this.tools.length ? { type: "none" } : undefined,
        messages: this.messages,
        cache_control: { type: "ephemeral" },
        stream: true,
      };
      if (!NO_ADAPTIVE.test(this.model)) {
        params.thinking = { type: "adaptive" };
        if (this.opts.effort) params.output_config = { effort: this.opts.effort };
      }
      const betas: string[] = [];
      if (this.firstParty && FALLBACK_MODELS.has(this.model)) {
        betas.push("server-side-fallback-2026-07-01");
        params.fallbacks = "default";
      }
      if (betas.length) params.betas = betas;

      const stream = this.client.beta.messages.stream(params, { signal: hooks.signal });
      if (hooks.onText) stream.on("text", hooks.onText);

      let message: Anthropic.Beta.BetaMessage;
      try {
        message = await stream.finalMessage();
      } catch (err) {
        // Only an unparseable streamed tool input is retried here; API errors
        // (already retried by the SDK) propagate.
        if (err instanceof Anthropic.APIError || hooks.signal?.aborted || jsonRetries++ >= MAX_JSON_RETRIES) throw err;
        continue;
      }

      // Append the assistant turn exactly as returned (thinking blocks included).
      this.messages.push({ role: "assistant", content: message.content as Anthropic.Beta.BetaContentBlockParam[] });

      let text = "";
      const toolCalls: ToolCall[] = [];
      for (const block of message.content) {
        if (block.type === "text") text += block.text;
        else if (block.type === "tool_use") {
          const inputObj = block.input;
          const valid = inputObj !== null && typeof inputObj === "object" && !Array.isArray(inputObj);
          toolCalls.push({
            id: block.id,
            name: block.name,
            input: valid ? (inputObj as Record<string, unknown>) : {},
            parseError: valid ? undefined : "tool input was not a JSON object",
          });
        }
      }

      const u = message.usage;
      const usage = {
        input: u.input_tokens ?? 0,
        output: u.output_tokens ?? 0,
        cacheRead: u.cache_read_input_tokens ?? 0,
        cacheWrite: u.cache_creation_input_tokens ?? 0,
      };
      return {
        text,
        toolCalls,
        stop: mapStop(message.stop_reason),
        usage,
        contextTokens: usage.input + usage.cacheRead + usage.cacheWrite + usage.output,
      };
    }
  }
}

function mapStop(reason: string | null): StopKind {
  switch (reason) {
    case "end_turn":
    case "stop_sequence":
      return "end";
    case "tool_use":
      return "tool_use";
    case "max_tokens":
      return "max_tokens";
    case "refusal":
      return "refusal";
    default:
      return "other";
  }
}
