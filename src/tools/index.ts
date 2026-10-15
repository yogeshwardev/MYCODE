import fs from "node:fs";
import path from "node:path";
import type { ToolSpec } from "../providers/types.js";
import {
  clip,
  confine,
  detectShell,
  globToRegExp,
  hasRipgrep,
  invalidateFileList,
  listFiles,
  run,
  runShell,
  toPosix,
} from "../util.js";

export type { ApprovalKind, Tool, ToolContext } from "./types.js";
export { ToolError } from "./types.js";
import { ToolError, type Tool, type ToolContext } from "./types.js";
import { webFetch, webSearch } from "./web.js";
import { securityScan } from "./security.js";
import { BROWSER_TOOLS } from "./browser.js";
import { generatePdf, readDocument } from "./documents.js";
import { processOutput, processStop, runInBackground } from "./processes.js";

const str = (input: Record<string, unknown>, key: string) => input[key] as string;

function version(file: string): string {
  const st = fs.statSync(file);
  return `${st.mtimeMs}:${st.size}`;
}

/** After a write, forget cached reads of that file and refresh file listings. */
function touched(ctx: ToolContext, file: string) {
  invalidateFileList(ctx.root);
  if (!ctx.readCache) return;
  for (const key of [...ctx.readCache.keys()]) if (key.startsWith(file + "|")) ctx.readCache.delete(key);
}

function numbered(lines: string[], start: number): string {
  const width = String(start + lines.length).length;
  return lines.map((l, i) => `${String(start + i).padStart(width)}\t${l.length > 2000 ? l.slice(0, 2000) + "…" : l}`).join("\n");
}

const readFile: Tool = {
  readOnly: true,
  spec: {
    name: "read_file",
    description:
      "Read a text file. Returns numbered lines. Use offset/limit (1-based line numbers) for large files; at most 2000 lines are returned per call. Re-reading an unchanged file returns a short notice instead of the content.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path relative to the workspace root" },
        offset: { type: "integer", description: "First line to read (1-based)" },
        limit: { type: "integer", description: "Number of lines to read" },
      },
      required: ["path"],
    },
  },
  async run(input, ctx) {
    const rel = str(input, "path");
    const file = confine(ctx.root, rel);
    if (!fs.existsSync(file)) throw new ToolError(`File not found: ${rel}`);
    if (fs.statSync(file).isDirectory()) throw new ToolError(`${rel} is a directory; use list_dir`);
    const start = Math.max(1, Number(input.offset ?? 1));
    const count = Math.min(2000, Math.max(1, Number(input.limit ?? 2000)));
    const key = `${file}|${start}|${count}`;
    const ver = version(file);
    if (ctx.readCache?.get(key) === ver) {
      return `[${rel} lines ${start}+ are unchanged since you last read them; use that earlier result.]`;
    }
    const buf = fs.readFileSync(file);
    if (buf.subarray(0, 8000).includes(0)) throw new ToolError(`${rel} looks like a binary file.`);
    const lines = buf.toString("utf8").split(/\r?\n/);
    const slice = lines.slice(start - 1, start - 1 + count);
    let out = numbered(slice, start);
    const end = start - 1 + slice.length;
    if (end < lines.length) out += `\n\n[Showing lines ${start}-${end} of ${lines.length}. Use offset to read more.]`;
    ctx.readCache?.set(key, ver);
    return clip(out, 60_000) || "(empty file)";
  },
};

const writeFile: Tool = {
  readOnly: false,
  spec: {
    name: "write_file",
    description: "Create or overwrite a file with the given content. Prefer edit_file for changes to existing files.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        content: { type: "string" },
      },
      required: ["path", "content"],
    },
  },
  async run(input, ctx) {
    const rel = str(input, "path");
    const file = confine(ctx.root, rel);
    const existed = fs.existsSync(file);
    if (!(await ctx.approve("write", `${existed ? "Overwrite" : "Create"} ${rel}`))) throw new ToolError("User declined the write.");
    ctx.checkpoint?.(file);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, str(input, "content"));
    touched(ctx, file);
    const note = await ctx.afterWrite?.(file);
    return `${existed ? "Overwrote" : "Created"} ${rel} (${str(input, "content").split("\n").length} lines)${note ? `\n${note}` : ""}`;
  },
};

interface EditOp {
  old_string: string;
  new_string: string;
  replace_all?: boolean;
}

