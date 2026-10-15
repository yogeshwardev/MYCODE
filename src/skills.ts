import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SWARMCODE_HOME } from "./config.js";
import { ToolError, type Tool } from "./tools/types.js";

// Skills are expert playbooks written in Markdown with a small frontmatter:
//
//   ---
//   name: security-review
//   description: One line saying when to use it.
//   ---
//   Instructions...
//
// Agents see only the name + description of each skill (a few tokens each) and
// load the full instructions with the use_skill tool when a task calls for it.
// Sources, later ones overriding earlier ones by name: built-in skills shipped
// with SwarmCode, ~/.swarmcode/skills, and <project>/.swarmcode/skills.

export interface Skill {
  name: string;
  description: string;
  /** Words or phrases that suggest the skill applies (frontmatter "triggers", comma-separated). */
  triggers: string[];
  body: string;
  source: "built-in" | "user" | "project";
}

function builtinDir(): string | undefined {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // src/ or dist/ in the package, or next to a bundled desktop main script.
  for (const candidate of [path.join(here, "..", "skills"), path.join(here, "skills"), path.join(here, "..", "..", "skills")]) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return undefined;
}

export function parseSkill(text: string, source: Skill["source"]): Skill | undefined {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) return undefined;
  const meta: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^(\w+)\s*:\s*(.*)$/.exec(line);
    if (kv) meta[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, "");
  }
  if (!meta.name || !meta.description) return undefined;
  const triggers = (meta.triggers ?? "").split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
  return { name: meta.name, description: meta.description, triggers, body: m[2].trim(), source };
}

export function loadSkills(root: string): Skill[] {
  const byName = new Map<string, Skill>();
  const dirs: Array<[string | undefined, Skill["source"]]> = [
    [builtinDir(), "built-in"],
    [path.join(SWARMCODE_HOME, "skills"), "user"],
    [path.join(root, ".swarmcode", "skills"), "project"],
  ];
  for (const [dir, source] of dirs) {
    if (!dir || !fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".md")).sort()) {
      const skill = parseSkill(fs.readFileSync(path.join(dir, f), "utf8"), source);
      if (skill) byName.set(skill.name, skill);
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** The short index that goes into system prompts. */
export function skillIndex(skills: Skill[]): string {
  return skills.map((s) => `- ${s.name}: ${s.description}`).join("\n");
}

export function makeSkillTool(skills: Skill[]): Tool {
  return {
    readOnly: true,
    spec: {
      name: "use_skill",
      description:
        "Load the full instructions of a skill (an expert playbook) listed in <skills>. Load a skill before starting a task it covers, and follow it.",
      parameters: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
    },
    async run(input) {
      const name = String(input.name);
      const skill = skills.find((s) => s.name === name);
      if (!skill) throw new ToolError(`No skill named "${name}". Available: ${skills.map((s) => s.name).join(", ")}`);
      return `# Skill: ${skill.name}\n\n${skill.body}`;
    },
  };
}

const STOP = new Set("a an the and or of to in on for with is are be it this that my our your me we i you do does how what why can could should would please make add fix use using code file files project app".split(" "));
const words = (t: string) => t.toLowerCase().split(/[^a-z0-9+#.]+/).filter((w) => w.length > 2 && !STOP.has(w));

/**
 * Skills that look relevant to a request, best first. Trigger phrases count
 * most, then words shared with the name and description. Cheap and local, so
 * it runs on every request; the agent still decides whether to load them.
 */
export function suggestSkills(request: string, skills: Skill[], max = 2): Skill[] {
  return rankSkills(request, skills, max).map((x) => x.skill);
}

/** A score at which a skill clearly fits the request (e.g. two trigger words). */
export const STRONG_SKILL_MATCH = 7;

/** Skills matching a request, best first, with a score (trigger phrase 4, trigger word 3, shared word 1). */
export function rankSkills(request: string, skills: Skill[], max = 2): Array<{ skill: Skill; score: number }> {
  const text = ` ${request.toLowerCase().replace(/\s+/g, " ")} `;
  const reqWords = new Set(words(request));
  const scored = skills.map((s) => {
    let score = 0;
    for (const t of s.triggers) if (text.includes(t.includes(" ") ? t : ` ${t}`)) score += t.includes(" ") ? 4 : 3;
    for (const w of new Set([...words(s.name.replace(/-/g, " ")), ...words(s.description)])) if (reqWords.has(w)) score += 1;
    return { s, score };
  });
  return scored
    .filter((x) => x.score >= 3)
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map((x) => ({ skill: x.s, score: x.score }));
}
