// Types shared by the Electron main process, the preload bridge and the UI.
import type { AgentEvent } from "../../src/agent/events.js";
import type { Plan } from "../../src/swarm/planner.js";
import type { TaskState } from "../../src/swarm/orchestrator.js";

export type { AgentEvent, Plan, TaskState };

export type Role = "main" | "planner" | "worker" | "explorer";

export interface ProjectInfo {
  root: string;
  name: string;
  isRepo: boolean;
  models: Record<Role, string>;
  maxParallel: number;
  mcpTools: number;
  warnings: string[];
}

export interface SessionSummary {
  id: string;
  title: string;
  updated: string;
}

export interface Settings {
  models: Record<Role, string>;
  effort: Record<Role, string>;
  maxParallel: number;
  verifyCommand: string;
  permission: "ask" | "auto";
  budgetUsd: number | null;
}

export interface ProviderStatus {
  name: string;
  envVar?: string;
  /** Key comes from the environment or the app's encrypted store. */
  source: "env" | "app" | "none" | "local";
}

export interface UsageInfo {
  costUsd: number | null;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  contextTokens: number;
  contextWindow: number;
}

/** Something the engine needs the user to decide. */
export type UserRequest =
  | { id: string; kind: "approve"; approval: string; summary: string }
  | { id: string; kind: "plan"; plan: Plan }
  | { id: string; kind: "apply"; report: string; diff: string }
  | { id: string; kind: "mode"; size: string; reason: string; recommended: string; why: string; options: ModeOption[] }
  | { id: string; kind: "question"; question: string; options: string[] };

export interface ModeOption {
  mode: "agent" | "swarm" | "best";
  tokens: number;
  seconds: number;
  costUsd: number | null;
  fitsBudget: boolean;
}

export interface AccountView {
  provider: "github" | "google";
  name: string;
  login?: string;
  email?: string;
  avatar?: string;
}

export interface HealthReportView {
  score: number;
  items: Array<{ area: string; severity: "critical" | "high" | "medium" | "low" | "info"; title: string; detail: string; fixPrompt?: string }>;
  stats: { files: number; sourceFiles: number; testFiles: number };
}

export type RequestAnswer = { allow: boolean; always?: boolean; mode?: "agent" | "swarm" | "best"; text?: string };

/** An image the user pasted or dropped into the composer. */
export interface ImageAttachment {
  mediaType: string;
  /** Base64 without the data: prefix. */
  data: string;
}

export interface SendOptions {
  plan?: boolean;
  images?: ImageAttachment[];
}

export interface AppState {
  recent: string[];
  providers: ProviderStatus[];
  secureStorage: boolean;
  version: string;
  /** process.platform, for window chrome layout. */
  platform: string;
  account: AccountView | null;
  /** Which sign-in providers this build is configured for. */
  signIn: { github: boolean; google: boolean };
}

/** Messages pushed from main to the window. */
export type Push =
  | { type: "event"; event: AgentEvent }
  | { type: "tasks"; tasks: TaskState[] }
  | { type: "request"; request: UserRequest }
  | { type: "result"; report: string; diff: string }
  | { type: "usage"; usage: UsageInfo }
  | { type: "warning"; message: string }
  | { type: "device-code"; code: string; url: string };

/** The API the preload script exposes as window.swarm. */
export interface SwarmApi {
  state(): Promise<AppState>;
  openProject(path?: string): Promise<ProjectInfo | null>;
  send(prompt: string, skills?: string[], guarantee?: boolean, opts?: SendOptions): Promise<{ text: string }>;
  review(focus?: string): Promise<{ approved: boolean; feedback: string; scope: string }>;
  auto(goal: string, guarantee?: boolean, skills?: string[]): Promise<{ text: string; pick: string }>;
  health(runTests: boolean): Promise<HealthReportView>;
  undo(): Promise<string[]>;
  skills(): Promise<Array<{ name: string; description: string }>>;
  swarm(goal: string, guarantee?: boolean): Promise<{ report: string; applied: boolean; branch: string | null }>;
  bestOf(goal: string, n: number, guarantee?: boolean): Promise<{ report: string; applied: boolean; branch: string | null; winner: number | null }>;
  abort(): Promise<void>;
  answer(id: string, answer: RequestAnswer): Promise<void>;
  newConversation(): Promise<void>;
  sessions(): Promise<SessionSummary[]>;
  resume(id: string): Promise<Array<{ role: "user" | "assistant"; text: string }>>;
  workingDiff(): Promise<string>;
  getSettings(): Promise<Settings>;
  saveSettings(s: Settings): Promise<ProjectInfo | null>;
  setKey(provider: string, key: string): Promise<AppState>;
  openExternal(url: string): Promise<void>;
  signIn(provider: "github" | "google"): Promise<AppState>;
  cancelSignIn(): Promise<void>;
  signOut(): Promise<AppState>;
  onPush(cb: (p: Push) => void): () => void;
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
/** A request before main assigns it an id. */
export type NewRequest = DistributiveOmit<UserRequest, "id">;