const editFile: Tool = {
  readOnly: false,
  spec: {
    name: "edit_file",
    description:
      "Replace exact strings in a file. Give one replacement with old_string/new_string, or several at once with edits (applied in order, all-or-nothing) to save round trips. old_string must match exactly, including whitespace, and be unique unless replace_all is true. Returns the edited region with line numbers, so there is no need to re-read the file to check the result.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        old_string: { type: "string" },
        new_string: { type: "string" },
        replace_all: { type: "boolean" },
        edits: {
          type: "array",
          description: "Multiple replacements in one call",
          items: {
            type: "object",
            properties: {
              old_string: { type: "string" },
              new_string: { type: "string" },
              replace_all: { type: "boolean" },
            },
            required: ["old_string", "new_string"],
          },
        },
      },
      required: ["path"],
    },
  },
  async run(input, ctx) {
    const rel = str(input, "path");
    const file = confine(ctx.root, rel);
    if (!fs.existsSync(file)) throw new ToolError(`File not found: ${rel}. Use write_file to create it.`);
    const ops: EditOp[] = Array.isArray(input.edits) && input.edits.length
      ? (input.edits as EditOp[])
      : [{ old_string: str(input, "old_string"), new_string: str(input, "new_string"), replace_all: Boolean(input.replace_all) }];

    const raw = fs.readFileSync(file, "utf8");
    const crlf = raw.includes("\r\n");
    let text = crlf ? raw.replace(/\r\n/g, "\n") : raw;
    const changedAt: number[] = [];
    for (const [i, op] of ops.entries()) {
      const label = ops.length > 1 ? `Edit ${i + 1}: ` : "";
      if (typeof op.old_string !== "string" || typeof op.new_string !== "string") {
        throw new ToolError(
          `${label}old_string and new_string are required. Call as {"path": "...", "old_string": "exact text", "new_string": "replacement"} or {"path": "...", "edits": [{"old_string": "...", "new_string": "..."}]}.`,
        );
      }
      const oldS = op.old_string.replace(/\r\n/g, "\n");
      const newS = op.new_string.replace(/\r\n/g, "\n");
      if (!oldS) throw new ToolError(`${label}old_string is empty. Use write_file to create or replace a whole file.`);
      // A no-op edit isn't an error: models retry errors, so just move on.
      if (oldS === newS) continue;
      const count = text.split(oldS).length - 1;
      if (count === 0) throw new ToolError(`${label}old_string was not found. Nothing was changed. Re-read the file and copy the text exactly.`);
      if (count > 1 && !op.replace_all) {
        throw new ToolError(`${label}old_string occurs ${count} times. Add surrounding context to make it unique, or set replace_all. Nothing was changed.`);
      }
      changedAt.push(text.indexOf(oldS));
      text = op.replace_all ? text.split(oldS).join(newS) : text.replace(oldS, () => newS);
    }
    if (!changedAt.length) return `No change needed in ${rel}: old_string and new_string are identical, so the file already reads that way.`;
    if (!(await ctx.approve("write", `Edit ${rel}${ops.length > 1 ? ` (${ops.length} changes)` : ""}`))) {
      throw new ToolError("User declined the edit.");
    }
    ctx.checkpoint?.(file);
    fs.writeFileSync(file, crlf ? text.replace(/\n/g, "\r\n") : text);
    touched(ctx, file);

    // Show the region around the first change so the model can confirm it.
    const lines = text.split("\n");
    const firstLine = text.slice(0, Math.min(...changedAt)).split("\n").length;
    const from = Math.max(1, firstLine - 3);
    const snippet = numbered(lines.slice(from - 1, from - 1 + 14), from);
    const note = await ctx.afterWrite?.(file);
    return `Edited ${rel} (${ops.length} change${ops.length > 1 ? "s" : ""}). Region after the edit:\n${snippet}${note ? `\n${note}` : ""}`;
  },
};

const listDir: Tool = {
  readOnly: true,
  spec: {
    name: "list_dir",
    description: "List the entries of a directory (directories end with /).",
    parameters: { type: "object", properties: { path: { type: "string", description: "Defaults to the root" } } },
  },
  async run(input, ctx) {
    const dir = confine(ctx.root, str(input, "path") || ".");
    if (!fs.existsSync(dir)) throw new ToolError(`No such directory: ${str(input, "path")}`);
    const entries = fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.name !== ".git")
      .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
      .sort();
    if (!entries.length) return "(empty)";
    return entries.slice(0, 500).join("\n") + (entries.length > 500 ? `\n... ${entries.length - 500} more` : "");
  },
};

