import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { anthropicModel } from "./providers/anthropic.js";
import { openaiModel } from "./providers/openai.js";
import type { McpServerConfig } from "./mcp.js";
import type { PermissionRules } from "./policy.js";
import type { Effort, ModelHandle } from "./providers/types.js";

export type Role = "main" | "planner" | "worker" | "explorer";

export interface ProviderDef {
  type: "anthropic" | "openai";
  baseURL?: string;
  apiKeyEnv?: string;
  apiKey?: string;
}

export interface SwarmCodeConfig {
  models: Record<Role, string>;
  effort: Record<Role, Effort>;
  providers: Record<string, ProviderDef>;
  /** Override context window sizes by "provider/model" spec. */
  contextWindows: Record<string, number>;
  maxParallel: number;
  verifyCommand?: string;
  /** "ask" prompts before edits/commands in interactive mode; "auto" never asks. */
  permission: "ask" | "auto";
  /**
   * Allow/deny rules such as "bash:npm test*" or "write:src/**" (see policy.ts).
   * Deny rules come from every config layer; allow rules only from the global
   * config, so a cloned repository cannot pre-approve its own commands.
   */
  rules: PermissionRules;
  /**
   * Shell commands run at points in the agent's work. "afterEdit" runs after
   * each file write ({file} is replaced with its path), e.g. a formatter or
   * linter; failures are shown to the agent. Hooks go through normal approval.
   */
  hooks: { afterEdit?: string[] };
  /** Fraction of the context window at which an agent compacts its history. */
  compactAt: number;
  /**
   * Context tokens at which an agent compacts even when the model's window is
   * larger. Every turn resends the context, so a huge window used in full
   * multiplies cost; recall keeps everything reachable after compaction.
   */
  contextBudget: number;
  maxTurns: number;
  /** MCP servers whose tools every agent can use. */
  mcpServers: Record<string, McpServerConfig>;
  /** USD per million tokens [input, output, cache read] for models without built-in prices. */
  prices: Record<string, [number, number, number]>;
  /** Default spending cap per command, in USD. */
  budgetUsd?: number;
  /**
   * Independent review of changes before they are reported done:
   * "auto" reviews substantial changes, "always" every change, "off" never.
   */
  review: "auto" | "always" | "off";
  /**
   * Block changes that introduce new high-severity security findings
   * (secrets, injection, disabled TLS, ...) until they are fixed or justified.
   */
  securityGate: "on" | "off";
  /** Models for best-of-N candidates, cycled in order. Empty: use the main model for every candidate. */
  bestOfModels: string[];
  /** Write an audit trail of every agent action to .swarmcode/traces/. */
  audit: boolean;
  /**
   * Hidden acceptance tests written from the request before implementation:
   * "always" for every change request, "off" to use them only when asked (--guarantee).
   */
  hiddenTests: "always" | "off";
  /** Model council: models (ideally from other providers) that critique plans before parallel runs. */
  councilModels: string[];
  /** Public keys (PEM text or paths to PEM files) whose signatures make imported skills trusted. */
  trustedSkillKeys: string[];
  /** Refuse to import skills that are not signed by a trusted key. */
  requireSignedSkills: boolean;
}

