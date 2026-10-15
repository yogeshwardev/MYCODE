import fs from "node:fs";
import path from "node:path";
import type { AgentEvent } from "./agent/events.js";

// Audit trail: an append-only JSON Lines record of everything that happened in
// a session: requests, every tool call by every agent, approvals and their
// decisions, quality-gate outcomes, results and spend. Security and compliance
// teams can review exactly what an AI agent did on a machine.

export const TRACE_DIR = path.join(".swarmcode", "traces");

export type AuditRecord =
  | { type: "request"; mode: string; prompt: string }
  | { type: "checkpoint"; commit: string }
  | { type: "event"; event: AgentEvent }
  | { type: "approval"; kind: string; summary: string; allowed: boolean }
  | { type: "result"; mode: string; summary: string }
  | { type: "usage"; usage: unknown }
  | { type: "error"; message: string };

export class AuditTrail {
  constructor(private readonly file: string) {}

  get path() {
    return this.file;
  }

  record(rec: AuditRecord) {
    // Streaming text deltas and turn markers are noise for an audit; the final
    // answers are recorded through "result".
    if (rec.type === "event" && (rec.event.type === "text" || rec.event.type === "turn_start" || rec.event.type === "turn_end" || rec.event.type === "assistant_done")) return;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.appendFileSync(this.file, JSON.stringify({ ts: new Date().toISOString(), ...rec }) + "\n");
    } catch {
      /* auditing must never break the agent */
    }
  }
}

export function listTraces(root: string): string[] {
  const dir = path.join(root, TRACE_DIR);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".jsonl"))
    .map((f) => path.join(dir, f))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
}

/** Render a trace as a readable timeline (used by `swarm trace`). */
export function renderTrace(file: string): string {
  const out: string[] = [];
  for (const line of fs.readFileSync(file, "utf8").split("\n").filter(Boolean)) {
    let r: Record<string, unknown>;
    try {
      r = JSON.parse(line);
    } catch {
      continue;
    }
    const t = String(r.ts).slice(11, 19);
    switch (r.type) {
      case "request":
        out.push(`\n${t}  REQUEST (${r.mode})  ${String(r.prompt).replace(/\s+/g, " ").slice(0, 200)}`);
        break;
      case "approval":
        out.push(`${t}  ${r.allowed ? "APPROVED" : "DENIED  "}  ${r.kind}: ${String(r.summary).split("\n")[0].slice(0, 160)}`);
        break;
      case "result":
        out.push(`${t}  RESULT (${r.mode})  ${String(r.summary).replace(/\s+/g, " ").slice(0, 300)}`);
        break;
      case "error":
        out.push(`${t}  ERROR  ${r.message}`);
        break;
      case "usage":
        out.push(`${t}  USAGE  ${JSON.stringify((r.usage as { totals?: unknown })?.totals ?? r.usage)}`);
        break;
      case "event": {
        const e = r.event as AgentEvent;
        if (e.type === "tool") out.push(`${t}  [${e.agent}] ${e.name} ${e.summary}`);
        else if (e.type === "tool_error") out.push(`${t}  [${e.agent}] ${e.name} FAILED: ${e.error.split("\n")[0].slice(0, 160)}`);
        else if (e.type === "status") out.push(`${t}  -- ${e.message}`);
        else if (e.type === "compacted") out.push(`${t}  [${e.agent}] context compacted ${e.before} -> ${e.after}`);
        break;
      }
    }
  }
  return out.join("\n").trim();
}