const glob: Tool = {
  readOnly: true,
  spec: {
    name: "glob",
    description: 'Find files by glob pattern, e.g. "src/**/*.ts" or "*.test.js". Respects .gitignore.',
    parameters: { type: "object", properties: { pattern: { type: "string" } }, required: ["pattern"] },
  },
  async run(input, ctx) {
    const re = globToRegExp(str(input, "pattern"));
    const hits = (await listFiles(ctx.root)).filter((f) => re.test(f));
    if (!hits.length) return "No files matched.";
    return hits.slice(0, 300).join("\n") + (hits.length > 300 ? `\n... ${hits.length - 300} more` : "");
  },
};

const grep: Tool = {
  readOnly: true,
  spec: {
    name: "grep",
    description:
      'Search file contents with a regular expression. Returns path:line: text. Narrow with a glob (e.g. "**/*.py"). Respects .gitignore.',
    parameters: {
      type: "object",
      properties: {
        pattern: { type: "string" },
        glob: { type: "string" },
        ignore_case: { type: "boolean" },
        max_results: { type: "integer" },
      },
      required: ["pattern"],
    },
  },
  async run(input, ctx) {
    const pattern = str(input, "pattern");
    const max = Math.min(1000, Number(input.max_results ?? 200));
    let re: RegExp;
    try {
      re = new RegExp(pattern, input.ignore_case ? "i" : "");
    } catch (err) {
      throw new ToolError(`Invalid regex: ${(err as Error).message}`);
    }
    if (hasRipgrep()) {
      const fast = await ripgrep(ctx.root, pattern, input, max, ctx.signal);
      if (fast !== undefined) return fast;
    }
    const fileRe = input.glob ? globToRegExp(str(input, "glob")) : undefined;
    const results: string[] = [];
    for (const f of await listFiles(ctx.root)) {
      if (fileRe && !fileRe.test(f)) continue;
      const full = path.join(ctx.root, f);
      let content: string;
      try {
        if (fs.statSync(full).size > 2_000_000) continue;
        content = fs.readFileSync(full, "utf8");
      } catch {
        continue;
      }
      if (content.includes("\0")) continue; // binary
      const lines = content.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        if (re.test(lines[i])) {
          results.push(`${f}:${i + 1}: ${lines[i].trim().slice(0, 300)}`);
          if (results.length >= max) return results.join("\n") + `\n[stopped at ${max} results]`;
        }
      }
    }
    return results.length ? results.join("\n") : "No matches.";
  },
};

/** ripgrep is 10-100x faster on big repos. Returns undefined to fall back. */
async function ripgrep(root: string, pattern: string, input: Record<string, unknown>, max: number, signal?: AbortSignal) {
  const args = ["-n", "--no-heading", "--color", "never", "--max-columns", "300", "--max-columns-preview", "-g", "!.swarmcode/"];
  if (input.ignore_case) args.push("-i");
  if (input.glob) args.push("-g", str(input, "glob"));
  args.push("-e", pattern, "--", ".");
  const r = await run("rg", args, { cwd: root, timeoutMs: 60_000, signal });
  if (r.code === 1) return "No matches.";
  if (r.code !== 0) return undefined; // e.g. regex syntax rg doesn't support
  const lines = r.stdout.split(/\r?\n/).filter(Boolean).map((l) => toPosix(l.replace(/^\.[\\/]/, "")).replace(/^(\S+?):(\d+):\s*/, "$1:$2: "));
  return lines.slice(0, max).join("\n") + (lines.length > max ? `\n[stopped at ${max} of ${lines.length} results]` : "");
}

