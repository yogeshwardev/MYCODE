import fs from "node:fs";
import path from "node:path";
import { readMemory } from "../tools/memory.js";
import { estimateTokens, listFiles } from "../util.js";

// A compact map of the repository: the file tree plus top-level symbols.
// Every agent gets it up front, so it spends far fewer turns (and tokens)
// discovering where things live.

const SOURCE_EXT = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".go", ".rs", ".java", ".kt", ".cs",
  ".rb", ".php", ".swift", ".c", ".h", ".cpp", ".hpp", ".scala", ".dart", ".vue", ".svelte",
]);

const SYMBOL_PATTERNS: RegExp[] = [
  /^\s*export\s+(?:default\s+)?(?:async\s+)?(?:function\*?|class|interface|type|enum|const|let|abstract\s+class)\s+([A-Za-z_$][\w$]*)/,
  /^\s*(?:async\s+)?function\*?\s+([A-Za-z_$][\w$]*)/,
  /^\s*class\s+([A-Za-z_$][\w$]*)/,
  /^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)/,
  /^func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/,
  /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:fn|struct|enum|trait|impl)\s+([A-Za-z_]\w*)/,
  /^\s*(?:public|private|protected|internal)\s+(?:static\s+)?(?:final\s+)?(?:class|interface|record|enum)\s+([A-Za-z_]\w*)/,
  /^type\s+([A-Za-z_]\w*)\s+(?:struct|interface)/,
];

function symbolsOf(file: string): string[] {
  let text: string;
  try {
    if (fs.statSync(file).size > 300_000) return [];
    text = fs.readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    // Only unindented (or lightly indented, for Python methods) declarations.
    if (/^\s{5,}/.test(line)) continue;
    for (const re of SYMBOL_PATTERNS) {
      const m = re.exec(line);
      if (m) {
        out.push(line.trim().replace(/\s*[{:]\s*$/, "").slice(0, 120));
        break;
      }
    }
    if (out.length >= 40) break;
  }
  return out;
}

export async function buildRepoMap(root: string, tokenBudget = 6000): Promise<string> {
  const files = (await listFiles(root)).sort();
  if (!files.length) return "(empty workspace)";
  const lines: string[] = [`${files.length} files.`];
  let used = estimateTokens(lines[0]);
  let truncated = 0;
  for (const f of files) {
    const entry = [f];
    if (SOURCE_EXT.has(path.extname(f))) {
      for (const s of symbolsOf(path.join(root, f))) entry.push(`  ${s}`);
    }
    let cost = estimateTokens(entry.join("\n"));
    if (used + cost > tokenBudget) {
      // Out of budget for symbols: keep listing file names only, while they fit.
      cost = estimateTokens(f);
      if (used + cost > tokenBudget) {
        truncated++;
        continue;
      }
      lines.push(f);
    } else lines.push(...entry);
    used += cost;
  }
  if (truncated) lines.push(`... and ${truncated} more files (use glob/grep to find them)`);
  return lines.join("\n");
}

/** Project instruction files, in the conventions other agents use too. */
export function loadProjectInstructions(root: string): string {
  const parts: string[] = [];
  for (const name of ["SWARMCODE.md", "AGENTS.md", "CLAUDE.md", ".cursorrules"]) {
    const p = path.join(root, name);
    if (fs.existsSync(p)) parts.push(`# ${name}\n${fs.readFileSync(p, "utf8").slice(0, 20_000)}`);
  }
  const memory = readMemory(root);
  if (memory) parts.push(`# Project memory (lessons learned in earlier sessions)\n${memory}`);
  return parts.join("\n\n");
}
