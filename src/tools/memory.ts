import fs from "node:fs";
import path from "node:path";
import { ToolError, type Tool } from "./types.js";

// Project memory: durable lessons the agent learns about a project (commands,
// conventions, gotchas, user preferences), stored in .swarmcode/memory.md and
// loaded into every future session's system prompt. Commit it to share with
// the team, or keep it local.

export const MEMORY_FILE = path.join(".swarmcode", "memory.md");
const MAX_BYTES = 20_000;
const LOOKS_SECRET = /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b|\bsk-[A-Za-z0-9_-]{16,}|-----BEGIN [A-Z ]*PRIVATE KEY|\bgh[pousr]_[A-Za-z0-9]{20,}|(?:password|passwd|secret|token|api[_-]?key)\s*[:=]\s*\S{6,}/i;

export function readMemory(root: string): string {
  const file = path.join(root, MEMORY_FILE);
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8").slice(0, MAX_BYTES) : "";
}

export function makeRememberTool(): Tool {
  return {
    readOnly: false,
    spec: {
      name: "remember",
      description:
        "Save a durable lesson about this project to its memory (.swarmcode/memory.md) so future sessions know it: build/test commands, conventions, architecture facts, gotchas, or preferences the user stated. Use sparingly, only for facts that will matter again. One short sentence per note. Never store secrets.",
      parameters: { type: "object", properties: { note: { type: "string" } }, required: ["note"] },
    },
    async run(input, ctx) {
      const note = String(input.note).replace(/\s+/g, " ").trim();
      if (!note) throw new ToolError("note is empty.");
      if (note.length > 500) throw new ToolError("Keep notes under 500 characters.");
      if (LOOKS_SECRET.test(note)) throw new ToolError("That note looks like it contains a secret; memory must never store secrets.");
      const file = path.join(ctx.root, MEMORY_FILE);
      const existing = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
      if (existing.includes(note)) return "Already in memory.";
      if (existing.length + note.length > MAX_BYTES) throw new ToolError("Project memory is full; ask the user to prune .swarmcode/memory.md.");
      if (!(await ctx.approve("write", `Remember: ${note}`))) throw new ToolError("User declined.");
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const header = existing ? "" : "# Project memory\n\nLessons SwarmCode has learned about this project. Edit freely.\n\n";
      fs.appendFileSync(file, `${header}- ${note} (${new Date().toISOString().slice(0, 10)})\n`);
      return "Saved to project memory.";
    },
  };
}
