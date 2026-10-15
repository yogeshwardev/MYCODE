import type { ToolSpec } from "../providers/types.js";

export type ApprovalKind = "write" | "bash" | "mcp" | "swarm" | "web";

export interface ToolContext {
  /** Workspace root; every path is confined to it. */
  root: string;
  /** Ask the user before a side-effecting action. Resolves false if declined. */
  approve: (kind: ApprovalKind, summary: string) => Promise<boolean>;
  signal?: AbortSignal;
  /**
   * What this agent has already read (key -> file version). Lets read_file
   * answer "unchanged" instead of resending content already in context. The
   * agent clears it whenever its history is compacted.
   */
  readCache?: Map<string, string>;
  /** Called with an absolute path just before a tool modifies it (powers undo). */
  checkpoint?: (file: string) => void;
  /** Runs after-edit hooks (formatters, linters) on a written file; returns a note for the model, if any. */
  afterWrite?: (file: string) => Promise<string | undefined>;
}

export interface Tool {
  spec: ToolSpec;
  /** Read-only tools may run in parallel and are given to explorer agents. */
  readOnly: boolean;
  run(input: Record<string, unknown>, ctx: ToolContext): Promise<string>;
}

export class ToolError extends Error {}