// Every OpenAI-compatible endpoint is just a base URL plus a key variable.
export const BUILTIN_PROVIDERS: Record<string, ProviderDef> = {
  anthropic: { type: "anthropic", apiKeyEnv: "ANTHROPIC_API_KEY" },
  openai: { type: "openai", apiKeyEnv: "OPENAI_API_KEY" },
  openrouter: { type: "openai", baseURL: "https://openrouter.ai/api/v1", apiKeyEnv: "OPENROUTER_API_KEY" },
  deepseek: { type: "openai", baseURL: "https://api.deepseek.com/v1", apiKeyEnv: "DEEPSEEK_API_KEY" },
  gemini: { type: "openai", baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/", apiKeyEnv: "GEMINI_API_KEY" },
  groq: { type: "openai", baseURL: "https://api.groq.com/openai/v1", apiKeyEnv: "GROQ_API_KEY" },
  xai: { type: "openai", baseURL: "https://api.x.ai/v1", apiKeyEnv: "XAI_API_KEY" },
  mistral: { type: "openai", baseURL: "https://api.mistral.ai/v1", apiKeyEnv: "MISTRAL_API_KEY" },
  together: { type: "openai", baseURL: "https://api.together.xyz/v1", apiKeyEnv: "TOGETHER_API_KEY" },
  ollama: { type: "openai", baseURL: "http://localhost:11434/v1" },
  lmstudio: { type: "openai", baseURL: "http://localhost:1234/v1" },
};

const KNOWN_WINDOWS: Array<[RegExp, number]> = [
  [/claude-haiku-4-5|claude-3/, 200_000],
  [/claude-/, 1_000_000],
  [/gemini-/, 1_000_000],
  [/gpt-4\.1/, 1_000_000],
  [/gpt-5|o3|o4/, 400_000],
  [/deepseek/, 128_000],
];
const DEFAULT_WINDOW = 128_000;

function defaultModels(): Record<Role, string> {
  // Strong model to plan and steer, faster ones to execute and explore.
  return {
    main: "anthropic/claude-opus-5-5",
    planner: "anthropic/claude-opus-5-5",
    worker: "anthropic/claude-sonnet-5-5",
    explorer: "anthropic/claude-haiku-5-5",
  };
}

export function defaultConfig(): SwarmCodeConfig {
  return {
    models: defaultModels(),
    effort: { main: "high", planner: "high", worker: "medium", explorer: "low" },
    providers: {},
    contextWindows: {},
    maxParallel: 4,
    permission: "ask",
    rules: {},
    hooks: {},
    compactAt: 0.8,
    contextBudget: 160_000,
    maxTurns: 200,
    mcpServers: {},
    prices: {},
    review: "auto",
    securityGate: "on",
    bestOfModels: [],
    audit: true,
    hiddenTests: "off",
    councilModels: [],
    trustedSkillKeys: [],
    requireSignedSkills: false,
  };
}

/** Where user-level state lives; SWARMCODE_HOME overrides it (tests, portable installs). */
export const SWARMCODE_HOME = process.env.SWARMCODE_HOME || path.join(os.homedir(), ".swarmcode");
export const GLOBAL_CONFIG = path.join(SWARMCODE_HOME, "config.json");
export const projectConfigPath = (root: string) => path.join(root, ".swarmcode", "config.json");

function readJson(file: string): Partial<SwarmCodeConfig> {
  if (!fs.existsSync(file)) return {};
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    throw new Error(`Could not parse ${file}: ${(err as Error).message}`);
  }
}

/** Defaults <- ~/.swarmcode/config.json <- <project>/.swarmcode/config.json. */
export function loadConfig(root: string): SwarmCodeConfig {
  const cfg = defaultConfig();
  const globalLayer = readJson(GLOBAL_CONFIG);
  for (const layer of [globalLayer, readJson(projectConfigPath(root))]) {
    if (layer.models) cfg.models = { ...cfg.models, ...layer.models };
    if (layer.effort) cfg.effort = { ...cfg.effort, ...layer.effort };
    if (layer.providers) cfg.providers = { ...cfg.providers, ...layer.providers };
    if (layer.contextWindows) cfg.contextWindows = { ...cfg.contextWindows, ...layer.contextWindows };
    if (layer.mcpServers) cfg.mcpServers = { ...cfg.mcpServers, ...layer.mcpServers };
    if (layer.prices) cfg.prices = { ...cfg.prices, ...layer.prices };
    if (layer.rules?.deny) cfg.rules.deny = [...(cfg.rules.deny ?? []), ...layer.rules.deny];
    if (layer.rules?.allow && layer === globalLayer) cfg.rules.allow = [...(cfg.rules.allow ?? []), ...layer.rules.allow];
    if (layer.hooks?.afterEdit) cfg.hooks.afterEdit = layer.hooks.afterEdit;
    for (const key of ["maxParallel", "verifyCommand", "permission", "compactAt", "contextBudget", "maxTurns", "budgetUsd", "review", "securityGate", "bestOfModels", "audit", "hiddenTests", "councilModels", "trustedSkillKeys", "requireSignedSkills"] as const) {
      if (layer[key] !== undefined) (cfg as unknown as Record<string, unknown>)[key] = layer[key];
    }
  }
  // A single --model or SWARMCODE_MODEL overrides every role.
  if (process.env.SWARMCODE_MODEL) {
    for (const r of Object.keys(cfg.models) as Role[]) cfg.models[r] = process.env.SWARMCODE_MODEL;
  }
  return cfg;
}