const bash: Tool = {
  readOnly: false,
  spec: {
    name: "bash",
    description: `Run a shell command in the workspace root (shell: ${detectShell().name}). Use for builds, tests, git, package managers. Output is truncated if very long. Avoid interactive commands. For long-running commands (dev servers, watchers), set background: true and check on them with process_output.`,
    parameters: {
      type: "object",
      properties: {
        command: { type: "string" },
        timeout_ms: { type: "integer", description: "Default 120000, max 600000" },
        background: { type: "boolean", description: "Run without waiting (servers, watchers); returns a process id" },
      },
      required: ["command"],
    },
  },
  async run(input, ctx) {
    const command = str(input, "command");
    if (DANGEROUS.some((re) => re.test(command))) throw new ToolError("Refused: this command could wipe or disable the whole system. Never run it.");
    if (!(await ctx.approve("bash", input.background ? `${command}  (in the background)` : command))) throw new ToolError("User declined the command.");
    if (input.background) return runInBackground(command, ctx.root, ctx.signal);
    const timeout = Math.min(600_000, Number(input.timeout_ms ?? 120_000));
    const r = await runShell(command, ctx.root, timeout, ctx.signal);
    // Commands may change files behind our back.
    invalidateFileList(ctx.root);
    ctx.readCache?.clear();
    let out = "";
    if (r.stdout) out += r.stdout;
    if (r.stderr) out += (out ? "\n" : "") + r.stderr;
    out = clip(out.trim() || "(no output)");
    if (r.timedOut) out += `\n[timed out after ${timeout}ms]`;
    return `exit code ${r.code}\n${out}`;
  },
};

const DANGEROUS = [
  /\brm\s+-[a-z]*r[a-z]*\s+(\/|~|\$HOME)(\s|$|\*)/i,
  /\bmkfs\b/,
  /\bdd\s+if=.*of=\/dev\//,
  /:\(\)\s*\{\s*:\|:&\s*\};:/,
  /\bformat\s+[a-z]:/i,
  /\bshutdown\b|\breboot\b/,
];

export const CORE_TOOLS: Tool[] = [readFile, readDocument, listDir, glob, grep, securityScan, editFile, writeFile, generatePdf, bash, processOutput, processStop, webFetch, webSearch, ...BROWSER_TOOLS];
export const READ_ONLY_TOOLS: Tool[] = CORE_TOOLS.filter((t) => t.readOnly);

/** Light schema check: required keys present and primitive types right. */
export function validateInput(spec: ToolSpec, input: Record<string, unknown>): string | undefined {
  for (const key of spec.parameters.required ?? []) {
    if (input[key] === undefined || input[key] === null) return `Missing required parameter "${key}".`;
  }
  for (const [key, value] of Object.entries(input)) {
    const prop = spec.parameters.properties[key] as { type?: string } | undefined;
    if (!prop?.type || value === undefined || value === null) continue;
    const ok =
      prop.type === "string" ? typeof value === "string"
      : prop.type === "integer" ? Number.isInteger(value)
      : prop.type === "number" ? typeof value === "number"
      : prop.type === "boolean" ? typeof value === "boolean"
      : prop.type === "array" ? Array.isArray(value)
      : prop.type === "object" ? typeof value === "object"
      : true;
    if (!ok) return `Parameter "${key}" must be of type ${prop.type}.`;
  }
  return undefined;
}

export function describeCall(name: string, input: Record<string, unknown>, root: string): string {
  const p = typeof input.path === "string" ? toPosix(input.path) : "";
  switch (name) {
    case "read_file":
    case "read_document":
    case "write_file":
    case "list_dir":
      return p || ".";
    case "edit_file":
      return Array.isArray(input.edits) && input.edits.length > 1 ? `${p} (${input.edits.length} changes)` : p;
    case "glob":
      return String(input.pattern ?? "");
    case "grep":
      return `/${input.pattern}/${input.glob ? ` in ${input.glob}` : ""}`;
    case "bash":
      return `${String(input.command ?? "").split("\n")[0].slice(0, 120)}${input.background ? "  (background)" : ""}`;
    case "browser_navigate":
    case "web_fetch":
      return String(input.url ?? "");
    case "browser_click":
    case "browser_type":
      return input.ref !== undefined ? `ref ${input.ref}` : String(input.text ?? input.selector ?? "");
    case "process_output":
    case "process_stop":
      return String(input.id ?? "all");
    case "generate_pdf":
      return String(input.output ?? "");
    case "use_skill":
      return String(input.name ?? "");
    case "delegate":
      return (input.tasks as Array<{ label?: string }> | undefined)?.map((t) => t.label).join(", ") ?? "";
    case "swarm":
      return String(input.goal ?? "").slice(0, 100);
    default:
      return JSON.stringify(input).slice(0, 120).replace(root, ".");
  }
}