export function providerDef(cfg: SwarmCodeConfig, name: string): ProviderDef | undefined {
  return cfg.providers[name] ?? BUILTIN_PROVIDERS[name];
}

export function providerKey(def: ProviderDef): string | undefined {
  return def.apiKey ?? (def.apiKeyEnv ? process.env[def.apiKeyEnv] : undefined);
}

export function parseSpec(spec: string): { provider: string; model: string } {
  const i = spec.indexOf("/");
  if (i <= 0) throw new Error(`Model "${spec}" must be written as provider/model, e.g. anthropic/claude-opus-5-5`);
  return { provider: spec.slice(0, i), model: spec.slice(i + 1) };
}

const cache = new Map<string, ModelHandle>();

/** Forget resolved models, e.g. after API keys change. */
export function clearModelCache() {
  cache.clear();
}

/** Register a model handle directly (custom adapters, tests). */
export function registerModel(handle: ModelHandle) {
  cache.set(handle.spec, handle);
}

export function resolveModel(cfg: SwarmCodeConfig, role: Role): ModelHandle {
  return resolveSpec(cfg, cfg.models[role]);
}

/** Resolve any "provider/model" spec (not just a configured role). */
export function resolveSpec(cfg: SwarmCodeConfig, spec: string): ModelHandle {
  const hit = cache.get(spec);
  if (hit) return hit;
  const { provider, model } = parseSpec(spec);
  const def = providerDef(cfg, provider);
  if (!def) {
    throw new Error(
      `Unknown provider "${provider}". Built-in: ${Object.keys(BUILTIN_PROVIDERS).join(", ")}. ` +
        `Add custom ones under "providers" in .swarmcode/config.json.`,
    );
  }
  const key = providerKey(def);
  if (def.apiKeyEnv && !key && !def.baseURL?.includes("localhost")) {
    if (!(def.type === "anthropic" && process.env.ANTHROPIC_AUTH_TOKEN)) {
      throw new Error(
        `Model ${spec} needs the ${def.apiKeyEnv} environment variable. Set it, pick another model with --model (for example --model ollama/qwen3-coder for a free local model), or change the defaults in ${GLOBAL_CONFIG}.`,
      );
    }
  }
  const window =
    cfg.contextWindows[spec] ?? KNOWN_WINDOWS.find(([re]) => re.test(model))?.[1] ?? DEFAULT_WINDOW;
  const handle =
    def.type === "anthropic"
      ? anthropicModel(spec, provider, model, window, { apiKey: key, baseURL: def.baseURL })
      : openaiModel(spec, provider, model, window, { apiKey: key, baseURL: def.baseURL });
  cache.set(spec, handle);
  return handle;
}

export const CONFIG_TEMPLATE = {
  models: defaultModels(),
  effort: { main: "high", planner: "high", worker: "medium", explorer: "low" },
  maxParallel: 4,
  verifyCommand: "",
  permission: "ask",
  providers: {
    "my-vllm": { type: "openai", baseURL: "http://localhost:8000/v1", apiKeyEnv: "MY_VLLM_KEY" },
  },
  contextWindows: {},
  mcpServers: {},
};
